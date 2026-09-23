param([string]$ConfigPath="$PSScriptRoot\config.json",[string]$RunJobId="",[switch]$StartupProbe)
$ErrorActionPreference="Stop"

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

function ReadJob([string]$id){$p=JobPath $id;if(-not(Test-Path $p -PathType Leaf)){throw "Job not found: $id"};return(Get-Content $p -Raw -Encoding UTF8|ConvertFrom-Json)}
function WriteJob($j){$d=JobsDir;if(-not(Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};$p=JobPath([string]$j.id);$tmp=$p+".tmp."+$PID;$j|ConvertTo-Json -Depth 40|Set-Content $tmp -Encoding UTF8;Move-Item $tmp $p -Force;return $p}

function StartJobWorker([string]$id){$a=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-ConfigPath',$ConfigPath,'-RunJobId',$id);return (Start-Process powershell.exe -ArgumentList $a -WindowStyle Hidden -PassThru).Id}

function WorkspaceMap {
  $h=@{}
  foreach($p in $script:cfg.workspaces.psobject.Properties){$h[$p.Name]=$p.Value}
  return $h
}
function ResolveWorkspace($p) {
  $name=[string]$p.workspace
  if([string]::IsNullOrWhiteSpace($name)){$name=[string]$script:cfg.default_workspace}
  $map=WorkspaceMap
  if(-not$map.ContainsKey($name)){throw "Unknown workspace: $name"}
  $w=$map[$name]
  $path=[IO.Path]::GetFullPath([string]$w.path)
  if(-not(Test-Path $path -PathType Container)){throw "Workspace path not found: $path"}
  return @{name=$name;path=(Resolve-Path $path).Path;expected_repo=[string]$w.expected_repo;write_enabled=[bool]$w.write_enabled}
}
function AssertWorkspaceWritable($w) {
  if(-not[bool]$w.write_enabled){throw ("WORKSPACE_READ_ONLY: "+$w.name+" is protected from mutations.")}
}
function SafePath($w,[string]$rel,[switch]$AllowMissing) {
  $root=[IO.Path]::GetFullPath([string]$w.path)
  if(-not$root.EndsWith([IO.Path]::DirectorySeparatorChar)){$root+=[IO.Path]::DirectorySeparatorChar}
  if($null-eq$rel){$rel=""}
  $full=[IO.Path]::GetFullPath((Join-Path $root $rel))
  $cmp=$full;if(Test-Path $full -PathType Container){$cmp=$full+[IO.Path]::DirectorySeparatorChar}
  if(-not$cmp.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw "Path escapes workspace root"}
  if(-not$AllowMissing -and -not(Test-Path $full)){throw "Path not found: $rel"}
  return $full
}
function GitText($w,[string[]]$procArgs,[int]$timeout=120) {
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
  if(-not(Test-Path (Join-Path $w.path ".git"))){throw "Workspace is not a Git repository: $($w.name)"}
  $remote=RepoRemote $w
  if(-not[string]::IsNullOrWhiteSpace($w.expected_repo) -and (NormRemote $remote)-ne(NormRemote $w.expected_repo)){
    throw "Unexpected origin for workspace $($w.name): $remote"
  }
}
function GetSyncSnapshot($w) {
  VerifyWorkspaceRemote $w
  $fetch=RunProcess "git" @("fetch","--prune","origin") $w.path 300
  if($fetch.code-ne0){throw ("git fetch failed: "+$fetch.stderr+" "+$fetch.stdout)}
  $branch=GitText $w @("branch","--show-current")
  $head=GitText $w @("rev-parse","HEAD")
  $status=GitText $w @("status","--porcelain=v1","--branch")
  $upstream="";try{$upstream=GitText $w @("rev-parse","--abbrev-ref","--symbolic-full-name","@{u}")}catch{}
  $upstreamHead="";$ahead=0;$behind=0;$deltaLog="";$deltaFiles=""
  if(-not[string]::IsNullOrWhiteSpace($upstream)){
    $upstreamHead=GitText $w @("rev-parse","@{u}")
    $parts=(GitText $w @("rev-list","--left-right","--count","HEAD...@{u}"))-split'\s+'
    if($parts.Count-ge2){$ahead=[int]$parts[0];$behind=[int]$parts[1]}
    if($behind-gt0){
      $deltaLog=(RunProcess "git" @("log","--oneline","--decorate","HEAD..@{u}") $w.path 120).stdout
      $deltaFiles=(RunProcess "git" @("diff","--name-status","HEAD..@{u}") $w.path 120).stdout
    }
  }
  $recent=(RunProcess "git" @("for-each-ref","--sort=-committerdate","--count=12","--format=%(committerdate:iso8601)|%(objectname:short)|%(refname:short)|%(subject)","refs/remotes/origin") $w.path 120).stdout
  $prs="";try{$g=RunProcess "gh" @("pr","list","--state","open","--limit","30","--json","number,title,headRefName,baseRefName,updatedAt,url") $w.path 120;if($g.code-eq0){$prs=$g.stdout}}catch{}
  $handoff=@();if($deltaFiles){foreach($line in($deltaFiles-split"`r?`n")){if($line-match'(HANDOFF|CURRENT_STATUS|START_HERE|READ_FIRST|ARCHITECTURE|DECISION|RELEASE_NOTES)'){$handoff+=$line}}}
  return @{ok=$true;workspace=$w.name;write_enabled=$w.write_enabled;branch=$branch;head=$head;upstream=$upstream;upstream_head=$upstreamHead;ahead=$ahead;behind=$behind;clean=(-not(($status-split"`r?`n"|Where-Object{$_-and$_-notmatch'^##'})|Select-Object -First 1));status=$status;remote_delta_log=$deltaLog;remote_delta_files=$deltaFiles;handoff_or_status_changes=$handoff;recent_remote_refs=$recent;open_prs=$prs}
}
function AssertFreshWritable($w) {
  AssertWorkspaceWritable $w
  $s=GetSyncSnapshot $w
  if($s.ahead-gt0 -and $s.behind-gt0){throw "REMOTE_DIVERGED: local and upstream have diverged; mutation blocked."}
  if($s.behind-gt0){throw ("REMOTE_CHANGED: "+$w.name+" upstream is ahead by "+$s.behind+" commit(s); review and sync first.")}
  return $s
}
function ToolVersion([string]$exe,[string[]]$procArgs,[string]$cwd) {
  try{$r=RunProcess $exe $procArgs $cwd 30;return @{available=$true;code=$r.code;version=(($r.stdout+" "+$r.stderr).Trim())}}catch{return @{available=$false;error=$_.Exception.Message}}
}
function WorkspaceSummary {
  $out=@()
  foreach($name in (WorkspaceMap).Keys|Sort-Object){
    $w=(ResolveWorkspace ([pscustomobject]@{workspace=$name}))
    $isGit=Test-Path (Join-Path $w.path ".git")
    $branch="";$head="";$remote=""
    if($isGit){
      try{$branch=GitText $w @("branch","--show-current")}catch{}
      try{$head=GitText $w @("rev-parse","--short","HEAD")}catch{}
      try{$remote=RepoRemote $w}catch{}
    }
    $out+=@{name=$w.name;path=$w.path;expected_repo=$w.expected_repo;write_enabled=$w.write_enabled;git=$isGit;branch=$branch;head=$head;origin=$remote}
  }
  return $out
}

function ArtifactRoot {
  $r="";try{$r=[string]$script:cfg.artifact_root}catch{}
  if([string]::IsNullOrWhiteSpace($r)){$r=if($env:USERPROFILE){Join-Path $env:USERPROFILE "Downloads"}else{Join-Path $PSScriptRoot "artifacts"}}
  $full=[IO.Path]::GetFullPath($r)
  if(-not(Test-Path $full -PathType Container)){New-Item -ItemType Directory -Path $full -Force|Out-Null}
  return $full
}
function ArtifactAuditPath {
  $base=if($env:LOCALAPPDATA){Join-Path $env:LOCALAPPDATA "SOKNA\Bridge\logs"}else{Join-Path $PSScriptRoot "logs"}
  if(-not(Test-Path $base)){New-Item -ItemType Directory -Path $base -Force|Out-Null}
  return (Join-Path $base "artifact-events.jsonl")
}
function WriteArtifactAudit($e,[switch]$Required) {
  try{
    if(-not$e.ts){$e.ts=(Get-Date).ToUniversalTime().ToString("o")}
    $line=$e|ConvertTo-Json -Compress -Depth 12
    [IO.File]::AppendAllText((ArtifactAuditPath),$line+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
    return $true
  }catch{
    if($Required){throw ("ARTIFACT_AUDIT_WRITE_FAILED: "+$_.Exception.Message)}
    return $false
  }
}
function ResolveArtifactFile([string]$raw) {
  if([string]::IsNullOrWhiteSpace($raw)){throw "ARTIFACT_PATH_REQUIRED"}
  $root=ArtifactRoot
  $full=if([IO.Path]::IsPathRooted($raw)){[IO.Path]::GetFullPath($raw)}else{[IO.Path]::GetFullPath((Join-Path $root $raw))}
  $prefix=$root;if(-not$prefix.EndsWith([IO.Path]::DirectorySeparatorChar)){$prefix+=[IO.Path]::DirectorySeparatorChar}
  if(-not$full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw "ARTIFACT_PATH_OUTSIDE_ROOT"}
  if(-not(Test-Path $full -PathType Leaf)){throw "ARTIFACT_NOT_FOUND"}
  if([IO.Path]::GetExtension($full).ToLowerInvariant()-ne".zip"){throw "ARTIFACT_ZIP_REQUIRED"}
  $size=(Get-Item $full).Length;if($size-le0-or$size-gt512MB){throw "ARTIFACT_ZIP_SIZE_INVALID"}
  return $full
}
function NewArtifactStage([string]$zip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $base=if($env:LOCALAPPDATA){Join-Path $env:LOCALAPPDATA "SOKNA\Bridge\artifact-stage"}else{Join-Path $PSScriptRoot "artifact-stage"}
  if(-not(Test-Path $base)){New-Item -ItemType Directory -Path $base -Force|Out-Null}
  $stage=Join-Path $base ([Guid]::NewGuid().ToString("N"));New-Item -ItemType Directory -Path $stage -Force|Out-Null
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
  foreach($x in Get-ChildItem $stage -Recurse -Force -ErrorAction Stop){if(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw "ARTIFACT_REPARSE_POINT_BLOCKED"}}
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
    "artifact.inspect" {
      $w=ResolveWorkspace $p
      try{$r=InvokeArtifactPackage $w $p;$null=WriteArtifactAudit @{action="artifact.inspect";phase="validated";ok=$true;workspace=$w.name;artifact_id=$r.artifact_id;artifact_sha256=$r.artifact_sha256;path=$r.artifact_path;files=$r.files;elapsed_ms=$r.elapsed_ms};return $r}catch{$null=WriteArtifactAudit @{action="artifact.inspect";phase="failed";ok=$false;workspace=$w.name;path=[string]$p.path;error=$_.Exception.Message};throw}
    }
    "artifact.apply" {
      $w=ResolveWorkspace $p
      try{return (InvokeArtifactPackage $w $p -Apply)}catch{$null=WriteArtifactAudit @{action="artifact.apply";phase="failed";ok=$false;workspace=$w.name;path=[string]$p.path;error=$_.Exception.Message};throw}
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
      return @{ok=$true;agent="sokna-bridge-v2.5.7";version="2.5.7";capabilities_action="agent.capabilities";artifact_root=(ArtifactRoot);artifact_log=(ArtifactAuditPath);computer=$env:COMPUTERNAME;default_workspace=[string]$script:cfg.default_workspace;workspaces=(WorkspaceSummary)}
    }
    "workspace.list" { return @{ok=$true;default_workspace=[string]$script:cfg.default_workspace;workspace_root=[string]$script:cfg.workspace_root;workspaces=(WorkspaceSummary)} }
    "workspace.inspect" {
      $w=ResolveWorkspace $p
      VerifyWorkspaceRemote $w
      $st=RunProcess "git" @("status","--short","--branch") $w.path 60
      $lg=RunProcess "git" @("log","--oneline","--decorate","-10") $w.path 60
      return @{ok=($st.code-eq0);workspace=$w.name;path=$w.path;write_enabled=$w.write_enabled;status=$st.stdout;log=$lg.stdout;origin=(RepoRemote $w)}
    }
    "system.capabilities" {
      $w=ResolveWorkspace $p
      return @{ok=$true;workspace=$w.name;git=(ToolVersion "git" @("--version") $w.path);gh=(ToolVersion "gh" @("--version") $w.path);php=(ToolVersion "php" @("--version") $w.path);node=(ToolVersion "node" @("--version") $w.path);composer=(ToolVersion "composer" @("--version") $w.path);dotnet=(ToolVersion "dotnet" @("--version") $w.path);powershell=(ToolVersion "powershell" @("-NoProfile","-Command",'$PSVersionTable.PSVersion.ToString()') $w.path)}
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
      if(-not$w.write_enabled){throw ("WORKSPACE_READ_ONLY: "+$w.name+" is protected; sync apply blocked.")}
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
      $w=ResolveWorkspace $p;$path=SafePath $w ([string]$p.path)
      $items=Get-ChildItem $path -Force -Recurse -ErrorAction SilentlyContinue|Where-Object{$_.FullName-notmatch'\\(\.git|vendor|node_modules)\\'}|Select-Object -First 1200 @{n="path";e={$_.FullName.Substring($w.path.Length).TrimStart('\')}},Mode,Length,LastWriteTime
      return @{ok=$true;workspace=$w.name;items=$items}
    }
    "file.read" {
      $w=ResolveWorkspace $p;$rel=[string]$p.path;$path=SafePath $w $rel
      if(-not(Test-Path $path -PathType Leaf)){throw "Not a file: $rel"}
      $lines=[IO.File]::ReadAllLines($path,[Text.Encoding]::UTF8);$start=if($p.start_line){[Math]::Max([int]$p.start_line,1)}else{1};$count=if($p.line_count){[Math]::Min([int]$p.line_count,2500)}else{500};$slice=$lines|Select-Object -Skip ($start-1) -First $count
      return @{ok=$true;workspace=$w.name;path=$rel;sha256=(Sha256File $path);start_line=$start;content=(Clip ($slice-join"`n") 32000);total_lines=$lines.Count}
    }
    "file.search" {
      $w=ResolveWorkspace $p;$q=[string]$p.query;if([string]::IsNullOrWhiteSpace($q)){throw "query required"};$glob=if($p.glob){[string]$p.glob}else{"*"};$max=if($p.max_results){[Math]::Min([int]$p.max_results,300)}else{100};$out=@()
      $files=Get-ChildItem $w.path -File -Recurse -Filter $glob -ErrorAction SilentlyContinue|Where-Object{$_.FullName-notmatch'\\(\.git|vendor|node_modules)\\'}
      foreach($f in $files){if($out.Count-ge$max){break};try{$lines=[IO.File]::ReadAllLines($f.FullName,[Text.Encoding]::UTF8);for($i=0;$i-lt$lines.Length;$i++){if($lines[$i].IndexOf($q,[StringComparison]::OrdinalIgnoreCase)-ge0){$out+=@{path=$f.FullName.Substring($w.path.Length).TrimStart('\');line=$i+1;text=(Clip ([string]$lines[$i]) 1000)};if($out.Count-ge$max){break}}}}catch{}}
      return @{ok=$true;workspace=$w.name;query=$q;matches=$out}
    }
    "file.replace" {
      $w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$rel=[string]$p.path;$path=SafePath $w $rel;$expected=[string]$p.expected_sha256
      if($expected-and(Sha256File $path)-ne$expected.ToLowerInvariant()){throw "SHA256 mismatch"};$old=[string]$p.old;$new=[string]$p.new;if([string]::IsNullOrEmpty($old)){throw "old text required"}
      $txt=[IO.File]::ReadAllText($path,[Text.Encoding]::UTF8);$count=([regex]::Matches($txt,[regex]::Escape($old))).Count;if($count-ne1){throw "Expected exactly one match, found $count"}
      [IO.File]::WriteAllText($path,$txt.Replace($old,$new),(New-Object Text.UTF8Encoding($false)))
      return @{ok=$true;workspace=$w.name;path=$rel;sha256=(Sha256File $path);sync_guard=$sync}
    }
    "file.write" {
      $w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$rel=[string]$p.path;$path=SafePath $w $rel -AllowMissing;$expected=[string]$p.expected_sha256
      if($expected-and(Test-Path $path)-and(Sha256File $path)-ne$expected.ToLowerInvariant()){throw "SHA256 mismatch"}
      $dir=Split-Path $path -Parent;if(-not(Test-Path $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
      [IO.File]::WriteAllText($path,[string]$p.content,(New-Object Text.UTF8Encoding($false)))
      return @{ok=$true;workspace=$w.name;path=$rel;sha256=(Sha256File $path);sync_guard=$sync}
    }
    "process.run" {
      $w=ResolveWorkspace $p
      if($p.mutating){$null=AssertFreshWritable $w}
      $exe=[string]$p.exe;$a=@();if($p.args){$a=@($p.args|ForEach-Object{[string]$_})}
      $cwd=$w.path;if($p.cwd){$cwd=SafePath $w ([string]$p.cwd)}
      $timeout=if($p.timeout_sec){[Math]::Min([Math]::Max([int]$p.timeout_sec,1),1800)}else{180}
      $r=RunProcess $exe $a $cwd $timeout
      return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;stdout=$r.stdout;stderr=$r.stderr}
    }
    "git.status" {$w=ResolveWorkspace $p;$r=RunProcess "git" @("status","--short","--branch") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;write_enabled=$w.write_enabled;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.diff" {$w=ResolveWorkspace $p;$a=@("diff","--no-ext-diff");if($p.cached){$a+=("--cached")};$r=RunProcess "git" $a $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=(Clip $r.stdout 32000);error=$r.stderr}}
    "git.log" {$w=ResolveWorkspace $p;$n=if($p.count){[Math]::Min([Math]::Max([int]$p.count,1),100)}else{20};$r=RunProcess "git" @("log","--oneline","--decorate","-$n") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.fetch" {$w=ResolveWorkspace $p;$r=RunProcess "git" @("fetch","--prune","origin") $w.path 300;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.switch" {$w=ResolveWorkspace $p;AssertWorkspaceWritable $w;$name=[string]$p.name;if($name-notmatch'^[A-Za-z0-9._/-]+$'){throw"Invalid branch"};$r=RunProcess "git" @("switch",$name) $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.branch.create" {$w=ResolveWorkspace $p;AssertWorkspaceWritable $w;$name=[string]$p.name;if($name-notmatch'^[A-Za-z0-9._/-]+$'){throw"Invalid branch"};$r=RunProcess "git" @("switch","-c",$name) $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "git.add.paths" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$paths=@($p.paths);if($paths.Count-eq0){throw"paths required"};foreach($x in $paths){$rel=[string]$x;$null=SafePath $w $rel -AllowMissing;$r=RunProcess "git" @("add","--",$rel) $w.path 60;if($r.code-ne0){throw$r.stderr}};return @{ok=$true;workspace=$w.name;paths=$paths;sync_guard=$sync}}
    "git.add" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$r=RunProcess "git" @("add","-A") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "git.commit" {$w=ResolveWorkspace $p;$msg=[string]$p.message;if([string]::IsNullOrWhiteSpace($msg)){throw"message required"};$sync=AssertFreshWritable $w;$r=RunProcess "git" @("commit","-m",$msg) $w.path 120;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "git.push" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$b=(RunProcess "git" @("branch","--show-current") $w.path 60).stdout.Trim();if($b-in@("main","master","production")){throw"Direct push to protected branch blocked"};$r=RunProcess "git" @("push","-u","origin",$b) $w.path 300;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;branch=$b;output=$r.stdout;error=$r.stderr;sync_guard=$sync}}
    "gh.auth.status" {$w=ResolveWorkspace $p;$r=RunProcess "gh" @("auth","status") $w.path 60;return @{ok=($r.code-eq0);workspace=$w.name;code=$r.code;output=$r.stdout;error=$r.stderr}}
    "github.repo.create" {
      $w=ResolveWorkspace $p
      $name=[string]$p.name;if($name-notmatch'^[A-Za-z0-9._-]+$'){throw "Invalid repository name"}
      $owner=[string]$p.owner;if([string]::IsNullOrWhiteSpace($owner)){$owner=[string]$script:cfg.default_github_owner}
      if($script:cfg.allowed_github_owners-notcontains$owner){throw "GitHub owner not allowed: $owner"}
      $vis=[string]$p.visibility;if($vis-notin@("private","public","internal")){$vis="private"}
      $args=@("repo","create","$owner/$name","--$vis")
      if($p.description){$args+=@("--description",[string]$p.description)}
      $r=RunProcess "gh" $args $w.path 120
      return @{ok=($r.code-eq0);code=$r.code;stdout=$r.stdout;stderr=$r.stderr;repository="$owner/$name"}
    }
    "plan.stage" {$w=ResolveWorkspace $p;$sync=AssertFreshWritable $w;$r=[string]$p.path
      if($r-notmatch'^tools[\/]+plans[\/]+[A-Za-z0-9._-]+\.json$'){throw"Invalid plan path"}
      $f=SafePath $w $r -AllowMissing;if((-not$p.reset)-and$p.expected_sha256-and((Sha256File $f)-ne([string]$p.expected_sha256).ToLowerInvariant())){throw"Stage SHA256 mismatch"};$b=[Convert]::FromBase64String([string]$p.data_b64);if($b.Length-gt512){throw"Chunk too large"}
      $d=Split-Path $f -Parent;if(-not(Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}
      if($p.reset){[IO.File]::WriteAllBytes($f,$b)}else{if(-not(Test-Path $f)){throw"Stage file missing"};$s=[IO.File]::Open($f,'Append');try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}}
      return @{ok=$true;path=$r;sha256=(Sha256File $f);size=(Get-Item $f).Length;sync_guard=$sync}
    }
    "plan.run" {
      $w=ResolveWorkspace $p
      $rel=[string]$p.path
      if([string]::IsNullOrWhiteSpace($rel)){throw "plan path required"}
      $path=SafePath $w $rel
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
      $path=SafePath $w $rel
      if(-not(Test-Path $path -PathType Leaf)){throw ("Plan not found: "+$rel)}
      if($p.expected_sha256 -and (Sha256File $path) -ne ([string]$p.expected_sha256).ToLowerInvariant()){throw "Plan SHA256 mismatch"}
      $id=[string]$p.id
      if([string]::IsNullOrWhiteSpace($id)){$id="job-"+[Guid]::NewGuid().ToString("N")}
      $jp=JobPath $id
      if(Test-Path $jp){throw ("Job already exists: "+$id)}
      $j=[pscustomobject]@{id=$id;status="queued";workspace=$w.name;path=$rel;expected_sha256=[string]$p.expected_sha256;created_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();worker_pid=$null;started_at=$null;finished_at=$null;recovered_at=$null;result=$null;error=$null}
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
      $results=@();$steps=@($p.steps);if($steps.Count-gt30){throw"Max 30 steps"}
      foreach($s in $steps){
        $sp=$s.params
        if($null-eq$sp){$sp=[pscustomobject]@{}}
        if(-not$sp.workspace -and $p.workspace){$sp|Add-Member -NotePropertyName workspace -NotePropertyValue ([string]$p.workspace) -Force}
        try{$r=InvokeAction ([string]$s.action) $sp;$results+=@{name=[string]$s.name;action=[string]$s.action;result=$r};if($s.stop_on_error-and-not$r.ok){break}}
        catch{$results+=@{name=[string]$s.name;action=[string]$s.action;result=@{ok=$false;error=$_.Exception.Message}};if($s.stop_on_error){break}}
      }
      $all=$true;foreach($x in $results){if(-not$x.result.ok){$all=$false}};return @{ok=$all;results=$results}
    }
    default {throw"Unknown action: $action"}
  }
}

if(-not(Test-Path $ConfigPath)){throw"config.json missing. Re-run SOKNA Bridge Setup."}
$script:cfg=Get-Content $ConfigPath -Raw -Encoding UTF8|ConvertFrom-Json
if($null-eq$script:cfg.workspaces){throw"V2.5 workspace configuration missing. Re-run Setup V2.5."}
$null=WorkspaceSummary

if($StartupProbe){
  $capPath=Join-Path $PSScriptRoot "AGENT_CAPABILITIES.json"
  if(-not(Test-Path $capPath -PathType Leaf)){throw "STARTUP_PROBE_CAPABILITIES_MISSING"}
  $probeCaps=Get-Content $capPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$probeCaps.agent-ne"2.5.7"){throw "STARTUP_PROBE_CAPABILITIES_VERSION"}
  $probeArtifactRoot=ArtifactRoot
  [ordered]@{ok=$true;mode="startup-probe";version="2.5.7";capabilities_version=[string]$probeCaps.agent;artifact_root=$probeArtifactRoot;workspaces=@(WorkspaceSummary).Count}|ConvertTo-Json -Compress
  exit 0
}

if($RunJobId){
  $j=ReadJob $RunJobId
  $j.status='running';$j.started_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.worker_pid=$PID;WriteJob $j|Out-Null
  try{
    $pp=[pscustomobject]@{workspace=[string]$j.workspace;path=[string]$j.path}
    if($j.expected_sha256){$pp|Add-Member -NotePropertyName expected_sha256 -NotePropertyValue ([string]$j.expected_sha256)}
    $r=InvokeAction 'plan.run' $pp
    $j=ReadJob $RunJobId
    $j.status=if($r.ok){'done'}else{'failed'}
    $j.finished_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.result=$r;WriteJob $j|Out-Null
    if($r.ok){exit 0}else{exit 1}
  }catch{
    try{$j=ReadJob $RunJobId;$j.status='failed';$j.finished_at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$j.error=$_.Exception.Message;WriteJob $j|Out-Null}catch{}
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
$listener=New-Object Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$($cfg.port)/")
try{$listener.Start()}catch{Write-Host("Could not bind SOKNA Bridge endpoint: "+$_.Exception.Message)-ForegroundColor Red;exit 2}
Set-Content "$PSScriptRoot\agent.pid" $PID -Encoding ASCII
Write-Host "SOKNA Bridge V2.5.7 agent running" -ForegroundColor Green
Write-Host "Default workspace: $($cfg.default_workspace)"
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
