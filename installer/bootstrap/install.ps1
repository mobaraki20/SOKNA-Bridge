param(
  [string]$WorkspaceRoot = '',
  [switch]$SkipStart,
  [switch]$SkipOpenExtensions
)
$ErrorActionPreference='Stop'

$Root=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V3'
$AgentDir=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V2'
$ExtDir=Join-Path $Root 'extension'
$Payload=Join-Path $PSScriptRoot 'payload'
$HostName='com.sokna.bridge.v3'
# Extension identity is derived from the signed public manifest key.
function Get-ExtensionIdFromKey([string]$publicKey){
  if([string]::IsNullOrWhiteSpace($publicKey)){throw 'BRIDGE_EXTENSION_PUBLIC_KEY_MISSING'}
  try{$keyBytes=[Convert]::FromBase64String($publicKey)}catch{throw 'BRIDGE_EXTENSION_PUBLIC_KEY_INVALID'}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$hash=$sha.ComputeHash($keyBytes)}finally{$sha.Dispose()}
  $alphabet='abcdefghijklmnop';$id=''
  for($i=0;$i -lt 16;$i++){
    $id+=$alphabet[[int]($hash[$i] -shr 4)]
    $id+=$alphabet[[int]($hash[$i] -band 15)]
  }
  return $id
}
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
    $body=@{id=('setup-ping-'+[guid]::NewGuid().ToString('N'));action='agent.capabilities';params=@{}}|ConvertTo-Json -Compress
    $r=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api" -Method Post -Headers @{'X-Sokna-Token'=$token} -ContentType 'application/json' -Body $body -TimeoutSec 5
    return [bool]$r.ok
  }catch{return $false}
}

# Preflight payload and existing configuration before changing installed state.
$agentSrc=Join-Path $Payload 'agent.ps1'
$capsSrc=Join-Path $Payload 'AGENT_CAPABILITIES.json'
if(-not(Test-Path -LiteralPath $capsSrc -PathType Leaf)){throw 'BRIDGE_CAPABILITIES_PAYLOAD_MISSING'}
$caps=Get-Content -LiteralPath $capsSrc -Raw -Encoding UTF8|ConvertFrom-Json
$AgentVersion=[string]$caps.agent
$hostSrc=Join-Path $Payload 'sokna-bridge-native-host.exe'
$extSrc=Join-Path $Payload 'extension'
$extensionManifestPath=Join-Path $extSrc 'manifest.json'
if(-not(Test-Path -LiteralPath $extensionManifestPath -PathType Leaf)){throw 'BRIDGE_EXTENSION_PAYLOAD_MISSING'}
$extensionManifest=Get-Content -LiteralPath $extensionManifestPath -Raw -Encoding UTF8|ConvertFrom-Json
$ExtensionVersion=[string]$extensionManifest.version
$ExtId=Get-ExtensionIdFromKey ([string]$extensionManifest.key)
if(-not(Test-Path -LiteralPath $agentSrc -PathType Leaf)){throw 'BRIDGE_AGENT_PAYLOAD_MISSING'}
if(-not(Test-Path -LiteralPath $hostSrc -PathType Leaf)){throw 'BRIDGE_NATIVE_HOST_PAYLOAD_MISSING'}
if([string]::IsNullOrWhiteSpace($AgentVersion)){throw 'BRIDGE_AGENT_VERSION_MISSING'}
if([string]::IsNullOrWhiteSpace($ExtensionVersion)){throw 'BRIDGE_EXTENSION_VERSION_MISSING'}
if(-not(Test-Path -LiteralPath $extSrc -PathType Container)){throw 'BRIDGE_EXTENSION_DIR_MISSING'}

$configPath=Join-Path $AgentDir 'config.json'
$oldCfg=$null
if(Test-Path -LiteralPath $configPath -PathType Leaf){
  try {
    $oldCfg=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8|ConvertFrom-Json -ErrorAction Stop
    if($null-eq$oldCfg -or $null-eq$oldCfg.workspaces){throw 'Missing workspaces property'}
    if($null-eq$oldCfg.allowed_github_owners){throw 'Missing allowed_github_owners property'}
  }catch{throw "BRIDGE_CONFIG_INVALID_REFUSING_OVERWRITE: $($_.Exception.Message)"}
}
if($null-ne$oldCfg){
  $config=$oldCfg
  if(-not[string]::IsNullOrWhiteSpace($WorkspaceRoot)){$config.workspace_root=$WorkspaceRoot}
  if([string]::IsNullOrWhiteSpace([string]$config.token)){$config.token=New-Token}
  $config.port=$Port
}else{
  if([string]::IsNullOrWhiteSpace($WorkspaceRoot)){$WorkspaceRoot=Join-Path $env:USERPROFILE 'SOKNA-Bridge-Workspaces'}
  $config=[ordered]@{
    port=$Port
    token=(New-Token)
    workspace_root=$WorkspaceRoot
    default_workspace=''
    default_github_owner=''
    allowed_github_owners=@()
    protected_repositories=@()
    workspaces=[ordered]@{}
  }
}
# Do not kill an arbitrary PID. Maintenance owns safe upgrades and rollback.
$pidFile=Join-Path $AgentDir 'agent.pid'
if(Test-Path -LiteralPath $pidFile -PathType Leaf){throw 'BRIDGE_BOOTSTRAP_AGENT_PID_PRESENT_USE_MAINTENANCE'}
Ensure-Dir $Root
Ensure-Dir $AgentDir
Ensure-Dir $ExtDir
$token=[string]$config.token
if([string]::IsNullOrWhiteSpace($token)){throw 'BRIDGE_AGENT_TOKEN_MISSING'}
if($null-ne$oldCfg){
  $backup=Join-Path $AgentDir ('config.json.pre-bootstrap-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.bak')
  Copy-Item -LiteralPath $configPath -Destination $backup -ErrorAction Stop
}
$configTmp=Join-Path $AgentDir ('config.json.new-'+[guid]::NewGuid().ToString('N'))
try {
  Write-Utf8NoBom $configTmp ($config|ConvertTo-Json -Depth 20)
  Move-Item -LiteralPath $configTmp -Destination $configPath -Force -ErrorAction Stop
}finally {
  if(Test-Path -LiteralPath $configTmp){Remove-Item -LiteralPath $configTmp -Force -ErrorAction SilentlyContinue}
}

Copy-Item $agentSrc (Join-Path $AgentDir 'agent.ps1') -Force
Copy-Item $capsSrc (Join-Path $AgentDir 'AGENT_CAPABILITIES.json') -Force
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
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $AgentDir 'agent.ps1'))
  $ok=$false
  for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 500;if(Test-Agent $token){$ok=$true;break}}
  if(-not $ok){throw 'Agent health check failed on port 8766'}
}

$report=[ordered]@{
  version='1.0.0'
  installed_at=(Get-Date).ToString('o')
  agent_version=$AgentVersion
  extension_version=$ExtensionVersion
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
