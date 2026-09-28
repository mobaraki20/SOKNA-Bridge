param([string]$ConfigPath="$PSScriptRoot\config.json",[string]$RunJobId="",[switch]$StartupProbe,[switch]$RunScheduler,[int]$SchedulerParentPid=0)
$ErrorActionPreference="Stop"
$artifactModule=Join-Path $PSScriptRoot "Sokna.ArtifactRoot.psm1"
if(-not(Test-Path -LiteralPath $artifactModule -PathType Leaf)){throw "ARTIFACT_ROOT_MODULE_MISSING"}
Import-Module $artifactModule -Force
$workspaceModule=Join-Path $PSScriptRoot "Sokna.Workspace.psm1"
if(-not(Test-Path -LiteralPath $workspaceModule -PathType Leaf)){throw "WORKSPACE_MODULE_MISSING"}
Import-Module $workspaceModule -Force
$browserModule=Join-Path $PSScriptRoot "Sokna.Browser.psm1"
if(-not(Test-Path -LiteralPath $browserModule -PathType Leaf)){throw "BROWSER_QA_MODULE_MISSING"}
Import-Module $browserModule -Force
$providerModule=Join-Path $PSScriptRoot "Sokna.ArtifactProvider.psm1"
if(-not(Test-Path -LiteralPath $providerModule -PathType Leaf)){throw "ARTIFACT_PROVIDER_MODULE_MISSING"}
Import-Module $providerModule -Force
$componentModule=Join-Path $PSScriptRoot "Sokna.Component.psm1"
if(-not(Test-Path -LiteralPath $componentModule -PathType Leaf)){throw "COMPONENT_MANAGER_MODULE_MISSING"}
Import-Module $componentModule -Force

function JsonResponse($ctx,[int]$status,$obj) {
  $json=$obj | ConvertTo-Json -Depth 40 -Compress
  $b=[Text.Encoding]::UTF8.GetBytes($json)
  $maxInline=24000
  if($b.Length -gt $maxInline){
    $dir=if($env:LOCALAPPDATA){Join-Path $env:LOCALAPPDATA "SOKNA\Bridge\results"}else{Join-Path $PSScriptRoot "results"}
    if(-not(Test-Path $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
    $shaAlg=[Security.Cryptography.SHA256]::Create()
    try{$sha=([BitConverter]::ToString($shaAlg.ComputeHash($b))).Replace("-","").ToLowerInvariant()}finally{$shaAlg.Dispose()}
    $path=Join-Path $dir ($sha+".json")
    if(-not(Test-Path $path -PathType Leaf)){[IO.File]::WriteAllBytes($path,$b)}
    $ok=($status-lt400);try{if($null-ne$obj.ok){$ok=[bool]$obj.ok}}catch{}
    $obj=[ordered]@{ok=$ok;large_result=$true;result_ref=[ordered]@{id=$sha;bytes=$b.Length;content_type="application/json"}}
    $json=$obj|ConvertTo-Json -Depth 10 -Compress
    $b=[Text.Encoding]::UTF8.GetBytes($json)
  }
  $ctx.Response.StatusCode=$status
  $ctx.Response.ContentType="application/json; charset=utf-8"
  $ctx.Response.ContentLength64=$b.Length
  $ctx.Response.OutputStream.Write($b,0,$b.Length)
  $ctx.Response.OutputStream.Close()
}
function Clip([string]$s,[int]$n=18000) {
  if($null -eq $s){return ""}
  if($s.Length -le $n){return $s}
  return $s.Substring(0,$n)+"`n...[TRUNCATED "+($s.Length-$n)+" chars]"
}
function Sha256File([string]$p) {
  if(-not(Test-Path $p -PathType Leaf)){return $null}
  return (Get-FileHash -Algorithm SHA256 $p).Hash.ToLowerInvariant()
}
function Quote-Arg([string]$arg) {
  if($null-eq$arg -or $arg.Length-eq0){return '""'}
  if($arg-notmatch'[\s"]'){return $arg}
  return '"' + ($arg -replace '(\\*)"', '$1$1\"' -replace '(\\+)$','$1$1') + '"'
}
function RunProcess([string]$exe,[string[]]$procArgs,[string]$cwd,[int]$timeout=180) {
  $allowed=@("git","git.exe","gh","gh.exe","php","php.exe","python","python.exe","py","py.exe",
             "node","node.exe","npm","npm.cmd","npx","npx.cmd","composer","composer.bat","dotnet","dotnet.exe",
             "powershell","powershell.exe","pwsh","pwsh.exe","cmd","cmd.exe")
  if($allowed-notcontains$exe.ToLowerInvariant()){throw "Executable not allowed: $exe"}
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=$exe;$psi.WorkingDirectory=$cwd;$psi.UseShellExecute=$false
  $psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.CreateNoWindow=$true;$psi.StandardOutputEncoding=[Text.Encoding]::UTF8;$psi.StandardErrorEncoding=[Text.Encoding]::UTF8
  $qa=@();foreach($a in $procArgs){$qa+=(Quote-Arg ([string]$a))};$psi.Arguments=($qa-join' ')
  $proc=New-Object Diagnostics.Process;$proc.StartInfo=$psi;[void]$proc.Start()
  $ot=$proc.StandardOutput.ReadToEndAsync();$et=$proc.StandardError.ReadToEndAsync()
  if(-not$proc.WaitForExit($timeout*1000)){try{$proc.Kill()}catch{};throw "Process timeout after ${timeout}s: $exe"}
  $o=$ot.GetAwaiter().GetResult();$e=$et.GetAwaiter().GetResult()
  return @{code=$proc.ExitCode;stdout=(Clip $o);stderr=(Clip $e)}
}

function StatePath { return "$PSScriptRoot\command_state.json" }
function LoadState {
  if(-not(Test-Path (StatePath))){return @{}}
  try{$o=Get-Content (StatePath) -Raw -Encoding UTF8|ConvertFrom-Json;$h=@{};foreach($x in $o.psobject.Properties){$h[$x.Name]=$x.Value};return $h}catch{return @{}}
}
function SaveState($h) {
  $items=@();foreach($k in $h.Keys){$items+=[pscustomobject]@{k=$k;v=$h[$k];ts=[int64]($h[$k].ts)}}
  if($items.Count-gt700){$keep=$items|Sort-Object ts -Descending|Select-Object -First 700;$n=@{};foreach($x in $keep){$n[$x.k]=$x.v};$h=$n}
  $h|ConvertTo-Json -Depth 40|Set-Content (StatePath) -Encoding UTF8
}

function JobsDir { return "$PSScriptRoot\jobs" }
function JobPath([string]$id) { if($id-notmatch'^[A-Za-z0-9._-]{1,80}$'){throw "Invalid job id"};return (Join-Path (JobsDir) ($id+".json")) }

function ReadJob([string]$id){$p=JobPath $id;if(-not(Test-Path $p -PathType Leaf)){throw "Job not found: $id"};return (Get-Content $p -Raw -Encoding UTF8|ConvertFrom-Json)}
function WriteJob($j){$d=JobsDir;if(-not(Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};$p=JobPath([string]$j.id);$tmp=$p+".tmp."+$PID;$j|ConvertTo-Json -Depth 40|Set-Content $tmp -Encoding UTF8;Move-Item $tmp $p -Force;return $p}

function StartJobWorker([string]$id){$a=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-ConfigPath',$ConfigPath,'-RunJobId',$id);return (Start-Process powershell.exe -ArgumentList $a -WindowStyle Hidden -PassThru).Id}

function SchedulerPidPath { $state=Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($ConfigPath))) 'state';if(-not(Test-Path -LiteralPath $state)){New-Item -ItemType Directory -Path $state -Force|Out-Null};return (Join-Path $state 'automation-scheduler.pid.json') }
function GetActiveJobRecords {
  $out=@();if(Test-Path (JobsDir)){foreach($f in Get-ChildItem (JobsDir) -Filter '*.json' -File){try{$j=Get-Content $f.FullName -Raw -Encoding UTF8|ConvertFrom-Json;if(([string]$j.status)-in@('queued','running')){$out+=$j}}catch{}}};return $out
}
function RevokeAutomationGrantForJob($j){
  if($null-eq$j){return};$aid='';$issuer='';$gid='';$run='';try{$aid=[string]$j.automation_id}catch{};try{$issuer=[string]$j.automation_grant_issuer}catch{};try{$gid=[string]$j.grant_id}catch{};try{$run=[string]$j.run_key}catch{}
  if($aid-and$gid-and$issuer){try{$null=Revoke-SoknaWorkspaceGrant -Id $gid -Issuer $issuer}catch{}}
  if($aid-and$run){try{$null=Release-SoknaAutomationRun -AutomationId $aid -RunKey $run -JobId ([string]$j.id) -Status ([string]$j.status)}catch{}}
}
function SubmitAutomationClaim($claim){
  $jobId=[string]$claim.job_id;$jp=JobPath $jobId
  if(Test-Path -LiteralPath $jp -PathType Leaf){$existing=ReadJob $jobId;$ea='';$er='';try{$ea=[string]$existing.automation_id}catch{};try{$er=[string]$existing.run_key}catch{};if($ea-eq[string]$claim.automation_id-and$er-eq[string]$claim.run_key){return @{ok=$true;job_id=$jobId;status=[string]$existing.status;idempotent=$true}};throw 'AUTOMATION_JOB_ID_COLLISION'}
  $base=Get-SoknaWorkspace ([string]$claim.workspace_id);$plan=Resolve-SoknaWorkspacePath -Workspace $base -Path ([string]$claim.plan_path) -Access 'read';if(-not(Test-Path -LiteralPath $plan -PathType Leaf)){throw 'AUTOMATION_PLAN_NOT_FOUND'};if([string]$claim.expected_sha256-and(Sha256File $plan)-ne([string]$claim.expected_sha256).ToLowerInvariant()){throw 'AUTOMATION_PLAN_SHA256_MISMATCH'}
  $grant=$null;try{$grant=New-SoknaWorkspaceGrant -Id ([string]$claim.grant_id) -WorkspaceId ([string]$claim.workspace_id) -JobId $jobId -Issuer ([string]$claim.grant_issuer) -Context ('automation:'+[string]$claim.automation_id) -Scopes @($claim.grant_scopes) -Tools @($claim.grant_tools) -TtlSeconds ([int]$claim.grant_ttl_seconds)}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_ALREADY_EXISTS'){throw};$grant=Get-SoknaWorkspaceGrant ([string]$claim.grant_id) ([string]$claim.workspace_id) $jobId}
  $j=[pscustomobject]@{id=$jobId;status='queued';workspace=[string]$claim.workspace_id;grant_id=[string]$claim.grant_id;path=[string]$claim.plan_path;expected_sha256=[string]$claim.expected_sha256;automation_id=[string]$claim.automation_id;automation_grant_issuer=[string]$claim.grant_issuer;run_key=[string]$claim.run_key;concurrency_key=[string]$claim.concurrency_key;created_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();worker_pid=$null;started_at=$null;finished_at=$null;recovered_at=$null;result=$null;error=$null}
  WriteJob $j|Out-Null
  try{$workerPid=StartJobWorker $jobId;$j=ReadJob $jobId;$j.worker_pid=$workerPid;WriteJob $j|Out-Null;return @{ok=$true;job_id=$jobId;status=$j.status;worker_pid=$workerPid;automation_id=[string]$claim.automation_id;run_key=[string]$claim.run_key;grant_id=[string]$grant.id}}
  catch{
    $submitErr=$_.Exception.Message
    try{$null=Revoke-SoknaWorkspaceGrant -Id ([string]$claim.grant_id) -Issuer ([string]$claim.grant_issuer)}catch{}
    Remove-Item -LiteralPath $jp -Force -ErrorAction SilentlyContinue
    throw $submitErr
  }
}
function InvokeAutomationDispatch([string]$TriggerKey='',[string]$EventId=''){
  $active=GetActiveJobRecords;$claims=Get-SoknaAutomationClaims -ActiveJobs $active -TriggerKey $TriggerKey -EventId $EventId;$out=@()
  foreach($c in @($claims)){try{$r=SubmitAutomationClaim $c;$null=Complete-SoknaAutomationClaim $c 'submitted';$out+=@([ordered]@{ok=$true;automation_id=[string]$c.automation_id;run_key=[string]$c.run_key;job=$r})}catch{$err=$_.Exception.Message;try{$null=Undo-SoknaAutomationClaim $c}catch{};$out+=@([ordered]@{ok=$false;automation_id=[string]$c.automation_id;run_key=[string]$c.run_key;error=$err})}}
  $ok=$true;foreach($x in $out){if(-not[bool]$x.ok){$ok=$false}};return [ordered]@{ok=$ok;trigger_key=$TriggerKey;event_id=$EventId;claims=$out}
}
function StartAutomationSchedulerWorker {
  if($RunScheduler){return $PID};$pidPath=SchedulerPidPath;$currentHash=Sha256File $PSCommandPath
  if(Test-Path -LiteralPath $pidPath -PathType Leaf){try{$rec=Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8|ConvertFrom-Json;$proc=Get-Process -Id ([int]$rec.pid) -ErrorAction SilentlyContinue;if($null-ne$proc){$start=([DateTimeOffset]$proc.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();if($start-eq[int64]$rec.start_unix_ms-and[string]$rec.script_sha256-eq$currentHash){return [int]$rec.pid};if($start-eq[int64]$rec.start_unix_ms-and$proc.ProcessName-in@('powershell','pwsh')){try{$proc.Kill();$proc.WaitForExit(3000)|Out-Null}catch{}}}}catch{};Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue}
  $a=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-ConfigPath',$ConfigPath,'-RunScheduler','-SchedulerParentPid',[string]$PID);$p=Start-Process powershell.exe -ArgumentList $a -WindowStyle Hidden -PassThru;Start-Sleep -Milliseconds 80;$start=([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();[ordered]@{pid=[int]$p.Id;start_unix_ms=$start;parent_pid=$PID;script_path=$PSCommandPath;script_sha256=$currentHash;created_at=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress|Set-Content -LiteralPath $pidPath -Encoding UTF8;return [int]$p.Id
}

function WorkspaceMap { return (Get-SoknaWorkspaceMap) }
function ResolveWorkspace($p) {
  $name=[string]$p.workspace
  $grantId='';$jobId=''
  if($null-ne$p.psobject.Properties['grant_id']){$grantId=[string]$p.grant_id}
  if($null-ne$p.psobject.Properties['job_id']){$jobId=[string]$p.job_id}
  return (Get-SoknaWorkspaceEffectiveView -WorkspaceId $name -GrantId $grantId -JobId $jobId)
}
function SafePath($w,[string]$rel,[string]$Access='read',[switch]$AllowMissing) {
  return (Resolve-SoknaWorkspacePath -Workspace $w -Path $rel -Access $Access -AllowMissing:$AllowMissing)
}
function AssertWorkspaceWritable($w) { $null=Assert-SoknaWorkspaceFullAccess -Workspace $w -Access 'write' }
function AssertWorkspaceReadable($w) { $null=Assert-SoknaWorkspaceFullAccess -Workspace $w -Access 'read' }
function AssertWorkspaceTool($w,[string]$tool) { $null=Assert-SoknaWorkspaceTool -Workspace $w -Tool $tool }
function GitText($w,[string[]]$procArgs,[int]$timeout=120) {
  AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'git'
  $r=RunProcess "git" $procArgs $w.path $timeout
  if($r.code-ne0){throw (($r.stderr+"`n"+$r.stdout).Trim())}
  return $r.stdout.Trim()
}
function RepoRemote($w) {
  try{return (GitText $w @("remote","get-url","origin") 60)}catch{return ""}
}
function NormRemote([string]$s) {
  $s=$s.Trim().TrimEnd('/');if($s.EndsWith(".git")){$s=$s.Substring(0,$s.Length-4)}
  $s=$s-replace'^https?://github\.com/','';$s=$s-replace'^git@github\.com:',''
  return $s.ToLowerInvariant()
}
function VerifyWorkspaceRemote($w) {
  AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'git'
  if(-not(Test-Path (Join-Path $w.path ".git"))){throw "Workspace is not a Git repository: $($w.name)"}
  $remote=RepoRemote $w
  if(-not[string]::IsNullOrWhiteSpace($w.expected_repo) -and (NormRemote $remote)-ne(NormRemote $w.expected_repo)){
    throw "Unexpected origin for workspace $($w.name): $remote"
  }
}
function GetSyncSnapshot($w) {
  AssertWorkspaceWritable $w;AssertWorkspaceTool $w 'git';VerifyWorkspaceRemote $w
  $fetch=RunProcess "git" @("fetch","--prune","origin") $w.path 300
  if($fetch.code-ne0){throw ("git fetch failed: "+$fetch.stderr+" "+$fetch.stdout)}
  $branch=(RunProcess "git" @("branch","--show-current") $w.path 60).stdout.Trim()
  $head=(RunProcess "git" @("rev-parse","HEAD") $w.path 60).stdout.Trim()
  $status=(RunProcess "git" @("status","--porcelain=v1","--branch") $w.path 60).stdout.Trim()
  $upstream="";try{$upstream=(RunProcess "git" @("rev-parse","--abbrev-ref","--symbolic-full-name","@{u}") $w.path 60).stdout.Trim()}catch{}
  $upstreamHead="";$ahead=0;$behind=0;$deltaLog="";$deltaFiles=""
  if(-not[string]::IsNullOrWhiteSpace($upstream)){
    $upstreamHead=(RunProcess "git" @("rev-parse","@{u}") $w.path 60).stdout.Trim()
    $parts=((RunProcess "git" @("rev-list","--left-right","--count","HEAD...@{u}") $w.path 60).stdout.Trim())-split'\s+'
    if($parts.Count-ge2){$ahead=[int]$parts[0];$behind=[int]$parts[1]}
    if($behind-gt0){
      $deltaLog=(RunProcess "git" @("log","--oneline","--decorate","HEAD..@{u}") $w.path 120).stdout
      $deltaFiles=(RunProcess "git" @("diff","--name-status","HEAD..@{u}") $w.path 120).stdout
    }
  }
  $recent=(RunProcess "git" @("for-each-ref","--sort=-committerdate","--count=12","--format=%(committerdate:iso8601)|%(objectname:short)|%(refname:short)|%(subject)","refs/remotes/origin") $w.path 120).stdout
  $prs=""
  try{AssertWorkspaceTool $w 'gh';$g=RunProcess "gh" @("pr","list","--state","open","--limit","30","--json","number,title,headRefName,baseRefName,updatedAt,url") $w.path 120;if($g.code-eq0){$prs=$g.stdout}}catch{}
  $handoff=@();if($deltaFiles){foreach($line in($deltaFiles-split"`r?`n")){if($line-match'(HANDOFF|CURRENT_STATUS|START_HERE|READ_FIRST|ARCHITECTURE|DECISION|RELEASE_NOTES)'){$handoff+=$line}}}
  return @{ok=$true;workspace=$w.name;write_enabled=$w.write_enabled;branch=$branch;head=$head;upstream=$upstream;upstream_head=$upstreamHead;ahead=$ahead;behind=$behind;clean=(-not(($status-split"`r?`n"|Where-Object{$_-and$_-notmatch'^##'})|Select-Object -First 1));status=$status;remote_delta_log=$deltaLog;remote_delta_files=$deltaFiles;handoff_or_status_changes=$handoff;recent_remote_refs=$recent;open_prs=$prs}
}
function AssertFreshWritable($w) {
  $s=GetSyncSnapshot $w
  if($s.ahead-gt0-and$s.behind-gt0){throw "REMOTE_DIVERGED: local and upstream have diverged; mutation blocked."}
  if($s.behind-gt0){throw ("REMOTE_CHANGED: "+$w.name+" upstream is ahead by "+$s.behind+" commit(s); review and sync first.")}
  return $s
}
function ToolVersion($w,[string]$exe,[string[]]$procArgs) {
  try{AssertWorkspaceTool $w $exe}catch{return @{allowed=$false;available=$false;error=$_.Exception.Message}}
  try{$r=RunProcess $exe $procArgs $w.path 30;return @{allowed=$true;available=$true;code=$r.code;version=(($r.stdout+" "+$r.stderr).Trim())}}catch{return @{allowed=$true;available=$false;error=$_.Exception.Message}}
}
function WorkspaceSummary {
  $out=@()
  foreach($x in @(Get-SoknaWorkspaceList)){
    $isGit=$false
    if($x.available){$isGit=Test-Path -LiteralPath (Join-Path ([string]$x.path) '.git') -PathType Container}
    $out+=@{name=[string]$x.id;display_name=[string]$x.display_name;path=[string]$x.path;kind=[string]$x.kind;expected_repo=[string]$x.expected_repo;write_enabled=[bool]$x.write_enabled;available=[bool]$x.available;error=[string]$x.error;scopes=@($x.scopes);tools=@($x.tools);git=$isGit}
  }
  return $out
}
function GetReadableWorkspaceFiles($w,[string]$StartRel='.',[string]$Glob='*',[int]$MaxFiles=5000) {
  $start=SafePath $w $StartRel 'read'
  if(-not(Test-Path -LiteralPath $start -PathType Container)){throw 'WORKSPACE_LIST_ROOT_NOT_DIRECTORY'}
  $stack=New-Object 'System.Collections.Generic.Stack[string]';$stack.Push($start);$files=@()
  while($stack.Count-gt0-and$files.Count-lt$MaxFiles){
    $dir=$stack.Pop()
    foreach($x in Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop){
      $rel=$x.FullName.Substring(([string]$w.path).TrimEnd('\','/').Length).TrimStart('\','/')
      try{$null=SafePath $w $rel 'read'}catch{continue}
      if(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'WORKSPACE_REPARSE_POINT_BLOCKED: '+$rel}
      if($x.PSIsContainer){$stack.Push($x.FullName);continue}
      if($x.Name-like$Glob){$files+=$x;if($files.Count-ge$MaxFiles){break}}
    }
  }
  return @($files)
}
function GetReadableWorkspaceEntries($w,[string]$StartRel='.',[int]$MaxItems=1200) {
  $start=SafePath $w $StartRel 'read'
  if(-not(Test-Path -LiteralPath $start -PathType Container)){throw 'WORKSPACE_LIST_ROOT_NOT_DIRECTORY'}
  $stack=New-Object 'System.Collections.Generic.Stack[string]';$stack.Push($start);$items=@()
  while($stack.Count-gt0-and$items.Count-lt$MaxItems){
    $dir=$stack.Pop()
    foreach($x in Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop){
      $rel=$x.FullName.Substring(([string]$w.path).TrimEnd('\','/').Length).TrimStart('\','/')
      try{$null=SafePath $w $rel 'read'}catch{continue}
      if(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){continue}
      $length=$null;if(-not$x.PSIsContainer){$length=[int64]$x.Length}
      $items+=@{path=$rel;mode=[string]$x.Mode;length=$length;last_write_time=$x.LastWriteTime;is_directory=[bool]$x.PSIsContainer}
      if($x.PSIsContainer){$stack.Push($x.FullName)}
      if($items.Count-ge$MaxItems){break}
    }
  }
  return @($items)
}
function GetOptionalFreshnessGuard($w) {
  $isGit=Test-Path -LiteralPath (Join-Path $w.path '.git') -PathType Container
  if(-not$isGit){return @{enforced=$false;reason='local_only_workspace'}}
  try{AssertWorkspaceWritable $w;AssertWorkspaceTool $w 'git'}catch{return @{enforced=$false;reason='git_guard_not_permitted';detail=$_.Exception.Message}}
  return (AssertFreshWritable $w)
}

function ArtifactRoot { return (Get-SoknaArtifactRoot) }
function ArtifactAuditPath { return (Get-SoknaArtifactAuditPath) }
function WriteArtifactAudit($e,[switch]$Required) { return (Write-SoknaArtifactAudit -Event $e -Required:$Required) }
function ResolveArtifactFile([string]$raw) {
  if([string]::IsNullOrWhiteSpace($raw)){throw "ARTIFACT_PATH_REQUIRED"}
  $full=Resolve-SoknaManagedArtifactPath -Path $raw
  if(-not(Test-Path -LiteralPath $full -PathType Leaf)){throw "ARTIFACT_NOT_FOUND"}
  if([IO.Path]::GetExtension($full).ToLowerInvariant()-ne".zip"){throw "ARTIFACT_ZIP_REQUIRED"}
  $policy=Get-SoknaArtifactPolicy
  $size=(Get-Item -LiteralPath $full).Length
  if($size-le0-or$size-gt[int64]$policy.max_artifact_bytes){throw "ARTIFACT_ZIP_SIZE_INVALID"}
  return $full
}
function NewArtifactStage([string]$zip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $stage=New-SoknaArtifactStage -ArtifactPath $zip
  $prefix=[IO.Path]::GetFullPath($stage);if(-not$prefix.EndsWith([IO.Path]::DirectorySeparatorChar)){$prefix+=[IO.Path]::DirectorySeparatorChar}
  $a=[IO.Compression.ZipFile]::OpenRead($zip)
  try{
    if($a.Entries.Count-gt256){throw "ARTIFACT_ZIP_TOO_MANY_ENTRIES"}
    [int64]$total=0
    foreach($e in $a.Entries){
      $n=[string]$e.FullName;if([string]::IsNullOrWhiteSpace($n)){continue};$n=$n.Replace('/','\')
      $parts=$n-split'\\';if([IO.Path]::IsPathRooted($n)-or($parts-contains'..')-or$n-match'[:\x00-\x1F]'){throw "ARTIFACT_UNSAFE_ZIP_PATH"}
      if($e.Length-gt256MB){throw "ARTIFACT_ZIP_ENTRY_TOO_LARGE"};$total+=[int64]$e.Length;if($total-gt512MB){throw "ARTIFACT_ZIP_UNPACKED_TOO_LARGE"}
      if($e.Length-gt10MB-and$e.CompressedLength-gt0-and($e.Length/[double]$e.CompressedLength)-gt200){throw "ARTIFACT_ZIP_SUSPICIOUS_RATIO"}
      $out=[IO.Path]::GetFullPath((Join-Path $stage $n));if(-not$out.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw "ARTIFACT_UNSAFE_ZIP_PATH"}
    }
  }finally{$a.Dispose()}
  [IO.Compression.ZipFile]::ExtractToDirectory($zip,$stage)
  foreach($x in Get-ChildItem -LiteralPath $stage -Recurse -Force -ErrorAction Stop){if(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw "ARTIFACT_REPARSE_POINT_BLOCKED"}}
  return $stage
}

function GetArtifactPatchFiles([string]$patch) {
  $txt=[IO.File]::ReadAllText($patch,[Text.Encoding]::UTF8)
  if($txt.Length-gt25MB){throw "ARTIFACT_PATCH_TOO_LARGE"}
  $out=@()
  foreach($m in [regex]::Matches($txt,'(?m)^diff --git a/([^"\r\n]+) b/([^"\r\n]+)\r?$')){
    $a=[string]$m.Groups[1].Value;$b=[string]$m.Groups[2].Value
    if($a-ne$b){throw "ARTIFACT_RENAME_UNSUPPORTED_V1"}
    if([string]::IsNullOrWhiteSpace($b)-or$b-match'(^[\\/]|(^|[\\/])\.\.([\\/]|$)|[\x00-\x1F])'){throw "ARTIFACT_PATCH_PATH_INVALID"}
    $out+=$b
  }
  if($out.Count-eq0){throw "ARTIFACT_PATCH_HAS_NO_FILES"}
  $u=@($out|Sort-Object -Unique);if($u.Count-ne$out.Count){throw "ARTIFACT_PATCH_DUPLICATE_FILE"}
  return $u
}
function InvokeArtifactPackage($w,$p,[switch]$Apply) {
  $started=[DateTimeOffset]::UtcNow
  $zip=ResolveArtifactFile ([string]$p.path);$zipSha=Sha256File $zip;$expected=[string]$p.expected_sha256
  if($Apply -and [string]::IsNullOrWhiteSpace($expected)){throw "ARTIFACT_EXPECTED_SHA256_REQUIRED"}
  if($expected -and $expected -notmatch '^[a-fA-F0-9]{64}$'){throw "ARTIFACT_EXPECTED_SHA256_INVALID"}
  if($expected -and $zipSha -ne $expected.ToLowerInvariant()){throw "ARTIFACT_SHA256_MISMATCH"}
  if($Apply){$sync=AssertFreshWritable $w;$tracked=GitText $w @("status","--porcelain","--untracked-files=no");if(-not[string]::IsNullOrWhiteSpace($tracked)){throw "ARTIFACT_TRACKED_WORKTREE_DIRTY"}}else{VerifyWorkspaceRemote $w;$sync=$null}
  $stage=NewArtifactStage $zip
  $applied=$false;$patch=$null;$artifactId="";$actualFiles=@()
  try{
    $mf=Join-Path $stage "artifact.json";if(-not(Test-Path $mf -PathType Leaf)){throw "ARTIFACT_MANIFEST_MISSING"}
    try{$m=Get-Content $mf -Raw -Encoding UTF8|ConvertFrom-Json}catch{throw "ARTIFACT_MANIFEST_INVALID_JSON"}
    $schema=[string]$m.schema;if($schema-notin@("sokna-artifact-v1","sokna-artifact-pilot-v1")){throw "ARTIFACT_SCHEMA_UNSUPPORTED"}
    $artifactId=[string]$m.artifact_id;if($artifactId-notmatch'^[A-Za-z0-9._-]{1,100}$'){throw "ARTIFACT_ID_INVALID"}
    if($Apply-and([string]::IsNullOrWhiteSpace([string]$m.target.workspace)-or[string]::IsNullOrWhiteSpace([string]$m.target.branch)-or[string]::IsNullOrWhiteSpace([string]$m.target.base_head))){throw "ARTIFACT_TARGET_INCOMPLETE"}
    if($m.target.workspace-and[string]$m.target.workspace-ne[string]$w.name){throw "ARTIFACT_WORKSPACE_MISMATCH"}
    if($m.target.repo-and(NormRemote ([string]$m.target.repo))-ne(NormRemote (RepoRemote $w))){throw "ARTIFACT_REPO_MISMATCH"}
    $branch=GitText $w @("branch","--show-current");$head=GitText $w @("rev-parse","HEAD")
    if($m.target.branch-and[string]$m.target.branch-ne$branch){throw "ARTIFACT_BRANCH_MISMATCH"}
    if($m.target.base_head-and[string]$m.target.base_head-ne$head){throw "ARTIFACT_BASE_HEAD_MISMATCH"}
    if([string]$m.payload.type-ne"git_patch"){throw "ARTIFACT_PAYLOAD_UNSUPPORTED"}
    $rel=[string]$m.payload.path;if([string]::IsNullOrWhiteSpace($rel)){throw "ARTIFACT_PAYLOAD_PATH_REQUIRED"}
    $root=[IO.Path]::GetFullPath($stage);if(-not$root.EndsWith([IO.Path]::DirectorySeparatorChar)){$root+=[IO.Path]::DirectorySeparatorChar}
    $patch=[IO.Path]::GetFullPath((Join-Path $stage $rel));if(-not$patch.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw "ARTIFACT_PAYLOAD_PATH_ESCAPE"}
    if(-not(Test-Path $patch -PathType Leaf)){throw "ARTIFACT_PAYLOAD_MISSING"}
    $patchSha=Sha256File $patch;if(([string]$m.payload.sha256 -notmatch '^[a-fA-F0-9]{64}$') -or ($patchSha -ne ([string]$m.payload.sha256).ToLowerInvariant())){throw "ARTIFACT_PAYLOAD_SHA256_MISMATCH"}
    $declared=@($m.payload.files|ForEach-Object{[string]$_});if($declared.Count-eq0-or$declared.Count-gt1000){throw "ARTIFACT_FILE_LIST_INVALID"}
    $declaredUnique=@($declared|Sort-Object -Unique);if($declaredUnique.Count-ne$declared.Count){throw "ARTIFACT_FILE_LIST_DUPLICATE"}
    $actualFiles=@(GetArtifactPatchFiles $patch);$delta=@(Compare-Object -ReferenceObject $declaredUnique -DifferenceObject $actualFiles);if($delta.Count-gt0){throw "ARTIFACT_FILE_LIST_MISMATCH"}
    if($Apply-and([string]::IsNullOrWhiteSpace([string]$m.handoff.path)-or[string]$m.handoff.sha256-notmatch'^[a-fA-F0-9]{64}$')){throw "ARTIFACT_HANDOFF_REQUIRED"}
    if($m.handoff.path-and$m.handoff.sha256){$hf=[IO.Path]::GetFullPath((Join-Path $stage ([string]$m.handoff.path)));if(-not$hf.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)-or-not(Test-Path $hf -PathType Leaf)-or(Sha256File $hf)-ne([string]$m.handoff.sha256).ToLowerInvariant()){throw "ARTIFACT_HANDOFF_SHA256_MISMATCH"}}
    $check=RunProcess "git" @("apply","--check",$patch) $w.path 120;if($check.code-ne0){throw ("ARTIFACT_APPLY_CHECK_FAILED: "+$check.stderr+" "+$check.stdout)}
    if($Apply){
      $null=WriteArtifactAudit @{action="artifact.apply";phase="prepared";ok=$true;workspace=$w.name;artifact_id=$artifactId;artifact_sha256=$zipSha;path=$zip;size=(Get-Item $zip).Length;files=$actualFiles} -Required
      $run=RunProcess "git" @("apply",$patch) $w.path 120;if($run.code-ne0){$null=WriteArtifactAudit @{action="artifact.apply";phase="apply_failed";ok=$false;workspace=$w.name;artifact_id=$artifactId;error=($run.stderr+" "+$run.stdout)};throw ("ARTIFACT_APPLY_FAILED: "+$run.stderr+" "+$run.stdout)};$applied=$true
      try{$null=WriteArtifactAudit @{action="artifact.apply";phase="applied";ok=$true;workspace=$w.name;artifact_id=$artifactId;artifact_sha256=$zipSha;path=$zip;files=$actualFiles} -Required}catch{
        $rc=RunProcess "git" @("apply","--reverse","--check",$patch) $w.path 120;if($rc.code-eq0){$rr=RunProcess "git" @("apply","--reverse",$patch) $w.path 120;if($rr.code-eq0){$applied=$false;throw "ARTIFACT_AUDIT_FINALIZE_FAILED_ROLLED_BACK"}}
        throw "ARTIFACT_AUDIT_FINALIZE_FAILED_MANUAL_RECOVERY_REQUIRED"
      }
    }
    $elapsed=([DateTimeOffset]::UtcNow-$started).TotalMilliseconds
    return @{ok=$true;workspace=$w.name;artifact_root=(ArtifactRoot);artifact_path=$zip;artifact_id=$artifactId;schema=$schema;artifact_sha256=$zipSha;payload_sha256=$patchSha;base_head=$head;branch=$branch;apply_check=$true;applied=$applied;files=$actualFiles;audit_log=(ArtifactAuditPath);elapsed_ms=[int64]$elapsed;sync_guard=$sync}
  }finally{Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue}
}

function InvokeAction([string]$action,$p) {
  switch($action) {
    "artifact.root.status" { return (Get-SoknaArtifactRootStatus) }
    "artifact.import.local" { return (Invoke-SoknaArtifactProviderAcquire -Provider 'local_file' -Params $p) }
    "artifact.chat.import.download" { return (Invoke-SoknaChatArtifactImportDownload -Params $p) }
    "artifact.provider.status" { return (Get-SoknaArtifactProviderStatus) }
    "artifact.provider.probe" { return (Invoke-SoknaArtifactProviderProbe -Provider ([string]$p.provider) -Params $p) }
    "artifact.provider.acquire" { return (Invoke-SoknaArtifactProviderAcquire -Provider ([string]$p.provider) -Params $p) }
    "artifact.provider.verify" { return (Invoke-SoknaArtifactProviderVerify -Params $p) }
    "component.registry.status" { return (Get-SoknaComponentManagerStatus) }
    "component.list" { return @{ok=$true;components=@(Get-SoknaComponentList)} }
    "component.inspect" { return @{ok=$true;component=(Get-SoknaComponent ([string]$p.id))} }
    "component.register" {
      $display=if($null-ne$p.psobject.Properties['display_name']){[string]$p.display_name}else{[string]$p.id};$channel=if($null-ne$p.psobject.Properties['release_channel']){[string]$p.release_channel}else{'stable'};$entry=if($null-ne$p.psobject.Properties['entrypoint']){[string]$p.entrypoint}else{''};$args=if($null-ne$p.psobject.Properties['args']){@($p.args)}else{@()};$service=if($null-ne$p.psobject.Properties['service_name']){[string]$p.service_name}else{''};$health=if($null-ne$p.psobject.Properties['health_path']){[string]$p.health_path}else{''};$deps=if($null-ne$p.psobject.Properties['dependencies']){@($p.dependencies)}else{@()}
      $c=Register-SoknaComponent -Id ([string]$p.id) -DisplayName $display -Type ([string]$p.type) -ReleaseChannel $channel -EntryPoint $entry -CommandArgs $args -ServiceName $service -HealthPath $health -Dependencies $deps;return @{ok=$true;component=$c}
    }
    "component.channel.set" { return @{ok=$true;component=(Set-SoknaComponentReleaseChannel -Id ([string]$p.id) -Channel ([string]$p.channel))} }
    "component.dependency.acquire" {
      if($null-eq$p.psobject.Properties['provider']){throw 'component.dependency.acquire requires provider'};$acq=Invoke-SoknaArtifactProviderAcquire -Provider ([string]$p.provider) -Params $p;$c=Set-SoknaComponentDependencyEvidence -Id ([string]$p.id) -ArtifactId ([string]$acq.artifact_id) -Path ([string]$acq.path) -Sha256 ([string]$acq.sha256);return @{ok=$true;component=$c;artifact=$acq;auto_execute=$false}
    }
    "component.release.apply" {
      $id=[string]$p.id;$version=[string]$p.version;$artifactPath=[string]$p.artifact_path;if([string]::IsNullOrWhiteSpace($artifactPath)){throw 'component.release.apply requires artifact_path'};$expected=if($null-ne$p.psobject.Properties['expected_sha256']){[string]$p.expected_sha256}else{''};$verifyParams=[pscustomobject]@{path=$artifactPath;expected_sha256=$expected;artifact_id=($(if($null-ne$p.psobject.Properties['artifact_id']){[string]$p.artifact_id}else{''}))};$verified=Invoke-SoknaArtifactProviderVerify -Params $verifyParams;$full=Resolve-SoknaManagedArtifactPath -Path $artifactPath;$install=Install-SoknaComponentRelease -Id $id -Version $version -ArtifactAbsolutePath $full -ArtifactPath $artifactPath -Sha256 ([string]$verified.sha256);$activate=$true;if($null-ne$p.psobject.Properties['activate']){$activate=[bool]$p.activate};if(-not$activate){return @{ok=$true;installed=$install;activated=$false}};$act=Activate-SoknaComponentRelease -Id $id -Version $version;return @{ok=$true;installed=$install;activated=$true;activation=$act}
    }
    "component.start" { return (Start-SoknaComponent -Id ([string]$p.id)) }
    "component.stop" { return (Stop-SoknaComponent -Id ([string]$p.id)) }
    "component.restart" { return (Restart-SoknaComponent -Id ([string]$p.id)) }
    "component.health" { $retries=if($null-ne$p.psobject.Properties['retries']){[int]$p.retries}else{5};$delay=if($null-ne$p.psobject.Properties['delay_ms']){[int]$p.delay_ms}else{500};return (Test-SoknaComponentHealth -Id ([string]$p.id) -Retries $retries -DelayMs $delay) }
    "component.rollback" { return (Rollback-SoknaComponent -Id ([string]$p.id)) }
    "component.remove" { return (Remove-SoknaComponent -Id ([string]$p.id)) }
    "automation.list" { return @{ok=$true;automations=@(Get-SoknaAutomationList)} }
    "automation.register" {
      $w=Get-SoknaWorkspace ([string]$p.workspace);$rel=[string]$p.path;$plan=Resolve-SoknaWorkspacePath -Workspace $w -Path $rel -Access 'read';if(-not(Test-Path -LiteralPath $plan -PathType Leaf)){throw 'AUTOMATION_PLAN_NOT_FOUND'};$sha=if($null-ne$p.psobject.Properties['expected_sha256']){[string]$p.expected_sha256}else{''};if($sha-and(Sha256File $plan)-ne$sha.ToLowerInvariant()){throw 'AUTOMATION_PLAN_SHA256_MISMATCH'};if($null-eq$p.psobject.Properties['grant_scopes']){throw 'automation.register requires grant_scopes'};$tools=if($null-ne$p.psobject.Properties['grant_tools']){@($p.grant_tools)}else{@()};$interval=if($null-ne$p.psobject.Properties['interval_seconds']){[int64]$p.interval_seconds}else{0};$trigger=if($null-ne$p.psobject.Properties['trigger_key']){[string]$p.trigger_key}else{''};$missed=if($null-ne$p.psobject.Properties['missed_run_policy']){[string]$p.missed_run_policy}else{'run_once'};$ck=if($null-ne$p.psobject.Properties['concurrency_key']){[string]$p.concurrency_key}else{[string]$p.id};$max=if($null-ne$p.psobject.Properties['max_concurrency']){[int]$p.max_concurrency}else{1};$ttl=if($null-ne$p.psobject.Properties['grant_ttl_seconds']){[int]$p.grant_ttl_seconds}else{3600};$start=if($null-ne$p.psobject.Properties['start_unix_ms']){[int64]$p.start_unix_ms}else{0};$enabled=if($null-ne$p.psobject.Properties['enabled']){[bool]$p.enabled}else{$true};$a=Register-SoknaAutomation -Id ([string]$p.id) -WorkspaceId ([string]$w.id) -PlanPath $rel -ExpectedSha256 $sha -Type ([string]$p.type) -IntervalSeconds $interval -TriggerKey $trigger -MissedRunPolicy $missed -ConcurrencyKey $ck -MaxConcurrency $max -GrantScopes @($p.grant_scopes) -GrantTools $tools -GrantTtlSeconds $ttl -StartUnixMs $start -Enabled:$enabled;return @{ok=$true;automation=$a}
    }
    "automation.remove" { return (Remove-SoknaAutomation -Id ([string]$p.id)) }
    "automation.tick" { return (InvokeAutomationDispatch) }
    "automation.trigger" { if([string]::IsNullOrWhiteSpace([string]$p.trigger_key)-or[string]::IsNullOrWhiteSpace([string]$p.event_id)){throw 'automation.trigger requires trigger_key and event_id'};return (InvokeAutomationDispatch -TriggerKey ([string]$p.trigger_key) -EventId ([string]$p.event_id)) }
    "artifact.cleanup" { return (Invoke-SoknaArtifactCleanup -Execute:([bool]$p.execute)) }
    "artifact.inspect" {
      $w=ResolveWorkspace $p
      try{$r=InvokeArtifactPackage $w $p;$null=WriteArtifactAudit @{action="artifact.inspect";phase="validated";ok=$true;workspace=$w.name;artifact_id=$r.artifact_id;artifact_sha256=$r.artifact_sha256;path=$r.artifact_path;files=$r.files;elapsed_ms=$r.elapsed_ms};$null=Update-SoknaArtifactMetadataState -ArtifactId ([string]$r.artifact_id) -State 'validated' -Extra ([pscustomobject]@{artifact_sha256=$r.artifact_sha256;workspace=$w.name;validated_at=(Get-Date).ToUniversalTime().ToString('o')});return $r}catch{$null=WriteArtifactAudit @{action="artifact.inspect";phase="failed";ok=$false;workspace=$w.name;path=[string]$p.path;error=$_.Exception.Message};throw}
    }
    "artifact.apply" {
      $w=ResolveWorkspace $p
      try{$r=InvokeArtifactPackage $w $p -Apply;$null=Update-SoknaArtifactMetadataState -ArtifactId ([string]$r.artifact_id) -State 'applied' -Extra ([pscustomobject]@{artifact_sha256=$r.artifact_sha256;workspace=$w.name;applied_at=(Get-Date).ToUniversalTime().ToString('o')});return $r}catch{$null=WriteArtifactAudit @{action="artifact.apply";phase="failed";ok=$false;workspace=$w.name;path=[string]$p.path;error=$_.Exception.Message};throw}
    }
    "result.get" {
      $id=[string]$p.id
      if($id-notmatch'^[a-f0-9]{64}$'){throw "Invalid result ref id"}
      $dir=if($env:LOCALAPPDATA){Join-Path $env:LOCALAPPDATA "SOKNA\Bridge\results"}else{Join-Path $PSScriptRoot "results"}
      $path=Join-Path $dir ($id+".json")
      if(-not(Test-Path $path -PathType Leaf)){throw ("Result ref not found: "+$id)}
      $txt=[IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)
      $offset=if($p.offset){[Math]::Max([int]$p.offset,0)}else{0}
      $limit=if($p.limit){[Math]::Min([Math]::Max([int]$p.limit,1),12000)}else{8000}
      if($offset-gt$txt.Length){$offset=$txt.Length}
      $take=[Math]::Min($limit,$txt.Length-$offset)
      $chunk=if($take-gt0){$txt.Substring($offset,$take)}else{""}
      $next=$offset+$take
      return @{ok=$true;result_ref=$id;offset=$offset;next_offset=$next;total_chars=$txt.Length;done=($next-ge$txt.Length);content=$chunk}
    }
    "agent.capabilities" {$f=Join-Path $PSScriptRoot "AGENT_CAPABILITIES.json";if(-not(Test-Path $f -PathType Leaf)){throw "Capability manifest missing"};$c=Get-Content $f -Raw -Encoding UTF8|ConvertFrom-Json;return @{ok=$true;version=[string]$c.agent;capabilities=$c}}
    "ping" {
      $ws=Get-SoknaWorkspaceRegistryStatus
      return @{ok=$true;agent="sokna-bridge-v2.6.1";version="2.6.1";capabilities_action="agent.capabilities";artifact_root=(ArtifactRoot);artifact_log=(ArtifactAuditPath);browser_qa=(Get-SoknaBrowserQAStatus);artifact_providers=(Get-SoknaArtifactProviderStatus);computer=$env:COMPUTERNAME;default_workspace=[string]$ws.default_workspace;workspace_registry=[string]$ws.registry_path;workspaces=(WorkspaceSummary)}
    }
    "browser.qa.status" { return (Get-SoknaBrowserQAStatus) }
    "browser.recipe.run" {
      $w=ResolveWorkspace $p;AssertWorkspaceTool $w 'browser'
      $rel=[string]$p.path;if([string]::IsNullOrWhiteSpace($rel)){throw "browser recipe path required"};if([IO.Path]::GetExtension($rel).ToLowerInvariant()-ne'.json'){throw "browser recipe must be JSON"}
      $recipe=SafePath $w $rel 'read';$baseline=[string]$p.baseline_id;$job=[string]$p.job_id;$run=[string]$p.run_id
      return (Invoke-SoknaBrowserRecipe -RecipePath $recipe -Workspace ([string]$w.name) -JobId $job -BaselineId $baseline -RunId $run)
    }
    "browser.baseline.promote" {
      $w=ResolveWorkspace $p;AssertWorkspaceTool $w 'browser'
      return (Set-SoknaBrowserBaseline -Workspace ([string]$w.name) -RunId ([string]$p.run_id) -BaselineId ([string]$p.baseline_id) -Execute:([bool]$p.execute))
    }
    "browser.live.capture.policy" { return (Get-SoknaBrowserLiveCapturePolicy) }
    "workspace.registry.status" { return (Get-SoknaWorkspaceRegistryStatus) }
    "workspace.list" { $ws=Get-SoknaWorkspaceRegistryStatus;return @{ok=$true;default_workspace=[string]$ws.default_workspace;registry_path=[string]$ws.registry_path;audit_path=[string]$ws.audit_path;workspaces=(WorkspaceSummary)} }
    "workspace.inspect" {
      $w=ResolveWorkspace $p;$a=Get-SoknaWorkspaceAssessment ([string]$w.path)
      return @{ok=$true;workspace=$w.name;display_name=$w.display_name;kind=$w.kind;path=$w.path;scopes=@($w.scopes);tools=@($w.tools);write_enabled=[bool]$w.write_enabled;expected_repo=$w.expected_repo;assessment=$a}
    }
    "workspace.register" {
      if($null-eq$p.psobject.Properties['id']-or[string]::IsNullOrWhiteSpace([string]$p.id)){throw "workspace.register requires id"}
      if($null-eq$p.psobject.Properties['root']-or[string]::IsNullOrWhiteSpace([string]$p.root)){throw "workspace.register requires root"}
      if($null-eq$p.psobject.Properties['scopes']){throw "workspace.register requires explicit scopes"}
      $display=if($null-ne$p.psobject.Properties['display_name']){[string]$p.display_name}else{[string]$p.id}
      $tools=if($null-ne$p.psobject.Properties['tools']){@($p.tools)}else{@()}
      $w=Register-SoknaWorkspace -Id ([string]$p.id) -DisplayName $display -Root ([string]$p.root) -Scopes @($p.scopes) -Tools $tools
      return @{ok=$true;workspace=$w}
    }
    "workspace.permissions.update" {
      if($null-eq$p.psobject.Properties['id']-or[string]::IsNullOrWhiteSpace([string]$p.id)){throw "workspace.permissions.update requires id"}
      if($null-eq$p.psobject.Properties['scopes']){throw "workspace.permissions.update requires explicit scopes"}
      if($null-eq$p.psobject.Properties['tools']){throw "workspace.permissions.update requires explicit tools"}
      $w=Update-SoknaWorkspacePermissions -Id ([string]$p.id) -Scopes @($p.scopes) -Tools @($p.tools)
      return @{ok=$true;workspace=$w}
    }
    "workspace.unregister" { return (Unregister-SoknaWorkspace -Id ([string]$p.id)) }
    "workspace.assess" { $a=Get-SoknaWorkspaceAssessment ([string]$p.root);return @{ok=$true;assessment=$a} }
    "workspace.managed_copy.plan" { $plan=New-SoknaManagedCopyPlan -Source ([string]$p.source) -Destination ([string]$p.destination);return @{ok=$true;plan=$plan} }
    "workspace.policy.status" { $gid='';$jid='';if($null-ne$p.psobject.Properties['grant_id']){$gid=[string]$p.grant_id};if($null-ne$p.psobject.Properties['job_id']){$jid=[string]$p.job_id};return (Get-SoknaWorkspaceAdvancedStatus -WorkspaceId ([string]$p.workspace) -GrantId $gid -JobId $jid) }
    "workspace.grant.create" {
      if($null-eq$p.psobject.Properties['id']-or[string]::IsNullOrWhiteSpace([string]$p.id)-or$null-eq$p.psobject.Properties['job_id']-or[string]::IsNullOrWhiteSpace([string]$p.job_id)){throw 'workspace.grant.create requires id and job_id'}
      if($null-eq$p.psobject.Properties['workspace']-or[string]::IsNullOrWhiteSpace([string]$p.workspace)){throw 'workspace.grant.create requires workspace'}
      if($null-eq$p.psobject.Properties['issuer']-or[string]::IsNullOrWhiteSpace([string]$p.issuer)){throw 'workspace.grant.create requires issuer'}
      if($null-eq$p.psobject.Properties['scopes']){throw 'workspace.grant.create requires scopes'}
      $ttl=if($null-ne$p.psobject.Properties['ttl_seconds'] -and $null-ne$p.ttl_seconds){[Math]::Min([Math]::Max([int]$p.ttl_seconds,1),86400)}else{900}
      $tools=if($null-ne$p.psobject.Properties['tools']){@($p.tools)}else{@()}
      $g=New-SoknaWorkspaceGrant -Id ([string]$p.id) -WorkspaceId ([string]$p.workspace) -JobId ([string]$p.job_id) -Issuer ([string]$p.issuer) -Context ($(if($null-ne$p.psobject.Properties['context']){[string]$p.context}else{''})) -Scopes @($p.scopes) -Tools $tools -TtlSeconds $ttl
      return @{ok=$true;grant=$g}
    }
    "workspace.grant.revoke" {
      if($null-eq$p.psobject.Properties['id']-or[string]::IsNullOrWhiteSpace([string]$p.id)-or$null-eq$p.psobject.Properties['issuer']-or[string]::IsNullOrWhiteSpace([string]$p.issuer)){throw 'workspace.grant.revoke requires id and issuer'}
      return (Revoke-SoknaWorkspaceGrant -Id ([string]$p.id) -Issuer ([string]$p.issuer))
    }
    "workspace.remote.register" {
      $display=if($null-ne$p.psobject.Properties['display_name']){[string]$p.display_name}else{[string]$p.id}
      $credential=if($null-ne$p.psobject.Properties['credential_ref']){[string]$p.credential_ref}else{''}
      $tools=if($null-ne$p.psobject.Properties['tools']){@($p.tools)}else{@()}
      $w=Register-SoknaRemoteWorkspace -Id ([string]$p.id) -DisplayName $display -Adapter ([string]$p.adapter) -EndpointRef ([string]$p.endpoint_ref) -RootRef ([string]$p.root_ref) -CredentialRef $credential -Scopes @($p.scopes) -Tools $tools
      return @{ok=$true;workspace=$w}
    }
    "workspace.remote.exec" {
      $w=ResolveWorkspace $p
      $remoteArgs=if($null-ne$p.psobject.Properties['args']){@($p.args)}else{@()}
      return (Invoke-SoknaRemoteWorkspaceAdapter -Workspace $w -GrantId ([string]$p.grant_id) -JobId ([string]$p.job_id) -Path ([string]$p.path) -Operation ([string]$p.operation) -CommandArgs $remoteArgs)
    }
    "workspace.ephemeral.checkout" {
      $source=ResolveWorkspace $p
      if([string]$source.kind-ne'persistent_local'){throw 'EPHEMERAL_SOURCE_MUST_BE_PERSISTENT_LOCAL'}
      $null=Assert-SoknaWorkspaceFullAccess -Workspace $source -Access 'read';AssertWorkspaceTool $source 'git'
      $jobId=[string]$p.job_id;if([string]::IsNullOrWhiteSpace($jobId)){throw 'EPHEMERAL_JOB_ID_REQUIRED'}
      $id='';if($null-ne$p.psobject.Properties['id']){$id=[string]$p.id};if([string]::IsNullOrWhiteSpace($id)){$id='ep-'+$jobId}
      if($id-notmatch'^[A-Za-z0-9._-]{1,80}$'){throw 'EPHEMERAL_ID_INVALID'}
      $stateDir=Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($ConfigPath))) 'state';$epRoot=Join-Path $stateDir 'ephemeral';$target=Join-Path (Join-Path $epRoot $jobId) $id
      if(Test-Path -LiteralPath $target){throw 'EPHEMERAL_TARGET_EXISTS'};New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null
      $r=RunProcess 'git' @('clone','--no-hardlinks','--no-checkout',$source.path,$target) (Split-Path -Parent $target) 600
      if($r.code-ne0){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue;throw ('EPHEMERAL_CLONE_FAILED: '+$r.stderr)}
      $ref='';if($null-ne$p.psobject.Properties['ref']){$ref=[string]$p.ref};if([string]::IsNullOrWhiteSpace($ref)){$ref='HEAD'};if($ref-notmatch'^[A-Za-z0-9._/@+-]{1,200}$'){Remove-Item -LiteralPath $target -Recurse -Force;throw 'EPHEMERAL_REF_INVALID'}
      $co=RunProcess 'git' @('checkout','--detach',$ref) $target 300;if($co.code-ne0){Remove-Item -LiteralPath $target -Recurse -Force;throw ('EPHEMERAL_CHECKOUT_FAILED: '+$co.stderr)}
      $ttl=if($null-ne$p.psobject.Properties['ttl_seconds'] -and $p.ttl_seconds){[Math]::Min([Math]::Max([int]$p.ttl_seconds,60),86400)}else{3600}
      $scopes=if($null-ne$p.psobject.Properties['scopes']){@($p.scopes)}else{@([pscustomobject]@{path='.';access='write'})};$tools=if($null-ne$p.psobject.Properties['tools']){@($p.tools)}else{@('git')}
      $w=Register-SoknaEphemeralWorkspace -Id $id -DisplayName ($(if($null-ne$p.psobject.Properties['display_name']){[string]$p.display_name}else{$id})) -Root $target -JobId $jobId -TtlSeconds $ttl -Scopes $scopes -Tools $tools
      return @{ok=$true;workspace=$w;source_workspace=$source.id;job_id=$jobId;cleanup='expiry_or_job_orphan'}
    }
    "workspace.advanced.cleanup" {
      $active=@();if(Test-Path (JobsDir)){foreach($f in Get-ChildItem (JobsDir) -Filter '*.json' -File){try{$j=Get-Content $f.FullName -Raw -Encoding UTF8|ConvertFrom-Json;if(([string]$j.status)-in@('queued','running')){$active+=[string]$j.id}}catch{}}}
      return (Invoke-SoknaWorkspaceAdvancedCleanup -ActiveJobIds $active)
    }
    "system.capabilities" {
      $w=ResolveWorkspace $p
      return @{ok=$true;workspace=$w.name;git=(ToolVersion $w "git" @("--version"));gh=(ToolVersion $w "gh" @("--version"));php=(ToolVersion $w "php" @("--version"));node=(ToolVersion $w "node" @("--version"));composer=(ToolVersion $w "composer" @("--version"));dotnet=(ToolVersion $w "dotnet" @("--version"));powershell=(ToolVersion $w "powershell" @("-NoProfile","-Command",'$PSVersionTable.PSVersion.ToString()'))}
    }
    "repo.inspect" {
      $w=ResolveWorkspace $p;VerifyWorkspaceRemote $w
      $st=RunProcess "git" @("status","--short","--branch") $w.path 60
      $br=RunProcess "git" @("branch","--show-current") $w.path 60
      $rm=RunProcess "git" @("remote","-v") $w.path 60
      $lg=RunProcess "git" @("log","--oneline","--decorate","-10") $w.path 60
      return @{ok=($st.code-eq0-and$br.code-eq0);workspace=$w.name;write_enabled=$w.write_enabled;branch=$br.stdout;status=$st.stdout;remotes=$rm.stdout;log=$lg.stdout}
    }
    "repo.sync.preflight" {$w=ResolveWorkspace $p;return (GetSyncSnapshot $w)}
    "repo.sync.apply_ff" {
      $w=ResolveWorkspace $p
      $s=GetSyncSnapshot $w
      if(-not$s.clean){throw "Working tree is not clean; fast-forward blocked."}
      if([string]::IsNullOrWhiteSpace([string]$s.upstream)){throw "Current branch has no upstream."}
      if($s.ahead-gt0-and$s.behind-gt0){throw "Local and upstream have diverged."}
      if($s.behind-eq0){return @{ok=$true;changed=$false;snapshot=$s}}
      if($s.ahead-gt0){throw "Local branch has commits not on upstream; pull blocked."}
      $before=$s.head;$pull=RunProcess "git" @("pull","--ff-only") $w.path 300
      if($pull.code-ne0){throw ("Fast-forward failed: "+$pull.stderr+" "+$pull.stdout)}
      return @{ok=$true;changed=$true;before_head=$before;after=(GetSyncSnapshot $w);pull_output=$pull.stdout}
    }
    "file.list" {
      $w=ResolveWorkspace $p;$rel=[string]$p.path;if([string]::IsNullOrWhiteSpace($rel)){$rel='.'}
      $items=GetReadableWorkspaceEntries $w $rel 1200
      return @{ok=$true;workspace=$w.name;items=$items}
    }
    "file.read" {
      $w=ResolveWorkspace $p;$rel=[string]$p.path;$path=SafePath $w $rel 'read'
      if(-not(Test-Path $path -PathType Leaf)){throw "Not a file: $rel"}
      $lines=[IO.File]::ReadAllLines($path,[Text.Encoding]::UTF8);$startLine=if($p.start_line){[Math]::Max([int]$p.start_line,1)}else{1};$count=if($p.line_count){[Math]::Min([int]$p.line_count,2500)}else{500};$slice=$lines|Select-Object -Skip ($startLine-1) -First $count
      return @{ok=$true;workspace=$w.name;path=$rel;sha256=(Sha256File $path);start_line=$startLine;content=(Clip ($slice-join"`n") 32000);total_lines=$lines.Count}
    }
    "file.search" {
      $w=ResolveWorkspace $p;$q=[string]$p.query;if([string]::IsNullOrWhiteSpace($q)){throw "query required"};$glob=if($p.glob){[string]$p.glob}else{"*"};$max=if($p.max_results){[Math]::Min([Math]::Max([int]$p.max_results,1),300)}else{100};$out=@()
      $files=GetReadableWorkspaceFiles $w '.' $glob 5000
      foreach($f in $files){if($out.Count-ge$max){break};try{$lines=[IO.File]::ReadAllLines($f.FullName,[Text.Encoding]::UTF8);for($i=0;$i-lt$lines.Length;$i++){if($lines[$i].IndexOf($q,[StringComparison]::OrdinalIgnoreCase)-ge0){$rel=$f.FullName.Substring(([string]$w.path).TrimEnd('\','/').Length).TrimStart('\','/');$out+=@{path=$rel;line=$i+1;text=(Clip ([string]$lines[$i]) 1000)};if($out.Count-ge$max){break}}}}catch{}}
      return @{ok=$true;workspace=$w.name;query=$q;matches=$out}
    }
    "file.replace" {
      $w=ResolveWorkspace $p;$rel=[string]$p.path;$path=SafePath $w $rel 'write';$sync=GetOptionalFreshnessGuard $w;$expected=[string]$p.expected_sha256
      if($expected-and(Sha256File $path)-ne$expected.ToLowerInvariant()){throw "SHA256 mismatch"};$old=[string]$p.old;$new=[string]$p.new;if([string]::IsNullOrEmpty($old)){throw "old text required"}
      $txt=[IO.File]::ReadAllText($path,[Text.Encoding]::UTF8);$count=([regex]::Matches($txt,[regex]::Escape($old))).Count;if($count-ne1){throw "Expected exactly one match, found $count"}
      [IO.File]::WriteAllText($path,$txt.Replace($old,$new),(New-Object Text.UTF8Encoding($false)))
      return @{ok=$true;workspace=$w.name;path=$rel;sha256=(Sha256File $path);sync_guard=$sync}
    }
    "file.write" {
      $w=ResolveWorkspace $p;$rel=[string]$p.path;$path=SafePath $w $rel 'write' -AllowMissing;$sync=GetOptionalFreshnessGuard $w;$expected=[string]$p.expected_sha256
      if($expected-and(Test-Path $path)-and(Sha256File $path)-ne$expected.ToLowerInvariant()){throw "SHA256 mismatch"}
      $dir=Split-Path $path -Parent;if(-not(Test-Path $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
      [IO.File]::WriteAllText($path,[string]$p.content,(New-Object Text.UTF8Encoding($false)))
      return @{ok=$true;workspace=$w.name;path=$rel;sha256=(Sha256File $path);sync_guard=$sync}
    }
    "process.run" {
      $w=ResolveWorkspace $p;$exe=[string]$p.exe;$mutating=[bool]$p.mutating;$access=if($mutating){'write'}else{'read'}
      $null=Assert-SoknaWorkspaceFullAccess -Workspace $w -Access $access;AssertWorkspaceTool $w $exe
      $sync=$null;if($mutating){$sync=GetOptionalFreshnessGuard $w}
      $a=@();if($p.args){$a=@($p.args|ForEach-Object{[string]$_})}
      $cwd=$w.path;if($p.cwd){$cwd=SafePath $w ([string]$p.cwd) $access}
      $timeout=if($p.timeout_sec){[Math]::Min([Math]::Max([int]$p.timeout_sec,1),1800)}else{180}
      $r=RunProcess $exe $a $cwd $timeout
      return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;stdout=$r.stdout;stderr=$r.stderr;sync_guard=$sync}
    }
    "git.status" {$w=ResolveWorkspace $p;AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'git';$r=RunProcess "git" @("status","--short","--branch") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;write_enabled=$w.write_enabled;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.diff" {$w=ResolveWorkspace $p;AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'git';$a=@("diff","--no-ext-diff");if($p.cached){$a+=("--cached")};$r=RunProcess "git" $a $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=(Clip $r.stdout 32000);error=$r.stderr}}
    "git.log" {$w=ResolveWorkspace $p;AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'git';$n=if($p.count){[Math]::Min([Math]::Max([int]$p.count,1),100)}else{20};$r=RunProcess "git" @("log","--oneline","--decorate","-$n") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.fetch" {$w=ResolveWorkspace $p;AssertWorkspaceWritable $w;AssertWorkspaceTool $w 'git';VerifyWorkspaceRemote $w;$r=RunProcess "git" @("fetch","--prune","origin") $w.path 300;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.switch" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$name=[string]$p.name;if($name-notmatch'^[A-Za-z0-9._/-]+$'){throw "Invalid branch"};$r=RunProcess "git" @("switch",$name) $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "git.branch.create" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$name=[string]$p.name;if($name-notmatch'^[A-Za-z0-9._/-]+$'){throw "Invalid branch"};$r=RunProcess "git" @("switch","-c",$name) $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "git.add.paths" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$paths=@($p.paths);if($paths.Count-eq0){throw "paths required"};foreach($x in $paths){$rel=[string]$x;$null=SafePath $w $rel 'write' -AllowMissing;$r=RunProcess "git" @("add","--",$rel) $w.path 60;if($r.code-ne0){throw $r.stderr}};return @{ok=$true;workspace=$w.name;paths=$paths;sync_guard=$sync}}
    "git.add" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$r=RunProcess "git" @("add","-A") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "git.commit" {$w=ResolveWorkspace $p;$msg=[string]$p.message;if([string]::IsNullOrWhiteSpace($msg)){throw "message required"};$sync=AssertFreshWritable $w;$r=RunProcess "git" @("commit","-m",$msg) $w.path 120;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "git.push" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$b=(RunProcess "git" @("branch","--show-current") $w.path 60).stdout.Trim();if($b-in@("main","master","production")){throw "Direct push to protected branch blocked"};$r=RunProcess "git" @("push","-u","origin",$b) $w.path 300;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;branch=$b;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "gh.auth.status" {$w=ResolveWorkspace $p;AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'gh';$r=RunProcess "gh" @("auth","status") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "github.repo.create" {
      $w=ResolveWorkspace $p;AssertWorkspaceReadable $w;AssertWorkspaceTool $w 'gh'
      $name=[string]$p.name;if($name-notmatch'^[A-Za-z0-9._-]+$'){throw "Invalid repository name"}
      $owner=[string]$p.owner;if([string]::IsNullOrWhiteSpace($owner)){$owner=[string]$script:cfg.default_github_owner}
      if($script:cfg.allowed_github_owners-notcontains$owner){throw "GitHub owner not allowed: $owner"}
      $vis=[string]$p.visibility;if($vis-notin@("private","public","internal")){$vis="private"}
      $args=@("repo","create","$owner/$name","--$vis")
      if($p.description){$args+=@("--description",[string]$p.description)}
      $r=RunProcess "gh" $args $w.path 120
      return @{ok=($r.code-eq0);code=$r.code;stdout=$r.stdout;stderr=$r.stderr;repository="$owner/$name"}
    }
    "plan.stage" {$w=ResolveWorkspace $p;$r=[string]$p.path
      if($r-notmatch'^tools[\/]+plans[\/]+[A-Za-z0-9._-]+\.json$'){throw "Invalid plan path"}
      $f=SafePath $w $r 'write' -AllowMissing;$sync=GetOptionalFreshnessGuard $w;if((-not$p.reset)-and$p.expected_sha256-and((Sha256File $f)-ne([string]$p.expected_sha256).ToLowerInvariant())){throw "Stage SHA256 mismatch"};$b=[Convert]::FromBase64String([string]$p.data_b64);if($b.Length-gt512){throw "Chunk too large"}
      $d=Split-Path $f -Parent;if(-not(Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}
      if($p.reset){[IO.File]::WriteAllBytes($f,$b)}else{if(-not(Test-Path $f)){throw "Stage file missing"};$s=[IO.File]::Open($f,'Append');try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}}
      return @{ok=$true;path=$r;sha256=(Sha256File $f);size=(Get-Item $f).Length;sync_guard=$sync}
    }
    "plan.run" {
      $w=ResolveWorkspace $p
      $rel=[string]$p.path
      if([string]::IsNullOrWhiteSpace($rel)){throw "plan path required"}
      $path=SafePath $w $rel 'read'
      if(-not(Test-Path $path -PathType Leaf)){throw ("Plan not found: "+$rel)}
      if($p.expected_sha256 -and (Sha256File $path) -ne ([string]$p.expected_sha256).ToLowerInvariant()){throw "Plan SHA256 mismatch"}
      try{$plan=Get-Content $path -Raw -Encoding UTF8|ConvertFrom-Json}catch{throw ("Invalid plan JSON: "+$_.Exception.Message)}
      $planId=[string]$plan.id
      if([string]::IsNullOrWhiteSpace($planId)){throw "plan id required"}
      $steps=@($plan.steps)
      if($steps.Count-gt100){throw "Max 100 plan steps"}
      $results=@()
      foreach($s in $steps){
        $action=[string]$s.action
        if([string]::IsNullOrWhiteSpace($action)){throw "plan step action required"}
        if($action-eq"plan.run"){throw "Recursive plan.run is blocked"}
        $sp=$s.params
        if($null-eq$sp){$sp=[pscustomobject]@{}}
        if(-not$sp.workspace){$sp|Add-Member -NotePropertyName workspace -NotePropertyValue $w.name -Force}
        if($null-ne$p.psobject.Properties['grant_id'] -and [string]$p.grant_id -and $null-eq$sp.psobject.Properties['grant_id']){$sp|Add-Member -NotePropertyName grant_id -NotePropertyValue ([string]$p.grant_id) -Force}
        if($null-ne$p.psobject.Properties['job_id'] -and [string]$p.job_id -and $null-eq$sp.psobject.Properties['job_id']){$sp|Add-Member -NotePropertyName job_id -NotePropertyValue ([string]$p.job_id) -Force}
        try{
          $r=InvokeAction $action $sp
          $results+=@{name=[string]$s.name;action=$action;result=$r}
          if($s.stop_on_error-and-not$r.ok){break}
        }catch{
          $results+=@{name=[string]$s.name;action=$action;result=@{ok=$false;error=$_.Exception.Message}}
          if($s.stop_on_error){break}
        }
      }
      $all=$true
      foreach($x in $results){if(-not$x.result.ok){$all=$false}}
      return @{ok=$all;plan_id=$planId;path=$rel;workspace=$w.name;results=$results}
    }
    "job.submit" {
      $w=ResolveWorkspace $p
      $rel=[string]$p.path
      if([string]::IsNullOrWhiteSpace($rel)){throw "job plan path required"}
      $path=SafePath $w $rel 'read'
      if(-not(Test-Path $path -PathType Leaf)){throw ("Plan not found: "+$rel)}
      if($p.expected_sha256 -and (Sha256File $path) -ne ([string]$p.expected_sha256).ToLowerInvariant()){throw "Plan SHA256 mismatch"}
      $id=[string]$p.id
      if([string]::IsNullOrWhiteSpace($id)){$id="job-"+[Guid]::NewGuid().ToString("N")}
      $jp=JobPath $id
      if(Test-Path $jp){throw ("Job already exists: "+$id)}
      $grantId='';if($null-ne$p.psobject.Properties['grant_id']){$grantId=[string]$p.grant_id};if($grantId){$null=Get-SoknaWorkspaceGrant $grantId $w.name $id}
      $j=[pscustomobject]@{id=$id;status="queued";workspace=$w.name;grant_id=$grantId;path=$rel;expected_sha256=[string]$p.expected_sha256;created_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();worker_pid=$null;started_at=$null;finished_at=$null;recovered_at=$null;result=$null;error=$null}
      WriteJob $j|Out-Null
      try{
        $workerPid=StartJobWorker $id
        $j=ReadJob $id
        $j.worker_pid=$workerPid
        WriteJob $j|Out-Null
        return @{ok=$true;job_id=$id;status=$j.status;worker_pid=$workerPid}
      }catch{
        $j=ReadJob $id
        $j.status='failed';$j.finished_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.error=$_.Exception.Message
        WriteJob $j|Out-Null
        throw
      }
    }

    "job.get" { $j=ReadJob ([string]$p.id); return @{ok=$true;job=$j} }
    "job.batch" {
      $results=@();$steps=@($p.steps);if($steps.Count-gt30){throw "Max 30 steps"}
      foreach($s in $steps){
        $sp=$s.params
        if($null-eq$sp){$sp=[pscustomobject]@{}}
        if(-not$sp.workspace -and $p.workspace){$sp|Add-Member -NotePropertyName workspace -NotePropertyValue ([string]$p.workspace) -Force}
        if($null-ne$p.psobject.Properties['grant_id'] -and [string]$p.grant_id -and $null-eq$sp.psobject.Properties['grant_id']){$sp|Add-Member -NotePropertyName grant_id -NotePropertyValue ([string]$p.grant_id) -Force}
        if($null-ne$p.psobject.Properties['job_id'] -and [string]$p.job_id -and $null-eq$sp.psobject.Properties['job_id']){$sp|Add-Member -NotePropertyName job_id -NotePropertyValue ([string]$p.job_id) -Force}
        try{$r=InvokeAction ([string]$s.action) $sp;$results+=@{name=[string]$s.name;action=[string]$s.action;result=$r};if($s.stop_on_error-and-not$r.ok){break}}
        catch{$results+=@{name=[string]$s.name;action=[string]$s.action;result=@{ok=$false;error=$_.Exception.Message}};if($s.stop_on_error){break}}
      }
      $all=$true;foreach($x in $results){if(-not$x.result.ok){$all=$false}};return @{ok=$all;results=$results}
    }
    default {throw "Unknown action: $action"}
  }
}

if(-not(Test-Path $ConfigPath)){throw "config.json missing. Re-run SOKNA Bridge Setup."}
$script:cfg=Get-Content $ConfigPath -Raw -Encoding UTF8|ConvertFrom-Json
$null=Initialize-SoknaArtifactRoot -Config $script:cfg -RuntimeRoot $PSScriptRoot
$null=Initialize-SoknaWorkspaceRegistry -Config $script:cfg -ConfigPath $ConfigPath -RuntimeRoot $PSScriptRoot
$null=Initialize-SoknaBrowserQA -Config $script:cfg -RuntimeRoot $PSScriptRoot
$null=Initialize-SoknaArtifactProviders -Config $script:cfg -RuntimeRoot $PSScriptRoot
$null=Initialize-SoknaComponentManager -Config $script:cfg -ConfigPath $ConfigPath -RuntimeRoot $PSScriptRoot
$null=WorkspaceSummary

if($RunScheduler){
  $pidPath=SchedulerPidPath
  try{
    while($true){
      if($SchedulerParentPid-le0){break};$parent=Get-Process -Id $SchedulerParentPid -ErrorAction SilentlyContinue;if($null-eq$parent){break}
      try{$null=InvokeAutomationDispatch}catch{}
      Start-Sleep -Seconds 30
    }
  }finally{
    try{if(Test-Path -LiteralPath $pidPath -PathType Leaf){$rec=Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8|ConvertFrom-Json;if([int]$rec.pid-eq$PID){Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue}}}catch{}
  }
  exit 0
}

if($StartupProbe){
  $capPath=Join-Path $PSScriptRoot "AGENT_CAPABILITIES.json"
  if(-not(Test-Path $capPath -PathType Leaf)){throw "STARTUP_PROBE_CAPABILITIES_MISSING"}
  $probeCaps=Get-Content $capPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$probeCaps.agent-ne"2.6.1"){throw "STARTUP_PROBE_CAPABILITIES_VERSION"}
  $probeArtifactRoot=ArtifactRoot
  $probeWs=Get-SoknaWorkspaceRegistryStatus
  $probeBrowser=Get-SoknaBrowserQAStatus
  $probeComponents=Get-SoknaComponentManagerStatus
  [ordered]@{ok=$true;mode="startup-probe";version="2.6.1";capabilities_version=[string]$probeCaps.agent;artifact_root=$probeArtifactRoot;workspace_registry=[string]$probeWs.registry_path;default_workspace=[string]$probeWs.default_workspace;workspaces=@(WorkspaceSummary).Count;browser_runner_available=[bool]$probeBrowser.runner_available;component_count=[int]$probeComponents.component_count;automation_count=[int]$probeComponents.automation_count}|ConvertTo-Json -Compress
  exit 0
}

if($RunJobId){
  $j=ReadJob $RunJobId
  $j.status='running';$j.started_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.worker_pid=$PID;WriteJob $j|Out-Null
  try{
    $pp=[pscustomobject]@{workspace=[string]$j.workspace;path=[string]$j.path}
    if($j.expected_sha256){$pp|Add-Member -NotePropertyName expected_sha256 -NotePropertyValue ([string]$j.expected_sha256)}
    if($null-ne$j.psobject.Properties['grant_id'] -and [string]$j.grant_id){$pp|Add-Member -NotePropertyName grant_id -NotePropertyValue ([string]$j.grant_id);$pp|Add-Member -NotePropertyName job_id -NotePropertyValue ([string]$j.id)}
    $r=InvokeAction 'plan.run' $pp
    $j=ReadJob $RunJobId
    $j.status=if($r.ok){'done'}else{'failed'}
    $j.finished_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.result=$r;WriteJob $j|Out-Null
    RevokeAutomationGrantForJob $j
    if($r.ok){exit 0}else{exit 1}
  }catch{
    try{$j=ReadJob $RunJobId;$j.status='failed';$j.finished_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.error=$_.Exception.Message;WriteJob $j|Out-Null;RevokeAutomationGrantForJob $j}catch{}
    exit 1
  }
}

function RecoverJobs{
  $d=JobsDir
  if(-not(Test-Path $d)){return}
  foreach($f in Get-ChildItem $d -Filter '*.json' -File){
    try{
      $j=Get-Content $f.FullName -Raw -Encoding UTF8|ConvertFrom-Json
      if(([string]$j.status)-notin @('queued','running')){continue}
      if(([string]$j.status)-eq'running' -and $j.worker_pid){
        $alive=Get-Process -Id ([int]$j.worker_pid) -ErrorAction SilentlyContinue
        if($alive){continue}
      }
      $j.status='queued'
      $j.recovered_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $wp=StartJobWorker ([string]$j.id)
      $j.worker_pid=$wp
            WriteJob $j|Out-Null
      }catch{}
  }
}

$null=RecoverJobs
try{$active=@();if(Test-Path (JobsDir)){foreach($f in Get-ChildItem (JobsDir) -Filter '*.json' -File){try{$j=Get-Content $f.FullName -Raw -Encoding UTF8|ConvertFrom-Json;if(([string]$j.status)-in@('queued','running')){$active+=[string]$j.id}}catch{}}};$null=Invoke-SoknaWorkspaceAdvancedCleanup -ActiveJobIds $active}catch{}
$listener=New-Object Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$($cfg.port)/")
try{$listener.Start()}catch{Write-Host("Could not bind SOKNA Bridge endpoint: "+$_.Exception.Message)-ForegroundColor Red;exit 2}
$schedulerPid=StartAutomationSchedulerWorker
Set-Content "$PSScriptRoot\agent.pid" $PID -Encoding ASCII
Write-Host "SOKNA Bridge V2.6.1 agent running" -ForegroundColor Green
Write-Host "Default workspace: $((Get-SoknaWorkspaceRegistryStatus).default_workspace)"
Write-Host "Endpoint: http://127.0.0.1:$($cfg.port)"
try {
  while($listener.IsListening){
    $ctx=$listener.GetContext()
    try{
      if($ctx.Request.Url.AbsolutePath-ne"/api"-or$ctx.Request.HttpMethod-ne"POST"){JsonResponse $ctx 404 @{ok=$false;error="Not found"};continue}
      if($ctx.Request.Headers["X-Sokna-Token"]-ne[string]$cfg.token){JsonResponse $ctx 403 @{ok=$false;error="Forbidden"};continue}
      $rd=New-Object IO.StreamReader($ctx.Request.InputStream,$ctx.Request.ContentEncoding);$cmd=($rd.ReadToEnd()|ConvertFrom-Json);$id=[string]$cmd.id
      if([string]::IsNullOrWhiteSpace($id)){JsonResponse $ctx 400 @{ok=$false;error="Command id required"};continue}
      $state=LoadState
      if($state.ContainsKey($id)-and$state[$id].status-eq"done"){$cached=$state[$id].result;try{$cached.cached=$true}catch{};JsonResponse $ctx 200 $cached;continue}
      $state[$id]=@{status="running";ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()};SaveState $state
      try{$res=InvokeAction ([string]$cmd.action) $cmd.params;$state=LoadState;$state[$id]=@{status="done";ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();result=$res};SaveState $state;JsonResponse $ctx 200 $res}
      catch{$res=@{ok=$false;error=$_.Exception.Message};$state=LoadState;$state[$id]=@{status="done";ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();result=$res};SaveState $state;JsonResponse $ctx 500 $res}
    }catch{try{JsonResponse $ctx 500 @{ok=$false;error=$_.Exception.Message}}catch{}}
  }
} finally {try{$listener.Stop()}catch{};Remove-Item "$PSScriptRoot\agent.pid" -Force -ErrorAction SilentlyContinue}
