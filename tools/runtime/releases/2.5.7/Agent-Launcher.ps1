param([string]$InstallRoot=$PSScriptRoot)
$ErrorActionPreference='Stop'
function Get-Sha256([string]$Path){if(-not(Test-Path $Path -PathType Leaf)){return ''};return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Write-LauncherEvent([string]$Phase,[bool]$Ok,[string]$Message=''){$log=Join-Path $InstallRoot 'logs\runtime-activation.jsonl';$dir=Split-Path $log -Parent;if(-not(Test-Path $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null};$e=[ordered]@{ts=(Get-Date).ToUniversalTime().ToString('o');phase=$Phase;ok=$Ok;message=$Message};[IO.File]::AppendAllText($log,($e|ConvertTo-Json -Compress)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))}
$statePath=Join-Path $InstallRoot 'runtime-state.json'
if(Test-Path $statePath -PathType Leaf){
  try{$state=Get-Content $statePath -Raw -Encoding UTF8|ConvertFrom-Json}catch{throw 'LAUNCHER_STATE_INVALID'}
  if([string]$state.state-eq'activating'){
    $agent=Join-Path $InstallRoot 'agent.ps1';$caps=Join-Path $InstallRoot 'AGENT_CAPABILITIES.json'
    $targetOk=((Get-Sha256 $agent)-eq[string]$state.target_agent_sha256)-and((Get-Sha256 $caps)-eq[string]$state.target_caps_sha256)
    if($targetOk){$state.state='recovered_target_files_complete';$state.active_version=[string]$state.target_version;$state.recovered_at=(Get-Date).ToUniversalTime().ToString('o');$state.last_health='pending';$state|ConvertTo-Json -Depth 12|Set-Content $statePath -Encoding UTF8;Write-LauncherEvent 'recovery_target_complete' $true ([string]$state.tx_id)}else{
      $backup=[string]$state.backup_root
      if((Get-Sha256 (Join-Path $backup 'agent.ps1'))-ne[string]$state.backup_agent_sha256){throw 'LAUNCHER_BACKUP_AGENT_HASH'}
      if((Get-Sha256 (Join-Path $backup 'AGENT_CAPABILITIES.json'))-ne[string]$state.backup_caps_sha256){throw 'LAUNCHER_BACKUP_CAPS_HASH'}
      Copy-Item (Join-Path $backup 'agent.ps1') $agent -Force;Copy-Item (Join-Path $backup 'AGENT_CAPABILITIES.json') $caps -Force
      $state.state='rolled_back_by_launcher';$state.active_version=[string]$state.previous_version;$state.recovered_at=(Get-Date).ToUniversalTime().ToString('o');$state.last_health='pending'
      $state|ConvertTo-Json -Depth 12|Set-Content $statePath -Encoding UTF8
      Write-LauncherEvent 'recovery_rollback_files' $true ([string]$state.tx_id)
    }
  }
}
$runtimeLogDir=Join-Path $InstallRoot 'logs\runtime';if(-not(Test-Path $runtimeLogDir)){New-Item -ItemType Directory -Path $runtimeLogDir -Force|Out-Null}
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssfff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)
$outLog=Join-Path $runtimeLogDir ('agent-'+$stamp+'-stdout.log');$errLog=Join-Path $runtimeLogDir ('agent-'+$stamp+'-stderr.log')
$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $InstallRoot 'agent.ps1'),'-ConfigPath',(Join-Path $InstallRoot 'config.json'))
$p=Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $InstallRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -Wait
Write-LauncherEvent 'runtime_exit' ($p.ExitCode-eq0) ('pid='+$p.Id+' exit='+$p.ExitCode+' stdout='+$outLog+' stderr='+$errLog)
exit $p.ExitCode
