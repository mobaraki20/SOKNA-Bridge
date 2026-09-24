Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:SoknaBrowserContext=$null

function Get-SoknaBrowserOptional($Object,[string]$Name,$Default=$null){
  if($null-eq$Object){return $Default};$p=$Object.PSObject.Properties[$Name];if($null-eq$p){return $Default};return $p.Value
}
function Quote-SoknaBrowserArg([string]$Arg){
  if($null-eq$Arg-or$Arg.Length-eq0){return '""'};if($Arg-notmatch'[\s"]'){return$Arg};return '"'+($Arg-replace'(\\*)"','$1$1\"'-replace'(\\+)$','$1$1')+'"'
}
function Get-SoknaBrowserHashId([string]$Prefix,[string]$Value){$sha=[Security.Cryptography.SHA256]::Create();try{$b=[Text.Encoding]::UTF8.GetBytes($Value);$h=([BitConverter]::ToString($sha.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};return($Prefix+'-'+$h.Substring(0,24))}
function Test-SoknaBrowserSafeId([string]$Value){return((-not[string]::IsNullOrWhiteSpace($Value))-and$Value.Length-le100-and$Value-match'^[A-Za-z0-9._-]+$')}
function Test-SoknaBrowserReparse([string]$Path){if(-not(Test-Path -LiteralPath $Path)){return $false};$x=Get-Item -LiteralPath $Path -Force;return(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0)}
function Assert-SoknaBrowserTreeNoReparse([string]$Path){
  if(-not(Test-Path -LiteralPath $Path)){return};$root=Get-Item -LiteralPath $Path -Force;if(($root.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw'BROWSER_REPARSE_POINT_BLOCKED'}
  if(-not$root.PSIsContainer){return};$stack=New-Object 'System.Collections.Generic.Stack[string]';$stack.Push($root.FullName)
  while($stack.Count-gt0){foreach($x in @(Get-ChildItem -LiteralPath ($stack.Pop()) -Force)){if(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw('BROWSER_REPARSE_POINT_BLOCKED: '+$x.FullName)};if($x.PSIsContainer){$stack.Push($x.FullName)}}}
}
function Get-SoknaBrowserExecutable([string]$RuntimeRoot,$Config){
  $b=Get-SoknaBrowserOptional $Config 'browser_qa' $null;$override=[string](Get-SoknaBrowserOptional $b 'runner_path' '')
  if($override){$p=[IO.Path]::GetFullPath($override);if(Test-Path -LiteralPath $p -PathType Leaf){return $p};throw('BROWSER_QA_RUNNER_NOT_FOUND: '+$p)}
  $installRoot=Split-Path -Parent ([IO.Path]::GetFullPath($RuntimeRoot));$name=if($env:OS-eq'Windows_NT'){'sokna-browser-qa.exe'}else{'sokna-browser-qa'}
  $candidate=Join-Path (Join-Path $installRoot 'browser') $name
  if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}
  $nativeRoot=Split-Path -Parent $installRoot;$dev=Join-Path (Join-Path $nativeRoot 'browser') $name
  if(Test-Path -LiteralPath $dev -PathType Leaf){return([IO.Path]::GetFullPath($dev))}
  return $candidate
}
function Initialize-SoknaBrowserQA($Config,[string]$RuntimeRoot){
  $b=Get-SoknaBrowserOptional $Config 'browser_qa' $null
  [int64]$maxRun=[int64](Get-SoknaBrowserOptional $b 'max_run_bytes' 268435456);if($maxRun-le0-or$maxRun-gt1073741824){throw'BROWSER_QA_MAX_RUN_BYTES_INVALID'}
  $script:SoknaBrowserContext=[ordered]@{runtime_root=[IO.Path]::GetFullPath($RuntimeRoot);runner=(Get-SoknaBrowserExecutable $RuntimeRoot $Config);browser_path=[string](Get-SoknaBrowserOptional $b 'browser_path' '');max_run_bytes=$maxRun}
  return(Get-SoknaBrowserQAStatus)
}
function Get-SoknaBrowserQAStatus{
  if($null-eq$script:SoknaBrowserContext){throw'BROWSER_QA_NOT_INITIALIZED'}
  $runner=[string]$script:SoknaBrowserContext.runner
  return[ordered]@{ok=$true;schema='sokna-browser-qa-status-v1';runner_path=$runner;runner_available=(Test-Path -LiteralPath $runner -PathType Leaf);browser_path=[string]$script:SoknaBrowserContext.browser_path;max_run_bytes=[int64]$script:SoknaBrowserContext.max_run_bytes;artifact_directory=(Get-SoknaArtifactDirectory 'browser');live_capture=[ordered]@{implemented=$false;permission_required=$true;hidden_capture=$false;credential_export=$false}}
}
function Get-SoknaBrowserRunPath([string]$RunId,[switch]$AllowMissing){
  if(-not(Test-SoknaBrowserSafeId $RunId)){throw'BROWSER_RUN_ID_INVALID'};$rel=Join-Path 'browser' (Join-Path 'runs' $RunId);return(Resolve-SoknaManagedArtifactPath -Path $rel -AllowMissing:$AllowMissing)
}
function Get-SoknaBrowserBaselinePath([string]$BaselineId,[switch]$AllowMissing){
  if(-not(Test-SoknaBrowserSafeId $BaselineId)){throw'BROWSER_BASELINE_ID_INVALID'};$rel=Join-Path 'browser' (Join-Path 'baselines' $BaselineId);return(Resolve-SoknaManagedArtifactPath -Path $rel -AllowMissing:$AllowMissing)
}
function New-SoknaBrowserRunId([string]$ScenarioId){
  if(-not(Test-SoknaBrowserSafeId $ScenarioId)){throw'BROWSER_SCENARIO_ID_INVALID'};return($ScenarioId+'-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
}
function Get-SoknaBrowserRecipeScenario([string]$RecipePath){
  try{$r=Get-Content -LiteralPath $RecipePath -Raw -Encoding UTF8|ConvertFrom-Json}catch{throw('BROWSER_RECIPE_JSON_INVALID: '+$_.Exception.Message)}
  $id=[string]$r.scenario_id;if(-not(Test-SoknaBrowserSafeId $id)){throw'BROWSER_SCENARIO_ID_INVALID'};return$id
}
function Register-SoknaBrowserArtifacts([string]$RunId,[string]$RunPath,[string]$Workspace,[string]$JobId,$Summary){
  $registered=@();foreach($a in @($Summary.artifacts)){
    $id=[string]$a.artifact_id;if(-not(Test-SoknaBrowserSafeId $id)){throw'BROWSER_ARTIFACT_ID_INVALID'};$rel=[string]$a.path
    $full=[IO.Path]::GetFullPath((Join-Path $RunPath $rel));$root=[IO.Path]::GetFullPath($RunPath);if(-not($full-eq$root-or$full.StartsWith($root.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))){throw'BROWSER_ARTIFACT_PATH_ESCAPE'}
    if(-not(Test-Path -LiteralPath $full -PathType Leaf)){throw('BROWSER_ARTIFACT_MISSING: '+$rel)};if(Test-SoknaBrowserReparse $full){throw'BROWSER_ARTIFACT_REPARSE_BLOCKED'}
    $sha=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant();if($sha-ne([string]$a.sha256).ToLowerInvariant()){throw('BROWSER_ARTIFACT_HASH_MISMATCH: '+$rel)}
    $item=Get-Item -LiteralPath $full -Force;if([int64]$item.Length-ne[int64]$a.bytes){throw('BROWSER_ARTIFACT_SIZE_MISMATCH: '+$rel)}
    $artifactRoot=[IO.Path]::GetFullPath((Get-SoknaArtifactRoot));$managedRel=$full.Substring($artifactRoot.TrimEnd('\','/').Length).TrimStart('\','/').Replace('\','/')
    $m=[ordered]@{schema='sokna-artifact-metadata-v1';artifact_id=$id;provider='browser_qa';source_ref=('browser-run:'+ $RunId);local_path=$managedRel;size=[int64]$item.Length;sha256=$sha;content_type=[string]$a.content_type;created_at=(Get-Date).ToUniversalTime().ToString('o');updated_at=(Get-Date).ToUniversalTime().ToString('o');state='browser';workspace=$Workspace;job_id=$JobId;cleanup_state='active';browser_run_id=$RunId;browser_kind=[string]$a.kind;viewport_id=[string]$a.viewport_id}
    $null=Set-SoknaArtifactMetadata -ArtifactId $id -Metadata $m;$registered+=@([ordered]@{artifact_id=$id;path=$managedRel;sha256=$sha;bytes=[int64]$item.Length;kind=[string]$a.kind;viewport_id=[string]$a.viewport_id})
  };return$registered
}
function Invoke-SoknaBrowserRecipe{
  param([Parameter(Mandatory=$true)][string]$RecipePath,[string]$Workspace='', [string]$JobId='',[string]$BaselineId='',[string]$RunId='')
  if($null-eq$script:SoknaBrowserContext){throw'BROWSER_QA_NOT_INITIALIZED'};$runner=[string]$script:SoknaBrowserContext.runner;if(-not(Test-Path -LiteralPath $runner -PathType Leaf)){throw('BROWSER_QA_RUNNER_NOT_FOUND: '+$runner)}
  if(-not(Test-Path -LiteralPath $RecipePath -PathType Leaf)){throw'BROWSER_RECIPE_NOT_FOUND'};if(Test-SoknaBrowserReparse $RecipePath){throw'BROWSER_RECIPE_REPARSE_BLOCKED'}
  $scenario=Get-SoknaBrowserRecipeScenario $RecipePath;if([string]::IsNullOrWhiteSpace($RunId)){$RunId=New-SoknaBrowserRunId $scenario};$runPath=Get-SoknaBrowserRunPath $RunId -AllowMissing
  $baseline='';if($BaselineId){$baseline=Get-SoknaBrowserBaselinePath $BaselineId;if(-not(Test-Path -LiteralPath $baseline -PathType Container)){throw'BROWSER_BASELINE_NOT_FOUND'};Assert-SoknaBrowserTreeNoReparse $baseline;$bm=Join-Path $baseline 'baseline.json';if(-not(Test-Path -LiteralPath $bm -PathType Leaf)){throw'BROWSER_BASELINE_MANIFEST_MISSING'};$bo=Get-Content -LiteralPath $bm -Raw -Encoding UTF8|ConvertFrom-Json;if([string]$bo.workspace-ne$Workspace){throw'BROWSER_BASELINE_WORKSPACE_MISMATCH'}}
  if(Test-Path -LiteralPath $runPath){throw'BROWSER_RUN_ALREADY_EXISTS'};New-Item -ItemType Directory -Path $runPath -Force|Out-Null;Assert-SoknaBrowserTreeNoReparse $runPath
  $args=@('run','--recipe',$RecipePath,'--artifact-root',(Get-SoknaArtifactRoot),'--output-dir',$runPath,'--max-run-bytes',([string][int64]$script:SoknaBrowserContext.max_run_bytes),'--workspace',$Workspace);if($JobId){$args+=@('--job-id',$JobId)};if($baseline){$args+=@('--baseline-dir',$baseline)};if($script:SoknaBrowserContext.browser_path){$args+=@('--browser',[string]$script:SoknaBrowserContext.browser_path)}
  $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='browser.recipe.run';phase='started';ok=$true;run_id=$RunId;scenario_id=$scenario;workspace=$Workspace;job_id=$JobId;baseline_id=$BaselineId}) -Required
  try{
    $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$runner;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
    $qa=@();foreach($a in $args){$qa+=Quote-SoknaBrowserArg ([string]$a)};$psi.Arguments=($qa-join' ');$proc=New-Object Diagnostics.Process;$proc.StartInfo=$psi;[void]$proc.Start();$outTask=$proc.StandardOutput.ReadToEndAsync();$errTask=$proc.StandardError.ReadToEndAsync();if(-not$proc.WaitForExit(300000)){try{$proc.Kill()}catch{};throw'BROWSER_QA_TIMEOUT'};$stdout=$outTask.GetAwaiter().GetResult().Trim();$stderr=$errTask.GetAwaiter().GetResult().Trim()
    if([string]::IsNullOrWhiteSpace($stdout)){throw('BROWSER_QA_NO_RESULT: '+$stderr)};try{$summary=$stdout|ConvertFrom-Json}catch{throw('BROWSER_QA_RESULT_JSON_INVALID: '+$stdout)}
    $runManifest=[ordered]@{schema='sokna-browser-run-manifest-v1';run_id=$RunId;scenario_id=$scenario;workspace=$Workspace;job_id=$JobId;baseline_id=$BaselineId;recipe_sha256=[string]$summary.recipe_sha256;created_at=(Get-Date).ToUniversalTime().ToString('o')};$runManifest|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $runPath 'run.json') -Encoding UTF8
    Assert-SoknaBrowserTreeNoReparse $runPath;[int64]$bytes=0;foreach($f in @(Get-ChildItem -LiteralPath $runPath -File -Recurse -Force)){$bytes+=[int64]$f.Length};if($bytes-gt[int64]$script:SoknaBrowserContext.max_run_bytes){Remove-Item -LiteralPath $runPath -Recurse -Force;throw'BROWSER_RUN_SIZE_LIMIT'}
    $rootStatus=Get-SoknaArtifactRootStatus;if([int64]$rootStatus.usage_bytes-gt[int64]$rootStatus.quota_bytes){Remove-Item -LiteralPath $runPath -Recurse -Force;throw'ARTIFACT_ROOT_QUOTA_EXCEEDED'}
    $registered=Register-SoknaBrowserArtifacts -RunId $RunId -RunPath $runPath -Workspace $Workspace -JobId $JobId -Summary $summary
    $report=Join-Path $runPath 'report.json';$reportId=Get-SoknaBrowserHashId 'browser-report' $RunId;if((Test-SoknaBrowserSafeId $reportId) -and (Test-Path -LiteralPath $report -PathType Leaf)){$sha=(Get-FileHash -LiteralPath $report -Algorithm SHA256).Hash.ToLowerInvariant();$item=Get-Item $report;$artRoot=[IO.Path]::GetFullPath((Get-SoknaArtifactRoot));$rel=$report.Substring($artRoot.TrimEnd('\','/').Length).TrimStart('\','/').Replace('\','/');$meta=[ordered]@{schema='sokna-artifact-metadata-v1';artifact_id=$reportId;provider='browser_qa';source_ref=('browser-run:'+ $RunId);local_path=$rel;size=[int64]$item.Length;sha256=$sha;content_type='application/json';created_at=(Get-Date).ToUniversalTime().ToString('o');updated_at=(Get-Date).ToUniversalTime().ToString('o');state='browser';workspace=$Workspace;job_id=$JobId;cleanup_state='active';browser_run_id=$RunId;browser_kind='report'};$null=Set-SoknaArtifactMetadata -ArtifactId $reportId -Metadata $meta;$registered+=@([ordered]@{artifact_id=$reportId;path=$rel;sha256=$sha;bytes=[int64]$item.Length;kind='report';viewport_id=''})}
    $ok=[bool]$summary.ok;$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='browser.recipe.run';phase='completed';ok=$ok;run_id=$RunId;scenario_id=$scenario;workspace=$Workspace;job_id=$JobId;baseline_id=$BaselineId;artifact_count=@($registered).Count;bytes=$bytes;exit_code=$proc.ExitCode}) -Required
    return[ordered]@{ok=$ok;schema='sokna-browser-run-result-v1';run_id=$RunId;scenario_id=$scenario;baseline_id=$BaselineId;report_artifact_id=$reportId;artifact_count=@($registered).Count;artifacts=$registered;findings=@($summary.findings);browser=[string]$summary.browser;browser_path=[string]$summary.browser_path;artifact_root=(Get-SoknaArtifactRoot);run_path=$runPath;runner_exit_code=$proc.ExitCode;runner_stderr=$stderr}
  }catch{$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='browser.recipe.run';phase='failed';ok=$false;run_id=$RunId;scenario_id=$scenario;workspace=$Workspace;job_id=$JobId;baseline_id=$BaselineId;error=$_.Exception.Message});throw}
}
function Set-SoknaBrowserBaseline{
  param([Parameter(Mandatory=$true)][string]$Workspace,[Parameter(Mandatory=$true)][string]$RunId,[Parameter(Mandatory=$true)][string]$BaselineId,[switch]$Execute)
  $run=Get-SoknaBrowserRunPath $RunId;$dest=Get-SoknaBrowserBaselinePath $BaselineId -AllowMissing;Assert-SoknaBrowserTreeNoReparse $run;$rm=Join-Path $run 'run.json';if(-not(Test-Path -LiteralPath $rm -PathType Leaf)){throw'BROWSER_RUN_MANIFEST_MISSING'};$ro=Get-Content -LiteralPath $rm -Raw -Encoding UTF8|ConvertFrom-Json;if([string]$ro.workspace-ne$Workspace){throw'BROWSER_RUN_WORKSPACE_MISMATCH'}
  $shots=@(Get-ChildItem -LiteralPath $run -Filter '*.png' -File -Recurse|Where-Object{$_.Name-in@('viewport.png','full-page.png')});if($shots.Count-eq0){throw'BROWSER_BASELINE_NO_SCREENSHOTS'}
  $plan=@();foreach($s in $shots){$rel=$s.FullName.Substring($run.TrimEnd('\','/').Length).TrimStart('\','/');$plan+=@([ordered]@{source=$rel;sha256=(Get-FileHash -LiteralPath $s.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=[int64]$s.Length})}
  if(-not$Execute){return[ordered]@{ok=$true;dry_run=$true;run_id=$RunId;baseline_id=$BaselineId;files=$plan;source_preserved=$true}}
  if(Test-Path -LiteralPath $dest){throw'BROWSER_BASELINE_ALREADY_EXISTS'};New-Item -ItemType Directory -Path $dest -Force|Out-Null
  try{foreach($x in $plan){$src=Join-Path $run ([string]$x.source);$dst=Join-Path $dest ([string]$x.source);$dd=Split-Path -Parent $dst;if(-not(Test-Path $dd)){New-Item -ItemType Directory -Path $dd -Force|Out-Null};Copy-Item -LiteralPath $src -Destination $dst -Force;if((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLowerInvariant()-ne[string]$x.sha256){throw'BROWSER_BASELINE_COPY_VERIFY_FAILED'}};Assert-SoknaBrowserTreeNoReparse $dest;$manifest=[ordered]@{schema='sokna-browser-baseline-v1';baseline_id=$BaselineId;source_run_id=$RunId;workspace=$Workspace;created_at=(Get-Date).ToUniversalTime().ToString('o');files=$plan};$manifest|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $dest 'baseline.json') -Encoding UTF8;$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='browser.baseline.promote';phase='completed';ok=$true;run_id=$RunId;baseline_id=$BaselineId;files=$plan.Count;source_preserved=$true}) -Required;return[ordered]@{ok=$true;dry_run=$false;run_id=$RunId;baseline_id=$BaselineId;path=$dest;files=$plan;source_preserved=$true}}
  catch{Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue;throw}
}
function Get-SoknaBrowserLiveCapturePolicy{return[ordered]@{ok=$true;schema='sokna-live-browser-capture-policy-v1';implemented=$false;permission_required=$true;explicit_user_consent_per_session=$true;allowed=@('current_url','title','screenshot','dom_context','console_metadata','selected_diagnostics');forbidden=@('hidden_capture','background_spying','credential_extraction','unrestricted_cookie_export','unrestricted_token_export');note='Live capture remains disabled until an explicit consent-bound tab integration is implemented and accepted.'}}

Export-ModuleMember -Function Initialize-SoknaBrowserQA,Get-SoknaBrowserQAStatus,Invoke-SoknaBrowserRecipe,Set-SoknaBrowserBaseline,Get-SoknaBrowserLiveCapturePolicy,Get-SoknaBrowserRunPath,Get-SoknaBrowserBaselinePath
