param(
  [string]$PackageRoot=$PSScriptRoot,
  [string]$InstallRoot="$env:LOCALAPPDATA\SOKNA-Bridge-V2"
)
$ErrorActionPreference='Stop'
$accept=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageRoot 'Acceptance-AgentRuntime257.ps1') -InstallRoot $InstallRoot
if($LASTEXITCODE-ne0){throw ('COMPLETE_ACCEPTANCE_PROCESS: '+($accept-join"`n"))}
$a=$accept|ConvertFrom-Json;if(-not$a.ok){throw ('COMPLETE_ACCEPTANCE_RESULT: '+($accept-join"`n"))}
$cleaned=@();foreach($name in @('a256.ps1','agent.ps1.next','AGENT_CAPABILITIES.json.next')){$path=Join-Path $InstallRoot $name;if(Test-Path $path -PathType Leaf){Remove-Item $path -Force;$cleaned+=$name}}
$final=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageRoot 'Finalize-RepoUpdate257.ps1') -PackageRoot $PackageRoot -InstallRoot $InstallRoot
if($LASTEXITCODE-ne0){throw ('COMPLETE_FINALIZE_PROCESS: '+($final-join"`n"))}
$f=$final|ConvertFrom-Json;if(-not$f.ok){throw ('COMPLETE_FINALIZE_RESULT: '+($final-join"`n"))}
[ordered]@{ok=$true;runtime='2.5.7';acceptance=$a;cleanup=$cleaned;repo=$f}|ConvertTo-Json -Depth 12 -Compress
