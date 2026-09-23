param([string]$ConfigPath="$PSScriptRoot\config.json",[string]$RunJobId="")
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

function InvokeAction([string]$action,$p) {
  switch($action) {
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
      return @{ok=$true;agent="sokna-bridge-v2.5.5";version="2.5.5";capabilities_action="agent.capabilities";computer=$env:COMPUTERNAME;default_workspace=[string]$script:cfg.default_workspace;workspaces=(WorkspaceSummary)}
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
Write-Host "SOKNA Bridge V2.5.5 agent running" -ForegroundColor Green
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
