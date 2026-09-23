param(
  [string]$PackageRoot=$PSScriptRoot,
  [string]$InstallRoot="$env:LOCALAPPDATA\SOKNA-Bridge-V2"
)
$ErrorActionPreference='Stop'
function Fail([string]$Code,[string]$Message){throw ($Code+': '+$Message)}
function Read-Tail([string]$Path,[int]$Count=30){if(Test-Path $Path -PathType Leaf){return ((Get-Content $Path -Tail $Count -ErrorAction SilentlyContinue)-join"`n")};return ''}

$payload=Join-Path $PackageRoot 'payload'
$sourceAgent=Join-Path $payload 'agent.ps1';$sourceCaps=Join-Path $payload 'AGENT_CAPABILITIES.json';$liveCfg=Join-Path $InstallRoot 'config.json'
foreach($p in @($sourceAgent,$sourceCaps,$liveCfg)){if(-not(Test-Path $p -PathType Leaf)){Fail 'STARTUP_PROBE_FILE_MISSING' $p}}
$id='probe-'+[Guid]::NewGuid().ToString('N')
$root=Join-Path $InstallRoot ('diagnostics\startup-probes\'+$id)
New-Item -ItemType Directory -Path $root -Force|Out-Null
Copy-Item $sourceAgent (Join-Path $root 'agent.ps1') -Force
Copy-Item $sourceCaps (Join-Path $root 'AGENT_CAPABILITIES.json') -Force
$cfg=Get-Content $liveCfg -Raw -Encoding UTF8|ConvertFrom-Json
if($cfg.PSObject.Properties.Name -contains 'artifact_root'){$cfg.artifact_root=(Join-Path $root 'artifacts')}else{$cfg|Add-Member -NotePropertyName artifact_root -NotePropertyValue (Join-Path $root 'artifacts')}
$cfgPath=Join-Path $root 'config.json';$cfg|ConvertTo-Json -Depth 30|Set-Content $cfgPath -Encoding UTF8
$out=Join-Path $root 'stdout.log';$err=Join-Path $root 'stderr.log'
$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'agent.ps1'),'-ConfigPath',$cfgPath,'-StartupProbe')
$p=Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait
$stdout=Read-Tail $out 50;$stderr=Read-Tail $err 50
if($p.ExitCode-ne0){Fail 'STARTUP_PROBE_PROCESS_FAILED' ('exit='+$p.ExitCode+' stderr='+$stderr+' stdout='+$stdout)}
$line=($stdout -split"`r?`n"|Where-Object{$_ -match '^\{.*\}$'}|Select-Object -Last 1)
if([string]::IsNullOrWhiteSpace($line)){Fail 'STARTUP_PROBE_RESULT_MISSING' ('stderr='+$stderr+' stdout='+$stdout)}
try{$r=$line|ConvertFrom-Json}catch{Fail 'STARTUP_PROBE_RESULT_JSON' $_.Exception.Message}
if(-not$r.ok-or[string]$r.version-ne'2.5.7'-or[string]$r.capabilities_version-ne'2.5.7'){Fail 'STARTUP_PROBE_RESULT_INVALID' $line}
[ordered]@{ok=$true;stage='startup_probe';version='2.5.7';probe_id=$id;probe_root=$root;stdout=$out;stderr=$err;workspaces=$r.workspaces}|ConvertTo-Json -Compress
