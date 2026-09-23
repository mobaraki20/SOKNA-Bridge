param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference='Stop'
function Get-Sha256([string]$Path){return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Start-Launcher([string]$Root){return Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Root 'Agent-Launcher.ps1'),'-InstallRoot',$Root) -WorkingDirectory $Root -WindowStyle Hidden -PassThru}
function Invoke-Ping([object]$Cfg){$body=@{id=('rollback-ping-'+[Guid]::NewGuid().ToString('N'));action='ping';params=@{}}|ConvertTo-Json -Compress;return Invoke-RestMethod -Uri ("http://127.0.0.1:"+$Cfg.port+"/api") -Method Post -Headers @{'X-Sokna-Token'=[string]$Cfg.token} -ContentType 'application/json' -Body $body -TimeoutSec 2}
$plan=Get-Content $PlanPath -Raw -Encoding UTF8|ConvertFrom-Json;$InstallRoot=[string]$plan.install_root;$BackupRoot=[string]$plan.backup_root;$ExpectedVersion=[string]$plan.current_version
if((Get-Sha256 (Join-Path $BackupRoot 'agent.ps1'))-ne[string]$plan.backup_agent_sha256){throw 'ROLLBACK_BACKUP_AGENT_HASH'}
if((Get-Sha256 (Join-Path $BackupRoot 'AGENT_CAPABILITIES.json'))-ne[string]$plan.backup_caps_sha256){throw 'ROLLBACK_BACKUP_CAPS_HASH'}
$cfg=Get-Content (Join-Path $InstallRoot 'config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$pidFile=Join-Path $InstallRoot 'agent.pid'
if(Test-Path $pidFile){[int]$p=(Get-Content $pidFile -Raw).Trim();$proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p) -ErrorAction SilentlyContinue;if($proc-and([string]$proc.CommandLine)-match[regex]::Escape((Join-Path $InstallRoot 'agent.ps1'))){Stop-Process -Id $p -Force}}
Copy-Item (Join-Path $BackupRoot 'agent.ps1') (Join-Path $InstallRoot 'agent.ps1') -Force
Copy-Item (Join-Path $BackupRoot 'AGENT_CAPABILITIES.json') (Join-Path $InstallRoot 'AGENT_CAPABILITIES.json') -Force
$state=[ordered]@{schema='sokna-runtime-state-v1';state='active';active_version=$ExpectedVersion;previous_version=$ExpectedVersion;activation_tx_id=[string]$plan.tx_id;backup_root=$BackupRoot;backup_agent_sha256=[string]$plan.backup_agent_sha256;backup_caps_sha256=[string]$plan.backup_caps_sha256;last_health='pending'};$state|ConvertTo-Json -Depth 12|Set-Content (Join-Path $InstallRoot 'runtime-state.json') -Encoding UTF8
$proc=Start-Launcher $InstallRoot
$healthy=$false;for($i=0;$i-lt12;$i++){Start-Sleep -Milliseconds 500;try{$r=Invoke-Ping $cfg;if($r.ok-and[string]$r.version-eq$ExpectedVersion){$healthy=$true;break}}catch{}}
if(-not$healthy){throw 'ROLLBACK_HEALTH_FAILED'}
[ordered]@{ok=$true;restored_version=$ExpectedVersion;agent_pid=$proc.Id;backup=$BackupRoot;health='pass'}|ConvertTo-Json -Compress
