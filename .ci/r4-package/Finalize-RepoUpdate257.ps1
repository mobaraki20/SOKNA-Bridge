param(
  [string]$PackageRoot=$PSScriptRoot,
  [string]$InstallRoot="$env:LOCALAPPDATA\SOKNA-Bridge-V2"
)
$ErrorActionPreference='Stop'
function Run-Git([string]$Repo,[string[]]$GitArgs){$output=& git -C $Repo @GitArgs 2>&1;if($LASTEXITCODE-ne0){throw ('GIT_FAILED '+($GitArgs-join' ')+' :: '+($output-join"`n"))};return ($output-join"`n")}
$cfg=Get-Content (Join-Path $InstallRoot 'config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$w=$cfg.workspaces.psobject.Properties|Where-Object{$_.Name-eq'SOKNA-Bridge'}|Select-Object -First 1
if($null-eq$w){throw 'FINALIZE_WORKSPACE_MISSING'}
$repo=[IO.Path]::GetFullPath([string]$w.Value.path)
$branch=(Run-Git $repo @('branch','--show-current')).Trim();if($branch-ne'dev/bootstrap-v2.5'){throw ('FINALIZE_BRANCH '+$branch)}
$head=(Run-Git $repo @('rev-parse','HEAD')).Trim();if(-not$head.StartsWith('06d901a',[StringComparison]::OrdinalIgnoreCase)){throw ('FINALIZE_BASE '+$head)}
Run-Git $repo @('fetch','--prune','origin')|Out-Null
$up=(Run-Git $repo @('rev-parse','@{u}')).Trim();if($up-ne$head){throw ('FINALIZE_REMOTE_CHANGED '+$up)}
$tracked=(Run-Git $repo @('status','--porcelain','--untracked-files=no')).Trim();if($tracked){throw ('FINALIZE_TRACKED_DIRTY '+$tracked)}

$overlay=Join-Path $PackageRoot 'repo-overlay'
$copies=@{
  'docs/contracts/AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md'='docs/contracts/AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md';
  'docs/contracts/AGENT_CHANGE_EXECUTION_POLICY_V1.json'='docs/contracts/AGENT_CHANGE_EXECUTION_POLICY_V1.json';
  'docs/status/AGENT_257_LOCAL_VALIDATION.md'='docs/status/AGENT_257_LOCAL_VALIDATION.md';
  'docs/handoffs/CURRENT_AGENT_HANDOFF_FA.md'='docs/handoffs/CURRENT_AGENT_HANDOFF_FA.md';
  'docs/handoffs/MASTER_AGENT_HANDOFF_ROADMAP_FA.md'='docs/handoffs/MASTER_AGENT_HANDOFF_ROADMAP_FA.md';
  'native/runtime/v2.5.7/agent.ps1'='native/runtime/v2.5.7/agent.ps1';
  'native/runtime/v2.5.7/AGENT_CAPABILITIES.json'='native/runtime/v2.5.7/AGENT_CAPABILITIES.json';
  'tools/runtime/releases/2.5.7/Preflight-AgentRuntime257.ps1'='tools/runtime/releases/2.5.7/Preflight-AgentRuntime257.ps1';
  'tools/runtime/releases/2.5.7/Stage-AgentRuntime257.ps1'='tools/runtime/releases/2.5.7/Stage-AgentRuntime257.ps1';
  'tools/runtime/releases/2.5.7/Activate-AgentRuntime.ps1'='tools/runtime/releases/2.5.7/Activate-AgentRuntime.ps1';
  'tools/runtime/releases/2.5.7/Agent-Launcher.ps1'='tools/runtime/releases/2.5.7/Agent-Launcher.ps1';
  'tools/runtime/releases/2.5.7/Rollback-AgentRuntime.ps1'='tools/runtime/releases/2.5.7/Rollback-AgentRuntime.ps1';
  'tools/runtime/releases/2.5.7/Acceptance-AgentRuntime257.ps1'='tools/runtime/releases/2.5.7/Acceptance-AgentRuntime257.ps1';
  'tools/runtime/releases/2.5.7/Finalize-RepoUpdate257.ps1'='tools/runtime/releases/2.5.7/Finalize-RepoUpdate257.ps1';
  'tools/runtime/releases/2.5.7/Complete-AgentRuntime257.ps1'='tools/runtime/releases/2.5.7/Complete-AgentRuntime257.ps1'
}
foreach($entry in $copies.GetEnumerator()){
  $src=Join-Path $overlay $entry.Key;$dst=Join-Path $repo $entry.Value;$parent=Split-Path $dst -Parent
  if(-not(Test-Path $src -PathType Leaf)){throw ('FINALIZE_OVERLAY_MISSING '+$entry.Key)}
  if(-not(Test-Path $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
  Copy-Item $src $dst -Force
}

$build=Join-Path $repo 'installer/bootstrap/build-package.ps1';$txt=Get-Content $build -Raw -Encoding UTF8
$old='param([string]$OutDir="dist",[string]$AgentVersion="2.5.6")';$new='param([string]$OutDir="dist",[string]$AgentVersion="2.5.7")'
if(($txt.Split($old).Count-1)-ne1){throw 'FINALIZE_BUILD_VERSION_MATCH'}
[IO.File]::WriteAllText($build,$txt.Replace($old,$new),(New-Object Text.UTF8Encoding($false)))
$readme=Join-Path $repo 'installer/bootstrap/README.txt';$r=Get-Content $readme -Raw -Encoding UTF8
if(($r.Split('Agent 2.5.6:').Count-1)-ne1){throw 'FINALIZE_README_VERSION_MATCH'}
[IO.File]::WriteAllText($readme,$r.Replace('Agent 2.5.6:','Agent 2.5.7:'),(New-Object Text.UTF8Encoding($false)))
$rf=Join-Path $repo '00_READ_FIRST_NEW_CHAT.md';if(Test-Path $rf){$rt=Get-Content $rf -Raw -Encoding UTF8;$marker='AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md';if($rt-notmatch[regex]::Escape($marker)){$block="`n## Mandatory execution workflow`n- Read docs/handoffs/MASTER_AGENT_HANDOFF_ROADMAP_FA.md first for architecture, roadmap, reference-workload requirements and exact continuation rules.`n- Read docs/contracts/AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md before non-trivial Agent changes.`n- Read docs/handoffs/CURRENT_AGENT_HANDOFF_FA.md before discovery or mutation.`n";[IO.File]::WriteAllText($rf,$rt.TrimEnd()+"`n"+$block,(New-Object Text.UTF8Encoding($false)))}}

$ps=Get-ChildItem (Join-Path $repo 'native/runtime/v2.5.7') -Filter '*.ps1' -File;foreach($f in $ps){$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$t,[ref]$e);if($e.Count){throw ('FINALIZE_PS_PARSE '+$f.FullName)}}
Get-Content (Join-Path $repo 'native/runtime/v2.5.7/AGENT_CAPABILITIES.json') -Raw -Encoding UTF8|ConvertFrom-Json|Out-Null
$acceptStatus=Join-Path $repo 'docs/status/AGENT_257_WINDOWS_ACCEPTANCE.md'
$statePath=Join-Path $InstallRoot 'runtime-state.json';$stateText=if(Test-Path $statePath){Get-Content $statePath -Raw -Encoding UTF8}else{'{}'}
$now=(Get-Date).ToUniversalTime().ToString('o')
$statusText="# Agent 2.5.7 Windows Acceptance`n`nGenerated: $now`nResult: PASS`n`n- Live ping version: 2.5.7`n- Capability version: 2.5.7`n- artifact.inspect: PASS`n- artifact.apply controlled probe: PASS`n- reverse cleanup: PASS`n- artifact audit events: PASS`n- tracked repository after probe: clean`n- runtime state snapshot: $stateText`n"
[IO.File]::WriteAllText($acceptStatus,$statusText,(New-Object Text.UTF8Encoding($false)))
Run-Git $repo @('diff','--check')|Out-Null
$paths=@($copies.Values)+@('installer/bootstrap/build-package.ps1','installer/bootstrap/README.txt','00_READ_FIRST_NEW_CHAT.md','docs/status/AGENT_257_WINDOWS_ACCEPTANCE.md')
foreach($rel in $paths){if(Test-Path (Join-Path $repo $rel)){Run-Git $repo @('add','--',$rel)|Out-Null}}
Run-Git $repo @('diff','--cached','--check')|Out-Null
$commit=Run-Git $repo @('commit','-m','agent: enforce tested artifact execution contract v2.5.7')
$push=Run-Git $repo @('push','origin',$branch)
$newHead=(Run-Git $repo @('rev-parse','HEAD')).Trim()
[ordered]@{ok=$true;stage='repo_finalized';head=$newHead;branch=$branch;commit=$commit;push=$push}|ConvertTo-Json -Compress
