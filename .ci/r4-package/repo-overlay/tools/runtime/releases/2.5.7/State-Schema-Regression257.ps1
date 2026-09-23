param([string]$PackageRoot=$PSScriptRoot)
$ErrorActionPreference='Stop'
function Sha([string]$p){return (Get-FileHash -Path $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$root=Join-Path $env:TEMP ('sokna-state257-'+[Guid]::NewGuid().ToString('N'))
try{
  New-Item -ItemType Directory -Path $root -Force|Out-Null
  Copy-Item (Join-Path $PackageRoot 'Agent-Launcher.ps1') (Join-Path $root 'Agent-Launcher.ps1') -Force
  [IO.File]::WriteAllText((Join-Path $root 'agent.ps1'),"param([string]`$ConfigPath)`nWrite-Output 'DUMMY257'`nexit 0`n",(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $root 'AGENT_CAPABILITIES.json'),'{}',(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText((Join-Path $root 'config.json'),'{}',(New-Object Text.UTF8Encoding($false)))
  $agent=Join-Path $root 'agent.ps1';$caps=Join-Path $root 'AGENT_CAPABILITIES.json'
  $state=[ordered]@{
    schema='sokna-runtime-state-v1';state='activating';tx_id='state-schema-regression';
    previous_version='2.5.5';target_version='2.5.7';active_version='2.5.5';
    recovered_at=$null;accepted_at=$null;target_agent_sha256=(Sha $agent);target_caps_sha256=(Sha $caps);
    last_health='pending'
  }
  $state|ConvertTo-Json -Depth 12|Set-Content (Join-Path $root 'runtime-state.json') -Encoding UTF8
  & (Join-Path $root 'Agent-Launcher.ps1') -InstallRoot $root
  if($LASTEXITCODE-ne0){throw 'STATE_SCHEMA_LAUNCHER_EXIT'}
  $after=Get-Content (Join-Path $root 'runtime-state.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$after.state-ne'recovered_target_files_complete'){throw 'STATE_SCHEMA_STATE'}
  if([string]$after.active_version-ne'2.5.7'){throw 'STATE_SCHEMA_ACTIVE_VERSION'}
  if([string]::IsNullOrWhiteSpace([string]$after.recovered_at)){throw 'STATE_SCHEMA_RECOVERED_AT'}
  $out=Get-ChildItem (Join-Path $root 'logs\runtime') -Filter 'agent-*-stdout.log' -File|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if($null-eq$out -or (Get-Content $out.FullName -Raw)-notmatch'DUMMY257'){throw 'STATE_SCHEMA_RUNTIME_LOG'}
  [ordered]@{ok=$true;stage='state_schema_regression';version='2.5.7';state=[string]$after.state;active_version=[string]$after.active_version}|ConvertTo-Json -Compress
}finally{Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue}
