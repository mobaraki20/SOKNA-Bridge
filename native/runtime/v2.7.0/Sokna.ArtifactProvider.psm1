Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:SoknaProviderContext=$null

function Get-SoknaProviderOptional($Object,[string]$Name,$Default=$null){
  if($null-eq$Object){return $Default};try{$p=$Object.PSObject.Properties[$Name];if($null-ne$p-and$null-ne$p.Value){return $p.Value}}catch{};return $Default
}
function Test-SoknaProviderId([string]$Value){return ((-not[string]::IsNullOrWhiteSpace($Value))-and$Value.Length-le100-and$Value-match'^[A-Za-z0-9._-]+$')}
function Get-SoknaProviderRunner([string]$RuntimeRoot,$Config){
  $p=Get-SoknaProviderOptional $Config 'artifact_providers' $null;$override=[string](Get-SoknaProviderOptional $p 'runner_path' '')
  if($override){$full=[IO.Path]::GetFullPath($override);if(Test-Path -LiteralPath $full -PathType Leaf){return $full};throw('ARTIFACT_PROVIDER_RUNNER_NOT_FOUND: '+$full)}
  $installRoot=Split-Path -Parent ([IO.Path]::GetFullPath($RuntimeRoot));$name=if($env:OS-eq'Windows_NT'){'sokna-artifact-provider.exe'}else{'sokna-artifact-provider'}
  $candidate=Join-Path (Join-Path $installRoot 'provider') $name;if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}
  $nativeRoot=Split-Path -Parent $installRoot;$dev=Join-Path (Join-Path $nativeRoot 'provider') $name;if(Test-Path -LiteralPath $dev -PathType Leaf){return ([IO.Path]::GetFullPath($dev))}
  return $candidate
}
function Initialize-SoknaArtifactProviders($Config,[string]$RuntimeRoot){
  $cfg=Get-SoknaProviderOptional $Config 'artifact_providers' $null;$folders=@{}
  foreach($x in @(Get-SoknaProviderOptional $cfg 'managed_folders' @())){
    $id=[string](Get-SoknaProviderOptional $x 'id' '');$root=[string](Get-SoknaProviderOptional $x 'root' '')
    if(-not(Test-SoknaProviderId $id)){throw 'ARTIFACT_PROVIDER_MANAGED_FOLDER_ID_INVALID'};if([string]::IsNullOrWhiteSpace($root)-or-not[IO.Path]::IsPathRooted($root)){throw('ARTIFACT_PROVIDER_MANAGED_FOLDER_ROOT_INVALID: '+$id)}
    if($folders.ContainsKey($id)){throw('ARTIFACT_PROVIDER_MANAGED_FOLDER_DUPLICATE: '+$id)};$folders[$id]=[IO.Path]::GetFullPath($root)
  }
  [int]$retries=[int](Get-SoknaProviderOptional $cfg 'retries' 3);if($retries-lt1-or$retries-gt5){throw 'ARTIFACT_PROVIDER_RETRIES_INVALID'}
  [int]$backoff=[int](Get-SoknaProviderOptional $cfg 'backoff_ms' 500);if($backoff-lt1-or$backoff-gt5000){throw 'ARTIFACT_PROVIDER_BACKOFF_INVALID'}
  [int]$timeout=[int](Get-SoknaProviderOptional $cfg 'timeout_seconds' 120);if($timeout-lt1-or$timeout-gt900){throw 'ARTIFACT_PROVIDER_TIMEOUT_INVALID'}
  $script:SoknaProviderContext=[ordered]@{runner=(Get-SoknaProviderRunner $RuntimeRoot $Config);managed_folders=$folders;retries=$retries;backoff_ms=$backoff;timeout_seconds=$timeout}
  return (Get-SoknaArtifactProviderStatus)
}
function Get-SoknaArtifactProviderStatus{
  if($null-eq$script:SoknaProviderContext){throw 'ARTIFACT_PROVIDER_NOT_INITIALIZED'};$ids=@($script:SoknaProviderContext.managed_folders.Keys|Sort-Object)
  return [ordered]@{ok=$true;schema='sokna-artifact-provider-status-v1';runner_path=[string]$script:SoknaProviderContext.runner;runner_available=(Test-Path -LiteralPath ([string]$script:SoknaProviderContext.runner) -PathType Leaf);providers=@('local_file','managed_folder','https','github_release_asset','object_storage','google_drive','onedrive');managed_folders=$ids;remote_sha256_required=$true;signature_policy='optional-ed25519-sha256-fail-closed-when-required';cloud_boundary='google_drive/onedrive require url_env supplied by external plugin/presigned boundary';auto_execute=$false}
}
function Invoke-SoknaProviderRunner($Request){
  if($null-eq$script:SoknaProviderContext){throw 'ARTIFACT_PROVIDER_NOT_INITIALIZED'};$runner=[string]$script:SoknaProviderContext.runner;if(-not(Test-Path -LiteralPath $runner -PathType Leaf)){throw('ARTIFACT_PROVIDER_RUNNER_NOT_FOUND: '+$runner)}
  $json=$Request|ConvertTo-Json -Depth 20 -Compress;$psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$runner;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$utf8NoBom=New-Object Text.UTF8Encoding($false);if($null-ne$psi.PSObject.Properties['StandardInputEncoding']){$psi.StandardInputEncoding=$utf8NoBom};$psi.StandardOutputEncoding=$utf8NoBom;$psi.StandardErrorEncoding=$utf8NoBom
  $p=New-Object Diagnostics.Process;$p.StartInfo=$psi;[void]$p.Start();$p.StandardInput.Write($json);$p.StandardInput.Close();$ot=$p.StandardOutput.ReadToEndAsync();$et=$p.StandardError.ReadToEndAsync();if(-not$p.WaitForExit(920000)){try{$p.Kill()}catch{};throw 'ARTIFACT_PROVIDER_TIMEOUT'};$stdout=$ot.GetAwaiter().GetResult().Trim();$stderr=$et.GetAwaiter().GetResult().Trim()
  if([string]::IsNullOrWhiteSpace($stdout)){throw('ARTIFACT_PROVIDER_NO_RESULT: '+$stderr)};try{$result=$stdout|ConvertFrom-Json}catch{throw 'ARTIFACT_PROVIDER_RESULT_INVALID_JSON'}
  if($p.ExitCode-ne0-or-not[bool](Get-SoknaProviderOptional $result 'ok' $false)){throw('ARTIFACT_PROVIDER_FAILED: '+[string](Get-SoknaProviderOptional $result 'message' $stderr))};return $result
}
function Get-SoknaProviderSource($Params,[string]$Provider){
  $s=[ordered]@{}
  switch($Provider){
    'local_file' {$path=[string](Get-SoknaProviderOptional $Params 'source_path' (Get-SoknaProviderOptional $Params 'path' ''));if([string]::IsNullOrWhiteSpace($path)){throw 'ARTIFACT_PROVIDER_SOURCE_PATH_REQUIRED'};$s.path=$path}
    'managed_folder' {$id=[string](Get-SoknaProviderOptional $Params 'managed_folder' (Get-SoknaProviderOptional $Params 'folder_id' ''));if(-not(Test-SoknaProviderId $id)-or-not$script:SoknaProviderContext.managed_folders.ContainsKey($id)){throw 'ARTIFACT_PROVIDER_MANAGED_FOLDER_UNKNOWN'};$rel=[string](Get-SoknaProviderOptional $Params 'relative_path' (Get-SoknaProviderOptional $Params 'path' ''));if([string]::IsNullOrWhiteSpace($rel)){throw 'ARTIFACT_PROVIDER_RELATIVE_PATH_REQUIRED'};$s.managed_root=[string]$script:SoknaProviderContext.managed_folders[$id];$s.relative_path=$rel}
    'github_release_asset' {$s.repository=[string](Get-SoknaProviderOptional $Params 'repository' '');$s.tag=[string](Get-SoknaProviderOptional $Params 'tag' 'latest');$s.asset=[string](Get-SoknaProviderOptional $Params 'asset' '');$s.url=[string](Get-SoknaProviderOptional $Params 'url' '');$s.url_env=[string](Get-SoknaProviderOptional $Params 'url_env' '');$s.credential_env=[string](Get-SoknaProviderOptional $Params 'credential_env' '')}
    default {$s.url=[string](Get-SoknaProviderOptional $Params 'url' '');$s.url_env=[string](Get-SoknaProviderOptional $Params 'url_env' '');$s.credential_env=[string](Get-SoknaProviderOptional $Params 'credential_env' '')}
  }
  $origins=@(Get-SoknaProviderOptional $Params 'allowed_redirect_origins' @());if($origins.Count-gt0){$s.allowed_redirect_origins=$origins};return $s
}
function New-SoknaProviderRequest([string]$Operation,[string]$Provider,$Params,[string]$ArtifactId){
  $policy=Get-SoknaArtifactPolicy;$sig=Get-SoknaProviderOptional $Params 'signature' $null;[int64]$max=[int64]$policy.max_artifact_bytes
  if($Operation-eq'acquire'){$st=Get-SoknaArtifactRootStatus;[int64]$available=[int64]$st.quota_remaining_bytes;$partial=Resolve-SoknaManagedArtifactPath -Path (Join-Path 'staging' ('.provider-'+$ArtifactId+'.partial')) -AllowMissing;if(Test-Path -LiteralPath $partial -PathType Leaf){$available+=[int64](Get-Item -LiteralPath $partial -Force).Length};$max=[Math]::Min($max,$available);if($max-le0){throw 'ARTIFACT_ROOT_QUOTA_EXCEEDED'}}
  return [ordered]@{schema='sokna-artifact-provider-request-v1';operation=$Operation;provider=$Provider;artifact_root=(Get-SoknaArtifactRoot);artifact_id=$ArtifactId;source=(Get-SoknaProviderSource $Params $Provider);expected_sha256=[string](Get-SoknaProviderOptional $Params 'expected_sha256' '');max_bytes=$max;retries=[int]$script:SoknaProviderContext.retries;backoff_ms=[int]$script:SoknaProviderContext.backoff_ms;timeout_seconds=[int]$script:SoknaProviderContext.timeout_seconds;signature=$sig;workspace=[string](Get-SoknaProviderOptional $Params 'workspace' '');job_id=[string](Get-SoknaProviderOptional $Params 'job_id' '')}
}
function Get-SoknaProviderArtifactId($Params,[string]$Provider){$id=[string](Get-SoknaProviderOptional $Params 'artifact_id' '');if([string]::IsNullOrWhiteSpace($id)){$id=($Provider-replace'[^A-Za-z0-9._-]','_')+'-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)};if(-not(Test-SoknaProviderId $id)){throw 'ARTIFACT_ID_INVALID'};return $id}
function Invoke-SoknaArtifactProviderProbe([string]$Provider,$Params){
  if([string]::IsNullOrWhiteSpace($Provider)){$Provider=[string](Get-SoknaProviderOptional $Params 'provider' '')};$id=Get-SoknaProviderArtifactId $Params $Provider;$req=New-SoknaProviderRequest 'probe' $Provider $Params $id
  $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.probe';phase='started';ok=$true;provider=$Provider;artifact_id=$id;workspace=[string]$req.workspace;job_id=[string]$req.job_id}) -Required
  try{
    $r=Invoke-SoknaProviderRunner $req
    $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.probe';phase='completed';ok=$true;provider=$Provider;artifact_id=$id;source_ref=[string](Get-SoknaProviderOptional $r 'source_ref' '');resolved_ref=[string](Get-SoknaProviderOptional $r 'resolved_ref' '');size=[int64](Get-SoknaProviderOptional $r 'size' 0);content_type=[string](Get-SoknaProviderOptional $r 'content_type' '')}) -Required
    return $r
  }catch{$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.probe';phase='failed';ok=$false;provider=$Provider;artifact_id=$id;error=$_.Exception.Message});throw}
}
function Invoke-SoknaArtifactProviderAcquire([string]$Provider,$Params){
  if([string]::IsNullOrWhiteSpace($Provider)){$Provider=[string](Get-SoknaProviderOptional $Params 'provider' '')};$id=Get-SoknaProviderArtifactId $Params $Provider;$req=New-SoknaProviderRequest 'acquire' $Provider $Params $id;$metaPath=$null;$final=$null;$stage=$null;$finalOwned=$false;$metaOwned=$false
  $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.acquire';phase='started';ok=$true;provider=$Provider;artifact_id=$id;workspace=[string]$req.workspace;job_id=[string]$req.job_id}) -Required
  try{
    $r=Invoke-SoknaProviderRunner $req
    $stage=[string](Get-SoknaProviderOptional $r 'managed_path' '')
    if([string]::IsNullOrWhiteSpace($stage)){throw 'ARTIFACT_PROVIDER_STAGING_PATH_MISSING'}
    $stage=Resolve-SoknaManagedArtifactPath -Path $stage
    if(-not(Test-Path -LiteralPath $stage -PathType Leaf)){throw 'ARTIFACT_PROVIDER_STAGING_MISSING'}
    $sourceRef=[string](Get-SoknaProviderOptional $r 'source_ref' '')
    $resolvedRef=[string](Get-SoknaProviderOptional $r 'resolved_ref' '')
    $fileName=[string](Get-SoknaProviderOptional $r 'file_name' 'artifact.bin')
    [int64]$resultSize=[int64](Get-SoknaProviderOptional $r 'size' 0)
    $resultSha=[string](Get-SoknaProviderOptional $r 'sha256' '')
    $contentType=[string](Get-SoknaProviderOptional $Params 'content_type' (Get-SoknaProviderOptional $r 'content_type' ''))
    [int]$attempts=[int](Get-SoknaProviderOptional $r 'attempts' 0)
    [int64]$resumedBytes=[int64](Get-SoknaProviderOptional $r 'resumed_bytes' 0)
    $signature=[string](Get-SoknaProviderOptional $r 'signature' '')
    [bool]$signatureOk=[bool](Get-SoknaProviderOptional $r 'signature_ok' $false)
    $providerBoundary=[string](Get-SoknaProviderOptional $r 'provider_boundary' '')
    $sha=(Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash.ToLowerInvariant();$item=Get-Item -LiteralPath $stage -Force
    if($sha-ne$resultSha.ToLowerInvariant()-or[int64]$item.Length-ne$resultSize){throw 'ARTIFACT_PROVIDER_VERIFY_DISAGREEMENT'}
    $status=Get-SoknaArtifactRootStatus;if([int64]$status.usage_bytes-gt[int64]$status.quota_bytes){Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue;throw 'ARTIFACT_ROOT_QUOTA_EXCEEDED'}
    $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.acquire';phase='verified';ok=$true;provider=$Provider;artifact_id=$id;source_ref=$sourceRef;size=$resultSize;sha256=$sha;attempts=$attempts;resumed_bytes=$resumedBytes;signature=$signature;signature_ok=$signatureOk}) -Required
    $safe=($fileName-replace'[^A-Za-z0-9._-]','_').Trim('.');if([string]::IsNullOrWhiteSpace($safe)){$safe='artifact.bin'};if($safe.Length-gt120){$safe=$safe.Substring(0,120)}
    $final=Resolve-SoknaManagedArtifactPath -Path (Join-Path 'incoming' ($id+'--'+$safe)) -AllowMissing;$existingMeta=Resolve-SoknaManagedArtifactPath -Path (Join-Path (Join-Path 'logs' 'artifact-metadata') ($id+'.json')) -AllowMissing;if(Test-Path -LiteralPath $final){throw 'ARTIFACT_PROVIDER_DESTINATION_EXISTS'};if(Test-Path -LiteralPath $existingMeta){throw 'ARTIFACT_PROVIDER_METADATA_EXISTS'};Move-Item -LiteralPath $stage -Destination $final;$finalOwned=$true
    $rel='incoming/'+[IO.Path]::GetFileName($final);$now=(Get-Date).ToUniversalTime().ToString('o');$m=[ordered]@{schema='sokna-artifact-metadata-v1';artifact_id=$id;provider=$Provider;source_ref=$sourceRef;resolved_ref=$resolvedRef;local_path=$rel;size=$resultSize;sha256=$sha;content_type=$contentType;created_at=$now;updated_at=$now;state='incoming';workspace=[string]$req.workspace;job_id=[string]$req.job_id;cleanup_state='active';provider_boundary=$providerBoundary;download_attempts=$attempts;resumed_bytes=$resumedBytes;signature=$signature;signature_ok=$signatureOk;auto_execute=$false}
    $metaPath=Set-SoknaArtifactMetadata -ArtifactId $id -Metadata $m;$metaOwned=$true;$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.acquire';phase='registered';ok=$true;provider=$Provider;artifact_id=$id;source_ref=$sourceRef;path=$rel;size=$resultSize;sha256=$sha;workspace=[string]$req.workspace;job_id=[string]$req.job_id;auto_execute=$false}) -Required
    return [ordered]@{ok=$true;schema='sokna-artifact-provider-acquire-v1';artifact_id=$id;provider=$Provider;source_ref=$sourceRef;resolved_ref=$resolvedRef;path=$rel;absolute_path=$final;size=$resultSize;sha256=$sha;content_type=$contentType;attempts=$attempts;resumed_bytes=$resumedBytes;signature=$signature;signature_ok=$signatureOk;provider_boundary=$providerBoundary;auto_execute=$false;artifact_root=(Get-SoknaArtifactRoot)}
  }catch{if($metaOwned-and$metaPath){Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue};if($finalOwned-and$final){Remove-Item -LiteralPath $final -Force -ErrorAction SilentlyContinue};if($stage-and(Test-Path -LiteralPath $stage -PathType Leaf)){Remove-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue};$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.acquire';phase='failed';ok=$false;provider=$Provider;artifact_id=$id;error=$_.Exception.Message;workspace=[string]$req.workspace;job_id=[string]$req.job_id});throw}
}
function Invoke-SoknaChatArtifactImportDownload($Params){
  $filename=[string](Get-SoknaProviderOptional $Params 'filename' '')
  if([string]::IsNullOrWhiteSpace($filename)-or[IO.Path]::GetFileName($filename)-ne$filename-or$filename-match'[\\/:*?"<>|\x00-\x1F]' -or -not $filename.ToLowerInvariant().EndsWith('.zip')){throw 'CHAT_ARTIFACT_FILENAME_INVALID'}
  $expected=[string](Get-SoknaProviderOptional $Params 'expected_sha256' '');if($expected-notmatch'^[a-fA-F0-9]{64}$'){throw 'CHAT_ARTIFACT_EXPECTED_SHA256_REQUIRED'}
  $home=[Environment]::GetFolderPath('UserProfile');if([string]::IsNullOrWhiteSpace($home)){$home=$env:USERPROFILE};if([string]::IsNullOrWhiteSpace($home)){throw 'CHAT_ARTIFACT_USERPROFILE_MISSING'}
  $downloads=[IO.Path]::GetFullPath((Join-Path $home 'Downloads'));$source=[IO.Path]::GetFullPath((Join-Path $downloads $filename));$prefix=$downloads.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  if(-not$source.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'CHAT_ARTIFACT_DOWNLOAD_PATH_ESCAPE'}
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'CHAT_ARTIFACT_DOWNLOAD_NOT_READY'}
  $item=Get-Item -LiteralPath $source -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'CHAT_ARTIFACT_DOWNLOAD_REPARSE_BLOCKED'}
  $req=[ordered]@{source_path=$source;expected_sha256=$expected;workspace=[string](Get-SoknaProviderOptional $Params 'workspace' '');job_id=''}
  $artifactId=[string](Get-SoknaProviderOptional $Params 'artifact_id' '');if(-not[string]::IsNullOrWhiteSpace($artifactId)){$req.artifact_id=$artifactId}
  $acq=Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params ([pscustomobject]$req)
  if([bool](Get-SoknaProviderOptional $Params 'cleanup_source' $false)){Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue}
  return $acq
}
function Invoke-SoknaArtifactProviderVerify($Params){
  $path=[string](Get-SoknaProviderOptional $Params 'path' '');if([string]::IsNullOrWhiteSpace($path)){throw 'ARTIFACT_PROVIDER_VERIFY_PATH_REQUIRED'};$full=Resolve-SoknaManagedArtifactPath -Path $path;if(-not(Test-Path -LiteralPath $full -PathType Leaf)){throw 'ARTIFACT_PROVIDER_VERIFY_TARGET_MISSING'}
  $policy=Get-SoknaArtifactPolicy;$artifactId=[string](Get-SoknaProviderOptional $Params 'artifact_id' '');$req=[ordered]@{schema='sokna-artifact-provider-request-v1';operation='verify';provider='managed_artifact';artifact_root=(Get-SoknaArtifactRoot);artifact_id=$artifactId;managed_path=$path;source=@{};expected_sha256=[string](Get-SoknaProviderOptional $Params 'expected_sha256' '');max_bytes=[int64]$policy.max_artifact_bytes;signature=(Get-SoknaProviderOptional $Params 'signature' $null)}
  $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.verify';phase='started';ok=$true;artifact_id=$artifactId;path=$path}) -Required
  try{
    $r=Invoke-SoknaProviderRunner $req
    $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.verify';phase='completed';ok=$true;artifact_id=$artifactId;path=$path;size=[int64](Get-SoknaProviderOptional $r 'size' 0);sha256=[string](Get-SoknaProviderOptional $r 'sha256' '');signature=[string](Get-SoknaProviderOptional $r 'signature' '');signature_ok=[bool](Get-SoknaProviderOptional $r 'signature_ok' $false)}) -Required
    return $r
  }catch{$null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.provider.verify';phase='failed';ok=$false;artifact_id=$artifactId;path=$path;error=$_.Exception.Message});throw}
}

Export-ModuleMember -Function Initialize-SoknaArtifactProviders,Get-SoknaArtifactProviderStatus,Invoke-SoknaArtifactProviderProbe,Invoke-SoknaArtifactProviderAcquire,Invoke-SoknaArtifactProviderVerify,Invoke-SoknaChatArtifactImportDownload
