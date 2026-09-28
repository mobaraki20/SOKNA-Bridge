param([string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Fail([string]$m){throw ('P4_PROVIDER_WINDOWS_ACCEPTANCE_FAILED: '+$m)}
function Sha([string]$p){return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$case=Join-Path ([IO.Path]::GetTempPath()) ('sokna-p4-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $case -Force|Out-Null
try{
  $runner=Join-Path $case 'sokna-artifact-provider.exe';Push-Location (Join-Path $RepoRoot 'native\provider');try{& go test ./...;if($LASTEXITCODE-ne0){Fail 'native provider tests failed'};& go build -trimpath -o $runner .;if($LASTEXITCODE-ne0){Fail 'native provider build failed'}}finally{Pop-Location}
  $artifactRoot=Join-Path $case 'artifacts';$managed=Join-Path $case 'managed';New-Item -ItemType Directory -Path $managed -Force|Out-Null
  $local=Join-Path $case 'local.bin';[IO.File]::WriteAllBytes($local,[Text.Encoding]::UTF8.GetBytes('provider-local-payload'))
  $lan=Join-Path $managed 'lan.bin';[IO.File]::WriteAllBytes($lan,[Text.Encoding]::UTF8.GetBytes('provider-managed-payload'))
  $cfg=[pscustomobject]@{artifact_root=$artifactRoot;artifact_policy=[pscustomobject]@{max_root_bytes=10485760;max_artifact_bytes=1048576};artifact_providers=[pscustomobject]@{runner_path=$runner;retries=2;backoff_ms=1;timeout_seconds=20;managed_folders=@([pscustomobject]@{id='lan';root=$managed})}}
  Import-Module (Join-Path $RepoRoot 'native\runtime\v2.6.1\Sokna.ArtifactRoot.psm1') -Force
  Import-Module (Join-Path $RepoRoot 'native\runtime\v2.6.1\Sokna.ArtifactProvider.psm1') -Force
  $null=Initialize-SoknaArtifactRoot -Config $cfg -RuntimeRoot (Join-Path $RepoRoot 'native\runtime\v2.6.1')
  $status=Initialize-SoknaArtifactProviders -Config $cfg -RuntimeRoot (Join-Path $RepoRoot 'native\runtime\v2.6.1')
  if(-not$status.runner_available-or$status.managed_folders-notcontains'lan'){Fail 'provider status/managed folder missing'}

  $lp=[pscustomobject]@{artifact_id='win-local';source_path=$local;expected_sha256=(Sha $local);workspace='w1';job_id='j1'}
  $lr=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params $lp
  if(-not$lr.ok-or$lr.sha256-ne(Sha $local)-or$lr.auto_execute){Fail 'local provider acquire invalid'}
  if(-not(Test-Path -LiteralPath $lr.absolute_path -PathType Leaf)){Fail 'local acquired file missing'}
  if(-not(Test-Path -LiteralPath (Join-Path $artifactRoot 'logs\artifact-metadata\win-local.json'))){Fail 'local metadata missing'}
  $originalAcceptedHash=Sha $lr.absolute_path
  try{$null=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params $lp;Fail 'artifact id collision accepted'}catch{if($_.Exception.Message-notmatch'DESTINATION_EXISTS'){throw}}
  if(-not(Test-Path -LiteralPath $lr.absolute_path -PathType Leaf)-or(Sha $lr.absolute_path)-ne$originalAcceptedHash){Fail 'collision cleanup modified existing artifact'}

  $mp=[pscustomobject]@{artifact_id='win-managed';managed_folder='lan';relative_path='lan.bin';expected_sha256=(Sha $lan)}
  $mr=Invoke-SoknaArtifactProviderAcquire -Provider 'managed_folder' -Params $mp
  if(-not$mr.ok-or$mr.provider-ne'managed_folder'){Fail 'managed folder provider failed'}
  if(-not(Test-Path -LiteralPath $lan -PathType Leaf)){Fail 'managed source was modified'}

  $vr=Invoke-SoknaArtifactProviderVerify -Params ([pscustomobject]@{path=$mr.path;expected_sha256=$mr.sha256})
  if(-not$vr.ok-or$vr.sha256-ne$mr.sha256){Fail 'managed verify failed'}

  $bad=[pscustomobject]@{artifact_id='badsha';source_path=$local;expected_sha256=('0'*64)}
  try{$null=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params $bad;Fail 'hash mismatch accepted'}catch{if($_.Exception.Message-notmatch'sha256 mismatch'){throw}}
  if(Test-Path -LiteralPath (Join-Path $artifactRoot 'staging\.provider-badsha.partial')){Fail 'poisoned hash partial retained'}

  $secret='SUPER_SECRET_URL_TOKEN_261';$raw=[pscustomobject]@{artifact_id='raw-secret';url=('https://example.com/file.bin?token='+$secret);expected_sha256=('a'*64)}
  try{$null=Invoke-SoknaArtifactProviderAcquire -Provider 'https' -Params $raw;Fail 'raw credential URL accepted'}catch{if($_.Exception.Message-notmatch'credential-bearing URL'){throw}}
  $audit=Get-Content -LiteralPath (Get-SoknaArtifactAuditPath) -Raw -Encoding UTF8;if($audit.Contains($secret)){Fail 'secret leaked to audit log'}

  $cloud=[pscustomobject]@{artifact_id='drive-no-boundary';url='https://example.com/file.bin';expected_sha256=('b'*64)}
  try{$null=Invoke-SoknaArtifactProviderAcquire -Provider 'google_drive' -Params $cloud;Fail 'cloud provider bypassed url_env boundary'}catch{if($_.Exception.Message-notmatch'url_env'){throw}}

  $sigMissing=[pscustomobject]@{artifact_id='sig-required';source_path=$local;expected_sha256=(Sha $local);signature=[pscustomobject]@{required=$true;algorithm='ed25519-sha256'}}
  try{$null=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params $sigMissing;Fail 'required signature missing accepted'}catch{if($_.Exception.Message-notmatch'signature material missing'){throw}}

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $downloadRoot=Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads';New-Item -ItemType Directory -Path $downloadRoot -Force|Out-Null
  $chatName=('sokna-chat-'+[Guid]::NewGuid().ToString('N')+'.zip');$chatPath=Join-Path $downloadRoot $chatName
  $chatStage=Join-Path $case 'chat-stage';New-Item -ItemType Directory -Path $chatStage -Force|Out-Null;[IO.File]::WriteAllText((Join-Path $chatStage 'payload.txt'),'chat-artifact',[Text.UTF8Encoding]::new($false));[IO.Compression.ZipFile]::CreateFromDirectory($chatStage,$chatPath)
  try{
    $chat=Invoke-SoknaChatArtifactImportDownload -Params ([pscustomobject]@{artifact_id='win-chat';filename=$chatName;expected_sha256=(Sha $chatPath);workspace='w1';cleanup_source=$true})
    if(-not$chat.ok-or-not(Test-Path -LiteralPath $chat.absolute_path -PathType Leaf)){Fail 'chat attachment import failed'}
    if(Test-Path -LiteralPath $chatPath -PathType Leaf){Fail 'chat attachment source cleanup failed'}
    try{$null=Invoke-SoknaChatArtifactImportDownload -Params ([pscustomobject]@{filename='../escape.zip';expected_sha256=('a'*64)});Fail 'chat attachment filename traversal accepted'}catch{if($_.Exception.Message-notmatch'CHAT_ARTIFACT_FILENAME_INVALID'){throw}}
  }finally{Remove-Item -LiteralPath $chatPath -Force -ErrorAction SilentlyContinue}

  [ordered]@{ok=$true;schema='sokna-p4-provider-windows-acceptance-v1';runner=$runner;local=$true;managed_folder=$true;verify=$true;hash_mismatch_fail_closed=$true;raw_credential_url_redacted=$true;cloud_boundary=$true;required_signature_fail_closed=$true;collision_preserves_existing=$true;source_preserved=$true;chat_attachment_import=$true}|ConvertTo-Json -Compress
}finally{Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue}
