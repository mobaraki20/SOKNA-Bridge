param(
  [string]$PackageRoot=$PSScriptRoot,
  [string]$InstallRoot="$env:LOCALAPPDATA\SOKNA-Bridge-V2"
)
$ErrorActionPreference='Stop'

function Get-Sha256([string]$Path){return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Fail([string]$Code,[string]$Message){throw ($Code+': '+$Message)}

$preflight=Join-Path $PackageRoot 'Preflight-AgentRuntime257.ps1'
$preflightResult=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $preflight -PackageRoot $PackageRoot -InstallRoot $InstallRoot -InvocationMode AgentMediated
if($LASTEXITCODE-ne0){Fail 'STAGE_PREFLIGHT_PROCESS' ([string]$preflightResult)}
$preflightObj=$preflightResult|ConvertFrom-Json
if(-not$preflightObj.ok){Fail 'STAGE_PREFLIGHT_RESULT' ([string]$preflightResult)}

$probe=Join-Path $PackageRoot 'Startup-Probe-AgentRuntime257.ps1'
$probeResult=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -PackageRoot $PackageRoot -InstallRoot $InstallRoot
if($LASTEXITCODE-ne0){Fail 'STAGE_STARTUP_PROBE_PROCESS' ([string]$probeResult)}
$probeObj=$probeResult|ConvertFrom-Json
if(-not$probeObj.ok){Fail 'STAGE_STARTUP_PROBE_RESULT' ([string]$probeResult)}

$manifest=Get-Content (Join-Path $PackageRoot 'runtime-manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
$tx='rt257-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$stage=Join-Path $InstallRoot ('updates\2.5.7\'+$tx);$backup=Join-Path $InstallRoot ('recovery\runtime\'+$tx+'-2.5.5')
New-Item -ItemType Directory -Path $stage -Force|Out-Null
New-Item -ItemType Directory -Path $backup -Force|Out-Null

Copy-Item (Join-Path $InstallRoot 'agent.ps1') (Join-Path $backup 'agent.ps1') -Force
Copy-Item (Join-Path $InstallRoot 'AGENT_CAPABILITIES.json') (Join-Path $backup 'AGENT_CAPABILITIES.json') -Force
Copy-Item (Join-Path $PackageRoot 'payload\agent.ps1') (Join-Path $stage 'agent.ps1') -Force
Copy-Item (Join-Path $PackageRoot 'payload\AGENT_CAPABILITIES.json') (Join-Path $stage 'AGENT_CAPABILITIES.json') -Force
Copy-Item (Join-Path $PackageRoot 'Activate-AgentRuntime.ps1') (Join-Path $stage 'Activate-AgentRuntime.ps1') -Force
Copy-Item (Join-Path $PackageRoot 'Agent-Launcher.ps1') (Join-Path $stage 'Agent-Launcher.ps1') -Force

foreach($pair in @(
  @((Join-Path $PackageRoot 'payload\agent.ps1'),(Join-Path $stage 'agent.ps1')),
  @((Join-Path $PackageRoot 'payload\AGENT_CAPABILITIES.json'),(Join-Path $stage 'AGENT_CAPABILITIES.json')),
  @((Join-Path $InstallRoot 'agent.ps1'),(Join-Path $backup 'agent.ps1')),
  @((Join-Path $InstallRoot 'AGENT_CAPABILITIES.json'),(Join-Path $backup 'AGENT_CAPABILITIES.json'))
)){
  if((Get-Sha256 $pair[0])-ne(Get-Sha256 $pair[1])){Fail 'STAGE_COPY_HASH' ($pair[1])}
}

[int]$currentPid=(Get-Content (Join-Path $InstallRoot 'agent.pid') -Raw).Trim()
$plan=[ordered]@{schema='sokna-runtime-activation-plan-v1';tx_id=$tx;install_root=$InstallRoot;stage_root=$stage;backup_root=$backup;current_version='2.5.5';target_version='2.5.7';current_pid=$currentPid;stage_agent_sha256=(Get-Sha256 (Join-Path $stage 'agent.ps1'));stage_caps_sha256=(Get-Sha256 (Join-Path $stage 'AGENT_CAPABILITIES.json'));stage_launcher_sha256=(Get-Sha256 (Join-Path $stage 'Agent-Launcher.ps1'));backup_agent_sha256=(Get-Sha256 (Join-Path $backup 'agent.ps1'));backup_caps_sha256=(Get-Sha256 (Join-Path $backup 'AGENT_CAPABILITIES.json'));created_at=(Get-Date).ToUniversalTime().ToString('o')}
$planPath=Join-Path $stage 'activation-plan.json';$plan|ConvertTo-Json -Depth 8|Set-Content $planPath -Encoding UTF8

$helper=Join-Path $stage 'Activate-AgentRuntime.ps1'
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$helper,'-PlanPath',$planPath) -WorkingDirectory $stage -WindowStyle Hidden|Out-Null
[ordered]@{ok=$true;stage='activation_scheduled';tx_id=$tx;target_version='2.5.7';plan=$planPath;backup=$backup;current_pid=$currentPid}|ConvertTo-Json -Compress
