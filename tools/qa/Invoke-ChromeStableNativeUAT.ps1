#requires -Version 5.1
# Disposable Windows Server Chrome Stable branded integration. Never operator devices.
param([Parameter(Mandatory=$true)][string]$SetupPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or -not $env:RUNNER_TEMP){
  throw 'STABLE_BRANDED_UAT_DISPOSABLE_GITHUB_WINDOWS_ONLY'
}
$setup=[IO.Path]::GetFullPath($SetupPath)
if(-not(Test-Path -LiteralPath $setup -PathType Leaf)){throw 'STABLE_UAT_SETUP_MISSING'}
$root=Join-Path $env:RUNNER_TEMP 'SOKNA-Bridge-Chrome-Stable-UAT'
$install=Join-Path $root 'app'
$artifacts=Join-Path $root 'external-data'
$profile=Join-Path $root 'chrome-stable-isolated-profile'
$logs=Join-Path $root 'logs'
$evidence=Join-Path $root 'chrome-stable-evidence.json'
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.sokna.bridge.v3'
foreach($p in @($root,$artifacts,$logs)){New-Item -ItemType Directory -Path $p -Force|Out-Null}
if(Test-Path -LiteralPath $install){throw 'STABLE_UAT_INSTALL_ALREADY_EXISTS'}
if(Test-Path -LiteralPath $key){throw 'STABLE_UAT_EXISTING_NATIVE_REGISTRATION_REFUSED'}
$pf86=[Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$paths=@()
if($env:ProgramFiles){$paths+=(Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')}
if($pf86){$paths+=(Join-Path $pf86 'Google\Chrome\Application\chrome.exe')}
if($env:LOCALAPPDATA){$paths+=(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')}
$chrome=$paths|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}|Select-Object -First 1
if([string]::IsNullOrWhiteSpace($chrome)){throw 'BRANDED_CHROME_STABLE_NOT_INSTALLED_ON_RUNNER'}
$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($chrome)
if($version.FileMajorPart -lt 137){throw 'BRANDED_CHROME_VERSION_LT_137_DOES_NOT_PROVE_NEW_LOADING'}
Write-Host ('BRANDED_CHROME_STABLE_INSTALLED_MAJOR='+$version.FileMajorPart)
function Run-Setup([string]$binary,[string[]]$launchArguments,[string]$purpose){
  $process=Start-Process -FilePath $binary -ArgumentList $launchArguments -PassThru -WindowStyle Hidden
  if($null-eq$process){throw ('STABLE_SETUP_START_FAILED_'+$purpose)}
  try{
    if(-not $process.WaitForExit(180000)){
      try{$process.Kill()}catch{}
      throw ('STABLE_SETUP_TIMEOUT_'+$purpose)
    }
    if($process.ExitCode -ne 0){throw ('STABLE_SETUP_EXIT_'+$purpose+'_'+$process.ExitCode)}
  }finally{$process.Dispose()}
}
$installed=$false
try{
  $argsInno=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',
    ('/DIR="'+$install+'"'),('/ArtifactRoot="'+$artifacts+'"'),'/TASKS=""',
    ('/LOG="'+(Join-Path $logs 'setup.log')+'"'))
  Run-Setup $setup $argsInno 'install'
  $installed=$true
  $hostManifest=Join-Path $install 'native-host\com.sokna.bridge.v3.json'
  $extension=Join-Path $install 'extension'
  if(-not(Test-Path -LiteralPath $hostManifest -PathType Leaf) -or -not(Test-Path -LiteralPath (Join-Path $extension 'manifest.json') -PathType Leaf)){
    throw 'STABLE_NATIVE_OR_EXTENSION_INSTALL_MISSING'
  }
  if(-not(Test-Path -LiteralPath $key)){throw 'STABLE_CHROME_NATIVE_HOST_REGISTRY_MISSING'}
  $registered=[string](Get-Item -LiteralPath $key).GetValue('')
  if(-not [string]::Equals([IO.Path]::GetFullPath($registered),[IO.Path]::GetFullPath($hostManifest),[StringComparison]::OrdinalIgnoreCase)){
    throw 'STABLE_HOST_REGISTRY_PATH_MISMATCH'
  }
  Write-Host 'STABLE_CHROME_HOST_INSTALLED_REGISTRATION_PASS'
  & node ./tools/qa/chrome_stable_pipe_native_uat.mjs --chrome $chrome --extension $extension --host-manifest $hostManifest --profile $profile --evidence $evidence
  if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $evidence -PathType Leaf)){
    throw 'STABLE_CHROME_NATIVE_E2E_FAILED'
  }
  Write-Host 'STABLE_BRANDED_CHROME_PIPE_TEST_VERIFIED_PASS'
}finally{
  if($installed){
    $uninstall=Join-Path $install 'unins000.exe'
    if(Test-Path -LiteralPath $uninstall -PathType Leaf){
      try{
        Run-Setup $uninstall @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',
          ('/LOG="'+(Join-Path $logs 'uninstall.log')+'"')) 'uninstall'
        Write-Host 'STABLE_CHROME_UAT_UNINSTALL_PASS'
      }catch{Write-Host 'STABLE_CHROME_UAT_UNINSTALL_CLEANUP_FAILED'}
    }
  }
  if(Test-Path -LiteralPath $key){Write-Host 'STABLE_CHROME_UAT_NATIVE_REGISTRY_LEFT_BY_UNINSTALL'}
}
