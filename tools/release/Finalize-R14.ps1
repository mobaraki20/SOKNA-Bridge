param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function ReadUtf8([string]$Path){
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "R14_FILE_MISSING: $Path"}
  return [IO.File]::ReadAllText((Resolve-Path $Path),[Text.Encoding]::UTF8)
}
function Require([bool]$Condition,[string]$Code){if(-not$Condition){throw $Code}}

# R14 source is already finalized before qualification. This script is deliberately
# verification-only: it must never rewrite product files, normalize line endings,
# change encodings, or otherwise dirty the source that the installer will package.
$manifest=Get-Content 'extension/chrome/manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json
Require ([string]$manifest.version -eq '3.14.2') 'R14_EXTENSION_VERSION_INVALID'
Require ([string]$manifest.background.service_worker -eq 'background_bootstrap.js') 'R14_BOOTSTRAP_ENTRY_CHANGED'

$agent=ReadUtf8 'native/runtime/v2.7.1/agent.ps1'
Require ($agent.Contains('PLAN_STAGE_INVALID_PATH')) 'R14_PLAN_STAGE_FIX_MISSING'
Require ($agent.Contains('^tools/plans/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.json$')) 'R14_PLAN_STAGE_NESTED_PATH_MISSING'

$bg=ReadUtf8 'extension/chrome/background.js'
Require ($bg.Contains('const VERSION="3.14.2"')) 'R14_BACKGROUND_VERSION_INVALID'
Require ($bg.Contains('activeWorkspaceToolPolicy')) 'R14_WORKSPACE_POLICY_PROBE_MISSING'
Require ($bg.Contains('effective_source:tool_policy.resolved')) 'R14_EFFECTIVE_ACTION_SOURCE_MISSING'
Require ($bg.Contains('supported_actions')) 'R14_SUPPORTED_ACTIONS_MISSING'

$content=ReadUtf8 'extension/chrome/content.js'
Require ($content.Contains('const VERSION="3.14.2"')) 'R14_CONTENT_VERSION_INVALID'
Require ($content.Contains('if(env.kind!==expected.kind)continue')) 'R14_RESULT_KIND_GATE_MISSING'

$capture=ReadUtf8 'extension/chrome/browser_capture_map.js'
foreach($needle in @('state-handler-missing','state-unchanged','BROWSER_CAPTURE_MAP_ARTIFACT_INVALID','supports_artifact_map:true','map_artifact_ref')){
  Require ($capture.Contains($needle)) ("R14_CAPTURE_FIX_MISSING: "+$needle)
}

$contracts=ReadUtf8 'extension/chrome/action_contracts_core.js'
Require ($contracts.Contains('This is not a command lookup; use bridge.command.get for command ids.')) 'R14_RESULT_GET_CONTRACT_MISSING'
Require ($contracts.Contains('pattern:"^[a-fA-F0-9]{64}$"')) 'R14_RESULT_GET_HASH_PATTERN_MISSING'

$outcome=ReadUtf8 'extension/chrome/terminal_outcome_core.js'
Require ($outcome.Contains('retryable:!!d?.retryable')) 'R14_RETRYABLE_SOURCE_MISSING'

foreach($src in @($bg,$content,$capture,$contracts,$outcome)){
  Require (-not [regex]::IsMatch($src,'\beval\s*\(')) 'R14_RAW_EVAL_FORBIDDEN'
}

Write-Host 'R14_FINALIZE_OK'
