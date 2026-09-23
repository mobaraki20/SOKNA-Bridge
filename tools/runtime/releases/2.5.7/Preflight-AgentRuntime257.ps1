param(
  [string]$PackageRoot=$PSScriptRoot,
  [string]$InstallRoot="$env:LOCALAPPDATA\SOKNA-Bridge-V2",
  [ValidateSet('AgentMediated','External')][string]$InvocationMode='External'
)
$ErrorActionPreference='Stop'

function Get-Sha256([string]$Path){return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Fail([string]$Code,[string]$Message){throw ($Code+': '+$Message)}

$manifestPath=Join-Path $PackageRoot 'runtime-manifest.json'
if(-not(Test-Path $manifestPath -PathType Leaf)){Fail 'PREFLIGHT_MANIFEST_MISSING' $manifestPath}
try{$manifest=Get-Content $manifestPath -Raw -Encoding UTF8|ConvertFrom-Json}catch{Fail 'PREFLIGHT_MANIFEST_JSON' $_.Exception.Message}
if([string]$manifest.schema-ne'sokna-runtime-deployment-v1'){Fail 'PREFLIGHT_SCHEMA' ([string]$manifest.schema)}
if([string]$manifest.target_version-ne'2.5.7'){Fail 'PREFLIGHT_TARGET_VERSION' ([string]$manifest.target_version)}
$declared=@($manifest.files|ForEach-Object{([string]$_.path).Replace('\','/')})|Sort-Object -Unique
$actual=@(Get-ChildItem $PackageRoot -File -Recurse|ForEach-Object{$_.FullName.Substring([IO.Path]::GetFullPath($PackageRoot).Length).TrimStart('\','/').Replace('\','/')}|Where-Object{$_-ne'runtime-manifest.json'}|Sort-Object -Unique)
$delta=@(Compare-Object -ReferenceObject $declared -DifferenceObject $actual)
if($delta.Count-gt0){Fail 'PREFLIGHT_PACKAGE_FILE_SET' (($delta|ForEach-Object{$_.SideIndicator+':'+$_.InputObject})-join',')}

foreach($item in @($manifest.files)){
  $rel=[string]$item.path;$expected=[string]$item.sha256
  if($rel-match'(^[\\/]|(^|[\\/])\.\.([\\/]|$))'){Fail 'PREFLIGHT_PATH' $rel}
  $path=[IO.Path]::GetFullPath((Join-Path $PackageRoot $rel));$root=[IO.Path]::GetFullPath($PackageRoot)
  if(-not$root.EndsWith([IO.Path]::DirectorySeparatorChar)){$root+=[IO.Path]::DirectorySeparatorChar}
  if(-not$path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){Fail 'PREFLIGHT_PATH_ESCAPE' $rel}
  if(-not(Test-Path $path -PathType Leaf)){Fail 'PREFLIGHT_FILE_MISSING' $rel}
  if((Get-Sha256 $path)-ne$expected.ToLowerInvariant()){Fail 'PREFLIGHT_HASH' $rel}
}

$psFiles=Get-ChildItem $PackageRoot -Filter '*.ps1' -File -Recurse
foreach($file in $psFiles){
  $tokens=$null;$errors=$null
  [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
  if($errors.Count-gt0){Fail 'PREFLIGHT_PS_PARSE' ($file.Name+': '+(($errors|ForEach-Object{$_.Message})-join' | '))}
  $text=Get-Content $file.FullName -Raw -Encoding UTF8
  if($text-match'(?im)(^|[;\s])(gci|gc|cp|mv|rm|kill|sleep|gfh)(?=\s|;|$)'){Fail 'PREFLIGHT_ALIAS_FORBIDDEN' $file.Name}
}

if(-not(Test-Path $InstallRoot -PathType Container)){Fail 'PREFLIGHT_INSTALL_ROOT' $InstallRoot}
$live=Join-Path $InstallRoot 'agent.ps1';$caps=Join-Path $InstallRoot 'AGENT_CAPABILITIES.json';$cfgPath=Join-Path $InstallRoot 'config.json'
foreach($path in @($live,$caps,$cfgPath)){if(-not(Test-Path $path -PathType Leaf)){Fail 'PREFLIGHT_LIVE_FILE' $path}}

$liveText=Get-Content $live -Raw -Encoding UTF8
if($liveText-notmatch'version="2\.5\.5"'){Fail 'PREFLIGHT_CURRENT_VERSION' 'expected live Agent 2.5.5'}
try{$liveCapsFile=Get-Content $caps -Raw -Encoding UTF8|ConvertFrom-Json}catch{Fail 'PREFLIGHT_LIVE_CAPS_JSON' $_.Exception.Message}
if([string]$liveCapsFile.agent-ne'2.5.5'){Fail 'PREFLIGHT_LIVE_CAPS_VERSION' ([string]$liveCapsFile.agent)}
try{$cfg=Get-Content $cfgPath -Raw -Encoding UTF8|ConvertFrom-Json}catch{Fail 'PREFLIGHT_CONFIG_JSON' $_.Exception.Message}
if(-not$cfg.port-or-not$cfg.token){Fail 'PREFLIGHT_CONFIG_FIELDS' 'port/token required'}

$pidPath=Join-Path $InstallRoot 'agent.pid'
if(-not(Test-Path $pidPath -PathType Leaf)){Fail 'PREFLIGHT_PID_MISSING' $pidPath}
[int]$agentPid=(Get-Content $pidPath -Raw).Trim()
$proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$agentPid) -ErrorAction SilentlyContinue
if($null-eq$proc){Fail 'PREFLIGHT_PID_DEAD' ([string]$agentPid)}
if(([string]$proc.CommandLine)-notmatch[regex]::Escape($live)){Fail 'PREFLIGHT_PID_OWNERSHIP' ([string]$proc.CommandLine)}

$healthEvidence=''
if($InvocationMode-eq'External'){
  $pingBody=@{id=('preflight-ping-'+[Guid]::NewGuid().ToString('N'));action='ping';params=@{}}|ConvertTo-Json -Compress
  try{$ping=Invoke-RestMethod -Uri ("http://127.0.0.1:"+$cfg.port+"/api") -Method Post -Headers @{'X-Sokna-Token'=[string]$cfg.token} -ContentType 'application/json' -Body $pingBody -TimeoutSec 4}catch{Fail 'PREFLIGHT_CURRENT_HEALTH' $_.Exception.Message}
  if(-not$ping.ok-or[string]$ping.version-ne'2.5.5'){Fail 'PREFLIGHT_CURRENT_HEALTH_VERSION' ([string]$ping.version)}
  $capsBody=@{id=('preflight-caps-'+[Guid]::NewGuid().ToString('N'));action='agent.capabilities';params=@{}}|ConvertTo-Json -Compress
  try{$liveCaps=Invoke-RestMethod -Uri ("http://127.0.0.1:"+$cfg.port+"/api") -Method Post -Headers @{'X-Sokna-Token'=[string]$cfg.token} -ContentType 'application/json' -Body $capsBody -TimeoutSec 4}catch{Fail 'PREFLIGHT_CURRENT_CAPS' $_.Exception.Message}
  if(-not$liveCaps.ok-or[string]$liveCaps.version-ne'2.5.5'){Fail 'PREFLIGHT_CURRENT_CAPS_VERSION' ([string]$liveCaps.version)}
  $healthEvidence='external-http-ping+capabilities'
}else{
  # IMPORTANT: This script is running as a child of the live Agent action.
  # Synchronous HTTP calls back into that same Agent can deadlock while the Agent waits for this child.
  # Agent-mediated evidence is therefore: successful control-plane invocation + live PID ownership
  # + exact on-disk runtime/capability version checks above. Target runtime receives an external
  # HTTP health check only after restart, from the detached activation helper.
  $healthEvidence='agent-mediated-control-plane+pid-ownership+disk-version'
}

$recoveryRoot=Join-Path $InstallRoot 'recovery\runtime';$updatesRoot=Join-Path $InstallRoot 'updates'
New-Item -ItemType Directory -Path $recoveryRoot -Force|Out-Null
New-Item -ItemType Directory -Path $updatesRoot -Force|Out-Null
$probe=Join-Path $updatesRoot ('.write-probe-'+[Guid]::NewGuid().ToString('N'))
[IO.File]::WriteAllText($probe,'ok',[Text.Encoding]::ASCII);Remove-Item $probe -Force

[ordered]@{
  ok=$true;stage='preflight';target_version='2.5.7';current_version='2.5.5';install_root=$InstallRoot;
  invocation_mode=$InvocationMode;health_evidence=$healthEvidence;agent_pid=$agentPid;
  package_manifest_sha256=(Get-Sha256 $manifestPath);powershell_files=$psFiles.Count
}|ConvertTo-Json -Compress
