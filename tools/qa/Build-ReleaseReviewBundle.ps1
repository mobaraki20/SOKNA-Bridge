#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$RepoRoot,
      [Parameter(Mandatory=$true)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP){
  throw 'RELEASE_REVIEW_DISPOSABLE_WINDOWS_ONLY'
}
$root=[IO.Path]::GetFullPath($RepoRoot)
$out=[IO.Path]::GetFullPath($OutputDirectory)
$runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'
if(-not $out.StartsWith($runner,[StringComparison]::OrdinalIgnoreCase)){
  throw 'RELEASE_REVIEW_OUTPUT_NOT_UNDER_RUNNER_TEMP'
}
if(Test-Path -LiteralPath $out){throw 'RELEASE_REVIEW_MUST_NOT_OVERWRITE_OUTPUT'}
function Hash([string]$path){return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
$sha=(& git -C $root rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $sha -notmatch '^[a-f0-9]{40}$'){throw 'RELEASE_REVIEW_INVALID_SOURCE_COMMIT'}
$setup=Join-Path $root 'artifacts/windows/setup/SOKNA-Bridge-Setup-2.7.1-x64.exe'
$payload=Join-Path $root 'artifacts/windows/installer-payload'
$manifestPath=Join-Path $payload 'manifests/installed-manifest.json'
$extension=Join-Path $payload 'extension'
foreach($path in @($setup,$manifestPath,(Join-Path $extension 'manifest.json'))){
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'RELEASE_REVIEW_SOURCE_ARTIFACT_MISSING'}
}
$mf=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8|ConvertFrom-Json
if([string]$mf.schema -ne 'sokna-agent-install-manifest-v1' -or
   [string]$mf.product_version -ne '2.7.1' -or
   [string]$mf.source_commit -ne $sha){throw 'RELEASE_REVIEW_SOURCE_MANIFEST_MISMATCH'}
$ext=Get-Content -LiteralPath (Join-Path $extension 'manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
if([string]$ext.version -ne '3.14.2' -or [int]$ext.manifest_version -ne 3){throw 'RELEASE_REVIEW_EXTENSION_VERSION_MISMATCH'}
$keyBytes=[Convert]::FromBase64String([string]$ext.key)
if($keyBytes.Length -lt 128){throw 'RELEASE_REVIEW_EXTENSION_PUBLIC_KEY_TOO_SHORT'}
$keyHash=[Security.Cryptography.SHA256]::Create().ComputeHash($keyBytes)
$alpha='abcdefghijklmnop'
$extId=-join @($keyHash[0..15]|ForEach-Object{([string]$alpha[($_ -shr 4)])+([string]$alpha[($_ -band 15)])})
if($extId -notmatch '^[a-p]{32}$'){throw 'RELEASE_REVIEW_EXTENSION_ID_INVALID'}
$relevant=@($mf.files|Where-Object{[string]$_.path -like 'extension/*'})
$actual=@(Get-ChildItem -LiteralPath $extension -Recurse -File)
if($relevant.Count -ne $actual.Count){throw 'RELEASE_REVIEW_EXTENSION_FILESET_DIFFERENT_FROM_INSTALLED_PAYLOAD'}
foreach($item in $relevant){
  $rel=[string]$item.path
  if($rel -notmatch '^extension/[A-Za-z0-9_./-]+$' -or $rel.Contains('..')){throw 'RELEASE_REVIEW_UNSAFE_PAYLOAD_ENTRY'}
  $source=Join-Path $payload ($rel.Replace('/','\'))
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'RELEASE_REVIEW_EXTENSION_FILE_MISSING'}
  if(-not[string]::Equals((Hash $source),[string]$item.sha256,[StringComparison]::OrdinalIgnoreCase) -or
      (Get-Item -LiteralPath $source).Length -ne [long]$item.bytes){throw ('RELEASE_REVIEW_EXTENSION_TAMPERED_'+$rel)}
}
Write-Host 'REVIEW_PAYLOAD_EXTENSION_HASHES_VERIFIED_PASS'
New-Item -ItemType Directory -Path $out -Force|Out-Null
$setupDest=Join-Path $out 'SOKNA-Bridge-Setup-2.7.1-x64.exe'
Copy-Item -LiteralPath $setup -Destination $setupDest
Copy-Item -LiteralPath $extension -Destination (Join-Path $out 'extension') -Recurse
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $out 'installed-manifest.json')
Copy-Item -LiteralPath (Join-Path $root 'docs/qa/CHROME_SECURITY_RELEASE_READINESS_FA.md') -Destination $out
Copy-Item -LiteralPath (Join-Path $root 'docs/qa/CHROME_DISTRIBUTION_REVIEW_FA.md') -Destination $out
Copy-Item -LiteralPath (Join-Path $root 'docs/qa/RELEASE_REVIEW_CANDIDATE_FA.md') -Destination $out
$signatures=[ordered]@{}
foreach($binary in @($setupDest, (Join-Path $payload 'Sokna.Agent.Maintenance.exe'),
  (Join-Path $payload 'Sokna.Agent.Launcher.exe'),(Join-Path $payload 'Sokna.Bridge.ControlCenter.exe'),
  (Join-Path $payload 'native-host/sokna-bridge-native-host.exe'))){
  if(-not(Test-Path -LiteralPath $binary -PathType Leaf)){throw 'RELEASE_REVIEW_BINARY_NOT_BUILT'}
  $signed=Get-AuthenticodeSignature -LiteralPath $binary
  $signatures[[IO.Path]::GetFileName($binary)]=[string]$signed.Status
}
$allSigned=(@($signatures.Values|Where-Object{$_ -ne 'Valid'}).Count -eq 0)
$provenance=[ordered]@{
  schema='sokna-bridge-release-review-candidate-v1'
  source_commit=$sha
  package_version='2.7.1'
  chrome_extension_version=[string]$ext.version
  extension_id=$extId
  build_environment='isolated GitHub Windows Server 2025'
  installer_sha256=(Hash $setupDest)
  installer_bytes=(Get-Item -LiteralPath $setupDest).Length
  verified_extension_files=$relevant.Count
  binaries_authenticode_status=$signatures
  all_binaries_authenticode_valid=$allSigned
  cryptographic_github_attestation='NOT_CREATED'
  chrome_stable_native_host_e2e='QUALIFIED_BY_SEPARATE_CI'
  chrome_manual_load_unpacked_persistence='NOT_RUN'
  physical_power_cut='NOT_RUN'
  third_party_privacy_assessment='NOT_RUN'
  owner_final_release_approval='NOT_GRANTED'
  release_ready=$false
  draft_for_engineering_review_only=$true
}
$provenancePath=Join-Path $out 'REVIEW_PROVENANCE.json'
[IO.File]::WriteAllText($provenancePath,($provenance|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
$checks=@(Get-ChildItem -LiteralPath $out -Recurse -File|Where-Object {$_.Name -ne 'SHA256SUMS.txt'}|
  ForEach-Object{
    $rel=$_.FullName.Substring($out.TrimEnd('\').Length+1).Replace('\','/')
    (Hash $_.FullName)+'  '+$rel
  }|Sort-Object)
[IO.File]::WriteAllLines((Join-Path $out 'SHA256SUMS.txt'),$checks,[Text.UTF8Encoding]::new($false))
if(-not(Test-Path -LiteralPath (Join-Path $out 'SHA256SUMS.txt'))){throw 'RELEASE_REVIEW_HASH_LIST_MISSING'}
Write-Host ('REVIEW_INSTALLER_SHA256_PASS hash='+(Hash $setupDest))
Write-Host ('REVIEW_BINARY_AUTHENTICODE_'+$(if($allSigned){'VALID'}else{'NOT_ALL_VALID'}))
Write-Host ('REVIEW_EXTENSION_ID='+$extId)
Write-Host 'RELEASE_REVIEW_BUNDLE_PREPARED_PASS'
Write-Host 'RELEASE_READY_FALSE_SIGNING_PRIVACY_CHROME_GUI_REVIEW'
