param([string]$InstallRoot='',[string]$StatePath='')
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($InstallRoot)){$InstallRoot=Join-Path $env:LOCALAPPDATA 'SOKNA-Bridge-V3'}
if([string]::IsNullOrWhiteSpace($StatePath)){$StatePath=Join-Path $env:LOCALAPPDATA 'SOKNA\Bridge\autonomy-bootstrap\activation-state.json'}
if(-not(Test-Path $StatePath -PathType Leaf)){throw 'ROLLBACK_STATE_MISSING'}
$state=Get-Content $StatePath -Raw -Encoding UTF8|ConvertFrom-Json;$backup=[string]$state.backup_root
if([string]::IsNullOrWhiteSpace($backup) -or -not(Test-Path $backup -PathType Container)){throw 'ROLLBACK_BACKUP_MISSING'}
$installed=Join-Path $InstallRoot 'extension';$be=Join-Path $backup 'extension'
if(-not(Test-Path $be -PathType Container)){throw 'ROLLBACK_EXTENSION_BACKUP_MISSING'}
if(Test-Path $installed){Remove-Item $installed -Recurse -Force};Copy-Item $be $installed -Recurse -Force
$out=[ordered]@{schema='sokna-autonomy-activation-v1';ok=$true;state='rolled-back';backup_root=$backup;rolled_back_at=(Get-Date).ToUniversalTime().ToString('o');extension_reload_required=$true}
[IO.File]::WriteAllText($StatePath,($out|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false));$out|ConvertTo-Json -Compress
