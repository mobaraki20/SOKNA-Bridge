param(
  [string[]]$Traits=@()
)
$ErrorActionPreference='Stop'
$set=@{};foreach($t in $Traits){if(-not[string]::IsNullOrWhiteSpace($t)){$set[$t.Trim().ToLowerInvariant()]=$true}}
function Has([string]$x){return $set.ContainsKey($x.ToLowerInvariant())}
$sourceRoute='single_bridge_artifact_acquisition'
if(Has 'exact-source-already-in-development-workspace'){$sourceRoute='existing_exact_development_archive'}
elseif(Has 'verified-repository-mirror-available'){$sourceRoute='verified_repository_mirror'}
elseif(Has 'no-full-source-route'){$sourceRoute='targeted_bridge_read_last_resort'}
$development='local_development'
if((Has 'windows-specific') -and (Has 'clean-environment-sufficient')){$development='github_windows_clean'}
$acceptance=if((Has 'needs-real-user-session') -or (Has 'needs-real-hardware') -or (Has 'installed-extension')){'real_windows_pc'}else{'none'}
[ordered]@{
  ok=$true
  schema='sokna-fast-work-route-v1'
  source_route=$sourceRoute
  development_environment=$development
  github_push_policy='meaningful_validated_checkpoint_only'
  real_pc_role='access_activation_acceptance_only'
  acceptance_environment=$acceptance
  batch_first=$true
  piecemeal_bridge_source_reads_forbidden=($sourceRoute -ne 'targeted_bridge_read_last_resort')
}|ConvertTo-Json -Compress
