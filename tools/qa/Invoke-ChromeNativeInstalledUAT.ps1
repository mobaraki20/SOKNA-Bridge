param([Parameter(Mandatory=$true)][string]$SetupPath)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP){
  throw 'ONLY_DISPOSABLE_GITHUB_WINDOWS_RUNNER'
}
$setup=[IO.Path]::GetFullPath($SetupPath)
if(-not(Test-Path -LiteralPath $setup -PathType Leaf)){throw 'SETUP_NOT_FOUND'}
$root=Join-Path $env:RUNNER_TEMP 'SOKNA-Bridge-Chrome-Installed-UAT'
$install=Join-Path $root 'Installed Bridge App'
$profile=Join-Path $root 'Chrome-For-Testing-Profile'
$cft=Join-Path $root 'Chrome-For-Testing'
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.sokna.bridge.v3'
$installed=$false;$browserProcess=$null
New-Item -ItemType Directory -Force -Path $root,$cft|Out-Null
if(Test-Path -LiteralPath $key){throw 'REFUSING_EXISTING_CHROME_NATIVE_REGISTRATION'}
if(Test-Path -LiteralPath $install){throw 'REFUSING_EXISTING_INSTALL_ROOT'}
function Run-Setup([string]$exe,[string[]]$setupArguments,[string]$stage){
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$exe;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  # Inno parses command line as a string: quote paths containing spaces.
  $psi.Arguments=[string]::Join(' ',$setupArguments)
  $p=[Diagnostics.Process]::Start($psi)
  if($null-eq$p){throw "SETUP_START_FAILED_$stage"}
  try{
    if(-not $p.WaitForExit(180000)){$p.Kill();throw "SETUP_TIMEOUT_$stage"}
    if($p.ExitCode -ne 0){throw "SETUP_NONZERO_$stage"}
  }finally{$p.Dispose()}
}
try{
  # Chrome 137+ branded builds do not honor --load-extension.
  # Official Google Chrome for Testing still supports that test workflow.
  $info=Invoke-RestMethod -Uri 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' -TimeoutSec 40
  $items=@($info.channels.Stable.downloads.chrome|Where-Object{$_.platform -eq 'win64'})
  if($items.Count -ne 1){throw 'CHROME_FOR_TESTING_WIN64_MISSING'}
  $url=[string]$items[0].url
  if(-not $url.StartsWith('https://storage.googleapis.com/chrome-for-testing-public/',[StringComparison]::Ordinal)){throw 'UNTRUSTED_CHROME_DOWNLOAD_URL'}
  $archive=Join-Path $root 'chrome-for-testing.zip'
  Invoke-WebRequest -Uri $url -OutFile $archive -TimeoutSec 240
  $archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Expand-Archive -LiteralPath $archive -DestinationPath $cft
  $chrome=Join-Path $cft 'chrome-win64\chrome.exe'
  if(-not(Test-Path -LiteralPath $chrome -PathType Leaf)){throw 'CHROME_FOR_TESTING_EXE_MISSING'}
  Write-Host "OFFICIAL_CHROME_FOR_TESTING version=$($info.channels.Stable.version) zip_sha256=$archiveHash"
  $log=Join-Path $root 'inno-install.log'
  $installArgs=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NOICONS',
     ('/DIR="'+$install+'"'),('/LOG="'+$log+'"'))
  Run-Setup $setup $installArgs 'INSTALL'
  $installed=$true
  $ext=Join-Path $install 'extension'
  $nativeHostManifest=Join-Path $install 'native-host\com.sokna.bridge.v3.json'
  if(-not(Test-Path -LiteralPath (Join-Path $ext 'manifest.json') -PathType Leaf)){throw 'INSTALLED_EXTENSION_NOT_FOUND'}
  if(-not(Test-Path -LiteralPath $nativeHostManifest -PathType Leaf)){throw 'INSTALLED_HOST_MANIFEST_NOT_FOUND'}
  $registryValue=[string](Get-Item -LiteralPath $key -ErrorAction Stop).GetValue('')
  if([IO.Path]::GetFullPath($registryValue) -ne [IO.Path]::GetFullPath($nativeHostManifest)){throw 'INSTALLER_CHROME_REGISTRY_MISMATCH'}
  Write-Host 'REAL_INNO_INSTALLED_CHROME_HOST_REGISTRATION_PASS'
  New-Item -ItemType Directory -Force -Path $profile|Out-Null
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$chrome;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($a in @('--headless=new','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-sync','--remote-debugging-port=0',
    ('--user-data-dir='+$profile),('--disable-extensions-except='+$ext),
    ('--load-extension='+$ext),'about:blank')){
    [void]$psi.ArgumentList.Add($a)
  }
  $browserProcess=[Diagnostics.Process]::Start($psi)
  if($null-eq$browserProcess){throw 'CHROME_PROCESS_START_FAILED'}
  $evidence=Join-Path $root 'chrome-native-evidence.json'
  & node ./tools/qa/chrome_native_installed_uat.mjs --profile $profile --extension $ext --host-manifest $nativeHostManifest --evidence $evidence
  if($LASTEXITCODE -ne 0){throw 'CHROME_BROWSER_NATIVE_UAT_FAILED'}
  if(-not(Test-Path -LiteralPath $evidence -PathType Leaf)){throw 'CHROME_NATIVE_EVIDENCE_MISSING'}
}finally{
  if($null-ne$browserProcess){
    try{if(-not $browserProcess.HasExited){& taskkill.exe /PID $browserProcess.Id /T /F 2>$null|Out-Null}}catch{Write-Host 'CHROME_TEST_CLEANUP_ATTEMPTED'}
    $browserProcess.Dispose()
  }
  if($installed){
    $uninstall=Join-Path $install 'unins000.exe'
    if(Test-Path -LiteralPath $uninstall -PathType Leaf){
      try{Run-Setup $uninstall @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',
        ('/LOG="'+(Join-Path $root 'inno-uninstall.log')+'"')) 'UNINSTALL'
        Write-Host 'CHROME_QA_UNINSTALL_PASS'
      }catch{Write-Host 'CHROME_QA_UNINSTALL_CLEANUP_FAILED'}
    }
  }
  if(Test-Path -LiteralPath $key){
    try{Remove-Item -LiteralPath $key -Force}catch{Write-Host 'CHROME_QA_REGISTRY_CLEANUP_FAILED'}
  }
}