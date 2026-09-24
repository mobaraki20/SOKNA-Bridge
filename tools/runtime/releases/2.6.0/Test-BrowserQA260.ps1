param([string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0

function Write-Utf8NoBom([string]$Path,[string]$Text){[IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))}
function Require-Command([string]$Name){if(-not (Get-Command $Name -ErrorAction SilentlyContinue)){throw('P3_MISSING_TOOL: '+$Name)}}
Require-Command go
Require-Command python

$root=Join-Path $env:TEMP ('sokna-browserqa-260-'+[Guid]::NewGuid().ToString('N'))
$site=Join-Path $root 'site'
$art=Join-Path $root 'artifacts'
$runtime=Join-Path $root 'runtime'
$browserDir=Join-Path $root 'browser'
$recipeDir=Join-Path $root 'workspace'
$server=$null
try{
  foreach($d in @($site,$art,$runtime,$browserDir,$recipeDir)){New-Item -ItemType Directory -Path $d -Force|Out-Null}
  foreach($m in @('Sokna.ArtifactRoot.psm1','Sokna.Browser.psm1')){
    Copy-Item -LiteralPath (Join-Path $RepoRoot ('native\runtime\v2.6.0\'+$m)) -Destination (Join-Path $runtime $m) -Force
  }
  $runner=Join-Path $browserDir 'sokna-browser-qa.exe'
  Push-Location (Join-Path $RepoRoot 'native\browser')
  try{
    & go test ./...
    if($LASTEXITCODE -ne 0){throw'P3_NATIVE_BROWSER_TEST_FAILED'}
    & go build -trimpath -o $runner .
    if($LASTEXITCODE -ne 0){throw'P3_NATIVE_BROWSER_BUILD_FAILED'}
  }finally{Pop-Location}

  $html=@'
<!doctype html><html><head><meta charset="utf-8"><title>P3 Fixture</title><style>html,body{margin:0;padding:0}body{font-family:Arial,sans-serif}.card{width:240px;height:100px;margin:24px;background:#e8e8e8;padding:12px;box-sizing:border-box}</style></head><body><label>Name <input id="name"></label><select id="kind"><option value="a">A</option><option value="b">B</option></select><button id="apply">Apply</button><div id="result" class="card">ready</div><script>console.log('token=supersecret123');const hidden=localStorage.getItem('qa_secret');if(hidden)console.log(hidden);document.querySelector('#apply').onclick=()=>{document.querySelector('#result').textContent=document.querySelector('#name').value+'-'+document.querySelector('#kind').value};fetch('/api.json?token=supersecret123').catch(()=>{});</script></body></html>
'@
  Write-Utf8NoBom (Join-Path $site 'index.html') $html
  Write-Utf8NoBom (Join-Path $site 'api.json') '{"ok":true}'
  $port=18771
  $server=Start-Process python -ArgumentList @('-m','http.server',[string]$port,'--bind','127.0.0.1','--directory',$site) -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 700

  Import-Module (Join-Path $runtime 'Sokna.ArtifactRoot.psm1') -Force
  Import-Module (Join-Path $runtime 'Sokna.Browser.psm1') -Force
  $cfg=[pscustomobject]@{
    artifact_root=$art
    artifact_policy=[pscustomobject]@{
      max_root_bytes=[int64](512MB)
      max_artifact_bytes=[int64](256MB)
      retention=[pscustomobject]@{incoming_days=7;staging_hours=24;accepted_days=30;failed_days=14;cache_days=7;browser_days=30}
    }
    browser_qa=[pscustomobject]@{runner_path=$runner;max_run_bytes=[int64](128MB)}
  }
  $null=Initialize-SoknaArtifactRoot -Config $cfg -RuntimeRoot $runtime
  $status=Initialize-SoknaBrowserQA -Config $cfg -RuntimeRoot $runtime
  if(-not $status.runner_available){throw'P3_BROWSER_RUNNER_UNAVAILABLE'}
  $policy=Get-SoknaBrowserLiveCapturePolicy
  if($policy.implemented -or -not $policy.permission_required -or $policy.hidden_capture -or $policy.credential_export){throw'P3_LIVE_CAPTURE_BOUNDARY_BROKEN'}

  $env:P3_QA_SECRET='hidden-secret-987654'
  $recipePath=Join-Path $recipeDir 'recipe.json'
  $recipe=[ordered]@{
    schema='sokna-browser-recipe-v1'
    scenario_id='p3win'
    url=('http://127.0.0.1:'+ $port +'/index.html?token=supersecret123')
    viewports=@(
      @{id='mobile';width=390;height=844;dpr=1},
      @{id='desktop';width=1280;height=800;dpr=1}
    )
    setup=@{local_storage=@(@{key='qa_secret';value_env='P3_QA_SECRET'})}
    actions=@(
      @{op='type';selector='#name';value='SOKNA'},
      @{op='select';selector='#kind';value='b'},
      @{op='click';selector='#apply'}
    )
    assertions=@(
      @{type='selector_visible';selector='#result'},
      @{type='no_horizontal_overflow'},
      @{type='console_errors_max';max=0},
      @{type='network_failures_max';max=0}
    )
    captures=@{screenshot=$true;full_page=$true;dom=$true;geometry=$true;a11y=$true;console=$true;network=$true;slow_resource_ms=2000;elements=@('#result')}
    visual=@{enabled=$false;max_changed_ratio=0.005}
  }
  Write-Utf8NoBom $recipePath ($recipe|ConvertTo-Json -Depth 15)

  $first=Invoke-SoknaBrowserRecipe -RecipePath $recipePath -Workspace 'p3-test' -RunId 'p3-first'
  if(-not $first.ok){throw('P3_FIRST_RUN_FAILED: '+(($first.findings|ConvertTo-Json -Compress)-join''))}
  $report1=Get-Content -LiteralPath (Join-Path $first.run_path 'report.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$report1.status -ne 'PASS'){throw'P3_REPORT_PASS_STATUS_MISSING'}
  $browserText=(Get-ChildItem -LiteralPath $first.run_path -File -Recurse|Where-Object{$_.Extension -in @('.json','.html')}|ForEach-Object{Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8})-join"`n"
  if($browserText.Contains('supersecret123') -or $browserText.Contains($env:P3_QA_SECRET)){throw'P3_BROWSER_SECRET_LEAK'}
  if(-not $browserText.Contains('[REDACTED]')){throw'P3_REDACTION_EVIDENCE_MISSING'}

  try{
    $null=Set-SoknaBrowserBaseline -Workspace 'p3-other' -RunId 'p3-first' -BaselineId 'baseline-cross'
    throw'P3_BASELINE_CROSS_WORKSPACE_ALLOWED'
  }catch{if($_.Exception.Message -notmatch 'BROWSER_RUN_WORKSPACE_MISMATCH'){throw}}

  $dry=Set-SoknaBrowserBaseline -Workspace 'p3-test' -RunId 'p3-first' -BaselineId 'baseline-a'
  if(-not $dry.dry_run -or @($dry.files).Count -lt 2){throw'P3_BASELINE_DRYRUN_INVALID'}
  $promote=Set-SoknaBrowserBaseline -Workspace 'p3-test' -RunId 'p3-first' -BaselineId 'baseline-a' -Execute
  if(-not $promote.ok -or -not (Test-Path -LiteralPath (Join-Path $promote.path 'baseline.json'))){throw'P3_BASELINE_PROMOTE_FAILED'}
  try{
    $null=Set-SoknaBrowserBaseline -Workspace 'p3-test' -RunId 'p3-first' -BaselineId 'baseline-a' -Execute
    throw'P3_BASELINE_OVERWRITE_ALLOWED'
  }catch{if($_.Exception.Message -notmatch 'BROWSER_BASELINE_ALREADY_EXISTS'){throw}}

  try{
    $null=Invoke-SoknaBrowserRecipe -RecipePath $recipePath -Workspace 'p3-other' -BaselineId 'baseline-a' -RunId 'p3-cross'
    throw'P3_BASELINE_CROSS_WORKSPACE_ALLOWED'
  }catch{if($_.Exception.Message -notmatch 'BROWSER_BASELINE_WORKSPACE_MISMATCH'){throw}}
  if(Test-Path -LiteralPath (Get-SoknaBrowserRunPath 'p3-cross' -AllowMissing)){throw'P3_CROSS_WORKSPACE_LEFT_ORPHAN_RUN'}

  $recipe.visual.enabled=$true
  $recipe.assertions+=@{type='visual_changed_ratio_max';max_ratio=0.005;required=$true}
  Write-Utf8NoBom $recipePath ($recipe|ConvertTo-Json -Depth 15)
  $same=Invoke-SoknaBrowserRecipe -RecipePath $recipePath -Workspace 'p3-test' -BaselineId 'baseline-a' -RunId 'p3-same'
  if(-not $same.ok){throw('P3_IDENTICAL_VISUAL_REGRESSION_FAILED: '+(($same.findings|ConvertTo-Json -Compress)-join''))}

  $changed=$html.Replace('background:#e8e8e8','background:#111;color:#fff').Replace('width:240px','width:330px')
  Write-Utf8NoBom (Join-Path $site 'index.html') $changed
  $changedRun=Invoke-SoknaBrowserRecipe -RecipePath $recipePath -Workspace 'p3-test' -BaselineId 'baseline-a' -RunId 'p3-changed'
  if($changedRun.ok){throw'P3_VISUAL_CHANGE_NOT_DETECTED'}
  $reportChanged=Get-Content -LiteralPath (Join-Path $changedRun.run_path 'report.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$reportChanged.status -ne 'FAIL'){throw'P3_REPORT_FAIL_STATUS_MISSING'}
  $diffs=@(Get-ChildItem -LiteralPath $changedRun.run_path -Filter 'visual-diff.png' -File -Recurse)
  if($diffs.Count -lt 1){throw'P3_VISUAL_DIFF_EVIDENCE_MISSING'}
  $findingWithoutEvidence=@($reportChanged.findings|Where-Object{$_.severity -eq 'error' -and [string]::IsNullOrWhiteSpace([string]$_.evidence_artifact_id)})
  if($findingWithoutEvidence.Count -gt 0){throw'P3_FAILURE_EVIDENCE_ID_MISSING'}

  $badPath=Join-Path $recipeDir 'bad.json'
  $bad=[ordered]@{schema='sokna-browser-recipe-v1';scenario_id='bad';url='file:///C:/Windows/win.ini';viewports=@(@{id='d';width=800;height=600});captures=@{screenshot=$true}}
  Write-Utf8NoBom $badPath ($bad|ConvertTo-Json -Depth 8)
  & $runner validate --recipe $badPath *> $null
  if($LASTEXITCODE -eq 0){throw'P3_UNSAFE_URL_VALIDATION_BYPASSED'}

  [ordered]@{
    ok=$true
    first_run=$first.run_id
    baseline=$promote.baseline_id
    same_visual=$same.run_id
    changed_visual=$changedRun.run_id
    diff_count=$diffs.Count
    secret_redaction=$true
    cross_workspace_baseline_blocked=$true
    failure_evidence_ids=$true
    live_capture_permission_bound=$true
  }|ConvertTo-Json -Compress
}finally{
  Remove-Item Env:P3_QA_SECRET -ErrorAction SilentlyContinue
  if($null -ne $server){try{Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}catch{}}
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
