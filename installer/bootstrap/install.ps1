param(
  [string]$WorkspaceRoot = 'C:\SOKNA',
  [switch]$SkipStart,
  [switch]$SkipOpenExtensions
)
$ErrorActionPreference='Stop'

$Root=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V3'
$AgentDir=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V2'
$ExtDir=Join-Path $Root 'extension'
$Payload=Join-Path $PSScriptRoot 'payload'
$HostName='com.sokna.bridge.v3'
$ExtId='gnclegfheoegfdnhndkpemnlheilnick'
$Port=8766

function Ensure-Dir([string]$p){if(-not(Test-Path $p)){New-Item -ItemType Directory -Path $p -Force|Out-Null}}
function Write-Utf8NoBom([string]$p,[string]$text){[IO.File]::WriteAllText($p,$text,[Text.UTF8Encoding]::new($false))}
function New-Token {
  $b=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b)
}
function Test-Agent([string]$token){
  try{
    $body=@{id=('setup-ping-'+[guid]::NewGuid().ToString('N'));action='ping';params=@{}}|ConvertTo-Json -Compress
    $r=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api" -Method Post -Headers @{'X-Sokna-Token'=$token} -ContentType 'application/json' -Body $body -TimeoutSec 5
    return [bool]$r.ok
  }catch{return $false}
}

Ensure-Dir $Root
Ensure-Dir $AgentDir
Ensure-Dir $ExtDir

$agentSrc=Join-Path $Payload 'agent.ps1'
$hostSrc=Join-Path $Payload 'sokna-bridge-native-host.exe'
$extSrc=Join-Path $Payload 'extension'
if(-not(Test-Path $agentSrc)){throw "Missing payload: $agentSrc"}
if(-not(Test-Path $hostSrc)){throw "Missing payload: $hostSrc"}
if(-not(Test-Path (Join-Path $extSrc 'manifest.json'))){throw "Missing extension payload"}

$configPath=Join-Path $AgentDir 'config.json'
$token=$null
if(Test-Path $configPath){
  try{$old=Get-Content $configPath -Raw|ConvertFrom-Json;$token=[string]$old.token}catch{}
}
if([string]::IsNullOrWhiteSpace($token)){$token=New-Token}

$bridgePath=Join-Path $WorkspaceRoot 'SOKNA-Bridge'
$cafePath=Join-Path $WorkspaceRoot 'SoknaCafe'
$workspaces=[ordered]@{}
if(Test-Path $bridgePath -PathType Container){$workspaces['SOKNA-Bridge']=[ordered]@{path=$bridgePath;expected_repo='mobaraki20/SOKNA-Bridge';write_enabled=$true}}
if(Test-Path $cafePath -PathType Container){$workspaces['SoknaCafe']=[ordered]@{path=$cafePath;expected_repo='mobaraki20/SoknaCafe';write_enabled=$false}}
$default=''
if($workspaces.Contains('SOKNA-Bridge')){$default='SOKNA-Bridge'}elseif($workspaces.Contains('SoknaCafe')){$default='SoknaCafe'}
$config=[ordered]@{
  port=$Port
  token=$token
  workspace_root=$WorkspaceRoot
  default_workspace=$default
  default_github_owner='mobaraki20'
  allowed_github_owners=@('mobaraki20')
  workspaces=$workspaces
}
Write-Utf8NoBom $configPath ($config|ConvertTo-Json -Depth 8)

Copy-Item $agentSrc (Join-Path $AgentDir 'agent.ps1') -Force
Copy-Item (Join-Path $extSrc '*') $ExtDir -Recurse -Force
Copy-Item $hostSrc (Join-Path $Root 'sokna-bridge-native-host.exe') -Force

$hostManifest=Join-Path $Root "$HostName.json"
$hm=[ordered]@{
  name=$HostName
  description='SOKNA Bridge V3 Native Messaging Host'
  path=(Join-Path $Root 'sokna-bridge-native-host.exe')
  type='stdio'
  allowed_origins=@("chrome-extension://$ExtId/")
}
Write-Utf8NoBom $hostManifest ($hm|ConvertTo-Json -Depth 5)

foreach($k in @(
 ('HKCU:\Software\Google\Chrome\NativeMessagingHosts\'+$HostName),
 ('HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\'+$HostName)
)){
  New-Item -Path $k -Force|Out-Null
  Set-Item -Path $k -Value $hostManifest
}

$run='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $AgentDir 'agent.ps1')+'"'
New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Force|Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'SOKNA Bridge Agent' -Value $run

if(-not $SkipStart){
  $pidFile=Join-Path $AgentDir 'agent.pid'
  if(Test-Path $pidFile){
    try{$oldPid=[int](Get-Content $pidFile -Raw);Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue}catch{}
    Start-Sleep -Milliseconds 400
  }
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $AgentDir 'agent.ps1'))
  $ok=$false
  for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 500;if(Test-Agent $token){$ok=$true;break}}
  if(-not $ok){throw 'Agent health check failed on port 8766'}
}

$report=[ordered]@{
  version='1.0.0'
  installed_at=(Get-Date).ToString('o')
  agent_version='2.5.4'
  extension_version='3.9.4'
  agent_dir=$AgentDir
  extension_dir=$ExtDir
  native_host_manifest=$hostManifest
  startup='HKCU Run'
  health=($(if($SkipStart){'skipped'}else{'ok'}))
}
Write-Utf8NoBom (Join-Path $Root 'install-report.json') ($report|ConvertTo-Json -Depth 5)

Write-Host ''
Write-Host 'SOKNA Bridge bootstrap installed successfully.' -ForegroundColor Green
Write-Host "Extension path: $ExtDir" -ForegroundColor Cyan
Write-Host 'Chrome: open chrome://extensions, enable Developer mode, Load unpacked, then select the extension path above.' -ForegroundColor Yellow
if(-not $SkipOpenExtensions){
  try{Start-Process 'chrome.exe' 'chrome://extensions'}catch{}
}
