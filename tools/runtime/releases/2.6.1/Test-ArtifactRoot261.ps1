$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$module=Join-Path $repo 'native\runtime\v2.6.1\Sokna.ArtifactRoot.psm1'
Import-Module $module -Force
$root=Join-Path $env:TEMP ('sokna-artifact-root-261-'+[Guid]::NewGuid().ToString('N'))
$outside=Join-Path $env:TEMP ('sokna-artifact-outside-261-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $outside -Force|Out-Null
try{
  $cfg=[pscustomobject]@{
    artifact_root=$root
    artifact_policy=[pscustomobject]@{
      max_root_bytes=[int64](16MB)
      max_artifact_bytes=[int64](4MB)
      retention=[pscustomobject]@{incoming_days=7;staging_hours=1;accepted_days=30;failed_days=14;cache_days=1;browser_days=30}
    }
  }
  $status=Initialize-SoknaArtifactRoot -Config $cfg -RuntimeRoot $repo
  foreach($name in @('incoming','staging','accepted','failed','cache','browser','logs')){if(-not(Test-Path (Join-Path $root $name) -PathType Container)){throw ('MANAGED_DIR_MISSING_'+$name)}}
  if([int64]$status.quota_bytes-ne16MB){throw 'QUOTA_STATUS_MISMATCH'}

  $escaped=$false
  try{$null=Resolve-SoknaManagedArtifactPath -Path '..\outside.txt' -AllowMissing}catch{$escaped=$true}
  if(-not$escaped){throw 'TRAVERSAL_NOT_BLOCKED'}

  $source=Join-Path $outside 'source.zip';[IO.File]::WriteAllText($source,'artifact-261',[Text.UTF8Encoding]::new($false))
  $expected=(Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
  $import=Import-SoknaLocalArtifact -SourcePath $source -ArtifactId 'win261-import-1' -ExpectedSha256 $expected -ContentType 'application/zip'
  if(-not$import.ok -or $import.sha256-ne$expected){throw 'IMPORT_HASH_OR_RESULT'}
  if(-not(Test-Path $import.absolute_path -PathType Leaf)){throw 'IMPORT_FILE_MISSING'}
  if(-not(Test-Path $import.metadata -PathType Leaf)){throw 'IMPORT_METADATA_MISSING'}
  $audit=Get-SoknaArtifactAuditPath
  if((Get-Content $audit -Raw)-notmatch 'artifact.import.local'){throw 'IMPORT_AUDIT_MISSING'}

  $badSource=Join-Path $outside 'bad.zip';[IO.File]::WriteAllText($badSource,'bad-hash',[Text.UTF8Encoding]::new($false))
  $hashRejected=$false
  try{$null=Import-SoknaLocalArtifact -SourcePath $badSource -ArtifactId 'win261-badhash-1' -ExpectedSha256 ('0'*64)}catch{if($_.Exception.Message-match'ARTIFACT_SHA256_MISMATCH'){$hashRejected=$true}}
  if(-not$hashRejected){throw 'HASH_MISMATCH_NOT_BLOCKED'}

  $oldCache=Join-Path $root 'cache\old.bin';[IO.File]::WriteAllText($oldCache,'old',[Text.UTF8Encoding]::new($false));(Get-Item $oldCache).LastWriteTimeUtc=[DateTime]::UtcNow.AddDays(-2)
  $partial=Join-Path $root 'staging\.partial-interrupted';[IO.File]::WriteAllText($partial,'partial',[Text.UTF8Encoding]::new($false));(Get-Item $partial).LastWriteTimeUtc=[DateTime]::UtcNow.AddHours(-2)
  $outsideKeep=Join-Path $outside 'keep.txt';[IO.File]::WriteAllText($outsideKeep,'keep',[Text.UTF8Encoding]::new($false));(Get-Item $outsideKeep).LastWriteTimeUtc=[DateTime]::UtcNow.AddDays(-10)
  $dry=Invoke-SoknaArtifactCleanup
  if(-not$dry.dry_run -or @($dry.removed).Count-lt2){throw 'CLEANUP_DRY_RUN_MISSING'}
  if(-not(Test-Path $oldCache) -or -not(Test-Path $partial)){throw 'DRY_RUN_MUTATED'}
  $clean=Invoke-SoknaArtifactCleanup -Execute
  if($clean.dry_run -or (Test-Path $oldCache) -or (Test-Path $partial)){throw 'RETENTION_CLEANUP_FAILED'}
  if(-not(Test-Path $outsideKeep)){throw 'OUTSIDE_ROOT_DELETE_DETECTED'}

  $junction=Join-Path $root 'incoming\escape-junction'
  $mk=& cmd.exe /c ('mklink /J "'+$junction+'" "'+$outside+'"') 2>&1
  if($LASTEXITCODE-ne0){throw ('JUNCTION_CREATE_FAILED: '+($mk-join' '))}
  try{
    $reparseBlocked=$false
    try{$null=Resolve-SoknaManagedArtifactPath -Path 'incoming\escape-junction\x.zip' -AllowMissing}catch{if($_.Exception.Message-match'REPARSE'){$reparseBlocked=$true}}
    if(-not$reparseBlocked){throw 'REPARSE_NOT_BLOCKED'}
  }finally{& cmd.exe /c ('rmdir "'+$junction+'"')|Out-Null}

  $quotaRoot=Join-Path $env:TEMP ('sokna-artifact-quota-261-'+[Guid]::NewGuid().ToString('N'))
  try{
    $qcfg=[pscustomobject]@{artifact_root=$quotaRoot;artifact_policy=[pscustomobject]@{max_root_bytes=[int64]128;max_artifact_bytes=[int64]128;retention=[pscustomobject]@{incoming_days=7;staging_hours=1;accepted_days=30;failed_days=14;cache_days=7;browser_days=30}}}
    $null=Initialize-SoknaArtifactRoot -Config $qcfg -RuntimeRoot $repo
    [IO.File]::WriteAllText((Join-Path $quotaRoot 'cache\prefill.bin'),('p'*96),[Text.UTF8Encoding]::new($false))
    $qsource=Join-Path $outside 'quota.bin';[IO.File]::WriteAllText($qsource,('q'*64),[Text.UTF8Encoding]::new($false))
    $quotaBlocked=$false
    try{$null=Import-SoknaLocalArtifact -SourcePath $qsource -ArtifactId 'win261-quota-1'}catch{if($_.Exception.Message-match'ARTIFACT_ROOT_QUOTA_EXCEEDED'){$quotaBlocked=$true}}
    if(-not$quotaBlocked){throw 'QUOTA_NOT_ENFORCED'}
  }finally{Remove-Item $quotaRoot -Recurse -Force -ErrorAction SilentlyContinue}

  [ordered]@{ok=$true;version='2.6.1';managed_dirs=$true;traversal=$true;reparse=$true;hash_rollback=$true;quota=$true;retention=$true;interrupted_transition=$true;outside_root_preserved=$true}|ConvertTo-Json -Compress
  Write-Host 'ARTIFACT_ROOT_261_WINDOWS_PASS'
}finally{
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $outside -Recurse -Force -ErrorAction SilentlyContinue
}
