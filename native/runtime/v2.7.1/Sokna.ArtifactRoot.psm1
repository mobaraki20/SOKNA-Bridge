$script:SoknaArtifactContext = $null

function Get-SoknaConfigValue {
  param($Object,[string]$Name,$Default=$null)
  if($null-eq$Object){return $Default}
  try{
    $p=$Object.PSObject.Properties[$Name]
    if($null-ne$p -and $null-ne$p.Value){return $p.Value}
  }catch{}
  return $Default
}

function Get-SoknaArtifactPolicy {
  if($null-eq$script:SoknaArtifactContext){throw 'ARTIFACT_ROOT_NOT_INITIALIZED'}
  return $script:SoknaArtifactContext.policy
}

function Get-SoknaArtifactRoot {
  if($null-eq$script:SoknaArtifactContext){throw 'ARTIFACT_ROOT_NOT_INITIALIZED'}
  return [string]$script:SoknaArtifactContext.root
}

function Get-SoknaArtifactDirectory {
  param([Parameter(Mandatory=$true)][ValidateSet('incoming','staging','accepted','failed','cache','browser','logs')][string]$Name)
  $root=Get-SoknaArtifactRoot
  return (Join-Path $root $Name)
}

function Test-SoknaReparsePoint {
  param([Parameter(Mandatory=$true)][string]$Path)
  if(-not(Test-Path -LiteralPath $Path)){return $false}
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne0)
}

function Assert-SoknaNoReparseChain {
  param([Parameter(Mandatory=$true)][string]$FullPath,[switch]$AllowMissing)
  $root=[IO.Path]::GetFullPath((Get-SoknaArtifactRoot))
  $full=[IO.Path]::GetFullPath($FullPath)
  if(Test-SoknaReparsePoint $root){throw 'ARTIFACT_ROOT_REPARSE_POINT_BLOCKED'}
  if($full-eq$root){return}
  $prefix=$root
  if(-not$prefix.EndsWith([IO.Path]::DirectorySeparatorChar)){$prefix+=[IO.Path]::DirectorySeparatorChar}
  if(-not$full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'ARTIFACT_PATH_OUTSIDE_ROOT'}
  $relative=$full.Substring($prefix.Length)
  $current=$root
  foreach($part in ($relative -split '[\\/]')){
    if([string]::IsNullOrWhiteSpace($part)){continue}
    $current=Join-Path $current $part
    if(Test-Path -LiteralPath $current){
      if(Test-SoknaReparsePoint $current){throw ('ARTIFACT_REPARSE_POINT_BLOCKED: '+$current)}
    }elseif($AllowMissing){
      return
    }else{
      throw ('ARTIFACT_PATH_NOT_FOUND: '+$current)
    }
  }
}

function Resolve-SoknaManagedArtifactPath {
  param([Parameter(Mandatory=$true)][string]$Path,[switch]$AllowMissing)
  $root=[IO.Path]::GetFullPath((Get-SoknaArtifactRoot))
  if([string]::IsNullOrWhiteSpace($Path)){throw 'ARTIFACT_PATH_REQUIRED'}
  $full=if([IO.Path]::IsPathRooted($Path)){[IO.Path]::GetFullPath($Path)}else{[IO.Path]::GetFullPath((Join-Path $root $Path))}
  $prefix=$root
  if(-not$prefix.EndsWith([IO.Path]::DirectorySeparatorChar)){$prefix+=[IO.Path]::DirectorySeparatorChar}
  if($full-ne$root -and -not$full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'ARTIFACT_PATH_OUTSIDE_ROOT'}
  Assert-SoknaNoReparseChain -FullPath $full -AllowMissing:$AllowMissing
  if(-not$AllowMissing -and -not(Test-Path -LiteralPath $full)){throw 'ARTIFACT_PATH_NOT_FOUND'}
  return $full
}

function Measure-SoknaArtifactTreeBytes {
  param([Parameter(Mandatory=$true)][string]$Root)
  $start=Resolve-SoknaManagedArtifactPath -Path $Root
  [int64]$total=0
  $stack=New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push($start)
  while($stack.Count-gt0){
    $dir=$stack.Pop()
    foreach($item in @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop)){
      if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw ('ARTIFACT_REPARSE_POINT_BLOCKED: '+$item.FullName)}
      if($item.PSIsContainer){$stack.Push($item.FullName)}else{$total+=[int64]$item.Length}
    }
  }
  return $total
}

function Get-SoknaArtifactAuditPath {
  return (Join-Path (Get-SoknaArtifactDirectory 'logs') 'artifact-events.jsonl')
}

function Write-SoknaArtifactAudit {
  param([Parameter(Mandatory=$true)]$Event,[switch]$Required)
  try{
    if($null-eq$Event.ts){$Event.ts=(Get-Date).ToUniversalTime().ToString('o')}
    $line=$Event|ConvertTo-Json -Compress -Depth 20
    [IO.File]::AppendAllText((Get-SoknaArtifactAuditPath),$line+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
    return $true
  }catch{
    if($Required){throw ('ARTIFACT_AUDIT_WRITE_FAILED: '+$_.Exception.Message)}
    return $false
  }
}

function Get-SoknaArtifactMetadataPath {
  param([Parameter(Mandatory=$true)][string]$ArtifactId)
  if($ArtifactId-notmatch'^[A-Za-z0-9._-]{1,100}$'){throw 'ARTIFACT_ID_INVALID'}
  $dir=Join-Path (Get-SoknaArtifactDirectory 'logs') 'artifact-metadata'
  if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
  return (Join-Path $dir ($ArtifactId+'.json'))
}

function Set-SoknaArtifactMetadata {
  param([Parameter(Mandatory=$true)][string]$ArtifactId,[Parameter(Mandatory=$true)]$Metadata)
  $path=Get-SoknaArtifactMetadataPath -ArtifactId $ArtifactId
  $tmp=$path+'.tmp.'+$PID+'.'+[Guid]::NewGuid().ToString('N')
  try{
    $text=$Metadata|ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($tmp,$text,(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $path -Force
  }finally{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue}
  return $path
}

function Update-SoknaArtifactMetadataState {
  param([Parameter(Mandatory=$true)][string]$ArtifactId,[Parameter(Mandatory=$true)][string]$State,$Extra=$null)
  $path=Get-SoknaArtifactMetadataPath -ArtifactId $ArtifactId
  $m=[ordered]@{schema='sokna-artifact-metadata-v1';artifact_id=$ArtifactId;state=$State;updated_at=(Get-Date).ToUniversalTime().ToString('o')}
  if(Test-Path -LiteralPath $path){
    try{
      $old=Get-Content -LiteralPath $path -Raw -Encoding UTF8|ConvertFrom-Json
      foreach($p in $old.PSObject.Properties){$m[$p.Name]=$p.Value}
      $m.state=$State;$m.updated_at=(Get-Date).ToUniversalTime().ToString('o')
    }catch{}
  }
  if($null-ne$Extra){foreach($p in $Extra.PSObject.Properties){$m[$p.Name]=$p.Value}}
  return (Set-SoknaArtifactMetadata -ArtifactId $ArtifactId -Metadata $m)
}

function Initialize-SoknaArtifactRoot {
  param([Parameter(Mandatory=$true)]$Config,[Parameter(Mandatory=$true)][string]$RuntimeRoot)
  $configured=[string](Get-SoknaConfigValue $Config 'artifact_root' '')
  $mode='config'
  if([string]::IsNullOrWhiteSpace($configured)){
    $mode='managed-default'
    if($env:LOCALAPPDATA){$configured=Join-Path $env:LOCALAPPDATA 'SOKNA\Bridge\artifacts'}else{$configured=Join-Path $RuntimeRoot 'artifacts'}
  }
  $root=[IO.Path]::GetFullPath($configured)
  if(-not(Test-Path -LiteralPath $root)){New-Item -ItemType Directory -Path $root -Force|Out-Null}
  if(Test-SoknaReparsePoint $root){throw 'ARTIFACT_ROOT_REPARSE_POINT_BLOCKED'}
  foreach($name in @('incoming','staging','accepted','failed','cache','browser','logs')){
    $dir=Join-Path $root $name
    if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
    if(Test-SoknaReparsePoint $dir){throw ('ARTIFACT_MANAGED_DIR_REPARSE_POINT_BLOCKED: '+$name)}
  }
  $meta=Join-Path (Join-Path $root 'logs') 'artifact-metadata'
  if(-not(Test-Path -LiteralPath $meta)){New-Item -ItemType Directory -Path $meta -Force|Out-Null}
  if(Test-SoknaReparsePoint $meta){throw 'ARTIFACT_METADATA_DIR_REPARSE_POINT_BLOCKED'}

  $policyCfg=Get-SoknaConfigValue $Config 'artifact_policy' $null
  [int64]$quota=[int64](Get-SoknaConfigValue $policyCfg 'max_root_bytes' 10737418240)
  [int64]$maxArtifact=[int64](Get-SoknaConfigValue $policyCfg 'max_artifact_bytes' 536870912)
  if($quota-le0 -or $maxArtifact-le0 -or $maxArtifact-gt$quota){throw 'ARTIFACT_POLICY_INVALID_QUOTA'}
  $ret=Get-SoknaConfigValue $policyCfg 'retention' $null
  $policy=[ordered]@{
    max_root_bytes=$quota
    max_artifact_bytes=$maxArtifact
    retention=[ordered]@{
      incoming_days=[double](Get-SoknaConfigValue $ret 'incoming_days' 7)
      staging_hours=[double](Get-SoknaConfigValue $ret 'staging_hours' 24)
      accepted_days=[double](Get-SoknaConfigValue $ret 'accepted_days' 30)
      failed_days=[double](Get-SoknaConfigValue $ret 'failed_days' 14)
      cache_days=[double](Get-SoknaConfigValue $ret 'cache_days' 7)
      browser_days=[double](Get-SoknaConfigValue $ret 'browser_days' 30)
    }
  }
  foreach($v in $policy.retention.Values){if([double]$v-lt0){throw 'ARTIFACT_POLICY_INVALID_RETENTION'}}
  $legacy=if($env:USERPROFILE){Join-Path $env:USERPROFILE 'Downloads'}else{''}
  $script:SoknaArtifactContext=[ordered]@{root=$root;mode=$mode;policy=$policy;legacy_root=$legacy;legacy_exists=([bool]($legacy-and(Test-Path -LiteralPath $legacy)));legacy_auto_migrate=$false}
  return (Get-SoknaArtifactRootStatus)
}

function Get-SoknaArtifactRootStatus {
  $root=Get-SoknaArtifactRoot
  $policy=Get-SoknaArtifactPolicy
  $dirs=[ordered]@{}
  [int64]$usage=0
  foreach($name in @('incoming','staging','accepted','failed','cache','browser','logs')){
    $bytes=Measure-SoknaArtifactTreeBytes -Root (Join-Path $root $name)
    $dirs[$name]=$bytes;$usage+=$bytes
  }
  [int64]$free=-1;[int64]$total=-1
  try{$drive=New-Object IO.DriveInfo(([IO.Path]::GetPathRoot($root)));$free=[int64]$drive.AvailableFreeSpace;$total=[int64]$drive.TotalSize}catch{}
  [int64]$remaining=[Math]::Max([int64]0,[int64]$policy.max_root_bytes-$usage)
  return [ordered]@{
    ok=$true;schema='sokna-artifact-root-status-v1';root=$root;mode=[string]$script:SoknaArtifactContext.mode
    directories=$dirs;usage_bytes=$usage;quota_bytes=[int64]$policy.max_root_bytes;quota_remaining_bytes=$remaining
    max_artifact_bytes=[int64]$policy.max_artifact_bytes;drive_free_bytes=$free;drive_total_bytes=$total
    retention=$policy.retention;audit_log=(Get-SoknaArtifactAuditPath)
    migration=[ordered]@{legacy_root=[string]$script:SoknaArtifactContext.legacy_root;legacy_exists=[bool]$script:SoknaArtifactContext.legacy_exists;auto_migrate=$false;instruction='use artifact.import.local for legacy/outside-root files'}
  }
}

function Get-SoknaContentType {
  param([string]$Path,[string]$Explicit)
  if(-not[string]::IsNullOrWhiteSpace($Explicit)){return $Explicit}
  switch(([IO.Path]::GetExtension($Path).ToLowerInvariant())){
    '.zip' {return 'application/zip'}
    '.json' {return 'application/json'}
    '.txt' {return 'text/plain'}
    '.log' {return 'text/plain'}
    '.png' {return 'image/png'}
    '.jpg' {return 'image/jpeg'}
    '.jpeg' {return 'image/jpeg'}
    default {return 'application/octet-stream'}
  }
}

function Import-SoknaLocalArtifact {
  param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$ArtifactId,
    [string]$ExpectedSha256='',
    [string]$ContentType='',
    [string]$Workspace='',
    [string]$JobId=''
  )
  if($ArtifactId-notmatch'^[A-Za-z0-9._-]{1,100}$'){throw 'ARTIFACT_ID_INVALID'}
  if(-not[string]::IsNullOrWhiteSpace($ExpectedSha256) -and $ExpectedSha256-notmatch'^[a-fA-F0-9]{64}$'){throw 'ARTIFACT_EXPECTED_SHA256_INVALID'}
  $source=[IO.Path]::GetFullPath($SourcePath)
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'ARTIFACT_IMPORT_SOURCE_NOT_FOUND'}
  $sourceItem=Get-Item -LiteralPath $source -Force
  if(($sourceItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'ARTIFACT_IMPORT_SOURCE_REPARSE_BLOCKED'}
  [int64]$size=$sourceItem.Length
  $policy=Get-SoknaArtifactPolicy
  if($size-le0 -or $size-gt[int64]$policy.max_artifact_bytes){throw 'ARTIFACT_IMPORT_SIZE_INVALID'}
  $before=Get-SoknaArtifactRootStatus
  if(([int64]$before.usage_bytes+$size)-gt[int64]$policy.max_root_bytes){
    $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.import.local';phase='quota_rejected';ok=$false;artifact_id=$ArtifactId;source_ref=$source;size=$size})
    throw 'ARTIFACT_ROOT_QUOTA_EXCEEDED'
  }
  $safeName=([IO.Path]::GetFileName($source)-replace'[^A-Za-z0-9._-]','_').Trim('.')
  if([string]::IsNullOrWhiteSpace($safeName)){$safeName='artifact.bin'}
  if($safeName.Length-gt120){$safeName=$safeName.Substring(0,120)}
  $incoming=Get-SoknaArtifactDirectory 'incoming';$staging=Get-SoknaArtifactDirectory 'staging'
  $final=Resolve-SoknaManagedArtifactPath -Path (Join-Path 'incoming' ($ArtifactId+'--'+$safeName)) -AllowMissing
  if(Test-Path -LiteralPath $final){throw 'ARTIFACT_IMPORT_DESTINATION_EXISTS'}
  $tmp=Resolve-SoknaManagedArtifactPath -Path (Join-Path 'staging' ('.partial-'+$ArtifactId+'-'+[Guid]::NewGuid().ToString('N'))) -AllowMissing
  try{
    Copy-Item -LiteralPath $source -Destination $tmp -Force
    $copied=Get-Item -LiteralPath $tmp -Force
    if([int64]$copied.Length-ne$size){throw 'ARTIFACT_IMPORT_SOURCE_CHANGED'}
    $sha=(Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
    if($ExpectedSha256 -and $sha-ne$ExpectedSha256.ToLowerInvariant()){
      $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.import.local';phase='hash_rejected';ok=$false;artifact_id=$ArtifactId;source_ref=$source;size=$size;sha256=$sha})
      throw 'ARTIFACT_SHA256_MISMATCH'
    }
    Move-Item -LiteralPath $tmp -Destination $final
    $relative='incoming/'+[IO.Path]::GetFileName($final)
    $now=(Get-Date).ToUniversalTime().ToString('o')
    $metadata=[ordered]@{schema='sokna-artifact-metadata-v1';artifact_id=$ArtifactId;provider='local_file';source_ref=$source;local_path=$relative;size=$size;sha256=$sha;content_type=(Get-SoknaContentType -Path $source -Explicit $ContentType);created_at=$now;updated_at=$now;state='incoming';workspace=$Workspace;job_id=$JobId;cleanup_state='active'}
    $metaPath=Set-SoknaArtifactMetadata -ArtifactId $ArtifactId -Metadata $metadata
    $after=Get-SoknaArtifactRootStatus
    if([int64]$after.usage_bytes-gt[int64]$policy.max_root_bytes){
      Remove-Item -LiteralPath $final -Force -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $metaPath -Force -ErrorAction SilentlyContinue
      $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.import.local';phase='quota_postwrite_rejected';ok=$false;artifact_id=$ArtifactId;size=$size;sha256=$sha})
      throw 'ARTIFACT_ROOT_QUOTA_EXCEEDED'
    }
    $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.import.local';phase='imported';ok=$true;artifact_id=$ArtifactId;provider='local_file';source_ref=$source;path=$relative;size=$size;sha256=$sha;content_type=$metadata.content_type;workspace=$Workspace;job_id=$JobId}) -Required
    return [ordered]@{ok=$true;artifact_id=$ArtifactId;provider='local_file';source_ref=$source;path=$relative;absolute_path=$final;size=$size;sha256=$sha;content_type=$metadata.content_type;metadata=$metaPath;artifact_root=(Get-SoknaArtifactRoot)}
  }catch{
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    throw
  }
}

function New-SoknaArtifactStage {
  param([Parameter(Mandatory=$true)][string]$ArtifactPath)
  $null=Resolve-SoknaManagedArtifactPath -Path $ArtifactPath
  $stage=Resolve-SoknaManagedArtifactPath -Path (Join-Path 'staging' ('tx-'+[Guid]::NewGuid().ToString('N'))) -AllowMissing
  New-Item -ItemType Directory -Path $stage -Force|Out-Null
  return $stage
}

function Assert-SoknaTreeNoReparse {
  param([Parameter(Mandatory=$true)][string]$Path)
  $full=Resolve-SoknaManagedArtifactPath -Path $Path
  if(-not(Test-Path -LiteralPath $full)){return}
  $item=Get-Item -LiteralPath $full -Force
  if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw ('ARTIFACT_REPARSE_POINT_BLOCKED: '+$full)}
  if(-not$item.PSIsContainer){return}
  $stack=New-Object 'System.Collections.Generic.Stack[string]';$stack.Push($full)
  while($stack.Count-gt0){
    foreach($child in @(Get-ChildItem -LiteralPath ($stack.Pop()) -Force -ErrorAction Stop)){
      if(($child.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw ('ARTIFACT_REPARSE_POINT_BLOCKED: '+$child.FullName)}
      if($child.PSIsContainer){$stack.Push($child.FullName)}
    }
  }
}

function Invoke-SoknaArtifactCleanup {
  param([switch]$Execute)
  $policy=Get-SoknaArtifactPolicy
  $now=(Get-Date).ToUniversalTime()
  $rules=[ordered]@{
    incoming=[TimeSpan]::FromDays([double]$policy.retention.incoming_days)
    staging=[TimeSpan]::FromHours([double]$policy.retention.staging_hours)
    accepted=[TimeSpan]::FromDays([double]$policy.retention.accepted_days)
    failed=[TimeSpan]::FromDays([double]$policy.retention.failed_days)
    cache=[TimeSpan]::FromDays([double]$policy.retention.cache_days)
    browser=[TimeSpan]::FromDays([double]$policy.retention.browser_days)
  }
  $removed=@();[int64]$reclaimed=0
  foreach($name in $rules.Keys){
    $base=Get-SoknaArtifactDirectory $name;$cutoff=$now-$rules[$name]
    foreach($item in @(Get-ChildItem -LiteralPath $base -Force -ErrorAction Stop)){
      if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw ('ARTIFACT_REPARSE_POINT_BLOCKED: '+$item.FullName)}
      if($item.LastWriteTimeUtc-ge$cutoff){continue}
      Assert-SoknaTreeNoReparse -Path $item.FullName
      [int64]$bytes=if($item.PSIsContainer){Measure-SoknaArtifactTreeBytes -Root $item.FullName}else{[int64]$item.Length}
      $rel=$name+'/'+$item.Name;$removed+=@($rel);$reclaimed+=$bytes
      if($Execute){Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop}
    }
  }
  $result=[ordered]@{ok=$true;dry_run=(-not[bool]$Execute);removed=$removed;removed_count=$removed.Count;reclaimed_bytes=$reclaimed}
  $null=Write-SoknaArtifactAudit -Event ([ordered]@{action='artifact.cleanup';phase='completed';ok=$true;dry_run=$result.dry_run;removed=$result.removed_count;reclaimed_bytes=$reclaimed}) -Required
  return $result
}

Export-ModuleMember -Function Initialize-SoknaArtifactRoot,Get-SoknaArtifactRoot,Get-SoknaArtifactDirectory,Get-SoknaArtifactRootStatus,Get-SoknaArtifactPolicy,Get-SoknaArtifactAuditPath,Write-SoknaArtifactAudit,Resolve-SoknaManagedArtifactPath,Import-SoknaLocalArtifact,New-SoknaArtifactStage,Invoke-SoknaArtifactCleanup,Set-SoknaArtifactMetadata,Update-SoknaArtifactMetadataState,Measure-SoknaArtifactTreeBytes
