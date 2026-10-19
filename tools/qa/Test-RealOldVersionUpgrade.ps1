param(
  [Parameter(Mandatory=$true)][string]$LegacySetupPath,
  [Parameter(Mandatory=$true)][string]$CandidateSetupPath,
  [Parameter(Mandatory=$true)][string]$CandidateSourceCommit
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)){
  throw 'REAL_UPGRADE_QA_DISPOSABLE_WINDOWS_ONLY'
}
$runRoot=Join-Path $env:RUNNER_TEMP 'SOKNA-Bridge-RealUpgrade-UAT'
$install=Join-Path $runRoot 'Installed Bridge App'
$artifacts=Join-Path $runRoot 'External Operator Artifacts'
$logs=Join-Path $runRoot 'logs'
$legacy=[IO.Path]::GetFullPath($LegacySetupPath)
$candidate=[IO.Path]::GetFullPath($CandidateSetupPath)
foreach($exe in @($legacy,$candidate)){if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'UPGRADE_SETUP_MISSING'}}
if($legacy -eq $candidate){throw 'UPGRADE_TWO_DISTINCT_SETUP_REQUIRED'}
if(Test-Path -LiteralPath $install){throw 'UPGRADE_EXISTING_INSTALL_REFUSING_MUTATION'}
New-Item -ItemType Directory -Force -Path $runRoot,$artifacts,$logs|Out-Null
$installed=$false
$stage='prepare'
$markers=New-Object 'System.Collections.Generic.List[string]'
function Mark([string]$value){$script:markers.Add($value);Write-Host ($value+'_PASS')}
function Launch([string]$exe,[string[]]$args,[string]$purpose){
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=$exe
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.Arguments=[string]::Join(' ',$args)
  $proc=[Diagnostics.Process]::Start($info)
  if($null-eq$proc){throw ('UPGRADE_PROCESS_START_FAILED_'+$purpose)}
  try{
    if(-not $proc.WaitForExit(180000)){
  Write-Host ("UPGRADE_DIAGNOSTIC_PURPOSE="+$purpose)
  foreach($key in @('manifests/installed-manifest.json','config.json','state/runtime-ownership.json','Sokna.Agent.Maintenance.exe','Sokna.Agent.Launcher.exe','runtime/agent.ps1','unins000.exe')){
    $present=Test-Path -LiteralPath (Join-Path $install $key) -PathType Leaf
    Write-Host ("UPGRADE_FILE_"+($key.Replace('/','_').Replace('.','_').ToUpper())+"="+[bool]$present)
  }
  foreach($name in @('Sokna.Agent.Maintenance','Sokna.Agent.Launcher','powershell','pwsh')){
    Write-Host ("UPGRADE_PROC_"+($name.Replace('.','_').ToUpper())+"_COUNT="+@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count)
  }
  $innoTmp=@(Get-Process -Name '*setup*' -ErrorAction SilentlyContinue)
  Write-Host ("UPGRADE_INNO_PROCESS_COUNT="+$innoTmp.Count)
  $rootExists=Test-Path -LiteralPath $install -PathType Container
  Write-Host ("UPGRADE_INSTALL_DIRECTORY_EXISTS="+[bool]$rootExists)
  $events=Join-Path $install 'logs/maintenance/events.jsonl'
  if(Test-Path -LiteralPath $events -PathType Leaf){
    foreach($line in @(Get-Content -LiteralPath $events -Tail 10)){
      try{$v=$line|ConvertFrom-Json; $a=[string]$v.action;$b=[string]$v.stage;$c=[string]$v.result
        if($a -match '^[a-z-]{1,32}$' -and $b -match '^[a-z_]{1,32}$' -and $c -match '^(ok|failed)$'){Write-Host "UPGRADE_PHASE action=$a stage=$b result=$c"}
      }catch{}
    }
  }
  $inno=Join-Path $logs ($purpose+'.log')
  if(Test-Path -LiteralPath $inno -PathType Leaf){
    $tail=@(Get-Content -LiteralPath $inno -Tail 250)
    foreach($part in @('initialize','start','error')){Write-Host ('INNO_PHASE_'+$part.ToUpper()+'='+[bool](@($tail|Where-Object{$_ -match $part}).Count -gt 0))}
  }
  try{$proc.Kill()}catch{}
  throw ('UPGRADE_PROCESS_TIMEOUT_'+$purpose)
}
    if($proc.ExitCode -ne 0){throw ('UPGRADE_PROCESS_NONZERO_'+$purpose+'_EXIT_'+$proc.ExitCode)}
  }finally{$proc.Dispose()}
}
function RequireVersion([string]$version,[string]$commit=''){
  $manifest=Join-Path $install 'manifests/installed-manifest.json'
  $state=Join-Path $install 'state/runtime-ownership.json'
  foreach($p in @($manifest,$state)){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw 'UPGRADE_MANIFEST_STATE_MISSING'}}
  $m=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8|ConvertFrom-Json
  $s=Get-Content -LiteralPath $state -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$m.product_version -ne $version -or [string]$s.active_version -ne $version){throw 'UPGRADE_VERSION_STATE_MISMATCH'}
  if($commit -and [string]$m.source_commit -ne $commit){throw 'UPGRADE_SOURCE_COMMIT_MISMATCH'}
  return $m
}
function Hash([string]$p){return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function RunInno([string]$exe,[string]$label,[bool]$setRoot) {
  $arguments=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NOICONS',('/DIR="'+$install+'"'),
    ('/LOG="'+(Join-Path $logs ($label+'.log'))+'"'))
  if($setRoot){$arguments+=('/ArtifactRoot="'+$artifacts+'"')}
  Launch $exe $arguments $label
}
function InspectInstalledHashes($manifest){
  foreach($entry in @($manifest.files)){
    $rel=[string]$entry.path
    if($rel.Contains('..') -or [IO.Path]::IsPathRooted($rel)){throw 'MANIFEST_PATH_UNSAFE'}
    $file=Join-Path $install ($rel.Replace('/','\'))
    if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'UPGRADE_OWNED_FILE_MISSING'}
    if((Hash $file) -ne [string]$entry.sha256){throw 'UPGRADE_OWNED_FILE_HASH_MISMATCH'}
  }
}
try{
  $stage='install-real-2.7.0'
  RunInno $legacy 'old-install' $true
  $installed=$true
  $oldManifest=RequireVersion '2.7.0'
  InspectInstalledHashes $oldManifest
  $configPath=Join-Path $install 'config.json'
  $cfg=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8|ConvertFrom-Json
  $originalToken=[string]$cfg.token
  if([string]::IsNullOrWhiteSpace($originalToken)){throw 'OLD_VERSION_TOKEN_MISSING'}
  if([IO.Path]::GetFullPath([string]$cfg.artifact_root) -ne [IO.Path]::GetFullPath($artifacts)){throw 'OLD_VERSION_ARTIFACT_ROOT_WRONG'}
  Mark 'REAL_270_INSTALL_BASELINE'
  # User-owned data outside the application is preserved across upgrades.
  $marker=Join-Path $artifacts 'owned-user-marker.txt'
  [IO.File]::WriteAllText($marker,'MUST_SURVIVE_UPGRADE',[Text.Encoding]::UTF8)
  $markerHash=Hash $marker
  # A harmless config extension tests that the installer does not reset user settings.
  # Never output config contents, tokens, or protected paths in public logs.
  $configObject=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $configObject | Add-Member -MemberType NoteProperty -Name 'qa_nonsecret_upgrade_marker' -Value 'preserve-me' -Force
  [IO.File]::WriteAllText($configPath,($configObject|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
  $oldRuntime=Join-Path $install 'runtime/AGENT_CAPABILITIES.json'
  $beforeHash=Hash $oldRuntime
  $stage='in-place-270-to-271-inno-upgrade'
  RunInno $candidate 'actual-upgrade' $false
  $newManifest=RequireVersion '2.7.1' $CandidateSourceCommit
  Mark 'REAL_INNO_270_TO_271_UPGRADE'
  $newCfg=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$newCfg.token -ne $originalToken){throw 'UPGRADE_ROTATED_TOKEN'}
  if([IO.Path]::GetFullPath([string]$newCfg.artifact_root) -ne [IO.Path]::GetFullPath($artifacts)){throw 'UPGRADE_RESET_ARTIFACT_ROOT'}
  if([string]$newCfg.qa_nonsecret_upgrade_marker -ne 'preserve-me'){throw 'UPGRADE_RESET_OPERATOR_CONFIG'}
  if(-not(Test-Path -LiteralPath $marker -PathType Leaf) -or (Hash $marker) -ne $markerHash){throw 'UPGRADE_DESTROYED_OPERATOR_DATA'}
  Mark 'REAL_UPGRADE_SETTINGS_AND_DATA_PRESERVED'
  InspectInstalledHashes $newManifest
  Mark 'REAL_UPGRADE_OWNED_FILE_HASHES'
  if((Hash $oldRuntime) -eq $beforeHash){throw 'UPGRADE_RUNTIME_BYTES_UNCHANGED'}
  Mark 'REAL_UPGRADE_RUNTIME_CHANGED'
  $hostManifest=Join-Path $install 'native-host/com.sokna.bridge.v3.json'
  $hostCfg=Get-Content -LiteralPath $hostManifest -Raw -Encoding UTF8|ConvertFrom-Json
  $reg='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.sokna.bridge.v3'
  if([IO.Path]::GetFullPath([string](Get-Item -LiteralPath $reg).GetValue('')) -ne [IO.Path]::GetFullPath($hostManifest)){throw 'UPGRADE_CHROME_REGISTRY_WRONG'}
  if([string]$hostCfg.name -ne 'com.sokna.bridge.v3' -or -not(Test-Path -LiteralPath $hostCfg.path -PathType Leaf)){throw 'UPGRADE_NATIVE_HOST_INVALID'}
  Mark 'REAL_UPGRADE_CHROME_HOST_REGISTRATION'
  $stage='uninstall-after-upgrade'
  $uninstaller=Join-Path $install 'unins000.exe'
  if(-not(Test-Path -LiteralPath $uninstaller -PathType Leaf)){throw 'UPGRADE_UNINSTALLER_MISSING'}
  Launch $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+(Join-Path $logs 'uninstall.log')+'"')) 'uninstall'
  $installed=$false
  if(-not(Test-Path -LiteralPath $marker -PathType Leaf) -or (Hash $marker) -ne $markerHash){throw 'UPGRADE_UNINSTALL_REMOVED_EXTERNAL_DATA'}
  Mark 'REAL_UPGRADE_UNINSTALL_PRESERVED_DATA'
  $required=@('REAL_270_INSTALL_BASELINE','REAL_INNO_270_TO_271_UPGRADE','REAL_UPGRADE_SETTINGS_AND_DATA_PRESERVED',
    'REAL_UPGRADE_OWNED_FILE_HASHES','REAL_UPGRADE_RUNTIME_CHANGED','REAL_UPGRADE_CHROME_HOST_REGISTRATION','REAL_UPGRADE_UNINSTALL_PRESERVED_DATA')
  if(@(Compare-Object -ReferenceObject $required -DifferenceObject @($markers)).Count -gt 0){throw 'UPGRADE_REQUIRED_EVIDENCE_INCOMPLETE'}
  $report=Join-Path $runRoot 'upgrade-evidence.json'
  [ordered]@{
    schema='sokna-bridge-real-installed-upgrade-v1'
    evidence_kind='disposable_windows_actual_270_to_271_inno'
    old_version='2.7.0';new_version='2.7.1'
    old_source_commit=[string]$oldManifest.source_commit
    new_source_commit=$CandidateSourceCommit
    result='PASS';passed=$required
    chrome_manual='NOT_RUN';maintenance_delta_upgrade='NOT_RUN';physical_power_loss='NOT_RUN';release_ready=$false
  }|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $report -Encoding UTF8NoBOM -NoNewline
  Write-Host 'REAL_WINDOWS_OLD_VERSION_INSTALLED_UPGRADE_E2E_PASS'
}catch{
  Write-Host "UPGRADE_FAILED_STAGE=$stage"
  Write-Host 'UPGRADE_QUALIFICATION_FAIL'
  throw
}finally{
  if($installed -and (Test-Path -LiteralPath (Join-Path $install 'unins000.exe') -PathType Leaf)){
    try{Launch (Join-Path $install 'unins000.exe') @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',
        ('/LOG="'+(Join-Path $logs 'cleanup-uninstall.log')+'"')) 'cleanup'}catch{Write-Host 'CLEANUP_UNINSTALL_ATTEMPTED_FAILED'}
  }
}
