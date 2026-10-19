#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SetupPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP){throw 'DISPOSABLE_WINDOWS_GITHUB_ONLY'}
$setup=[IO.Path]::GetFullPath($SetupPath)
if(-not(Test-Path -LiteralPath $setup -PathType Leaf)){throw 'SETUP_MISSING'}
$base=Join-Path $env:RUNNER_TEMP ('Bridge-Abrupt-'+[guid]::NewGuid().ToString('N').Substring(0,8))
$app=Join-Path $base 'app'
$data=Join-Path $base 'external'
$logs=Join-Path $base 'logs'
$reportPath=Join-Path $env:RUNNER_TEMP 'bridge-abrupt-agent-recovery-evidence.json'
if(Test-Path -LiteralPath $reportPath){throw 'EVIDENCE_ALREADY_EXISTS'}
foreach($x in @($base,$data,$logs)){New-Item -ItemType Directory -Force -Path $x|Out-Null}
$marker=Join-Path $data 'preserve.txt'
[IO.File]::WriteAllText($marker,'DO_NOT_REMOVE',[Text.UTF8Encoding]::new($false))
function Launch([string]$exe,[string[]]$launchArguments,[string]$stage,[int]$timeout=180){
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$exe
  $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  $psi.Arguments=[string]::Join(' ',$launchArguments)
  $p=[Diagnostics.Process]::Start($psi)
  if($null-eq$p){throw ('START_FAILED_'+$stage)}
  try{
    if(-not $p.WaitForExit($timeout*1000)){
      try{$p.Kill()}catch{}
      throw ('PROCESS_TIMEOUT_'+$stage)
    }
    if($p.ExitCode -ne 0){throw ('PROCESS_EXIT_NONZERO_'+$stage+'_'+$p.ExitCode)}
  }finally{$p.Dispose()}
}
function ReadJson([string]$path){
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'REQUIRED_STATE_MISSING'}
  return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function ExactOwnedAgentPid {
  $launch=ReadJson (Join-Path $app 'state/launcher-state.json')
  $pidPath=Join-Path $app 'runtime/agent.pid'
  if(-not(Test-Path -LiteralPath $pidPath -PathType Leaf)){throw 'AGENT_PID_FILE_MISSING'}
  $pidValue=[int]((Get-Content -LiteralPath $pidPath -Raw).Trim())
  if($pidValue -le 1 -or [int]$launch.agent_pid -ne $pidValue){throw 'AGENT_OWNERSHIP_PID_MISMATCH'}
  $agentPath=[IO.Path]::GetFullPath((Join-Path $app 'runtime/agent.ps1'))
  if(-not[string]::Equals([IO.Path]::GetFullPath([string]$launch.agent_path),$agentPath,[StringComparison]::OrdinalIgnoreCase)){throw 'AGENT_OWNERSHIP_PATH_MISMATCH'}
  $proc=Get-Process -Id $pidValue -ErrorAction Stop
  $expected=[DateTimeOffset]::Parse([string]$launch.agent_process_start_utc)
  $actual=[DateTimeOffset]::new($proc.StartTime.ToUniversalTime())
  if([Math]::Abs(($expected.ToUniversalTime()-$actual).TotalSeconds) -gt 1){throw 'AGENT_OWNERSHIP_START_TIME_MISMATCH'}
  $cim=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue)
  if([string]$cim.Name -notmatch 'powershell' -or [string]$cim.CommandLine -notlike '*agent.ps1*'){throw 'AGENT_PROCESS_COMMANDLINE_MISMATCH'}
  return $pidValue
}
function AssertHealth([bool]$expected,[string]$stage) {
  $maint=Join-Path $app 'Sokna.Agent.Maintenance.exe'
  for($i=0;$i-lt20;$i++){
    $lines=@(& $maint health --install-root $app --expected-version 2.7.1 2>$null)
    if($LASTEXITCODE -eq 0 -and $lines.Count -gt 0){
      try{
        $r=($lines -join [Environment]::NewLine)|ConvertFrom-Json
        if([bool]$r.data.ok -eq $expected){return}
      }catch{}
    }
    Start-Sleep -Milliseconds 400
  }
  throw ('HEALTH_EXPECTED_STATE_MISSING_'+$stage)
}
function AssertPreserved([string]$token,[string]$hash){
  $cfg=ReadJson (Join-Path $app 'config.json')
  if([string]$cfg.token -ne $token){throw 'CONFIG_TOKEN_CHANGED'}
  if(-not[string]::Equals([IO.Path]::GetFullPath([string]$cfg.artifact_root),[IO.Path]::GetFullPath($data),[StringComparison]::OrdinalIgnoreCase)){throw 'ARTIFACT_ROOT_CHANGED'}
  if((Get-FileHash -LiteralPath (Join-Path $app 'runtime/agent.ps1') -Algorithm SHA256).Hash -ne $hash){throw 'RUNTIME_HASH_CHANGED'}
  if(-not(Test-Path -LiteralPath $marker)){throw 'EXTERNAL_MARKER_MISSING'}
}
$installed=$false
try{
  Launch $setup @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',
      ('/DIR="'+$app+'"'),('/ArtifactRoot="'+$data+'"'),'/TASKS=""',
      ('/LOG="'+(Join-Path $logs 'setup.log')+'"')) 'install'
  $installed=$true
  AssertHealth $true 'baseline'
  $cfg=ReadJson (Join-Path $app 'config.json')
  $token=[string]$cfg.token
  if([string]::IsNullOrWhiteSpace($token)){throw 'CONFIG_TOKEN_NOT_INITIALIZED'}
  $hash=(Get-FileHash -LiteralPath (Join-Path $app 'runtime/agent.ps1') -Algorithm SHA256).Hash
  AssertPreserved $token $hash
  Write-Host 'ABRUPT_AGENT_BASELINE_INSTALLED_PASS'
  $oldPid=ExactOwnedAgentPid
  Stop-Process -Id $oldPid -Force -ErrorAction Stop
  for($i=0;$i-lt20;$i++){
    if($null-eq(Get-Process -Id $oldPid -ErrorAction SilentlyContinue)){break}
    Start-Sleep -Milliseconds 100
  }
  if($null-ne(Get-Process -Id $oldPid -ErrorAction SilentlyContinue)){throw 'ABRUPT_AGENT_KILL_NOT_EFFECTIVE'}
  AssertHealth $false 'after-force-kill'
  Write-Host 'ABRUPT_AGENT_REAL_FORCE_KILL_PASS'
  $maint=Join-Path $app 'Sokna.Agent.Maintenance.exe'
  Launch $maint @('start','--install-root',$app,'--expected-version','2.7.1') 'restart' 150
  AssertHealth $true 'restart'
  $nextPid=ExactOwnedAgentPid
  if($nextPid -eq $oldPid){throw 'ABRUPT_AGENT_NOT_RESTARTED'}
  AssertPreserved $token $hash
  Write-Host 'ABRUPT_AGENT_MAINTENANCE_RESTART_PASS'
  Write-Host 'ABRUPT_AGENT_CONFIG_TOKEN_RUNTIME_HASH_EXTERNAL_DATA_PRESERVED_PASS'
  Launch $maint @('start','--install-root',$app,'--expected-version','2.7.1') 'idempotent' 150
  if((ExactOwnedAgentPid) -ne $nextPid){throw 'ABRUPT_AGENT_IDEMPOTENT_START_DUPLICATED_RUNTIME'}
  Write-Host 'ABRUPT_AGENT_IDEMPOTENT_START_PASS'
  $result=[ordered]@{
    schema='sokna-bridge-abrupt-owned-agent-recovery-v1'
    environment='disposable GitHub Windows Server 2025'
    inno_install='PASS'
    force_kill_owned_runtime='PASS'
    health_failed_closed_after_kill='PASS'
    restart_health='PASS'
    token_config_runtime_hash_artifact_preservation='PASS'
    idempotent_restart='PASS'
    physical_power_loss='NOT_RUN'
    actual_windows10_client='NOT_RUN'
    chrome_gui_persistence='NOT_RUN'
    release_ready=$false
  }
  [IO.File]::WriteAllText($reportPath,($result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
  Write-Host 'ABRUPT_OWNED_AGENT_RECOVERY_E2E_PASS'
}finally{
  if($installed){
    $uninstaller=Join-Path $app 'unins000.exe'
    if(Test-Path -LiteralPath $uninstaller -PathType Leaf){
      try{
        Launch $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+(Join-Path $logs 'uninstall.log')+'"')) 'uninstall' 150
        Write-Host 'ABRUPT_AGENT_UNINSTALL_PASS'
      }catch{Write-Host 'ABRUPT_AGENT_UNINSTALL_CLEANUP_FAILED'}
    }
  }
  if(-not(Test-Path -LiteralPath $marker)){throw 'UNINSTALL_REMOVED_EXTERNAL_MARKER'}
}
