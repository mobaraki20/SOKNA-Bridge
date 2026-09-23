param([string]$InstallRoot="$env:LOCALAPPDATA\SOKNA-Bridge-V2")
$ErrorActionPreference='Stop'
function Invoke-Agent([object]$Cfg,[string]$Action,[string]$Id,$Params){$body=@{id=$Id;action=$Action;params=$Params}|ConvertTo-Json -Depth 12 -Compress;return Invoke-RestMethod -Uri ("http://127.0.0.1:"+$Cfg.port+"/api") -Method Post -Headers @{'X-Sokna-Token'=[string]$Cfg.token} -ContentType 'application/json' -Body $body -TimeoutSec 5}
function Get-Sha256([string]$Path){return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
$cfg=Get-Content (Join-Path $InstallRoot 'config.json') -Raw -Encoding UTF8|ConvertFrom-Json
$ping=Invoke-Agent $cfg 'ping' ('accept-ping-'+[Guid]::NewGuid().ToString('N')) @{}
if(-not$ping.ok-or[string]$ping.version-ne'2.5.7'){throw 'ACCEPT_PING_VERSION'}
$caps=Invoke-Agent $cfg 'agent.capabilities' ('accept-caps-'+[Guid]::NewGuid().ToString('N')) @{}
if(-not$caps.ok-or[string]$caps.version-ne'2.5.7'){throw 'ACCEPT_CAP_VERSION'}
if(@($caps.capabilities.actions)-notcontains'artifact.inspect'-or@($caps.capabilities.actions)-notcontains'artifact.apply'){throw 'ACCEPT_CAP_ACTIONS'}

$wProp=$cfg.workspaces.psobject.Properties|Where-Object{$_.Name-eq'SOKNA-Bridge'}|Select-Object -First 1
if($null-eq$wProp){throw 'ACCEPT_WORKSPACE_MISSING'}
$repo=[IO.Path]::GetFullPath([string]$wProp.Value.path)
$status=& git -C $repo status --porcelain --untracked-files=no;if($LASTEXITCODE-ne0){throw 'ACCEPT_GIT_STATUS'};if(-not[string]::IsNullOrWhiteSpace(($status-join"`n"))){throw 'ACCEPT_TRACKED_DIRTY'}
$head=(& git -C $repo rev-parse HEAD).Trim();$branch=(& git -C $repo branch --show-current).Trim();$remote=(& git -C $repo remote get-url origin).Trim()
$artifactRoot=[string]$ping.artifact_root;if(-not(Test-Path $artifactRoot)){New-Item -ItemType Directory -Path $artifactRoot -Force|Out-Null}
$id='accept-'+[Guid]::NewGuid().ToString('N');$dir=Join-Path $env:TEMP $id;New-Item -ItemType Directory -Path $dir -Force|Out-Null
$probeRel='tools/.sokna-artifact-acceptance-probe.txt';$patch="diff --git a/$probeRel b/$probeRel`nnew file mode 100644`n--- /dev/null`n+++ b/$probeRel`n@@ -0,0 +1 @@`n+SOKNA_ARTIFACT_ACCEPTANCE_257`n"
$patchPath=Join-Path $dir 'change.patch';[IO.File]::WriteAllText($patchPath,$patch,(New-Object Text.UTF8Encoding($false)))
$handoffPath=Join-Path $dir 'HANDOFF_COMPLETE_FA.md';[IO.File]::WriteAllText($handoffPath,"Acceptance probe only.`n",(New-Object Text.UTF8Encoding($false)))
$manifest=[ordered]@{schema='sokna-artifact-v1';artifact_id=$id;target=[ordered]@{workspace='SOKNA-Bridge';repo=$remote;branch=$branch;base_head=$head};payload=[ordered]@{type='git_patch';path='change.patch';sha256=(Get-Sha256 $patchPath);files=@($probeRel)};handoff=[ordered]@{path='HANDOFF_COMPLETE_FA.md';sha256=(Get-Sha256 $handoffPath)}}
$manifest|ConvertTo-Json -Depth 12|Set-Content (Join-Path $dir 'artifact.json') -Encoding UTF8
$zip=Join-Path $artifactRoot ($id+'.zip');Compress-Archive -Path (Join-Path $dir '*') -DestinationPath $zip -CompressionLevel Optimal -Force
$zipSha=Get-Sha256 $zip
try{
  $inspect=Invoke-Agent $cfg 'artifact.inspect' ('accept-inspect-'+[Guid]::NewGuid().ToString('N')) @{workspace='SOKNA-Bridge';path=$zip;expected_sha256=$zipSha};if(-not$inspect.ok){throw 'ACCEPT_INSPECT'}
  $apply=Invoke-Agent $cfg 'artifact.apply' ('accept-apply-'+[Guid]::NewGuid().ToString('N')) @{workspace='SOKNA-Bridge';path=$zip;expected_sha256=$zipSha};if(-not$apply.ok-or-not$apply.applied){throw 'ACCEPT_APPLY'}
  $probe=Join-Path $repo $probeRel;if(-not(Test-Path $probe -PathType Leaf)){throw 'ACCEPT_PROBE_MISSING'}
  & git -C $repo apply --reverse --check $patchPath;if($LASTEXITCODE-ne0){throw 'ACCEPT_REVERSE_CHECK'}
  & git -C $repo apply --reverse $patchPath;if($LASTEXITCODE-ne0){throw 'ACCEPT_REVERSE'}
  $after=& git -C $repo status --porcelain --untracked-files=no;if(-not[string]::IsNullOrWhiteSpace(($after-join"`n"))){throw 'ACCEPT_REPO_NOT_CLEAN'}
  $audit=[string]$ping.artifact_log;$lines=Get-Content $audit -Tail 80 -ErrorAction Stop;$joined=$lines-join"`n";if($joined-notmatch[regex]::Escape($id)-or$joined-notmatch'"phase":"prepared"'-or$joined-notmatch'"phase":"applied"'){throw 'ACCEPT_AUDIT_EVENTS'}
  $statePath=Join-Path $InstallRoot 'runtime-state.json';if(Test-Path $statePath){$state=Get-Content $statePath -Raw -Encoding UTF8|ConvertFrom-Json;$state.state='active';$state.active_version='2.5.7';$state.last_health='pass';$state.accepted_at=(Get-Date).ToUniversalTime().ToString('o');$state|ConvertTo-Json -Depth 12|Set-Content $statePath -Encoding UTF8}
  [ordered]@{ok=$true;version='2.5.7';artifact_id=$id;inspect=$true;apply=$true;reverse=$true;audit=$true;repo_clean=$true}|ConvertTo-Json -Compress
}finally{Remove-Item $zip -Force -ErrorAction SilentlyContinue;Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue}
