param(
  [string]$Workflow = 'windows-agent-validation.yml',
  [ValidateSet('quick','full')][string]$Profile = 'full',
  [string]$Ref = '',
  [string]$ExpectedCommit = '',
  [int]$TimeoutSec = 900
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repo

if ([string]::IsNullOrWhiteSpace($Ref)) {
  $refOut = @(& git branch --show-current)
  if ($LASTEXITCODE -ne 0) { throw 'git branch --show-current failed' }
  $Ref = (($refOut -join "`n").Trim())
}
$headOut = @(& git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
$head = (($headOut -join "`n").Trim())
if ([string]::IsNullOrWhiteSpace($ExpectedCommit)) { $ExpectedCommit = $head }
if (-not [string]::Equals($head,$ExpectedCommit,[StringComparison]::OrdinalIgnoreCase)) { throw "CI_EXPECTED_COMMIT_LOCAL_MISMATCH expected=$ExpectedCommit actual=$head" }
$requestId = 'ci-' + [guid]::NewGuid().ToString('N').Substring(0,16)

function Invoke-GhJson([string[]]$GhArgs) {
  $raw = & gh @GhArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($raw | Out-String).Trim()) }
  $txt = ($raw | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($txt)) { return $null }
  return ($txt | ConvertFrom-Json)
}

$run = $null
if ($Profile -eq 'quick') {
  try {
    $list = @(Invoke-GhJson -GhArgs @('run','list','--workflow',$Workflow,'--branch',$Ref,'--limit','20','--json','databaseId,headSha,status,conclusion,url,event,createdAt,displayTitle'))
    $run = @(
      $list |
        Where-Object { ([string]$_.headSha -eq $head) -and ([string]$_.conclusion -eq 'success') } |
        Sort-Object createdAt -Descending |
        Select-Object -First 1
    )[0]
  } catch {}
}

if ($null -eq $run) {
  $before = @()
  try {
    $before = @(
      Invoke-GhJson -GhArgs @('run','list','--workflow',$Workflow,'--branch',$Ref,'--event','workflow_dispatch','--limit','30','--json','databaseId') |
        ForEach-Object { [int64]$_.databaseId }
    )
  } catch {}

  $dispatchArgs = @('workflow','run',$Workflow,'--ref',$Ref,'-f',"profile=$Profile",'-f',"request_id=$requestId")
  if ($Profile -eq 'full') { $dispatchArgs += @('-f',"expected_commit=$ExpectedCommit") }
  $dispatch = & gh @dispatchArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($dispatch | Out-String).Trim()) }

  $resolveDeadline = [DateTime]::UtcNow.AddSeconds(60)
  $match = @()
  while ([DateTime]::UtcNow -lt $resolveDeadline) {
    Start-Sleep -Seconds 2
    $list = @(Invoke-GhJson -GhArgs @('run','list','--workflow',$Workflow,'--branch',$Ref,'--event','workflow_dispatch','--limit','30','--json','databaseId,headSha,status,conclusion,url,event,createdAt,displayTitle'))
    $match = @(
      $list |
        Where-Object {
          ([string]$_.headSha -eq $head) -and
          ($before -notcontains [int64]$_.databaseId) -and
          ([string]$_.displayTitle -like "*$requestId*")
        } |
        Sort-Object createdAt -Descending |
        Select-Object -First 1
    )
    if ($match.Count -gt 0) { break }
  }
  if ($match.Count -eq 0) { throw "CI_DISPATCH_RUN_NOT_RESOLVED request_id=$requestId" }
  $runId = [int64]$match[0].databaseId
} else {
  $runId = [int64]$run.databaseId
  $requestId = 'reused'
}

$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(30,$TimeoutSec))
$view = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $view = Invoke-GhJson -GhArgs @('run','view',[string]$runId,'--json','status,conclusion,headSha,headBranch,workflowName,url,jobs,displayTitle')
  if ([string]$view.headSha -ne $ExpectedCommit) { throw "CI_SHA_MISMATCH expected=$ExpectedCommit actual=$($view.headSha)" }
  if ([string]$view.status -eq 'completed') { break }
  Start-Sleep -Seconds 5
}
if (($null -eq $view) -or ([string]$view.status -ne 'completed')) { throw "CI_TIMEOUT run_id=$runId" }

$failed = @()
foreach ($job in @($view.jobs)) {
  foreach ($step in @($job.steps)) {
    if ([string]$step.conclusion -in @('failure','cancelled','timed_out')) {
      $failed += @{job=[string]$job.name;step=[string]$step.name;conclusion=[string]$step.conclusion}
    }
  }
}

$logPath = ''
$excerpt = ''
if ([string]$view.conclusion -ne 'success') {
  $dir = Join-Path $env:LOCALAPPDATA 'SOKNA\Bridge\ci-results'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $logPath = Join-Path $dir ("github-run-$runId-failed.log")

  # continue-on-error hides the original failing steps from --log-failed. Pull the
  # full run once, persist it as evidence, and reduce it locally to the real failed
  # step groups so chat never needs a second manual log-extraction round trip.
  $lines = @(& gh run view $runId --log 2>&1)
  if ($LASTEXITCODE -ne 0) { $lines = @(& gh run view $runId --log-failed 2>&1) }
  [IO.File]::WriteAllText($logPath,(($lines | Out-String)),[Text.UTF8Encoding]::new($false))

  $groups = @{}
  foreach ($line in $lines) {
    $parts = @(([string]$line) -split "`t",3)
    if ($parts.Count -lt 3) { continue }
    $key = ([string]$parts[0]) + "`t" + ([string]$parts[1])
    if (-not $groups.ContainsKey($key)) { $groups[$key] = New-Object System.Collections.ArrayList }
    [void]$groups[$key].Add([string]$line)
  }

  $detected = @()
  foreach ($key in @($groups.Keys | Sort-Object)) {
    $stepLines = @($groups[$key])
    $hasError = $false
    foreach ($line in $stepLines) {
      if ([string]$line -match '##\[error\]') { $hasError = $true; break }
    }
    if (-not $hasError) { continue }
    $pair = @(([string]$key) -split "`t",2)
    $detected += [pscustomobject]@{job=[string]$pair[0];step=[string]$pair[1];conclusion='failure';lines=$stepLines}
  }

  $rootFailures = @($detected | Where-Object { [string]$_.step -ne 'Windows diagnostic gate' })
  if ($rootFailures.Count -eq 0) { $rootFailures = @($detected) }
  if ($rootFailures.Count -gt 0) {
    $failed = @($rootFailures | ForEach-Object { @{job=[string]$_.job;step=[string]$_.step;conclusion='failure'} })
    $chunks = @()
    foreach ($item in $rootFailures) {
      $tail = ((@($item.lines) | Select-Object -Last 24 | Out-String).Trim())
      if ($tail.Length -gt 1200) { $tail = $tail.Substring($tail.Length - 1200) }
      $chunks += ("=== " + [string]$item.step + " ===`r`n" + $tail)
    }
    $excerpt = (($chunks -join "`r`n") | Out-String).Trim()
  } else {
    $excerpt = (($lines | Select-Object -Last 80 | Out-String).Trim())
  }
  if ($excerpt.Length -gt 4000) { $excerpt = $excerpt.Substring(0,4000) }
}

$summary = [ordered]@{
  schema = 'sokna-ci-summary-v1'
  ok = ([string]$view.conclusion -eq 'success')
  provider = 'github-actions'
  environment = 'github_windows_clean'
  profile = $Profile
  request_id = $requestId
  workflow = [string]$view.workflowName
  run_id = $runId
  url = [string]$view.url
  head_sha = [string]$view.headSha
  head_branch = [string]$view.headBranch
  conclusion = [string]$view.conclusion
  failed_steps = $failed
  failure_excerpt = $excerpt
  evidence_path = $logPath
}

if ($summary.ok -and $Profile -eq 'full') {
  $ticketPath = Join-Path $env:LOCALAPPDATA 'SOKNA\Bridge\autonomy-bootstrap\source-ci-ticket.json'
  $ticketDir = Split-Path $ticketPath -Parent
  if (-not (Test-Path $ticketDir)) { New-Item -ItemType Directory -Path $ticketDir -Force | Out-Null }
  $ticket = [ordered]@{
    schema = 'sokna-autonomy-ci-ticket-v1'
    commit = $ExpectedCommit
    ci_run_id = $runId
    ci_conclusion = 'success'
    profile = 'full'
    request_id = $requestId
    created_at = (Get-Date).ToUniversalTime().ToString('o')
  }
  [IO.File]::WriteAllText($ticketPath,($ticket | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
}

$summary | ConvertTo-Json -Depth 8 -Compress
if (-not $summary.ok) { exit 1 }
