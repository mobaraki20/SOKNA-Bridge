param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("discover","list","inspect","clone","register","set-write")]
  [string]$Action,
  [string]$Repo="",
  [string]$Name="",
  [ValidateSet("enable","disable")]
  [string]$WriteMode="disable",
  [string]$ConfigPath="$env:LOCALAPPDATA\SOKNA-Bridge-V2\config.json"
)
$ErrorActionPreference="Stop"

function J($o){$o|ConvertTo-Json -Depth 30 -Compress}
function Run([string]$exe,[string[]]$a,[string]$cwd=""){
  $old=Get-Location
  try{
    if($cwd){Set-Location $cwd}
    $x=& $exe @a 2>&1;$c=$LASTEXITCODE
    [pscustomobject]@{code=$c;text=(($x|%{"$_"})-join"`n").Trim()}
  }finally{Set-Location $old}
}
function NR([string]$v,[string]$owner){
  if($null-eq$v){$v=""};$v=$v.Trim()
  if(!$v){throw "REPO_REQUIRED"}
  $v=$v-replace'^https://github\.com/','' -replace'^git@github\.com:','' -replace'\.git$',''
  $v=$v.Trim('/')
  if($v-notmatch'/'){$v="$owner/$v"}
  if($v-notmatch'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){throw "INVALID_REPO: $v"}
  $v
}
function NM([string]$v){
  if($null-eq$v){$v=""};$v=$v.Trim()
  ($v-replace'^https?://github\.com/','' -replace'^git@github\.com:','' -replace'\.git$','').Trim('/').ToLowerInvariant()
}
function Cfg{
  if(!(Test-Path $ConfigPath -PathType Leaf)){throw "CONFIG_NOT_FOUND"}
  Get-Content $ConfigPath -Raw -Encoding UTF8|ConvertFrom-Json
}
function Allow($c,[string]$r){
  $o=($r-split'/',2)[0].ToLowerInvariant()
  $a=@($c.allowed_github_owners|%{"$_".ToLowerInvariant()})
  if($a-notcontains$o){throw "OWNER_NOT_ALLOWED: $o"}
}
function Safe([string]$root,[string]$p){
  $r=[IO.Path]::GetFullPath($root).TrimEnd('\')+'\';$f=[IO.Path]::GetFullPath($p)
  if(!$f.StartsWith($r,[StringComparison]::OrdinalIgnoreCase)){throw "PATH_OUTSIDE_WORKSPACE_ROOT"}
  $f
}
function Origin([string]$p){
  $r=Run git @("-C",$p,"remote","get-url","origin")
  if($r.code-ne0){throw "ORIGIN_READ_FAILED: $($r.text)"};$r.text
}
function Match([string]$p,[string]$r){
  if(!(Test-Path (Join-Path $p ".git"))){throw "NOT_A_GIT_REPO: $p"}
  $o=Origin $p
  if((NM $o)-ne(NM $r)){throw "REMOTE_MISMATCH: expected=$r actual=$o"};$o
}
function Prop($c,[string]$n){$c.workspaces.psobject.Properties|?{$_.Name-eq$n}|select -First 1}
function Save($c){
  $d=Split-Path $ConfigPath -Parent;$s=Get-Date -Format"yyyyMMdd-HHmmss"
  $b=Join-Path $d "config.json.pre-workspace-$s";Copy-Item $ConfigPath $b -Force
  $t="$ConfigPath.tmp";$z=$c|ConvertTo-Json -Depth 40
  [IO.File]::WriteAllText($t,$z,(New-Object Text.UTF8Encoding($false)));Move-Item $t $ConfigPath -Force;$b
}

$c=Cfg;$root=[IO.Path]::GetFullPath([string]$c.workspace_root);$owner=[string]$c.default_github_owner
switch($Action){
"discover"{
  $r=Run gh @("repo","list",$owner,"--limit","200","--json","name,nameWithOwner,visibility,defaultBranchRef")
  if($r.code-ne0){throw "GH_DISCOVER_FAILED: $($r.text)"};$repos=$r.text|ConvertFrom-Json
  $out=@()
  foreach($i in $repos){
    $p=Join-Path $root ([string]$i.name);$exists=Test-Path $p -PathType Container;$git=$false;$match=$false
    if($exists-and(Test-Path (Join-Path $p ".git"))){$git=$true;try{$match=((NM (Origin $p))-eq(NM ([string]$i.nameWithOwner)))}catch{}}
    $q=Prop $c ([string]$i.name)
    $out+=[pscustomobject]@{repo=[string]$i.nameWithOwner;visibility=[string]$i.visibility;default_branch=$(if($i.defaultBranchRef){[string]$i.defaultBranchRef.name}else{""});local_path=$p;local_exists=$exists;git=$git;remote_match=$match;registered=($null-ne$q);write_enabled=$(if($q){[bool]$q.Value.write_enabled}else{$false})}
  }
  J ([pscustomobject]@{ok=$true;action="discover";owner=$owner;repos=$out})
}
"list"{
  $out=@();foreach($p in $c.workspaces.psobject.Properties){$out+=[pscustomobject]@{name=$p.Name;path=[string]$p.Value.path;expected_repo=[string]$p.Value.expected_repo;write_enabled=[bool]$p.Value.write_enabled}}
  J ([pscustomobject]@{ok=$true;action="list";workspace_root=$root;workspaces=$out})
}
"inspect"{
  $r=NR $Repo $owner;Allow $c $r;$leaf=($r-split'/',2)[1];$n=$(if($Name){$Name}else{$leaf})
  $p=Safe $root (Join-Path $root $n)
  $exists=Test-Path $p -PathType Container;$o="";$m=$false;$st=""
  if($exists-and(Test-Path (Join-Path $p ".git"))){$o=Origin $p;$m=((NM $o)-eq(NM $r));$st=(Run git @("-C",$p,"status","--short","--branch")).text}
  $q=Prop $c $n;J ([pscustomobject]@{ok=$true;action="inspect";repo=$r;name=$n;path=$p;exists=$exists;origin=$o;remote_match=$m;status=$st;registered=($null-ne$q);write_enabled=$(if($q){[bool]$q.Value.write_enabled}else{$false})})
}
"clone"{
  $r=NR $Repo $owner;Allow $c $r;$leaf=($r-split'/',2)[1];$n=$(if($Name){$Name}else{$leaf})
  $dup=$c.workspaces.psobject.Properties|?{(NM ([string]$_.Value.expected_repo))-eq(NM $r)}|select -First 1;if($dup){throw "REPO_ALREADY_REGISTERED_AS: $($dup.Name)"}
  if($n-notmatch'^[A-Za-z0-9_.-]+$'){throw "INVALID_WORKSPACE_NAME"}
  $p=Safe $root (Join-Path $root $n)
  if(Test-Path $p){if(@(Get-ChildItem $p -Force).Count-gt0){throw "TARGET_NOT_EMPTY: $p"}}
  if((Run gh @("repo","view",$r,"--json","nameWithOwner")).code-ne0){throw "GH_REPO_NOT_FOUND_OR_DENIED"}
  $x=Run gh @("repo","clone",$r,$p) $root;if($x.code-ne0){throw "CLONE_FAILED: $($x.text)"}
  $o=Match $p $r;if(Prop $c $n){throw "WORKSPACE_ALREADY_REGISTERED: $n"}
  $e=[pscustomobject]@{path=$p;expected_repo=$r;write_enabled=$false};$c.workspaces|Add-Member -NotePropertyName $n -NotePropertyValue $e
  $b=Save $c;J ([pscustomobject]@{ok=$true;action="clone";repo=$r;name=$n;path=$p;origin=$o;write_enabled=$false;backup=$b;restart_required=$true})
}
"register"{
  $r=NR $Repo $owner;Allow $c $r;$leaf=($r-split'/',2)[1];$n=$(if($Name){$Name}else{$leaf})
  $dup=$c.workspaces.psobject.Properties|?{(NM ([string]$_.Value.expected_repo))-eq(NM $r)}|select -First 1;if($dup -and $dup.Name -ne $n){throw "REPO_ALREADY_REGISTERED_AS: $($dup.Name)"}
  if($n-notmatch'^[A-Za-z0-9_.-]+$'){throw "INVALID_WORKSPACE_NAME"}
  $p=Safe $root (Join-Path $root $n);if(!(Test-Path $p -PathType Container)){throw "WORKSPACE_PATH_NOT_FOUND"}
  $o=Match $p $r;$q=Prop $c $n
  if($q){
    if((NM ([string]$q.Value.expected_repo))-ne(NM $r)){throw "REGISTERED_REPO_MISMATCH"}
    J ([pscustomobject]@{ok=$true;action="register";changed=$false;repo=$r;name=$n;path=$p;origin=$o;write_enabled=[bool]$q.Value.write_enabled;restart_required=$false})
  }else{
    $e=[pscustomobject]@{path=$p;expected_repo=$r;write_enabled=$false};$c.workspaces|Add-Member -NotePropertyName $n -NotePropertyValue $e
    $b=Save $c;J ([pscustomobject]@{ok=$true;action="register";changed=$true;repo=$r;name=$n;path=$p;origin=$o;write_enabled=$false;backup=$b;restart_required=$true})
  }
}
"set-write"{
  if(!$Name){throw "NAME_REQUIRED"};$q=Prop $c $Name;if(!$q){throw "WORKSPACE_NOT_REGISTERED: $Name"}
  $r=[string]$q.Value.expected_repo;Allow $c $r;$p=Safe $root ([string]$q.Value.path);$null=Match $p $r
  $enable=($WriteMode-eq"enable");if($enable -and (NM $r) -eq "mobaraki20/soknacafe"){throw "PROTECTED_WORKSPACE: SoknaCafe remains read-only during Bridge development."}
  $q.Value.write_enabled=$enable;$b=Save $c
  J ([pscustomobject]@{ok=$true;action="set-write";name=$Name;repo=$r;write_enabled=$enable;backup=$b;restart_required=$true})
}
}