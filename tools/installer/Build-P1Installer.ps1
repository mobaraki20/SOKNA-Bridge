param(
  [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Configuration='Release',
  [string]$InnoCompiler='',
  [string]$ExpectedSourceCommit='',
  [switch]$SkipInno,
  [switch]$AllowDirtyDevelopment
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name){if(-not(Get-Command $Name -ErrorAction SilentlyContinue)){throw "MISSING_TOOL: $Name"}}
function Sha([string]$Path){return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()}
function Copy-Tree([string]$Source,[string]$Destination){if(Test-Path $Destination){Remove-Item $Destination -Recurse -Force};New-Item -ItemType Directory -Path $Destination -Force|Out-Null;Copy-Item (Join-Path $Source '*') $Destination -Recurse -Force}

Require-Command dotnet
Require-Command go
Require-Command git
$sourceCommitOut=@(& git -C $RepoRoot rev-parse HEAD);if($LASTEXITCODE-ne0){throw 'GIT_HEAD_FAILED'};$sourceCommit=(($sourceCommitOut-join"`n").Trim())
if(-not[string]::IsNullOrWhiteSpace($ExpectedSourceCommit)-and-not[string]::Equals($sourceCommit,$ExpectedSourceCommit.Trim(),[StringComparison]::OrdinalIgnoreCase)){throw ('SOURCE_COMMIT_MISMATCH: expected='+$ExpectedSourceCommit+' actual='+$sourceCommit)}
$dirty=@(& git -C $RepoRoot status --porcelain --untracked-files=all)
if($LASTEXITCODE-ne0){throw 'GIT_STATUS_FAILED'}
if($dirty.Count -gt 0 -and -not $AllowDirtyDevelopment){throw ('DIRTY_SOURCE_NOT_REPRODUCIBLE: '+(($dirty -join '; ')))}
$payload=Join-Path $RepoRoot 'artifacts\windows\installer-payload'
$setupOut=Join-Path $RepoRoot 'artifacts\windows\setup'
if(Test-Path $payload){Remove-Item $payload -Recurse -Force}
New-Item -ItemType Directory -Path $payload -Force|Out-Null
New-Item -ItemType Directory -Path $setupOut -Force|Out-Null

$maintenanceOut=Join-Path $payload '.build-maintenance'
$launcherOut=Join-Path $payload '.build-launcher'
& dotnet publish (Join-Path $RepoRoot 'maintenance\Sokna.Agent.Maintenance\Sokna.Agent.Maintenance.csproj') -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -o $maintenanceOut
if($LASTEXITCODE-ne0){throw 'DOTNET_MAINTENANCE_PUBLISH_FAILED'}
& dotnet publish (Join-Path $RepoRoot 'maintenance\Sokna.Agent.Launcher\Sokna.Agent.Launcher.csproj') -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -o $launcherOut
if($LASTEXITCODE-ne0){throw 'DOTNET_LAUNCHER_PUBLISH_FAILED'}
Copy-Item (Join-Path $maintenanceOut 'Sokna.Agent.Maintenance.exe') (Join-Path $payload 'Sokna.Agent.Maintenance.exe') -Force
Copy-Item (Join-Path $launcherOut 'Sokna.Agent.Launcher.exe') (Join-Path $payload 'Sokna.Agent.Launcher.exe') -Force
Remove-Item $maintenanceOut,$launcherOut -Recurse -Force

$runtimeDest=Join-Path $payload 'runtime';Copy-Tree (Join-Path $RepoRoot 'native\runtime\v2.6.1') $runtimeDest
$extensionDest=Join-Path $payload 'extension';Copy-Tree (Join-Path $RepoRoot 'extension\chrome') $extensionDest
$hostDest=Join-Path $payload 'native-host';New-Item -ItemType Directory -Path $hostDest -Force|Out-Null
Push-Location (Join-Path $RepoRoot 'native\host')
try{& go build -trimpath -o (Join-Path $hostDest 'sokna-bridge-native-host.exe') .;if($LASTEXITCODE-ne0){throw 'GO_NATIVE_HOST_BUILD_FAILED'}}finally{Pop-Location}

$browserDest=Join-Path $payload 'browser';New-Item -ItemType Directory -Path $browserDest -Force|Out-Null
Push-Location (Join-Path $RepoRoot 'native\browser')
try{
  & go test ./...
  if($LASTEXITCODE-ne0){throw 'GO_BROWSER_QA_TEST_FAILED'}
  & go build -trimpath -o (Join-Path $browserDest 'sokna-browser-qa.exe') .
  if($LASTEXITCODE-ne0){throw 'GO_BROWSER_QA_BUILD_FAILED'}
}finally{Pop-Location}

$providerDest=Join-Path $payload 'provider';New-Item -ItemType Directory -Path $providerDest -Force|Out-Null
Push-Location (Join-Path $RepoRoot 'native\provider')
try{
  & go test ./...
  if($LASTEXITCODE-ne0){throw 'GO_ARTIFACT_PROVIDER_TEST_FAILED'}
  & go build -trimpath -o (Join-Path $providerDest 'sokna-artifact-provider.exe') .
  if($LASTEXITCODE-ne0){throw 'GO_ARTIFACT_PROVIDER_BUILD_FAILED'}
}finally{Pop-Location}

$files=@(Get-ChildItem $payload -File -Recurse|Where-Object{$_.Name-ne'installed-manifest.json'}|ForEach-Object{
  $rel=$_.FullName.Substring($payload.Length).TrimStart('\').Replace('\','/')
  $owner=if($rel.StartsWith('runtime/',[StringComparison]::OrdinalIgnoreCase)){'maintenance'}else{'installer'};[ordered]@{path=$rel;sha256=(Sha $_.FullName);bytes=$_.Length;owner=$owner}
}|Sort-Object path)
$manifest=[ordered]@{schema='sokna-agent-install-manifest-v1';product_version='2.6.1';launcher_version='1.0.0';source_commit=$sourceCommit;files=$files}
$manifestDir=Join-Path $payload 'manifests';New-Item -ItemType Directory -Path $manifestDir -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $manifestDir 'installed-manifest.json'),($manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))

if(-not$SkipInno){
  $isccPath=''
  if(-not[string]::IsNullOrWhiteSpace($InnoCompiler)){if(-not(Test-Path $InnoCompiler -PathType Leaf)){throw "INNO_COMPILER_NOT_FOUND: $InnoCompiler"};$isccPath=(Resolve-Path $InnoCompiler).Path}
  if([string]::IsNullOrWhiteSpace($isccPath)){$cmd=Get-Command ISCC.exe -ErrorAction SilentlyContinue;if($cmd){$isccPath=$cmd.Source}}
  if([string]::IsNullOrWhiteSpace($isccPath)){$candidates=@("$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe","$env:ProgramFiles\Inno Setup 7\ISCC.exe","$env:LOCALAPPDATA\Programs\Inno Setup 7\ISCC.exe");$isccPath=$candidates|Where-Object{$_-and(Test-Path $_)}|Select-Object -First 1}
  if([string]::IsNullOrWhiteSpace($isccPath)){throw 'MISSING_TOOL: ISCC.exe'}
  & $isccPath (Join-Path $RepoRoot 'installer\windows\SOKNA.Agent.iss')
  if($LASTEXITCODE-ne0){throw 'INNO_COMPILE_FAILED'}
}
[ordered]@{ok=$true;payload=$payload;setup_output=$setupOut;files=$files.Count;source_commit=$sourceCommit;inno_skipped=[bool]$SkipInno}|ConvertTo-Json -Compress
