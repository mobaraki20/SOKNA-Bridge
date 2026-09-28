param([string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Fail([string]$m){throw ('P6_COMPONENT_AUTOMATION_WINDOWS_ACCEPTANCE_FAILED: '+$m)}
function Sha([string]$p){return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$case=Join-Path ([IO.Path]::GetTempPath()) ('sokna-p6-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $case -Force|Out-Null
try{
  $runner=Join-Path $case 'sokna-artifact-provider.exe';Push-Location (Join-Path $RepoRoot 'native\provider');try{& go build -trimpath -o $runner .;if($LASTEXITCODE-ne0){Fail 'provider build failed'}}finally{Pop-Location}
  $artifactRoot=Join-Path $case 'artifacts';$cfgPath=Join-Path $case 'config.json';$cfg=[pscustomobject]@{artifact_root=$artifactRoot;artifact_policy=[pscustomobject]@{max_root_bytes=67108864;max_artifact_bytes=16777216};artifact_providers=[pscustomobject]@{runner_path=$runner;retries=2;backoff_ms=1;timeout_seconds=30;managed_folders=@()}}
  $cfg|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $cfgPath -Encoding UTF8
  Import-Module (Join-Path $RepoRoot 'native\runtime\v2.7.1\Sokna.ArtifactRoot.psm1') -Force
  Import-Module (Join-Path $RepoRoot 'native\runtime\v2.7.1\Sokna.ArtifactProvider.psm1') -Force
  Import-Module (Join-Path $RepoRoot 'native\runtime\v2.7.1\Sokna.Workspace.psm1') -Force
  Import-Module (Join-Path $RepoRoot 'native\runtime\v2.7.1\Sokna.Component.psm1') -Force
  $null=Initialize-SoknaArtifactRoot -Config $cfg -RuntimeRoot (Join-Path $RepoRoot 'native\runtime\v2.7.1')
  $null=Initialize-SoknaArtifactProviders -Config $cfg -RuntimeRoot (Join-Path $RepoRoot 'native\runtime\v2.7.1')
  $null=Initialize-SoknaWorkspaceRegistry -Config $cfg -ConfigPath $cfgPath -RuntimeRoot (Join-Path $RepoRoot 'native\runtime\v2.7.1')
  $status=Initialize-SoknaComponentManager -Config $cfg -ConfigPath $cfgPath -RuntimeRoot (Join-Path $RepoRoot 'native\runtime\v2.7.1');if($status.component_count-ne0){Fail 'initial component count'}

  $wsRoot=Join-Path $case 'workspace';New-Item -ItemType Directory -Path (Join-Path $wsRoot 'tools\plans') -Force|Out-Null;New-Item -ItemType Directory -Path (Join-Path $wsRoot 'secret') -Force|Out-Null
  $plan=Join-Path $wsRoot 'tools\plans\noop.json';'{"id":"noop","steps":[]}'|Set-Content -LiteralPath $plan -Encoding UTF8
  $null=Register-SoknaWorkspace -Id 'main' -DisplayName 'Main' -Root $wsRoot -Scopes @([pscustomobject]@{path='.';access='write'},[pscustomobject]@{path='secret';access='deny'}) -Tools @('powershell')

  # Build healthy v1 and deliberately unhealthy v2 process payloads.
  $src1=Join-Path $case 'src1';$src2=Join-Path $case 'src2';New-Item -ItemType Directory -Path $src1,$src2 -Force|Out-Null
  $code1='using System; using System.Threading; public class WorkerV1 { public static void Main(){ Thread.Sleep(60000); } }'
  $code2='using System; public class WorkerV2 { public static void Main(){ } }'
  Add-Type -TypeDefinition $code1 -OutputAssembly (Join-Path $src1 'worker.exe') -OutputType ConsoleApplication
  Add-Type -TypeDefinition $code2 -OutputAssembly (Join-Path $src2 'worker.exe') -OutputType ConsoleApplication
  'healthy'|Set-Content -LiteralPath (Join-Path $src1 'health.txt') -Encoding UTF8;'bad'|Set-Content -LiteralPath (Join-Path $src2 'health.txt') -Encoding UTF8
  $zip1=Join-Path $case 'v1.zip';$zip2=Join-Path $case 'v2.zip';Compress-Archive -Path (Join-Path $src1 '*') -DestinationPath $zip1;Compress-Archive -Path (Join-Path $src2 '*') -DestinationPath $zip2
  $a1=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params ([pscustomobject]@{artifact_id='p6-v1';source_path=$zip1;expected_sha256=(Sha $zip1)})
  $a2=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params ([pscustomobject]@{artifact_id='p6-v2';source_path=$zip2;expected_sha256=(Sha $zip2)})

  $null=Register-SoknaComponent -Id 'worker' -DisplayName 'Worker' -Type 'process' -ReleaseChannel 'stable' -EntryPoint 'worker.exe' -CommandArgs @() -ServiceName '' -HealthPath '' -Dependencies @()
  $v1=Invoke-SoknaArtifactProviderVerify -Params ([pscustomobject]@{path=$a1.path;expected_sha256=$a1.sha256});$i1=Install-SoknaComponentRelease -Id 'worker' -Version '1.0.0' -ArtifactAbsolutePath (Resolve-SoknaManagedArtifactPath -Path $a1.path) -ArtifactPath $a1.path -Sha256 $v1.sha256;$act1=Activate-SoknaComponentRelease -Id 'worker' -Version '1.0.0';if(-not$act1.ok){Fail 'v1 activation'}
  $c=Get-SoknaComponent 'worker';if($c.active_version-ne'1.0.0'-or$c.health-ne'healthy'){Fail 'v1 state'}

  # Ownership proof corruption must block stop of a live process.
  $proof=Get-Content -LiteralPath ([string]$c.process.sidecar) -Raw|ConvertFrom-Json;$saved=[string]$proof.owner_token;$proof.owner_token='foreign';$proof|ConvertTo-Json -Depth 10|Set-Content -LiteralPath ([string]$c.process.sidecar) -Encoding UTF8
  try{$null=Stop-SoknaComponent 'worker';Fail 'foreign ownership stop accepted'}catch{if($_.Exception.Message-notmatch'OWNERSHIP_PROOF_MISMATCH'){throw}}
  $proof.owner_token=$saved;$proof|ConvertTo-Json -Depth 10|Set-Content -LiteralPath ([string]$c.process.sidecar) -Encoding UTF8

  # v2 exits immediately; health must fail and automatic rollback must restore v1.
  $v2=Invoke-SoknaArtifactProviderVerify -Params ([pscustomobject]@{path=$a2.path;expected_sha256=$a2.sha256});$i2=Install-SoknaComponentRelease -Id 'worker' -Version '2.0.0' -ArtifactAbsolutePath (Resolve-SoknaManagedArtifactPath -Path $a2.path) -ArtifactPath $a2.path -Sha256 $v2.sha256
  $rolled=$false;try{$null=Activate-SoknaComponentRelease -Id 'worker' -Version '2.0.0';Fail 'unhealthy v2 committed'}catch{$after=Get-SoknaComponent 'worker';if($after.active_version-eq'1.0.0'-and$after.health-eq'healthy'){$rolled=$true}else{throw}};if(-not$rolled){Fail 'automatic rollback missing'}

  # Automation policy cannot expand the base deny.
  try{$null=Register-SoknaAutomation -Id 'bad-auto' -WorkspaceId 'main' -PlanPath 'tools\plans\noop.json' -ExpectedSha256 (Sha $plan) -Type 'interval' -IntervalSeconds 60 -TriggerKey '' -MissedRunPolicy 'run_once' -ConcurrencyKey 'build' -MaxConcurrency 1 -GrantScopes @([pscustomobject]@{path='secret';access='read'}) -GrantTools @() -GrantTtlSeconds 600 -StartUnixMs ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Enabled:$true;Fail 'automation grant escalation accepted'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_ESCALATION_BLOCKED'){throw}}

  $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$auto=Register-SoknaAutomation -Id 'interval1' -WorkspaceId 'main' -PlanPath 'tools\plans\noop.json' -ExpectedSha256 (Sha $plan) -Type 'interval' -IntervalSeconds 60 -TriggerKey '' -MissedRunPolicy 'run_once' -ConcurrencyKey 'build' -MaxConcurrency 1 -GrantScopes @([pscustomobject]@{path='.';access='read'}) -GrantTools @() -GrantTtlSeconds 600 -StartUnixMs ($now-60000) -Enabled:$true
  $claims=@(Get-SoknaAutomationClaims -ActiveJobs @() -NowUnixMs $now);if($claims.Count-ne1){Fail 'interval claim missing'};$again=@(Get-SoknaAutomationClaims -ActiveJobs @() -NowUnixMs $now);if($again.Count-ne0){Fail 'pending claim did not enforce concurrency/dedupe'};$null=Undo-SoknaAutomationClaim $claims[0]
  $claims2=@(Get-SoknaAutomationClaims -ActiveJobs @() -NowUnixMs $now);if($claims2.Count-ne1-or$claims2[0].run_key-ne$claims[0].run_key){Fail 'claim undo/idempotent restore failed'};$null=Undo-SoknaAutomationClaim $claims2[0]

  $tr=Register-SoknaAutomation -Id 'trigger1' -WorkspaceId 'main' -PlanPath 'tools\plans\noop.json' -ExpectedSha256 (Sha $plan) -Type 'trigger' -IntervalSeconds 0 -TriggerKey 'release' -MissedRunPolicy 'skip' -ConcurrencyKey 'trigger' -MaxConcurrency 1 -GrantScopes @([pscustomobject]@{path='.';access='read'}) -GrantTools @() -GrantTtlSeconds 600 -StartUnixMs 0 -Enabled:$true
  $tc=@(Get-SoknaAutomationClaims -ActiveJobs @() -NowUnixMs $now -TriggerKey 'release' -EventId 'evt1');if($tc.Count-ne1){Fail 'trigger claim missing'};$null=Release-SoknaAutomationRun -AutomationId 'trigger1' -RunKey $tc[0].run_key -JobId $tc[0].job_id -Status 'done';$dup=@(Get-SoknaAutomationClaims -ActiveJobs @() -NowUnixMs ($now+1000) -TriggerKey 'release' -EventId 'evt1');if($dup.Count-ne0){Fail 'trigger dedupe failed'}

  $outsideKeep=Join-Path $case 'workspace\user-data.txt';'keep'|Set-Content -LiteralPath $outsideKeep -Encoding UTF8;$null=Stop-SoknaComponent 'worker';$removed=Remove-SoknaComponent 'worker';if(-not$removed.workspace_data_preserved-or-not(Test-Path -LiteralPath $outsideKeep)){Fail 'component remove touched workspace data'}
  [ordered]@{ok=$true;schema='sokna-p6-component-automation-windows-acceptance-v1';component_process_lifecycle=$true;foreign_process_stop_blocked=$true;health_failure_auto_rollback=$true;lkg=$true;provider_artifact_boundary=$true;automation_escalation_blocked=$true;interval_dedupe=$true;trigger_dedupe=$true;bounded_pending_concurrency=$true;workspace_data_preserved=$true}|ConvertTo-Json -Compress
}finally{
  try{$c=Get-SoknaComponent 'worker';if($null-ne$c.process){$proof=Get-Content -LiteralPath ([string]$c.process.sidecar) -Raw|ConvertFrom-Json;$proof.owner_token=[string]$c.process.owner_token;$proof|ConvertTo-Json -Depth 10|Set-Content -LiteralPath ([string]$c.process.sidecar) -Encoding UTF8;$null=Stop-SoknaComponent 'worker'}}catch{}
  Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
}
