#requires -Version 5.1
# Read-only Win10 x64 Chrome operator UAT preparation. Never edits browser, registry or data.
[CmdletBinding()]
param(
  [ValidateSet('Preflight','Installed')][string]$Phase='Preflight',
  [string]$CandidateDirectory=$PSScriptRoot,
  [string]$OutputPath=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$passed=New-Object 'System.Collections.Generic.List[string]'
function Pass([string]$name){$script:passed.Add($name);Write-Host ($name+'_PASS')}
function Require([bool]$ok,[string]$reason){if(-not$ok){throw $reason}}
function Hash([string]$path){return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Canon([string]$path){return [IO.Path]::GetFullPath($path)}
function Same([string]$a,[string]$b){return [string]::Equals($a,$b,[StringComparison]::OrdinalIgnoreCase)}
function ExtensionId([string]$key){
  $bytes=[Convert]::FromBase64String($key)
  Require ($bytes.Length -ge 128) 'EXTENSION_PUBLIC_KEY_INVALID'
  $s=[Security.Cryptography.SHA256]::Create()
  try{$digest=$s.ComputeHash($bytes)}finally{$s.Dispose()}
  $abc='abcdefghijklmnop';$id=''
  foreach($n in $digest[0..15]){$id+=$abc[[int]($n -shr 4)]+$abc[[int]($n -band 15)]}
  return $id
}
try{
  $os=Get-CimInstance Win32_OperatingSystem
  $build=[int]$os.BuildNumber
  Require ([int]$os.ProductType -eq 1 -and $build -ge 10240 -and $build -lt 22000) 'WIN10_CLIENT_REQUIRED'
  Require ([string]$os.OSArchitecture -match '64' -and $env:PROCESSOR_ARCHITECTURE -eq 'AMD64') 'WIN10_X64_REQUIRED'
  Pass 'WIN10_CLIENT_X64'
  $dir=Canon $CandidateDirectory
  $provPath=Join-Path $dir 'candidate-provenance.json'
  Require (Test-Path -LiteralPath $provPath -PathType Leaf) 'CANDIDATE_PROVENANCE_NOT_FOUND'
  $p=Get-Content -LiteralPath $provPath -Raw -Encoding UTF8|ConvertFrom-Json
  Require ([string]$p.schema -eq 'sokna-bridge-win10-chrome-operator-candidate-v1') 'CANDIDATE_PROVENANCE_INVALID'
  Require ([string]$p.release_status -eq 'DRAFT_TEST_ONLY') 'CANDIDATE_NOT_TEST_ONLY'
  Require ([string]$p.source_commit -match '^[0-9a-f]{40}$') 'SOURCE_COMMIT_MISSING'
  Require ([string]$p.installer_sha256 -match '^[0-9a-f]{64}$') 'EXPECTED_SHA256_MISSING'
  $setup=Join-Path $dir 'SOKNA-Bridge-Setup-2.7.1-x64.exe'
  Require (Test-Path -LiteralPath $setup -PathType Leaf) 'INSTALLER_NOT_FOUND'
  Require ((Hash $setup) -eq [string]$p.installer_sha256) 'INSTALLER_SHA256_MISMATCH'
  Pass 'CANDIDATE_SHA256_INTEGRITY'
  $chromePaths=@()
  $pf86=[Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  if($env:LOCALAPPDATA){$chromePaths+=(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')}
  if($env:ProgramFiles){$chromePaths+=(Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')}
  if($pf86){$chromePaths+=(Join-Path $pf86 'Google\Chrome\Application\chrome.exe')}
  $chrome=$chromePaths|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}|Select-Object -First 1
  Require (-not[string]::IsNullOrWhiteSpace($chrome)) 'GOOGLE_CHROME_STABLE_NOT_INSTALLED'
  $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($chrome)
  Require ($version.FileMajorPart -ge 111) 'CHROME_VERSION_TOO_OLD'
  Pass 'GOOGLE_CHROME_STABLE_AVAILABLE'
  $result=[ordered]@{
    schema='sokna-bridge-win10-operator-readonly-v1';phase=$Phase
    os='Windows 10 client x64';os_build=$build;chrome_major=$version.FileMajorPart
    candidate_source_commit=[string]$p.source_commit;installer_sha256=[string]$p.installer_sha256
    read_only_checks=@();manual_chrome_extension_loaded='NOT_RUN'
    native_messaging_browser_roundtrip='NOT_RUN';chrome_permissions_ui='NOT_RUN'
    release_ready=$false
  }
  if($Phase -eq 'Installed'){
    $key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.sokna.bridge.v3'
    Require (Test-Path -LiteralPath $key) 'NATIVE_HOST_REGISTRY_MISSING'
    $hPath=[string](Get-Item -LiteralPath $key).GetValue('')
    Require (Test-Path -LiteralPath $hPath -PathType Leaf) 'NATIVE_HOST_MANIFEST_MISSING'
    $nativeHost=Get-Content -LiteralPath $hPath -Raw -Encoding UTF8|ConvertFrom-Json
    Require ([string]$nativeHost.name -eq 'com.sokna.bridge.v3') 'NATIVE_HOST_ID_WRONG'
    $nativeDir=Split-Path -Parent (Canon $hPath)
    $root=Split-Path -Parent $nativeDir
    $nativeExe=Join-Path $nativeDir 'sokna-bridge-native-host.exe'
    Require (Same (Canon ([string]$nativeHost.path)) (Canon $nativeExe)) 'NATIVE_HOST_PATH_WRONG'
    Require (Test-Path -LiteralPath $nativeExe -PathType Leaf) 'NATIVE_HOST_EXE_MISSING'
    $installedManifest=Join-Path $root 'manifests\installed-manifest.json'
    $extensionFile=Join-Path $root 'extension\manifest.json'
    Require (Test-Path -LiteralPath $installedManifest -PathType Leaf) 'INSTALLED_MANIFEST_MISSING'
    Require (Test-Path -LiteralPath $extensionFile -PathType Leaf) 'INSTALLED_EXTENSION_MISSING'
    $m=Get-Content -LiteralPath $installedManifest -Raw -Encoding UTF8|ConvertFrom-Json
    Require ([string]$m.product_version -eq '2.7.1') 'INSTALLED_PRODUCT_VERSION_WRONG'
    Require ([string]$m.source_commit -eq [string]$p.source_commit) 'INSTALLED_SOURCE_COMMIT_WRONG'
    foreach($relative in @('native-host/sokna-bridge-native-host.exe','extension/manifest.json')){
      $matching=@($m.files|Where-Object{$_.path -eq $relative})
      Require ($matching.Count -eq 1) 'MANIFEST_REQUIRED_ENTRY_MISSING'
      Require ((Hash (Join-Path $root ($relative.Replace('/','\')))) -eq [string]$matching[0].sha256) 'INSTALLED_OWNED_HASH_MISMATCH'
    }
    $ext=Get-Content -LiteralPath $extensionFile -Raw -Encoding UTF8|ConvertFrom-Json
    $id=ExtensionId ([string]$ext.key)
    Require ([string]$ext.version -eq '3.14.2') 'EXTENSION_VERSION_WRONG'
    Require (@($ext.permissions) -contains 'nativeMessaging') 'EXTENSION_NATIVE_PERMISSION_MISSING'
    Require (@($nativeHost.allowed_origins).Count -eq 1 -and [string]$nativeHost.allowed_origins[0] -eq ('chrome-extension://'+$id+'/')) 'NATIVE_ALLOWED_ORIGIN_WRONG'
    Pass 'INSTALLED_NATIVE_HOST_AND_EXTENSION'
    $result.extension_id=$id
    $result.extension_version=[string]$ext.version
    $result.native_host_registration='READ_ONLY_VERIFIED'
    $result.selftest_url='chrome-extension://'+$id+'/selftest.html'
  }
  $result.read_only_checks=@($passed.ToArray())
  if($OutputPath){
    $out=Canon $OutputPath
    Require (-not(Test-Path -LiteralPath $out)) 'EVIDENCE_ALREADY_EXISTS_REFUSE_OVERWRITE'
    Require (Test-Path -LiteralPath (Split-Path -Parent $out) -PathType Container) 'EVIDENCE_PARENT_NOT_FOUND'
    [IO.File]::WriteAllText($out,($result|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
    Write-Host 'NON_SENSITIVE_READONLY_EVIDENCE_CREATED'
  }
  Write-Host 'WIN10_CHROME_OPERATOR_PREFLIGHT_PASS'
  Write-Host 'MANUAL_CHROME_NATIVE_PROOF_NOT_RUN'
  if($Phase -eq 'Installed'){Write-Host ('SELFTEST_URL='+$result.selftest_url)}
}catch{
  Write-Host ('WIN10_OPERATOR_CHECK_FAILED: '+[string]$_.Exception.Message)
  exit 10
}
