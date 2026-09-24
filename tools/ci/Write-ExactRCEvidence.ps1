param(
  [Parameter(Mandatory=$true)][string]$SourceManifestPath,
  [Parameter(Mandatory=$true)][string]$SourceBundlePath,
  [Parameter(Mandatory=$true)][string]$SetupPath,
  [Parameter(Mandatory=$true)][string]$PayloadManifestPath,
  [Parameter(Mandatory=$true)][ValidateSet('passed')][string]$AcceptanceStatus,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Sha([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw "EVIDENCE_FILE_MISSING: $p"};return(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant()}
$head=(& git rev-parse HEAD).Trim();if($LASTEXITCODE-ne0){throw'GIT_HEAD_FAILED'}
$source=Get-Content -LiteralPath $SourceManifestPath -Raw -Encoding UTF8|ConvertFrom-Json
if([string]$source.source_commit-ne$head){throw "EXACT_RC_SOURCE_COMMIT_MISMATCH: manifest=$($source.source_commit) head=$head"}
$payload=Get-Content -LiteralPath $PayloadManifestPath -Raw -Encoding UTF8|ConvertFrom-Json
if([string]$payload.source_commit-ne$head){throw "EXACT_RC_PAYLOAD_COMMIT_MISMATCH: payload=$($payload.source_commit) head=$head"}
$ext=Get-Content -LiteralPath 'extension/chrome/manifest.json' -Raw -Encoding UTF8|ConvertFrom-Json
$caps=Get-Content -LiteralPath 'native/runtime/v2.6.0/AGENT_CAPABILITIES.json' -Raw -Encoding UTF8|ConvertFrom-Json
$payloadRoot=Split-Path -Parent (Split-Path -Parent ([IO.Path]::GetFullPath($PayloadManifestPath)))
$browser=Join-Path $payloadRoot 'browser\sokna-browser-qa.exe';$provider=Join-Path $payloadRoot 'provider\sokna-artifact-provider.exe'
$out=[ordered]@{
 schema='sokna-exact-rc-windows-evidence-v1';source_commit=$head;candidate_ref=[string]$source.candidate_ref;profile='full';acceptance=$AcceptanceStatus
 source_bundle_sha256=(Sha $SourceBundlePath);source_manifest_sha256=(Sha $SourceManifestPath);setup_sha256=(Sha $SetupPath);payload_manifest_sha256=(Sha $PayloadManifestPath)
 browser_runner_sha256=(Sha $browser);artifact_provider_runner_sha256=(Sha $provider)
 candidate_agent_version=[string]$caps.agent;extension_version=[string]$ext.version;windows_runner='windows-2025';dotnet='8.0.x';inno_setup='Tools.InnoSetup 6.7.3'
 exact_source_verified=$true;whole_product_acceptance_passed=$true;home_pc_touched=$false
 generated_at=(Get-Date).ToUniversalTime().ToString('o')
}
$dir=Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath));New-Item -ItemType Directory -Path $dir -Force|Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath),($out|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$out|ConvertTo-Json -Compress
