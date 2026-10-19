#requires -Version 5.1
<#
Disposable Windows Runner E2E qualification, never on operator machines.
This tests ACTUAL Inno installation and Maintenance repair/rollback transactions.
Do not call it a Chrome/Edge, legacy upgrade or production UAT.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SetupPath,
  [Parameter(Mandatory=$true)][string]$PayloadRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$setup=[IO.Path]::GetFullPath($SetupPath)
$payload=[IO.Path]::GetFullPath($PayloadRoot)
if(-not(Test-Path -LiteralPath $setup -PathType Leaf)){throw 'RECOVERY_SETUP_MISSING'}
if(-not(Test-Path -LiteralPath $payload -PathType Container)){throw 'RECOVERY_PAYLOAD_MISSING'}
if(-not $env:GITHUB_ACTIONS -or -not $env:RUNNER_TEMP){throw 'RECOVERY_TEST_DISPOSABLE_RUNNER_ONLY'}
$workspace=Join-Path $env:RUNNER_TEMP ('bridge-recovery-qa-'+[guid]::NewGuid().ToString('N'))
$install=Join-Path $workspace 'Bridge Installed With Spaces'
$external=Join-Path $workspace 'Unowned operator-like data'
$logs=Join-Path $workspace 'runner-logs'
foreach($p in @($workspace,$external,$logs)){New-Item -ItemType Directory -Force -Path $p|Out-Null}
$manifestInput=Join-Path $payload 'manifests/installed-manifest.json'
$expected=Get-Content -LiteralPath $manifestInput -Raw -Encoding UTF8|ConvertFrom-Json -ErrorAction Stop
$version=[string]$expected.product_version
if([string]::IsNullOrWhiteSpace($version)){throw 'RECOVERY_EXPECTED_VERSION_MISSING'}
function Launch([string]$binary,[string[]]$arguments,[string]$stage,[int]$timeoutSeconds,[bool]$allowError=$false,[bool]$rawInno=$false) {
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$binary
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  if($rawInno){$psi.Arguments=[string]::Join(' ',$arguments)}
  else {foreach($a in $arguments){[void]$psi.ArgumentList.Add($a)}}
  $p=[Diagnostics.Process]::Start($psi)
  if($null-eq$p){throw "RECOVERY_PROCESS_NOT_STARTED: $stage"}
  try{
    if(-not $p.WaitForExit($timeoutSeconds*1000)){
      try {$p.Kill($true)} catch {}
      throw "RECOVERY_PROCESS_TIMEOUT: $stage"
    }
    $code=$p.ExitCode
    if($allowError){return $code}
    if($code -ne 0){throw "RECOVERY_PROCESS_FAILED: $stage exit=$code"}
    return $code
  } finally {$p.Dispose()}
}
function FileHash([string]$path){
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "RECOVERY_EXPECTED_FILE_MISSING"}
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
function EvidenceOnFailure([string]$stage){
  Write-Host "RECOVERY_DIAGNOSTICS_STAGE=$stage"
  foreach($folder in @($logs,(Join-Path $install 'logs'),(Join-Path $install 'logs/runtime'))){
    if(-not(Test-Path -LiteralPath $folder -PathType Container)){continue}
    Get-ChildItem -LiteralPath $folder -File -Recurse -ErrorAction SilentlyContinue|
      Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object {
        Write-Host "RECOVERY_LOG_NAME=$($_.Name) SIZE=$($_.Length)"
        # Do not echo raw log lines; they may contain tokens or application data.
        $last=Get-Content -LiteralPath $_.FullName -Tail 250 -ErrorAction SilentlyContinue
        Write-Host "RECOVERY_LOG_LINES_TAIL=$(@($last).Count)"
        foreach($signature in @('AGENT_START_HEALTH_TIMEOUT','Get-FileHash','CommandNotFoundException',
           'rollback','health_failed','repair','runtime','error')){
          Write-Host "RECOVERY_LOG_CONTAINS_$($signature.Replace('-','_'))=$([bool](@($last|Where-Object{$_ -match [regex]::Escape($signature)}).Count -gt 0))"
        }
      }
  }
  $port=Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue
  Write-Host "RECOVERY_PORT8766_LISTENERS=$(@($port).Count)"
}
$stage='fresh-install'
try {
  $arguments=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NOICONS',
      ('/DIR="'+$install+'"'),('/ArtifactRoot="'+$external+'"'),
      ('/LOG="'+(Join-Path $logs 'setup.log')+'"'))
  [void](Launch $setup $arguments $stage 180 $false $true)
  $maintenance=Join-Path $install 'Sokna.Agent.Maintenance.exe'
  $installedManifest=Join-Path $install 'manifests/installed-manifest.json'
  $statePath=Join-Path $install 'state/runtime-ownership.json'
  $configPath=Join-Path $install 'config.json'
  $runtime=Join-Path $install 'runtime/AGENT_CAPABILITIES.json'
  foreach($path in @($maintenance,$installedManifest,$statePath,$configPath,$runtime)){
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'RECOVERY_BASELINE_INCOMPLETE'}
  }
  $initial=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
  $token=[string]$initial.token
  if([string]::IsNullOrWhiteSpace($token)){throw 'RECOVERY_TOKEN_NOT_INITIALIZED'}
  if([IO.Path]::GetFullPath([string]$initial.artifact_root) -ne [IO.Path]::GetFullPath($external)){
     throw 'RECOVERY_ARTIFACT_ROOT_WRONG'
  }
  $externalMarker=Join-Path $external 'operator-marker.txt'
  [IO.File]::WriteAllText($externalMarker,'PRESERVE_ACROSS_RECOVERY')
  $sourceRuntime=Join-Path $payload 'runtime/AGENT_CAPABILITIES.json'
  $baselineHash=FileHash $runtime
  if($baselineHash -ne (FileHash $sourceRuntime)){throw 'RECOVERY_INSTALLED_SOURCE_HASH_MISMATCH'}
  Write-Host "RECOVERY_FRESH_INSTALL_BASELINE_PASS"
  $stage='repair-corrupt-owned-file'
  [IO.File]::WriteAllText($runtime,'{"intentionally-corrupt-runtime-file":true}')
  if((FileHash $runtime) -eq $baselineHash){throw 'RECOVERY_CORRUPTION_NOT_APPLIED'}
  [void](Launch $maintenance @('repair','--install-root',$install,'--manifest',$manifestInput,
         '--payload-root',$payload) $stage 185)
  if((FileHash $runtime) -ne $baselineHash){throw 'REPAIR_OWNED_FILE_NOT_RESTORED'}
  if(-not(Test-Path -LiteralPath $externalMarker)){throw 'REPAIR_DELETED_UNOWNED_DATA'}
  if([string](Get-Content $configPath -Raw|ConvertFrom-Json).token -ne $token){throw 'REPAIR_ROTATED_TOKEN'}
  Write-Host "WINDOWS_MAINTENANCE_REPAIR_E2E_PASS"
  $stage='upgrade-health-failure-and-rollback'
  $faultManifest=Join-Path $workspace 'intentional-version-mismatch.json'
  $fault=Get-Content -LiteralPath $manifestInput -Raw | ConvertFrom-Json
  $fault.product_version=$version+'-expected-health-failure'
  [IO.File]::WriteAllText($faultManifest,($fault|ConvertTo-Json -Depth 20))
  $rc=Launch $maintenance @('upgrade','--install-root',$install,'--manifest',$faultManifest,
      '--payload-root',$payload) $stage 240 $true
  if($rc -eq 0){throw 'INTENTIONAL_BAD_UPGRADE_WAS_ACCEPTED'}
  $final=Get-Content -LiteralPath $installedManifest -Raw|ConvertFrom-Json
  $ownership=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
  if([string]$final.product_version -ne $version){throw 'ROLLBACK_DID_NOT_RESTORE_MANIFEST'}
  if([string]$ownership.active_version -ne $version){throw 'ROLLBACK_DID_NOT_RESTORE_ACTIVE_VERSION'}
  if([string]$ownership.last_health -ne 'rollback-pass'){throw 'ROLLBACK_HEALTH_NOT_VERIFIED'}
  if((FileHash $runtime) -ne $baselineHash){throw 'ROLLBACK_DID_NOT_RESTORE_RUNTIME'}
  if(-not(Test-Path -LiteralPath $externalMarker)){throw 'ROLLBACK_DELETED_UNOWNED_DATA'}
  if([string](Get-Content $configPath -Raw|ConvertFrom-Json).token -ne $token){throw 'ROLLBACK_ROTATED_TOKEN'}
  Write-Host "WINDOWS_MAINTENANCE_AUTO_ROLLBACK_E2E_PASS"
  $stage='uninstall'
  $uninstaller=Join-Path $install 'unins000.exe'
  if(-not(Test-Path -LiteralPath $uninstaller -PathType Leaf)){throw 'RECOVERY_UNINSTALLER_MISSING'}
  [void](Launch $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',
      ('/LOG="'+(Join-Path $logs 'uninstall.log')+'"')) $stage 120 $false $true)
  if(-not(Test-Path -LiteralPath $externalMarker)){throw 'UNINSTALL_REMOVED_UNOWNED_DATA'}
  Write-Host "WINDOWS_RECOVERY_FULL_E2E_PASS"
}catch{
  EvidenceOnFailure $stage
  throw
}
