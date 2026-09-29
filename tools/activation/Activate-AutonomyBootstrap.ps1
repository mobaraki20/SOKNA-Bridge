param(
  [string]$RepoRoot='',
  [string]$InstallRoot='',
  [string]$TicketPath=''
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($RepoRoot)){$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path}
if([string]::IsNullOrWhiteSpace($InstallRoot)){$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\SOKNA Agent'}
if([string]::IsNullOrWhiteSpace($TicketPath)){$TicketPath=Join-Path $env:LOCALAPPDATA 'SOKNA\Bridge\autonomy-bootstrap\source-ci-ticket.json'}
function WriteJson([string]$Path,$Value){$d=Split-Path $Path -Parent;if(-not(Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
if(-not(Test-Path $TicketPath -PathType Leaf)){throw "ACTIVATION_TICKET_MISSING: $TicketPath"}
$ticket=Get-Content $TicketPath -Raw -Encoding UTF8|ConvertFrom-Json
if(([string]$ticket.ci_conclusion -ne 'success') -or ([string]$ticket.profile -ne 'full')){throw 'ACTIVATION_FULL_CI_NOT_PASSED'}
Set-Location $RepoRoot
$head=(git rev-parse HEAD).Trim();if($LASTEXITCODE -ne 0){throw 'ACTIVATION_GIT_HEAD_FAILED'}
if($head -ne [string]$ticket.commit){throw "ACTIVATION_HEAD_MISMATCH expected=$($ticket.commit) actual=$head"}
$dirty=(git status --porcelain --untracked-files=no);if($dirty){throw 'ACTIVATION_TRACKED_WORKTREE_DIRTY'}
$source=Join-Path $RepoRoot 'extension\chrome';$manifest=Get-Content (Join-Path $source 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
if([string]$manifest.version -ne '3.12.6'){throw "ACTIVATION_EXTENSION_VERSION expected=3.12.6 actual=$($manifest.version)"}
$installed=Join-Path $InstallRoot 'extension';if(-not(Test-Path $InstallRoot -PathType Container)){throw "ACTIVATION_INSTALL_ROOT_MISSING: $InstallRoot"}
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssfff');$backupRoot=Join-Path $InstallRoot ('recovery\autonomy-'+$stamp);$stage=Join-Path $env:LOCALAPPDATA ('SOKNA\Bridge\staging\autonomy-'+[guid]::NewGuid().ToString('N'));$statePath=Join-Path $env:LOCALAPPDATA 'SOKNA\Bridge\autonomy-bootstrap\activation-state.json'
New-Item -ItemType Directory -Path $backupRoot,$stage -Force|Out-Null
Copy-Item (Join-Path $source '*') $stage -Recurse -Force
if(Test-Path $installed -PathType Container){Copy-Item $installed (Join-Path $backupRoot 'extension') -Recurse -Force}
$mutated=$false
try{
  if(Test-Path $installed){Remove-Item $installed -Recurse -Force}
  Copy-Item $stage $installed -Recurse -Force;$mutated=$true
  $live=Get-Content (Join-Path $installed 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$live.version -ne '3.12.6'){throw 'ACTIVATION_EXTENSION_COPY_VERIFY_FAILED'}
  $state=[ordered]@{schema='sokna-autonomy-activation-v1';ok=$true;state='files-installed';commit=$head;ci_run_id=$ticket.ci_run_id;extension_version='3.12.6';backup_root=$backupRoot;activated_at=(Get-Date).ToUniversalTime().ToString('o');extension_reload_required=$true}
  WriteJson $statePath $state;$state|ConvertTo-Json -Depth 10 -Compress
}catch{
  $reason=$_.Exception.Message
  if($mutated){$be=Join-Path $backupRoot 'extension';if(Test-Path $be){Remove-Item $installed -Recurse -Force -ErrorAction SilentlyContinue;Copy-Item $be $installed -Recurse -Force}}
  WriteJson $statePath ([ordered]@{schema='sokna-autonomy-activation-v1';ok=$false;state='failed';commit=$head;backup_root=$backupRoot;failure=$reason;failed_at=(Get-Date).ToUniversalTime().ToString('o');extension_reload_required=$true})
  throw
}finally{Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue}
