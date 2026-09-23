param(
  [ValidateSet('quick','full')][string]$Profile = 'quick',
  [string]$RuntimeVersion = '2.5.5'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ($RuntimeVersion -eq '2.5.6') { throw 'CI_BLOCKED_RUNTIME_VERSION: 2.5.6' }

$runtime = Join-Path $repo ('native/runtime/v' + $RuntimeVersion)
$agentSrc = Join-Path $runtime 'agent.ps1'
$capsSrc = Join-Path $runtime 'AGENT_CAPABILITIES.json'
if (-not (Test-Path $agentSrc -PathType Leaf)) { throw "runtime missing: $agentSrc" }
if (-not (Test-Path $capsSrc -PathType Leaf)) { throw "capabilities missing: $capsSrc" }

$parseErrors = @()
$psFiles = git -C $repo ls-files '*.ps1'
foreach ($rel in $psFiles) {
  $tokens = $null
  $errs = $null
  [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $rel),[ref]$tokens,[ref]$errs)
  if ($errs) { $parseErrors += @($errs | ForEach-Object { "$rel :: $($_.Message)" }) }
}
if ($parseErrors.Count -gt 0) { throw ('PowerShell parse failures: ' + ($parseErrors -join ' | ')) }

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$root = Join-Path $env:RUNNER_TEMP ('sokna-agent-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  Copy-Item $agentSrc (Join-Path $root 'agent.ps1') -Force
  Copy-Item $capsSrc (Join-Path $root 'AGENT_CAPABILITIES.json') -Force

  $remote = ''
  try { $remote = (git -C $repo remote get-url origin).Trim() } catch {}
  $expectedRepo = ''
  $owner = 'ci'
  if ($remote -match 'github\.com[/:](?<repo>[^\s]+?)(?:\.git)?$') {
    $expectedRepo = [string]$Matches.repo
    if ($expectedRepo.Contains('/')) { $owner = $expectedRepo.Split('/')[0] }
  }

  $cfg = [ordered]@{
    port = $port
    token = 'ci-token-' + [guid]::NewGuid().ToString('N')
    workspace_root = $repo
    default_workspace = 'CI-Workspace'
    default_github_owner = $owner
    allowed_github_owners = @($owner)
    workspaces = [ordered]@{
      'CI-Workspace' = [ordered]@{path=$repo;expected_repo=$expectedRepo;write_enabled=$false}
    }
  }
  $cfgPath = Join-Path $root 'config.json'
  [IO.File]::WriteAllText($cfgPath,($cfg | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))

  $stdoutPath = Join-Path $root 'stdout.log'
  $stderrPath = Join-Path $root 'stderr.log'
  $proc = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'agent.ps1'),'-ConfigPath',$cfgPath) -WorkingDirectory $root -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  try {
    $ready = $false
    $last = ''
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 250
      if ($proc.HasExited) { break }
      try {
        $body = @{id=('ci-ping-' + $i);action='ping';params=@{}} | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api" -Method Post -Headers @{'X-Sokna-Token'=$cfg.token} -ContentType 'application/json' -Body $body -TimeoutSec 2
        if ($response.ok) { $ready = $true; break }
      } catch { $last = $_.Exception.Message }
    }
    if (-not $ready) {
      $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }
      throw "agent failed to become healthy; last=$last; stderr=$stderr"
    }

    $capBody = @{id=('ci-caps-' + [guid]::NewGuid().ToString('N'));action='agent.capabilities';params=@{}} | ConvertTo-Json -Compress
    $caps = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api" -Method Post -Headers @{'X-Sokna-Token'=$cfg.token} -ContentType 'application/json' -Body $capBody -TimeoutSec 5
    if ((-not $caps.ok) -or ([string]$caps.version -ne $RuntimeVersion)) {
      throw "agent.capabilities mismatch expected=$RuntimeVersion actual=$($caps.version)"
    }
  } finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  }

  if ($Profile -eq 'full') {
    $obj = ('{"state":"activating","target_version":"x"}' | ConvertFrom-Json)
    $missingPropertyFailed = $false
    try { $obj.active_version = 'x' } catch { $missingPropertyFailed = $true }
    if (-not $missingPropertyFailed) { throw 'PSCustomObject missing-property regression premise unexpectedly changed' }
    $obj | Add-Member -NotePropertyName active_version -NotePropertyValue $null -Force
    $obj.active_version = 'x'
    if ($obj.active_version -ne 'x') { throw 'PSCustomObject declared-property mutation failed' }
  }

  [ordered]@{
    ok = $true
    schema = 'sokna-windows-runtime-check-v1'
    profile = $Profile
    runtime = $RuntimeVersion
    powershell_files = @($psFiles).Count
    windows = [Environment]::OSVersion.VersionString
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
