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
function Invoke-Maint([string]$Exe,[string]$InstallRoot,[string[]]$CommandArgs,[int[]]$Allowed=@(0)){
  try{return Invoke-ProcessChecked $Exe (@($CommandArgs)+@('--install-root',$InstallRoot)) $Allowed}catch{Write-Host 'P1_MAINT_FAILURE_EVIDENCE';Get-ChildItem (Join-Path $InstallRoot 'logs') -File -Recurse -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 2|ForEach-Object{Write-Host ('P1_MAINT_LOG '+$_.FullName);Get-Content $_.FullName -Tail 30 -ErrorAction SilentlyContinue|Write-Host};throw}
}

function Start-LegacyMigrationFixture([string]$CaseRoot){
  $legacyRoot=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V2'
  if(Test-Path -LiteralPath $legacyRoot){throw ('LEGACY_TEST_ROOT_ALREADY_EXISTS: '+$legacyRoot)}
  $workspace=Join-Path $CaseRoot 'legacy-workspace'
  New-Item -ItemType Directory -Path $legacyRoot,$workspace -Force|Out-Null
  $legacyAgent=Join-Path $legacyRoot 'agent.ps1'
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'native\legacy\v2.5\payload\agent.ps1') -Destination $legacyAgent -Force
  $token='LEGACY_CI_'+[Guid]::NewGuid().ToString('N')
  $cfg=[ordered]@{
    port=8766
    token=$token
    workspace_root=$workspace
    default_workspace='LegacyTest'
    default_github_owner=''
    allowed_github_owners=@()
    workspaces=[ordered]@{
      LegacyTest=[ordered]@{path=$workspace;expected_repo='';write_enabled=$true}
    }
  }
  Write-Json (Join-Path $legacyRoot 'config.json') $cfg
  $runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  New-Item -Path $runKey -Force|Out-Null
  $legacyRun='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$legacyAgent+'"'
  Set-ItemProperty -Path $runKey -Name 'SOKNA Bridge Agent' -Value $legacyRun

  $proc=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$legacyAgent,'-ConfigPath',(Join-Path $legacyRoot 'config.json')) -WindowStyle Hidden -PassThru
  $ready=$false
  for($i=0;$i -lt 30;$i++){
    Start-Sleep -Milliseconds 250
    try{
      $body=@{id=('legacy-ci-'+[guid]::NewGuid().ToString('N'));action='ping';params=@{}}|ConvertTo-Json -Compress
      $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8766/api' -Method Post -Headers @{'X-Sokna-Token'=$token} -ContentType 'application/json' -Body $body -TimeoutSec 2
      if([bool]$r.ok){$ready=$true;break}
    }catch{}
  }
  if(-not$ready){
    try{$proc.Kill()}catch{}
    throw 'LEGACY_MIGRATION_FIXTURE_NOT_READY'
  }
  $pidFile=Join-Path $legacyRoot 'agent.pid'
  if(-not(Test-Path -LiteralPath $pidFile -PathType Leaf)){throw 'LEGACY_MIGRATION_FIXTURE_PID_MISSING'}
  $legacyPid=[int](Get-Content -LiteralPath $pidFile -Raw)
  return [pscustomobject]@{root=$legacyRoot;pid=$legacyPid;process=$proc;run_key=$runKey}
}

if([string]::IsNullOrWhiteSpace($SetupPath)){
  $s=Get-ChildItem (Join-Path $RepoRoot 'artifacts\windows\setup') -Filter 'SOKNA-Agent-Setup-*.exe' -File|Select-Object -First 1
  if(-not $s){throw 'SETUP_EXE_MISSING'};$SetupPath=$s.FullName
}
$caseRoot=Join-Path $env:TEMP ('sokna-p1-ci-'+[Guid]::NewGuid().ToString('N'))
$install=Join-Path $caseRoot 'app';$artifact=Join-Path $caseRoot 'artifacts';$setupLog=Join-Path $caseRoot 'setup.log'
New-Item -ItemType Directory -Path $caseRoot -Force|Out-Null
$legacyFixture=$null
try{
  $legacyFixture=Start-LegacyMigrationFixture $caseRoot
  Invoke-ProcessChecked $SetupPath @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',('/DIR="'+$install+'"'),('/ArtifactRoot="'+$artifact+'"'),'/TASKS=""',('/LOG="'+$setupLog+'"'))|Out-Null
  if(Get-Process -Id ([int]$legacyFixture.pid) -ErrorAction SilentlyContinue){throw 'LEGACY_RUNTIME_NOT_STOPPED'}
  if(-not(Test-Path -LiteralPath (Join-Path $legacyFixture.root 'config.json') -PathType Leaf)){throw 'LEGACY_MIGRATION_SOURCE_NOT_PRESERVED'}
  $legacyRun=Get-ItemPropertyValue -Path $legacyFixture.run_key -Name 'SOKNA Bridge Agent' -ErrorAction SilentlyContinue
  if(-not[string]::IsNullOrWhiteSpace([string]$legacyRun)){throw 'LEGACY_AUTOSTART_NOT_REMOVED'}
  $maint=Join-Path $install 'Sokna.Agent.Maintenance.exe';if(-not(Test-Path $maint)){throw 'MAINTENANCE_EXE_MISSING_AFTER_INSTALL'}
  Invoke-Maint $maint $install @('health','--expected-version','2.6.0')|Out-Null
  foreach($d in 'incoming','staging','accepted','failed','cache','browser','logs'){if(-not(Test-Path (Join-Path $artifact $d))){throw "ARTIFACT_ROOT_DIR_MISSING: $d"}}

  $configObj=Get-Content (Join-Path $install 'config.json') -Raw|ConvertFrom-Json;$configToken=[string]$configObj.token
  $probeSecret='CI_SECRET_'+[Guid]::NewGuid().ToString('N');$runtimeLog=Join-Path $install 'logs\runtime\ci-secret.log';New-Item -ItemType Directory -Path (Split-Path $runtimeLog -Parent) -Force|Out-Null
  [IO.File]::WriteAllText($runtimeLog,("token=$probeSecret`nAuthorization: Bearer $probeSecret`n"),[Text.UTF8Encoding]::new($false))
  $bundle=Join-Path $caseRoot 'support.zip';Invoke-Maint $maint $install @('support-bundle','--output',$bundle)|Out-Null;if(-not(Test-Path $bundle)){throw 'SUPPORT_BUNDLE_MISSING'}
  $bundleDir=Join-Path $caseRoot 'support-expanded';Expand-Archive -LiteralPath $bundle -DestinationPath $bundleDir -Force
  $bundleText=(Get-ChildItem $bundleDir -File -Recurse|ForEach-Object{Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue}) -join "`n"
  if($bundleText.Contains($probeSecret) -or $bundleText.Contains($configToken)){throw 'SUPPORT_BUNDLE_SECRET_LEAK'}
  foreach($stateName in 'workspaces.json','workspace-grants.json','components.json','automations.json'){if(-not(Test-Path (Join-Path (Join-Path $bundleDir 'state') $stateName))){throw ('SUPPORT_BUNDLE_WHOLE_PRODUCT_STATE_MISSING: '+$stateName)}}
  $agent=Join-Path $install 'runtime\agent.ps1';Add-Content -LiteralPath $agent -Value '# CI corruption'
  $payload=Join-Path $RepoRoot 'artifacts\windows\installer-payload';$manifest=Join-Path $payload 'manifests\installed-manifest.json'
  Invoke-Maint $maint $install @('repair','--manifest',$manifest,'--payload-root',$payload)|Out-Null
  if((Sha $agent)-ne(Sha (Join-Path $payload 'runtime\agent.ps1'))){throw 'REPAIR_DID_NOT_RESTORE_RUNTIME'}

  $v261=Join-Path $caseRoot 'payload-2.6.1';$m261=New-SyntheticPayload $payload $v261 '2.6.1' -AddObsolete
  Invoke-Maint $maint $install @('upgrade','--manifest',$m261,'--payload-root',$v261)|Out-Null
  if(-not(Test-Path (Join-Path $install 'runtime\obsolete-ci.txt'))){throw 'UPGRADE_ADD_FILE_FAILED'}

  $v262=Join-Path $caseRoot 'payload-2.6.2';$m262=New-SyntheticPayload $v261 $v262 '2.6.2' -RemoveObsolete
  Invoke-Maint $maint $install @('upgrade','--manifest',$m262,'--payload-root',$v262)|Out-Null
  if(Test-Path (Join-Path $install 'runtime\obsolete-ci.txt')){throw 'UPGRADE_REMOVED_FILE_STALE'}
  $status=& $maint status --install-root $install|ConvertFrom-Json;$tx=[string]$status.data.ownership.activation_tx_id
  if([string]::IsNullOrWhiteSpace($tx)){throw 'UPGRADE_TX_ID_MISSING'}
  Invoke-Maint $maint $install @('rollback','--tx-id',$tx)|Out-Null
  if(-not(Test-Path (Join-Path $install 'runtime\obsolete-ci.txt'))){throw 'ROLLBACK_DID_NOT_RESTORE_REMOVED_FILE'}

  $bad=Join-Path $caseRoot 'payload-bad';$mbad=New-SyntheticPayload $v261 $bad '2.6.2' -AddObsolete -BrokenRuntime
  Invoke-Maint $maint $install @('upgrade','--manifest',$mbad,'--payload-root',$bad) @(10)|Out-Null
  Invoke-Maint $maint $install @('health','--expected-version','2.6.1')|Out-Null

  $uninstaller=Get-ChildItem $install -Filter 'unins*.exe' -File|Select-Object -First 1;if(-not $uninstaller){throw 'UNINSTALLER_MISSING'}
  Invoke-ProcessChecked $uninstaller.FullName @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART')|Out-Null
  if(-not(Test-Path $artifact)){throw 'UNINSTALL_REMOVED_ARTIFACT_ROOT'}
  $locator=Join-Path $env:LOCALAPPDATA 'SOKNA\Agent\install-locator.json'
  if(Test-Path $locator){$l=Get-Content $locator -Raw|ConvertFrom-Json;if([string]$l.install_root -eq $install){throw 'UNINSTALL_LEFT_ACTIVE_LOCATOR'}}
  [ordered]@{ok=$true;case_root=$caseRoot;artifact_root_preserved=$true;repair=$true;upgrade=$true;rollback=$true;automatic_rollback=$true;uninstall=$true}|ConvertTo-Json -Compress
}
finally{
  if(Test-Path $install){try{$m=Join-Path $install 'Sokna.Agent.Maintenance.exe';if(Test-Path $m){& $m stop --install-root $install|Out-Null}}catch{}}
  if($null-ne$legacyFixture){
    try{if(Get-Process -Id ([int]$legacyFixture.pid) -ErrorAction SilentlyContinue){Stop-Process -Id ([int]$legacyFixture.pid) -Force -ErrorAction SilentlyContinue}}catch{}
    try{
      $legacyRun=Get-ItemPropertyValue -Path $legacyFixture.run_key -Name 'SOKNA Bridge Agent' -ErrorAction SilentlyContinue
      if(([string]$legacyRun).Contains([string]$legacyFixture.root,[StringComparison]::OrdinalIgnoreCase)){Remove-ItemProperty -Path $legacyFixture.run_key -Name 'SOKNA Bridge Agent' -Force -ErrorAction SilentlyContinue}
    }catch{}
    try{if(Test-Path -LiteralPath $legacyFixture.root){Remove-Item -LiteralPath $legacyFixture.root -Recurse -Force}}catch{}
  }
}
