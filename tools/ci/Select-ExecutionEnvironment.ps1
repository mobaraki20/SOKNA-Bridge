param(
  [string[]]$Traits=@(),
  [string]$PolicyPath=''
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if([string]::IsNullOrWhiteSpace($PolicyPath)){$PolicyPath=Join-Path $root 'docs\contracts\EXECUTION_ENVIRONMENT_POLICY_V1.json'}
$policy=Get-Content $PolicyPath -Raw -Encoding UTF8|ConvertFrom-Json
$set=@{};foreach($t in $Traits){if(-not[string]::IsNullOrWhiteSpace($t)){$set[$t.Trim().ToLowerInvariant()]=$true}}
function Has([string]$x){return $set.ContainsKey($x.ToLowerInvariant())}
$choice='local_development';$reason='default-lowest-cost-capable'
if((Has 'needs-real-user-session') -or (Has 'needs-printer') -or (Has 'needs-lan-wifi') -or (Has 'needs-real-hardware')){$choice='real_windows_pc';$reason='real-session-or-hardware'}
elseif((Has 'windows-specific') -and (Has 'clean-environment-sufficient')){$choice='github_windows_clean';$reason='windows-specific-clean-repro'}
elseif((Has 'browser-qa') -and (Has 'no-personal-session-needed')){$choice='controlled_browser';$reason='browser-clean-session'}
elseif(Has 'platform-neutral'){$choice='local_development';$reason='platform-neutral'}
$gates=@();if((Has 'windows-runtime-release-candidate') -or (Has 'windows-installer-release-candidate')){$gates+=@('github_windows_clean-before-real_windows_pc')}
[ordered]@{ok=$true;schema='sokna-environment-selection-v1';environment=$choice;reason=$reason;traits=@($set.Keys|Sort-Object);gates=$gates;policy_schema=[string]$policy.schema}|ConvertTo-Json -Compress
