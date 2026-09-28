param(
  [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$SetupPath=''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Invoke-ProcessChecked([string]$FilePath,[string[]]$Arguments,[int[]]$AllowedExitCodes=@(0)){
  Write-Host ('P1_PROCESS_START '+$FilePath+' '+($Arguments -join ' '))
  $p=Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if(-not $p.WaitForExit(180000)){try{$p.Kill()}catch{};throw ('PROCESS_TIMEOUT: '+$FilePath)};$p.WaitForExit()
  Write-Host ('P1_PROCESS_EXIT '+$FilePath+' '+$p.ExitCode)
  if($AllowedExitCodes -notcontains $p.ExitCode){throw "PROCESS_FAILED: $FilePath exit=$($p.ExitCode)"}
  return $p.ExitCode
}
function Sha([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Write-Json([string]$Path,$Object){[IO.File]::WriteAllText($Path,($Object|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))}
function New-SyntheticPayload([string]$Source,[string]$Destination,[string]$Version,[switch]$AddObsolete,[switch]$RemoveObsolete,[switch]$BrokenRuntime){
  if(Test-Path $Destination){Remove-Item $Destination -Recurse -Force}
  New-Item -ItemType Directory -Path $Destination -Force|Out-Null
  Get-ChildItem -LiteralPath $Source -Force|ForEach-Object{
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
  $manifestPath=Join-Path $Destination 'manifests\installed-manifest.json'
  if(-not(Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'SYNTHETIC_PAYLOAD_SOURCE_MANIFEST_MISSING'}
  $manifest=Get-Content $manifestPath -Raw|ConvertFrom-Json
  $old=[string]$manifest.product_version
  $agent=Join-Path $Destination 'runtime\agent.ps1'
  if(-not(Test-Path -LiteralPath $agent -PathType Leaf)){throw 'SYNTHETIC_PAYLOAD_AGENT_MISSING'}
  if($BrokenRuntime){[IO.File]::WriteAllText($agent,'param([string]$ConfigPath=""); throw "CI injected startup failure"',[Text.UTF8Encoding]::new($false))}
  else{$text=Get-Content $agent -Raw;$text=$text.Replace($old,$Version);[IO.File]::WriteAllText($agent,$text,[Text.UTF8Encoding]::new($false))}
  $caps=Join-Path $Destination 'runtime\AGENT_CAPABILITIES.json'
  if(-not(Test-Path -LiteralPath $caps -PathType Leaf)){throw 'SYNTHETIC_PAYLOAD_CAPABILITIES_MISSING'}
  $capsObj=Get-Content $caps -Raw|ConvertFrom-Json
  $capsObj.agent=$Version
  Write-Json $caps $capsObj
  $obsolete=Join-Path $Destination 'runtime\obsolete-ci.txt'
  if($AddObsolete){[IO.File]::WriteAllText($obsolete,'obsolete-ci',[Text.UTF8Encoding]::new($false))}
  if($RemoveObsolete -and (Test-Path $obsolete)){Remove-Item $obsolete -Force}

  # Rebuild ownership from the actual destination tree. Never splice entries from
  # the previous manifest: a stale path there must not survive into a synthetic upgrade.
  # Windows PowerShell 5.1 does not expose System.IO.Path.GetRelativePath. Canonicalize
  # both paths, require a directory-boundary prefix, then derive the relative path.
  $destinationRoot=[IO.Path]::GetFullPath($Destination).TrimEnd('\')
  $destinationPrefix=$destinationRoot+'\'
  $files=@(Get-ChildItem -LiteralPath $destinationRoot -File -Recurse|ForEach-Object{
    $fullPath=[IO.Path]::GetFullPath($_.FullName)
    if(-not $fullPath.StartsWith($destinationPrefix,[StringComparison]::OrdinalIgnoreCase)){throw ('SYNTHETIC_PAYLOAD_PATH_ESCAPE: '+$fullPath)}
    $rel=$fullPath.Substring($destinationPrefix.Length).Replace('\','/')
    if(-not [string]::Equals($rel,'manifests/installed-manifest.json',[StringComparison]::OrdinalIgnoreCase)){
      $owner=if($rel.StartsWith('runtime/',[StringComparison]::OrdinalIgnoreCase)){'maintenance'}else{'installer'}
      [pscustomobject]@{path=$rel;sha256=(Sha $_.FullName);bytes=$_.Length;owner=$owner}
    }
  }|Sort-Object path)
  $dupes=@($files|Group-Object path|Where-Object Count -gt 1)
  if($dupes.Count -gt 0){throw ('SYNTHETIC_PAYLOAD_DUPLICATE_PATH: '+(($dupes|ForEach-Object Name)-join','))}
  $manifest.product_version=$Version
  $manifest.source_commit='ci-synthetic'
  $manifest.files=$files
  Write-Json $manifestPath $manifest
  foreach($file in @($manifest.files)){
    $rel=[string]$file.path
    if([string]::IsNullOrWhiteSpace($rel)-or[IO.Path]::IsPathRooted($rel)-or$rel.Contains('..')){throw ('SYNTHETIC_PAYLOAD_UNSAFE_PATH: '+$rel)}
    $candidate=Join-Path $destinationRoot ($rel.Replace('/','\'))
    if(-not(Test-Path -LiteralPath $candidate -PathType Leaf)){throw ('SYNTHETIC_PAYLOAD_OWNED_PATH_MISSING: '+$rel)}
    $actual=Sha $candidate
    if(-not[string]::Equals($actual,[string]$file.sha256,[StringComparison]::OrdinalIgnoreCase)){throw ('SYNTHETIC_PAYLOAD_HASH_MISMATCH: '+$rel)}
  }
  return $manifestPath
}

function Get-FreeTcpPort {
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  $listener.Start()
  try{return ([Net.IPEndPoint]$listener.LocalEndpoint).Port}finally{$listener.Stop()}
}
function Test-LegacyPing([int]$Port,[string]$Token){
  try{
    $body=@{id=('legacy-probe-'+[guid]::NewGuid().ToString('N'));action='ping';params=@{}}|ConvertTo-Json -Compress
    $r=Invoke-RestMethod -Uri ('http://127.0.0.1:'+ $Port +'/api') -Method Post -Headers @{'X-Sokna-Token'=$Token} -ContentType 'application/json' -Body $body -TimeoutSec 2
    return ([bool]$r.ok -and ([string]$r.version).StartsWith('2.5.'))
  }catch{return $false}
}
function Invoke-LegacyRunningSetupAcceptance([string]$Setup,[string]$RepoRoot,[string]$CaseRoot){
  $legacyRoot=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V2'
  if(Test-Path -LiteralPath $legacyRoot){throw 'LEGACY_ACCEPTANCE_PATH_ALREADY_EXISTS'}
  $legacyInstall=Join-Path $CaseRoot 'legacy-upgrade-app'
  $legacyArtifacts=Join-Path $CaseRoot 'legacy-upgrade-artifacts'
  $legacySetupLog=Join-Path $CaseRoot 'legacy-upgrade-setup.log'
  $legacyProc=$null
  $runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  try{
    New-Item -ItemType Directory -Path $legacyRoot -Force|Out-Null
    $legacyAgent=Join-Path $legacyRoot 'agent.ps1'
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'native\legacy\v2.5\payload\agent.ps1') -Destination $legacyAgent -Force
    $port=Get-FreeTcpPort
    $tokenBytes=New-Object byte[] 32
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($tokenBytes)}finally{$rng.Dispose()}
    $token=[Convert]::ToBase64String($tokenBytes)
    $legacyCfg=[ordered]@{
      port=$port
      token=$token
      workspace_root=$RepoRoot
      default_workspace='ci'
      default_github_owner=''
      allowed_github_owners=@()
      workspaces=[ordered]@{ci=[ordered]@{path=$RepoRoot;expected_repo='';write_enabled=$false}}
    }
    Write-Json (Join-Path $legacyRoot 'config.json') $legacyCfg
    New-Item -Path $runKey -Force|Out-Null
    $runValue='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$legacyAgent+'"'
    Set-ItemProperty -Path $runKey -Name 'SOKNA Bridge Agent' -Value $runValue
    $legacyProc=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$legacyAgent) -PassThru -WindowStyle Hidden
    $ready=$false
    for($i=0;$i-lt40;$i++){Start-Sleep -Milliseconds 250;if((Test-Path (Join-Path $legacyRoot 'agent.pid'))-and(Test-LegacyPing $port $token)){$ready=$true;break}}
    if(-not$ready){throw 'LEGACY_ACCEPTANCE_AGENT_DID_NOT_START'}
    $legacyPidPath=Join-Path $legacyRoot 'agent.pid'
    Remove-Item -LiteralPath $legacyPidPath -Force
    if($null-eq(Get-Process -Id $legacyProc.Id -ErrorAction SilentlyContinue)){throw 'LEGACY_ACCEPTANCE_UNTRACKED_AGENT_NOT_RUNNING'}
    Write-Host 'P1_LEGACY_UNTRACKED_RUNTIME_INJECTED'

    Invoke-ProcessChecked $Setup @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',('/DIR="'+$legacyInstall+'"'),('/ArtifactRoot="'+$legacyArtifacts+'"'),'/TASKS=""',('/LOG="'+$legacySetupLog+'"'))|Out-Null
    Start-Sleep -Milliseconds 300
    try{$legacyProc.Refresh()}catch{}
    if(-not$legacyProc.HasExited){
      $legacyProc.WaitForExit(3000)|Out-Null
      $legacyProc.Refresh()
    }
    if(-not$legacyProc.HasExited){throw 'LEGACY_ACCEPTANCE_OLD_AGENT_STILL_RUNNING'}
    if(-not(Test-Path -LiteralPath (Join-Path $legacyRoot 'config.json') -PathType Leaf)){throw 'LEGACY_ACCEPTANCE_SOURCE_CONFIG_REMOVED'}
    if(-not(Test-Path -LiteralPath $legacyAgent -PathType Leaf)){throw 'LEGACY_ACCEPTANCE_SOURCE_AGENT_REMOVED'}
    $legacyRun=$null
    try{$legacyRun=Get-ItemPropertyValue -Path $runKey -Name 'SOKNA Bridge Agent' -ErrorAction Stop}catch{$legacyRun=$null}
    if(-not[string]::IsNullOrWhiteSpace([string]$legacyRun)){throw 'LEGACY_ACCEPTANCE_AUTOSTART_NOT_REMOVED'}

    $newCfg=Get-Content (Join-Path $legacyInstall 'config.json') -Raw|ConvertFrom-Json
    if([int]$newCfg.port-ne$port){throw 'LEGACY_ACCEPTANCE_PORT_NOT_MIGRATED'}
    if([string]$newCfg.token-ne$token){throw 'LEGACY_ACCEPTANCE_TOKEN_NOT_MIGRATED'}
    $prep=Get-Content (Join-Path $legacyInstall 'state\install-preparation.json') -Raw|ConvertFrom-Json
    if(-not[bool]$prep.legacy_runtime_detected -or -not[bool]$prep.legacy_runtime_stopped){throw 'LEGACY_ACCEPTANCE_PREPARATION_EVIDENCE_MISSING'}
    if(-not[bool]$prep.recovered_untracked_runtime_stopped){throw 'LEGACY_ACCEPTANCE_UNTRACKED_RECOVERY_EVIDENCE_MISSING'}
    if([int]$prep.recovered_untracked_runtime_pid-ne$legacyProc.Id){throw 'LEGACY_ACCEPTANCE_UNTRACKED_RECOVERY_PID_MISMATCH'}
    if([int]$prep.recovered_untracked_runtime_port-ne$port){throw 'LEGACY_ACCEPTANCE_UNTRACKED_RECOVERY_PORT_MISMATCH'}
    if([string]$prep.recovered_untracked_runtime_source-ne'legacy-config'){throw 'LEGACY_ACCEPTANCE_UNTRACKED_RECOVERY_SOURCE_MISMATCH'}
    if(-not[bool]$prep.legacy_autostart_removed){throw 'LEGACY_ACCEPTANCE_AUTOSTART_EVIDENCE_MISSING'}
    Write-Host 'P1_LEGACY_UNTRACKED_RUNTIME_RECOVERY_PASS'
    $legacyMaint=Join-Path $legacyInstall 'Sokna.Agent.Maintenance.exe'
    Invoke-Maint $legacyMaint $legacyInstall @('health','--expected-version','2.7.1')|Out-Null

    $uninstaller=Get-ChildItem $legacyInstall -Filter 'unins*.exe' -File|Select-Object -First 1
    if(-not$uninstaller){throw 'LEGACY_ACCEPTANCE_UNINSTALLER_MISSING'}
    Invoke-ProcessChecked $uninstaller.FullName @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART')|Out-Null
    Write-Host 'P1_LEGACY_RUNNING_SETUP_ACCEPTANCE_PASS'
  }finally{
    if($null-ne$legacyProc){try{Stop-Process -Id $legacyProc.Id -Force -ErrorAction SilentlyContinue}catch{}}
    try{Remove-ItemProperty -Path $runKey -Name 'SOKNA Bridge Agent' -ErrorAction SilentlyContinue}catch{}
    if(Test-Path -LiteralPath $legacyInstall){try{$m=Join-Path $legacyInstall 'Sokna.Agent.Maintenance.exe';if(Test-Path $m){& $m stop --install-root $legacyInstall|Out-Null}}catch{}}
    if(Test-Path -LiteralPath $legacyRoot){Remove-Item -LiteralPath $legacyRoot -Recurse -Force -ErrorAction SilentlyContinue}
  }
}

function Invoke-Maint([string]$Exe,[string]$InstallRoot,[string[]]$CommandArgs,[int[]]$Allowed=@(0)){
  try{return Invoke-ProcessChecked $Exe (@($CommandArgs)+@('--install-root',$InstallRoot)) $Allowed}catch{Write-Host 'P1_MAINT_FAILURE_EVIDENCE';Get-ChildItem (Join-Path $InstallRoot 'logs') -File -Recurse -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 2|ForEach-Object{Write-Host ('P1_MAINT_LOG '+$_.FullName);Get-Content $_.FullName -Tail 30 -ErrorAction SilentlyContinue|Write-Host};throw}
}

if([string]::IsNullOrWhiteSpace($SetupPath)){
  $s=Get-ChildItem (Join-Path $RepoRoot 'artifacts\windows\setup') -Filter 'SOKNA-Bridge-Setup-*.exe' -File|Select-Object -First 1
  if(-not $s){throw 'SETUP_EXE_MISSING'};$SetupPath=$s.FullName
}
$caseRoot=Join-Path $env:TEMP ('sokna-p1-ci-'+[Guid]::NewGuid().ToString('N'))
$install=Join-Path $caseRoot 'app';$artifact=Join-Path $caseRoot 'artifacts';$setupLog=Join-Path $caseRoot 'setup.log'
New-Item -ItemType Directory -Path $caseRoot -Force|Out-Null
try{
  Invoke-LegacyRunningSetupAcceptance $SetupPath $RepoRoot $caseRoot
  Invoke-ProcessChecked $SetupPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',('/DIR="'+$install+'"'),('/ArtifactRoot="'+$artifact+'"'),'/TASKS=""',('/LOG="'+$setupLog+'"'))|Out-Null
  $maint=Join-Path $install 'Sokna.Agent.Maintenance.exe';if(-not(Test-Path $maint)){throw 'MAINTENANCE_EXE_MISSING_AFTER_INSTALL'}
  $control=Join-Path $install 'Sokna.Bridge.ControlCenter.exe';if(-not(Test-Path $control)){throw 'CONTROL_CENTER_EXE_MISSING_AFTER_INSTALL'}
  $ccSelf=Join-Path $caseRoot 'control-center-self-test.json'
  Invoke-ProcessChecked $control @('--self-test','--install-root',$install,'--output',$ccSelf)|Out-Null
  if(-not(Test-Path $ccSelf)){throw 'CONTROL_CENTER_SELF_TEST_OUTPUT_MISSING'}
  $ccObj=Get-Content $ccSelf -Raw|ConvertFrom-Json;if(-not[bool]$ccObj.ok){throw 'CONTROL_CENTER_SELF_TEST_FAILED'}
  Write-Host 'P1_CONTROL_CENTER_SELF_TEST_PASS'
  Invoke-Maint $maint $install @('health','--expected-version','2.7.1')|Out-Null
  Invoke-ProcessChecked $SetupPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',('/DIR="'+$install+'"'),('/ArtifactRoot="'+$artifact+'"'),'/TASKS=""',('/LOG="'+(Join-Path $caseRoot 'active-reinstall.log')+'"'))|Out-Null
  Invoke-Maint $maint $install @('health','--expected-version','2.7.1')|Out-Null
  $prep=Get-Content (Join-Path $install 'state\install-preparation.json') -Raw|ConvertFrom-Json
  if(-not[bool]$prep.current_runtime_stopped){throw 'ACTIVE_REINSTALL_DID_NOT_STOP_OWNED_RUNTIME'}
  Write-Host 'P1_ACTIVE_RUNTIME_REINSTALL_ACCEPTANCE_PASS'
  foreach($d in 'incoming','staging','accepted','failed','cache','browser','logs'){if(-not(Test-Path (Join-Path $artifact $d))){throw "ARTIFACT_ROOT_DIR_MISSING: $d"}}

  $configObj=Get-Content (Join-Path $install 'config.json') -Raw|ConvertFrom-Json;$configToken=[string]$configObj.token
  $probeSecret='CI_SECRET_'+[Guid]::NewGuid().ToString('N');$runtimeLog=Join-Path $install 'logs\runtime\ci-secret.log';New-Item -ItemType Directory -Path (Split-Path $runtimeLog -Parent) -Force|Out-Null
  [IO.File]::WriteAllText($runtimeLog,("token=$probeSecret`nAuthorization: Bearer $probeSecret`n"),[Text.UTF8Encoding]::new($false))
  $bundle=Join-Path $caseRoot 'support.zip';Invoke-Maint $maint $install @('support-bundle','--output',$bundle)|Out-Null;if(-not(Test-Path $bundle)){throw 'SUPPORT_BUNDLE_MISSING'}
  $bundleDir=Join-Path $caseRoot 'support-expanded';Expand-Archive -LiteralPath $bundle -DestinationPath $bundleDir -Force
  $bundleText=(Get-ChildItem $bundleDir -File -Recurse|ForEach-Object{Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue}) -join "`n"
  if($bundleText.Contains($probeSecret) -or $bundleText.Contains($configToken)){throw 'SUPPORT_BUNDLE_SECRET_LEAK'}
  foreach($stateName in 'workspaces.json','workspace-grants.json','components.json','automations.json'){if(-not(Test-Path (Join-Path (Join-Path $bundleDir 'state') $stateName))){throw ('SUPPORT_BUNDLE_WHOLE_PRODUCT_STATE_MISSING: '+$stateName)}}

  # Fault-injection: one malformed state file + one locked/non-readable runtime log must not abort the bundle.
  $workspaceState=Join-Path $install 'state\workspaces.json';$workspaceBackup=[IO.File]::ReadAllBytes($workspaceState)
  $lockedLog=Join-Path $install 'logs\runtime\ci-locked.log';[IO.File]::WriteAllText($lockedLog,'locked',[Text.UTF8Encoding]::new($false))
  $lock=[IO.File]::Open($lockedLog,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try{
    [IO.File]::WriteAllText($workspaceState,'{"broken":',[Text.UTF8Encoding]::new($false))
    $partialBundle=Join-Path $caseRoot 'support-partial.zip';Invoke-Maint $maint $install @('support-bundle','--output',$partialBundle)|Out-Null
    if(-not(Test-Path $partialBundle)){throw 'SUPPORT_BUNDLE_PARTIAL_MISSING'}
    $partialDir=Join-Path $caseRoot 'support-partial-expanded';Expand-Archive -LiteralPath $partialBundle -DestinationPath $partialDir -Force
    $bundleManifest=Get-Content (Join-Path $partialDir 'bundle-manifest.json') -Raw|ConvertFrom-Json
    $bundleErrors=Get-Content (Join-Path $partialDir 'bundle-errors.json') -Raw|ConvertFrom-Json
    if(-not[bool]$bundleManifest.partial){throw 'SUPPORT_BUNDLE_PARTIAL_FLAG_MISSING'}
    if([int]$bundleManifest.error_count -lt 1){throw 'SUPPORT_BUNDLE_PARTIAL_ERROR_COUNT_MISSING'}
    if(@($bundleErrors).Count -lt 1){throw 'SUPPORT_BUNDLE_ERRORS_MISSING'}
    Write-Host 'P1_SUPPORT_BUNDLE_PARTIAL_PASS'
  }finally{
    if($lock){$lock.Dispose()}
    [IO.File]::WriteAllBytes($workspaceState,$workspaceBackup)
  }

  $agent=Join-Path $install 'runtime\agent.ps1';Add-Content -LiteralPath $agent -Value '# CI corruption'
  $payload=Join-Path $RepoRoot 'artifacts\windows\installer-payload';$manifest=Join-Path $payload 'manifests\installed-manifest.json'
  Invoke-Maint $maint $install @('repair','--manifest',$manifest,'--payload-root',$payload)|Out-Null
  if((Sha $agent)-ne(Sha (Join-Path $payload 'runtime\agent.ps1'))){throw 'REPAIR_DID_NOT_RESTORE_RUNTIME'}

  $v272=Join-Path $caseRoot 'payload-2.7.2';$m272=New-SyntheticPayload $payload $v272 '2.7.2' -AddObsolete
  Invoke-Maint $maint $install @('upgrade','--manifest',$m272,'--payload-root',$v272)|Out-Null
  if(-not(Test-Path (Join-Path $install 'runtime\obsolete-ci.txt'))){throw 'UPGRADE_ADD_FILE_FAILED'}

  $v273=Join-Path $caseRoot 'payload-2.7.3';$m273=New-SyntheticPayload $v272 $v273 '2.7.3' -RemoveObsolete
  Invoke-Maint $maint $install @('upgrade','--manifest',$m273,'--payload-root',$v273)|Out-Null
  if(Test-Path (Join-Path $install 'runtime\obsolete-ci.txt')){throw 'UPGRADE_REMOVED_FILE_STALE'}
  $status=& $maint status --install-root $install|ConvertFrom-Json;$tx=[string]$status.data.ownership.activation_tx_id
  if([string]::IsNullOrWhiteSpace($tx)){throw 'UPGRADE_TX_ID_MISSING'}
  Invoke-Maint $maint $install @('rollback','--tx-id',$tx)|Out-Null
  if(-not(Test-Path (Join-Path $install 'runtime\obsolete-ci.txt'))){throw 'ROLLBACK_DID_NOT_RESTORE_REMOVED_FILE'}

  $bad=Join-Path $caseRoot 'payload-bad';$mbad=New-SyntheticPayload $v272 $bad '2.7.3' -AddObsolete -BrokenRuntime
  Invoke-Maint $maint $install @('upgrade','--manifest',$mbad,'--payload-root',$bad) @(10)|Out-Null
  Invoke-Maint $maint $install @('health','--expected-version','2.7.2')|Out-Null

  $uninstaller=Get-ChildItem $install -Filter 'unins*.exe' -File|Select-Object -First 1;if(-not $uninstaller){throw 'UNINSTALLER_MISSING'}
  Invoke-ProcessChecked $uninstaller.FullName @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART')|Out-Null
  if(-not(Test-Path $artifact)){throw 'UNINSTALL_REMOVED_ARTIFACT_ROOT'}
  $locator=Join-Path $env:LOCALAPPDATA 'SOKNA\Agent\install-locator.json'
  if(Test-Path $locator){$l=Get-Content $locator -Raw|ConvertFrom-Json;if([string]$l.install_root -eq $install){throw 'UNINSTALL_LEFT_ACTIVE_LOCATOR'}}
  [ordered]@{ok=$true;case_root=$caseRoot;artifact_root_preserved=$true;repair=$true;upgrade=$true;rollback=$true;automatic_rollback=$true;legacy_running_setup=$true;active_runtime_reinstall=$true;control_center=$true;support_bundle_partial=$true;uninstall=$true}|ConvertTo-Json -Compress
}
finally{
  if(Test-Path $install){try{$m=Join-Path $install 'Sokna.Agent.Maintenance.exe';if(Test-Path $m){& $m stop --install-root $install|Out-Null}}catch{}}
}
