param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference='Stop'

function Write-Event($Plan,[string]$Phase,[bool]$Ok,[string]$Message=''){
  $log=Join-Path ([string]$Plan.install_root) 'logs\runtime-activation.jsonl';$dir=Split-Path $log -Parent
  if(-not(Test-Path $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
  $e=[ordered]@{ts=(Get-Date).ToUniversalTime().ToString('o');tx=[string]$Plan.tx_id;phase=$Phase;ok=$Ok;message=$Message;target=[string]$Plan.target_version}
  [IO.File]::AppendAllText($log,($e|ConvertTo-Json -Compress)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
}
function Invoke-Agent([object]$Cfg,[string]$Action,[string]$Id){
  $body=@{id=$Id;action=$Action;params=@{}}|ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri ("http://127.0.0.1:"+$Cfg.port+"/api") -Method Post -Headers @{'X-Sokna-Token'=[string]$Cfg.token} -ContentType 'application/json' -Body $body -TimeoutSec 2
}
function Start-Launcher([string]$InstallRoot){
  return Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $InstallRoot 'Agent-Launcher.ps1'),'-InstallRoot',$InstallRoot) -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
}

function Get-Sha256([string]$Path){return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Wait-Version([object]$Cfg,[string]$Version){
  for($i=0;$i-lt12;$i++){
    Start-Sleep -Milliseconds 500
    try{$r=Invoke-Agent $Cfg 'ping' ('activation-ping-'+[Guid]::NewGuid().ToString('N'));if($r.ok-and[string]$r.version-eq$Version){return $true}}catch{}
  }
  return $false
}

$plan=Get-Content $PlanPath -Raw -Encoding UTF8|ConvertFrom-Json
$install=[string]$plan.install_root;$backup=[string]$plan.backup_root;$stage=[string]$plan.stage_root
$cfg=Get-Content (Join-Path $install 'config.json') -Raw -Encoding UTF8|ConvertFrom-Json
Write-Event $plan 'activation_started' $true
Start-Sleep -Seconds 3
$mutationStarted=$false

try{
  if((Get-Sha256 (Join-Path $stage 'agent.ps1'))-ne[string]$plan.stage_agent_sha256){throw 'ACTIVATE_STAGE_AGENT_HASH'}
  if((Get-Sha256 (Join-Path $stage 'AGENT_CAPABILITIES.json'))-ne[string]$plan.stage_caps_sha256){throw 'ACTIVATE_STAGE_CAPS_HASH'}
  if((Get-Sha256 (Join-Path $stage 'Agent-Launcher.ps1'))-ne[string]$plan.stage_launcher_sha256){throw 'ACTIVATE_STAGE_LAUNCHER_HASH'}
  if((Get-Sha256 (Join-Path $backup 'agent.ps1'))-ne[string]$plan.backup_agent_sha256){throw 'ACTIVATE_BACKUP_AGENT_HASH'}
  if((Get-Sha256 (Join-Path $backup 'AGENT_CAPABILITIES.json'))-ne[string]$plan.backup_caps_sha256){throw 'ACTIVATE_BACKUP_CAPS_HASH'}
  [int]$oldPid=$plan.current_pid
  $pidFile=Join-Path $install 'agent.pid'
  if(-not(Test-Path $pidFile -PathType Leaf)){throw 'ACTIVATE_PID_FILE_MISSING'}
  if([int](Get-Content $pidFile -Raw).Trim()-ne$oldPid){throw 'ACTIVATE_PID_CHANGED'}
  $proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$oldPid) -ErrorAction SilentlyContinue
  if($null-eq$proc){throw 'ACTIVATE_OLD_PROCESS_MISSING'}
  $live=Join-Path $install 'agent.ps1'
  if(([string]$proc.CommandLine)-notmatch[regex]::Escape($live)){throw 'ACTIVATE_OLD_PROCESS_OWNERSHIP'}
  Copy-Item (Join-Path $stage 'Agent-Launcher.ps1') (Join-Path $install 'Agent-Launcher.ps1.new') -Force
  Move-Item (Join-Path $install 'Agent-Launcher.ps1.new') (Join-Path $install 'Agent-Launcher.ps1') -Force
  $state=[ordered]@{schema='sokna-runtime-state-v1';state='activating';tx_id=[string]$plan.tx_id;previous_version=[string]$plan.current_version;target_version=[string]$plan.target_version;active_version=[string]$plan.current_version;recovered_at=$null;accepted_at=$null;target_agent_sha256=[string]$plan.stage_agent_sha256;target_caps_sha256=[string]$plan.stage_caps_sha256;backup_agent_sha256=[string]$plan.backup_agent_sha256;backup_caps_sha256=[string]$plan.backup_caps_sha256;backup_root=$backup;started_at=(Get-Date).ToUniversalTime().ToString('o');last_health='pending'}
  $state|ConvertTo-Json -Depth 12|Set-Content (Join-Path $install 'runtime-state.json') -Encoding UTF8
  $run='powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $install 'Agent-Launcher.ps1')+'" -InstallRoot "'+$install+'"'
  New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Force|Out-Null
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'SOKNA Bridge Agent' -Value $run
  $mutationStarted=$true
  Stop-Process -Id $oldPid -Force
  for($i=0;$i-lt20;$i++){if($null-eq(Get-Process -Id $oldPid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 200}
  if(Get-Process -Id $oldPid -ErrorAction SilentlyContinue){throw 'ACTIVATE_OLD_PROCESS_WONT_STOP'}

  Copy-Item (Join-Path $stage 'agent.ps1') (Join-Path $install 'agent.ps1.new') -Force
  Copy-Item (Join-Path $stage 'AGENT_CAPABILITIES.json') (Join-Path $install 'AGENT_CAPABILITIES.json.new') -Force
  Move-Item (Join-Path $install 'agent.ps1.new') (Join-Path $install 'agent.ps1') -Force
  Move-Item (Join-Path $install 'AGENT_CAPABILITIES.json.new') (Join-Path $install 'AGENT_CAPABILITIES.json') -Force
  $launcherProc=Start-Launcher $install
  if(-not(Wait-Version $cfg ([string]$plan.target_version))){
    $runtimeLogDir=Join-Path $install 'logs\runtime';$errTail='';$outTail=''
    $ef=Get-ChildItem $runtimeLogDir -Filter 'agent-*-stderr.log' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1
    $of=Get-ChildItem $runtimeLogDir -Filter 'agent-*-stdout.log' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1
    if($ef){$errTail=((Get-Content $ef.FullName -Tail 30 -ErrorAction SilentlyContinue)-join' | ')}
    if($of){$outTail=((Get-Content $of.FullName -Tail 30 -ErrorAction SilentlyContinue)-join' | ')}
    throw ('ACTIVATE_NEW_HEALTH_FAILED stderr='+$errTail+' stdout='+$outTail)
  }
  $caps=Invoke-Agent $cfg 'agent.capabilities' ('activation-caps-'+[Guid]::NewGuid().ToString('N'))
  if(-not$caps.ok-or[string]$caps.version-ne[string]$plan.target_version){throw 'ACTIVATE_CAPABILITIES_FAILED'}
  $agentPid=[int](Get-Content (Join-Path $install 'agent.pid') -Raw).Trim();$state=[ordered]@{schema='sokna-runtime-state-v1';state='active';active_version=[string]$plan.target_version;previous_version=[string]$plan.current_version;activation_tx_id=[string]$plan.tx_id;agent_pid=$agentPid;launcher_pid=$launcherProc.Id;activated_at=(Get-Date).ToUniversalTime().ToString('o');accepted_at=$null;backup_root=$backup;target_agent_sha256=[string]$plan.stage_agent_sha256;target_caps_sha256=[string]$plan.stage_caps_sha256;backup_agent_sha256=[string]$plan.backup_agent_sha256;backup_caps_sha256=[string]$plan.backup_caps_sha256;last_health='pass'}
  $state|ConvertTo-Json -Depth 8|Set-Content (Join-Path $install 'runtime-state.json') -Encoding UTF8
  Write-Event $plan 'health_pass' $true
}catch{
  $reason=$_.Exception.Message;Write-Event $plan 'health_failed' $false $reason
  if(-not$mutationStarted){Write-Event $plan 'activation_aborted_pre_mutation' $false $reason;exit 10}
  try{
    $pidFile=Join-Path $install 'agent.pid';if(Test-Path $pidFile){$p=[int](Get-Content $pidFile -Raw).Trim();$proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p) -ErrorAction SilentlyContinue;if($proc-and([string]$proc.CommandLine)-match[regex]::Escape((Join-Path $install 'agent.ps1'))){Stop-Process -Id $p -Force -ErrorAction SilentlyContinue}}
    if((Get-Sha256 (Join-Path $backup 'agent.ps1'))-ne[string]$plan.backup_agent_sha256){throw 'ROLLBACK_BACKUP_AGENT_HASH'}
    if((Get-Sha256 (Join-Path $backup 'AGENT_CAPABILITIES.json'))-ne[string]$plan.backup_caps_sha256){throw 'ROLLBACK_BACKUP_CAPS_HASH'}
    Copy-Item (Join-Path $backup 'agent.ps1') (Join-Path $install 'agent.ps1') -Force
    Copy-Item (Join-Path $backup 'AGENT_CAPABILITIES.json') (Join-Path $install 'AGENT_CAPABILITIES.json') -Force
    $rollbackState=[ordered]@{schema='sokna-runtime-state-v1';state='active';active_version=[string]$plan.current_version;previous_version=[string]$plan.current_version;activation_tx_id=[string]$plan.tx_id;backup_root=$backup;backup_agent_sha256=[string]$plan.backup_agent_sha256;backup_caps_sha256=[string]$plan.backup_caps_sha256;last_health='pending';failure=$reason};$rollbackState|ConvertTo-Json -Depth 12|Set-Content (Join-Path $install 'runtime-state.json') -Encoding UTF8
    $oldLauncher=Start-Launcher $install
    if(-not(Wait-Version $cfg ([string]$plan.current_version))){throw 'ROLLBACK_HEALTH_FAILED'}
    $agentPid=[int](Get-Content (Join-Path $install 'agent.pid') -Raw).Trim();$state=[ordered]@{schema='sokna-runtime-state-v1';state='active';active_version=[string]$plan.current_version;failed_target=[string]$plan.target_version;activation_tx_id=[string]$plan.tx_id;agent_pid=$agentPid;launcher_pid=$oldLauncher.Id;rolled_back_at=(Get-Date).ToUniversalTime().ToString('o');backup_root=$backup;backup_agent_sha256=[string]$plan.backup_agent_sha256;backup_caps_sha256=[string]$plan.backup_caps_sha256;last_health='rollback-pass';failure=$reason}
    $state|ConvertTo-Json -Depth 8|Set-Content (Join-Path $install 'runtime-state.json') -Encoding UTF8
    Write-Event $plan 'rollback_pass' $true $reason
  }catch{Write-Event $plan 'rollback_failed' $false ($reason+' | '+$_.Exception.Message)}
  exit 10
}
exit 0
