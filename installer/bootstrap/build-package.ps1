param([string]$OutDir="dist",[string]$AgentVersion="2.5.6")
$ErrorActionPreference="Stop"
$Repo=(Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$Stage=Join-Path $Repo "$OutDir/SOKNA-Bridge-Setup"
$Payload=Join-Path $Stage "payload"
Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Payload -Force|Out-Null
Copy-Item (Join-Path $PSScriptRoot "install.ps1") $Stage -Force
Copy-Item (Join-Path $PSScriptRoot "README.txt") $Stage -Force
Copy-Item (Join-Path $PSScriptRoot "INSTALL.cmd") $Stage -Force
Copy-Item (Join-Path $PSScriptRoot "HEALTH.cmd") $Stage -Force
Copy-Item (Join-Path $PSScriptRoot "UNINSTALL.cmd") $Stage -Force
$AgentRuntime=Join-Path $Repo ("native/runtime/v"+$AgentVersion)
Copy-Item (Join-Path $AgentRuntime "agent.ps1") (Join-Path $Payload "agent.ps1") -Force
Copy-Item (Join-Path $AgentRuntime "AGENT_CAPABILITIES.json") (Join-Path $Payload "AGENT_CAPABILITIES.json") -Force
Copy-Item (Join-Path $Repo "extension/chrome") (Join-Path $Payload "extension") -Recurse -Force
$hostOut=Join-Path $Payload "sokna-bridge-native-host.exe"
Push-Location (Join-Path $Repo "native/host")
try {
  & go build -trimpath -o $hostOut main.go
  if($LASTEXITCODE -ne 0){throw "Native host build failed"}
} finally { Pop-Location }
$zip=Join-Path $Repo "$OutDir/SOKNA-Bridge-Setup.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $zip -CompressionLevel Optimal
$sha=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[ordered]@{ok=$true;zip=$zip;sha256=$sha;agent=$AgentVersion;extension=[string]((Get-Content (Join-Path $Repo "extension/chrome/manifest.json") -Raw -Encoding UTF8|ConvertFrom-Json).version)}|ConvertTo-Json
