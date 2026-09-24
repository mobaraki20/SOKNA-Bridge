Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:WorkspaceRegistryPath=$null
$script:WorkspaceAuditPath=$null
$script:WorkspaceDefault=$null
$script:WorkspaceGrantPath=$null
$script:WorkspaceEphemeralRoot=$null
$script:WorkspaceRemoteAdapterRoot=$null

function Get-SoknaOptionalProperty($Object,[string]$Name,$Default=$null){
  if($null-eq$Object){return $Default}
  $prop=$Object.psobject.Properties[$Name]
  if($null-eq$prop){return $Default}
  return $prop.Value
}

function Write-SoknaWorkspaceJsonAtomic([string]$Path,$Object){
  $dir=Split-Path -Parent $Path
  if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
  $tmp=$Path+'.tmp.'+$PID+'.'+[Guid]::NewGuid().ToString('N')
  $Object|ConvertTo-Json -Depth 40|Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Test-SoknaWorkspaceId([string]$Id){
  return ((-not [string]::IsNullOrWhiteSpace($Id)) -and ($Id.Length -le 80) -and ($Id -match '^[A-Za-z0-9._-]+$'))
}
function ConvertTo-SoknaWorkspaceId([string]$Name){
  if(Test-SoknaWorkspaceId $Name){return $Name}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$b=[Text.Encoding]::UTF8.GetBytes([string]$Name);$h=([BitConverter]::ToString($sha.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  return 'legacy-'+$h.Substring(0,8)
}
function Test-SoknaWorkspaceContained([string]$Root,[string]$Candidate){
  $r=[IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  $c=[IO.Path]::GetFullPath($Candidate).TrimEnd('\','/')
  if($c.Equals($r,[StringComparison]::OrdinalIgnoreCase)){return $true}
  return $c.StartsWith(($r+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)
}
function Assert-SoknaNoReparsePath([string]$Path,[switch]$AllowMissing){
  $full=[IO.Path]::GetFullPath($Path)
  $cursor=$full
  while($true){
    if(Test-Path -LiteralPath $cursor){
      $item=Get-Item -LiteralPath $cursor -Force
      if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'WORKSPACE_REPARSE_POINT_BLOCKED: '+$cursor}
    }elseif(-not$AllowMissing){throw 'WORKSPACE_PATH_NOT_FOUND: '+$cursor}
    $parent=Split-Path -Parent $cursor
    if([string]::IsNullOrWhiteSpace($parent)-or$parent-eq$cursor){break}
    $cursor=$parent
  }
}
function Normalize-SoknaWorkspaceScopePath([string]$Root,[string]$Relative){
  $rel=[string]$Relative
  if([string]::IsNullOrWhiteSpace($rel)-or$rel-eq'.'){$rel='.'}
  if([IO.Path]::IsPathRooted($rel)){throw 'WORKSPACE_SCOPE_MUST_BE_RELATIVE'}
  $full=[IO.Path]::GetFullPath((Join-Path $Root $rel))
  if(-not(Test-SoknaWorkspaceContained $Root $full)){throw 'WORKSPACE_SCOPE_ESCAPE'}
  Assert-SoknaNoReparsePath $full -AllowMissing
  $rootClean=[IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  $fullClean=$full.TrimEnd('\','/')
  if($fullClean.Equals($rootClean,[StringComparison]::OrdinalIgnoreCase)){return '.'}
  return $fullClean.Substring($rootClean.Length).TrimStart('\','/').Replace('/','\')
}
function Normalize-SoknaWorkspaceScopes([string]$Root,$Scopes){
  $arr=@($Scopes)
  if($arr.Count-eq0){throw 'WORKSPACE_EXPLICIT_SCOPE_REQUIRED'}
  $out=@();$seen=@{};$nonDeny=@{}
  foreach($s in $arr){
    $access=([string]$s.access).ToLowerInvariant()
    if($access-notin@('read','write','deny')){throw 'WORKSPACE_SCOPE_ACCESS_INVALID'}
    $p=Normalize-SoknaWorkspaceScopePath $Root ([string]$s.path)
    $pk=$p.ToLowerInvariant()
    if($access-ne'deny'){
      if($nonDeny.ContainsKey($pk)-and[string]$nonDeny[$pk]-ne$access){throw 'WORKSPACE_SCOPE_READ_WRITE_CONFLICT: '+$p}
      $nonDeny[$pk]=$access
    }
    $k=$access+'|'+$pk
    if(-not$seen.ContainsKey($k)){$seen[$k]=$true;$out+=@{path=$p;access=$access}}
  }
  return @($out|Sort-Object path,access)
}
function Normalize-SoknaWorkspaceTools($Tools){
  $out=@();$seen=@{}
  foreach($x in @($Tools)){
    $raw=([string]$x).Trim()
    $t=[IO.Path]::GetFileName($raw).ToLowerInvariant()
    foreach($suffix in @('.exe','.cmd','.bat')){if($t.EndsWith($suffix)){$t=$t.Substring(0,$t.Length-$suffix.Length)}}
    if([string]::IsNullOrWhiteSpace($t)-or$t-match'[\\/\s\x00]'){throw 'WORKSPACE_TOOL_INVALID'}
    if(-not$seen.ContainsKey($t)){$seen[$t]=$true;$out+=$t}
  }
  return @($out|Sort-Object)
}
function Normalize-SoknaRemotePath([string]$Path){
  $p=([string]$Path).Replace('\','/').Trim()
  if([string]::IsNullOrWhiteSpace($p)-or$p-eq'.'){return '.'}
  if($p.StartsWith('/')){throw 'REMOTE_PATH_MUST_BE_RELATIVE'}
  $parts=New-Object 'System.Collections.Generic.List[string]'
  foreach($part in $p.Split('/')){if([string]::IsNullOrWhiteSpace($part)-or$part-eq'.'){continue};if($part-eq'..'){throw 'REMOTE_PATH_ESCAPE'};if($part-match'[\x00\r\n]'){throw 'REMOTE_PATH_INVALID'};$parts.Add($part)}
  if($parts.Count-eq0){return '.'};return ($parts -join '/')
}
function Normalize-SoknaRemoteScopes($Scopes){
  $arr=@($Scopes);if($arr.Count-eq0){throw 'WORKSPACE_EXPLICIT_SCOPE_REQUIRED'};$out=@();$seen=@{};$nonDeny=@{}
  foreach($x in $arr){$a=([string]$x.access).ToLowerInvariant();if($a-notin@('read','write','deny')){throw 'WORKSPACE_SCOPE_ACCESS_INVALID'};$rp=Normalize-SoknaRemotePath ([string]$x.path);$pk=$rp.ToLowerInvariant();if($a-ne'deny'){if($nonDeny.ContainsKey($pk)-and[string]$nonDeny[$pk]-ne$a){throw 'WORKSPACE_SCOPE_READ_WRITE_CONFLICT: '+$rp};$nonDeny[$pk]=$a};$k=$a+'|'+$pk;if(-not$seen.ContainsKey($k)){$seen[$k]=$true;$out+=[ordered]@{path=$rp;access=$a}}}
  return @($out|Sort-Object path,access)
}
function Write-SoknaWorkspaceAudit([string]$Action,[string]$WorkspaceId,$Data){
  $e=[ordered]@{schema='sokna-workspace-audit-v1';timestamp=(Get-Date).ToUniversalTime().ToString('o');action=$Action}
  if($WorkspaceId){$e.workspace_id=$WorkspaceId}
  if($Data){foreach($p in $Data.psobject.Properties){$e[$p.Name]=$p.Value}}
  $dir=Split-Path -Parent $script:WorkspaceAuditPath
  if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
  Add-Content -LiteralPath $script:WorkspaceAuditPath -Value ($e|ConvertTo-Json -Depth 20 -Compress) -Encoding UTF8
}
function New-SoknaEmptyWorkspaceRegistry(){return [ordered]@{schema='sokna-workspace-registry-v1';default_workspace='';workspaces=[ordered]@{};updated_at=(Get-Date).ToUniversalTime().ToString('o')}}
function Save-SoknaWorkspaceRegistry($Registry){$Registry.updated_at=(Get-Date).ToUniversalTime().ToString('o');Write-SoknaWorkspaceJsonAtomic $script:WorkspaceRegistryPath $Registry}
function Get-SoknaWorkspaceRegistry(){
  if(-not(Test-Path -LiteralPath $script:WorkspaceRegistryPath -PathType Leaf)){throw 'WORKSPACE_REGISTRY_MISSING'}
  $r=Get-Content -LiteralPath $script:WorkspaceRegistryPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$r.schema-ne'sokna-workspace-registry-v1'){throw 'WORKSPACE_REGISTRY_SCHEMA_UNSUPPORTED'}
  return $r
}
function Convert-SoknaWorkspaceMapToHashtable($Map){
  $h=[ordered]@{}
  if($null-ne$Map){foreach($p in $Map.psobject.Properties){$h[$p.Name]=$p.Value}}
  return $h
}
function Initialize-SoknaWorkspaceRegistry($Config,[string]$ConfigPath,[string]$RuntimeRoot){
  $configDir=Split-Path -Parent ([IO.Path]::GetFullPath($ConfigPath))
  $stateDir=Join-Path $configDir 'state';$logsDir=Join-Path $configDir 'logs'
  $registryOverride=[string](Get-SoknaOptionalProperty $Config 'workspace_registry_path' '')
  if($registryOverride){$script:WorkspaceRegistryPath=[IO.Path]::GetFullPath($registryOverride)}else{$script:WorkspaceRegistryPath=Join-Path $stateDir 'workspaces.json'}
  $script:WorkspaceAuditPath=Join-Path $logsDir 'workspace-audit.jsonl'
  $script:WorkspaceGrantPath=Join-Path $stateDir 'workspace-grants.json'
  $script:WorkspaceEphemeralRoot=Join-Path $stateDir 'ephemeral'
  $script:WorkspaceRemoteAdapterRoot=Join-Path $RuntimeRoot 'adapters'
  if(-not(Test-Path -LiteralPath $script:WorkspaceEphemeralRoot)){New-Item -ItemType Directory -Path $script:WorkspaceEphemeralRoot -Force|Out-Null}
  if(-not(Test-Path -LiteralPath $script:WorkspaceRegistryPath -PathType Leaf)){
    $r=New-SoknaEmptyWorkspaceRegistry;$migrated=0;$legacyMap=Get-SoknaOptionalProperty $Config 'workspaces' $null
    if($null-ne$legacyMap){
      foreach($p in $legacyMap.psobject.Properties){
        $old=$p.Value;$raw=[string]$old.path
        if([string]::IsNullOrWhiteSpace($raw)){continue}
        try{
          $root=[IO.Path]::GetFullPath($raw)
          if(-not(Test-Path -LiteralPath $root -PathType Container)){continue}
          Assert-SoknaNoReparsePath $root
          $id=ConvertTo-SoknaWorkspaceId ([string]$p.Name)
          if($r.workspaces.Contains($id)){continue}
          $legacyWrite=[bool](Get-SoknaOptionalProperty $old 'write_enabled' $false);$access=if($legacyWrite){'write'}else{'read'}
          $now=(Get-Date).ToUniversalTime().ToString('o')
          $r.workspaces[$id]=[ordered]@{id=$id;display_name=[string]$p.Name;kind='persistent_local';root=$root;scopes=@(@{path='.';access=$access});tools=@();legacy_expected_repo=[string](Get-SoknaOptionalProperty $old 'expected_repo' '');created_at=$now;updated_at=$now}
          $migrated++
        }catch{continue}
      }
    }
    $legacyDefault=[string](Get-SoknaOptionalProperty $Config 'default_workspace' '')
    if($legacyDefault){$candidate=ConvertTo-SoknaWorkspaceId $legacyDefault;if($r.workspaces.Contains($candidate)){$r.default_workspace=$candidate}}
    if(-not$r.default_workspace-and$r.workspaces.Count-gt0){$r.default_workspace=@($r.workspaces.Keys|Sort-Object)[0]}
    Save-SoknaWorkspaceRegistry $r
    if($migrated-gt0){Write-SoknaWorkspaceAudit 'workspace.legacy.migrate' '' ([pscustomobject]@{source_config=$ConfigPath;source_preserved=$true;migrated_count=$migrated;tool_permissions_require_review=$true})}
  }
  $loaded=Get-SoknaWorkspaceRegistry;$script:WorkspaceDefault=[string]$loaded.default_workspace
  $map=Convert-SoknaWorkspaceMapToHashtable $loaded.workspaces
  return @{registry_path=$script:WorkspaceRegistryPath;audit_path=$script:WorkspaceAuditPath;count=$map.Count;default_workspace=$script:WorkspaceDefault}
}
function Get-SoknaWorkspaceMap(){return (Convert-SoknaWorkspaceMapToHashtable (Get-SoknaWorkspaceRegistry).workspaces)}
function ConvertTo-SoknaWorkspaceCompat($w){
  $root=[IO.Path]::GetFullPath([string]$w.root)
  $scopes=Normalize-SoknaWorkspaceScopes $root @($w.scopes)
  $tools=Normalize-SoknaWorkspaceTools @($w.tools)
  $view=[ordered]@{id=[string]$w.id;name=[string]$w.id;display_name=[string]$w.display_name;path=$root;kind=[string]$w.kind;scopes=$scopes;tools=$tools;expected_repo=[string](Get-SoknaOptionalProperty $w 'legacy_expected_repo' '');write_enabled=$false}
  try{Assert-SoknaWorkspaceFullAccess -Workspace $view -Access 'write';$view.write_enabled=$true}catch{}
  return $view
}
function Get-SoknaWorkspace([string]$Workspace){
  $r=Get-SoknaWorkspaceRegistry;$id=$Workspace
  if([string]::IsNullOrWhiteSpace($id)){$id=[string]$r.default_workspace}
  if([string]::IsNullOrWhiteSpace($id)){throw 'WORKSPACE_REQUIRED'}
  $map=Convert-SoknaWorkspaceMapToHashtable $r.workspaces
  if(-not$map.Contains($id)){throw 'UNKNOWN_WORKSPACE: '+$id}
  $w=$map[$id]
  if([string]$w.id-ne$id){throw 'WORKSPACE_REGISTRY_ID_MISMATCH: '+$id}
  $kind=[string]$w.kind
  if($kind-in@('persistent_local','ephemeral_checkout')){
    $root=[IO.Path]::GetFullPath([string]$w.root)
    if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'WORKSPACE_ROOT_NOT_FOUND: '+$root}
    Assert-SoknaNoReparsePath $root
    $view=ConvertTo-SoknaWorkspaceCompat $w
    if($kind-eq'ephemeral_checkout'){$view['kind']='ephemeral_checkout';$view['owner_job_id']=[string](Get-SoknaOptionalProperty $w 'owner_job_id' '');$view['expires_at']=[string](Get-SoknaOptionalProperty $w 'expires_at' '')}
    return $view
  }
  if($kind-eq'remote'){
    $scopes=Normalize-SoknaRemoteScopes @($w.scopes);$tools=Normalize-SoknaWorkspaceTools @($w.tools);$remote=Get-SoknaOptionalProperty $w 'remote' $null
    if($null-eq$remote){throw 'REMOTE_WORKSPACE_SPEC_MISSING'}
    return [ordered]@{id=$id;name=$id;display_name=[string]$w.display_name;path='';kind='remote';scopes=$scopes;tools=$tools;write_enabled=$false;remote=$remote}
  }
  throw 'WORKSPACE_KIND_UNSUPPORTED: '+$kind
}
function Get-SoknaWorkspaceList(){
  $r=Get-SoknaWorkspaceRegistry;$map=Convert-SoknaWorkspaceMapToHashtable $r.workspaces;$out=@()
  foreach($id in @($map.Keys|Sort-Object)){
    try{$w=Get-SoknaWorkspace $id;$out+=[ordered]@{id=$w.id;display_name=$w.display_name;kind=$w.kind;path=$w.path;scopes=@($w.scopes);tools=@($w.tools);expected_repo=[string](Get-SoknaOptionalProperty $w 'expected_repo' '');write_enabled=[bool]$w.write_enabled;available=$true;error=''}}
    catch{$raw=$map[$id];$out+=[ordered]@{id=$id;display_name=[string](Get-SoknaOptionalProperty $raw 'display_name' $id);kind=[string](Get-SoknaOptionalProperty $raw 'kind' '');path=[string](Get-SoknaOptionalProperty $raw 'root' '');scopes=@();tools=@();expected_repo='';write_enabled=$false;available=$false;error=$_.Exception.Message}}
  }
  return @($out)
}
function Test-SoknaScopeMatch([string]$Scope,[string]$Rel){
  $s=$Scope.Replace('/','\').Trim('\');$r=$Rel.Replace('/','\').Trim('\')
  if([string]::IsNullOrWhiteSpace($s)-or$s-eq'.'){return $true}
  return $r.Equals($s,[StringComparison]::OrdinalIgnoreCase)-or$r.StartsWith(($s+'\'),[StringComparison]::OrdinalIgnoreCase)
}
function Resolve-SoknaWorkspacePath($Workspace,[string]$Path,[string]$Access='read',[switch]$AllowMissing){
  if([string]$Workspace.kind-eq'remote'){throw 'REMOTE_WORKSPACE_LOCAL_PATH_BLOCKED'}
  if($Access-notin@('read','write')){throw 'WORKSPACE_ACCESS_INVALID'}
  $root=[IO.Path]::GetFullPath([string]$Workspace.path);$rel=$Path
  if([string]::IsNullOrWhiteSpace($rel)){$rel='.'}
  if([IO.Path]::IsPathRooted($rel)){throw 'WORKSPACE_PATH_MUST_BE_RELATIVE'}
  $full=[IO.Path]::GetFullPath((Join-Path $root $rel))
  if(-not(Test-SoknaWorkspaceContained $root $full)){throw 'WORKSPACE_PATH_ESCAPE'}
  Assert-SoknaNoReparsePath $full -AllowMissing:$AllowMissing
  $rootClean=$root.TrimEnd('\','/');$fullClean=$full.TrimEnd('\','/')
  if($fullClean.Equals($rootClean,[StringComparison]::OrdinalIgnoreCase)){$normRel='.'}else{$normRel=$fullClean.Substring($rootClean.Length).TrimStart('\','/')}
  $matches=@($Workspace.scopes|Where-Object{Test-SoknaScopeMatch ([string]$_.path) $normRel})
  if(@($matches|Where-Object{([string]$_.access)-eq'deny'}).Count-gt0){throw 'WORKSPACE_PATH_DENIED: '+$normRel}
  $best=$null;$bestLen=-1
  foreach($s in $matches){
    $a=[string]$s.access;if($a-eq'deny'){continue}
    $sp=([string]$s.path).Replace('/','\')
    if($sp.Length-gt$bestLen){$best=$s;$bestLen=$sp.Length}
  }
  if($null-eq$best){throw 'WORKSPACE_PATH_ACCESS_NOT_GRANTED: '+$normRel}
  $grant=[string]$best.access
  if($Access-eq'write'-and$grant-ne'write'){throw 'WORKSPACE_WRITE_NOT_GRANTED: '+$normRel}
  if($null-ne$Workspace.psobject.Properties['grant_scopes']){if(-not(Test-SoknaPolicyScopes @($Workspace.grant_scopes) $normRel $Access)){throw 'WORKSPACE_GRANT_PATH_NOT_GRANTED: '+$normRel}}
  if((-not $AllowMissing) -and (-not (Test-Path -LiteralPath $full))){throw 'WORKSPACE_PATH_NOT_FOUND: '+$normRel}
  return $full
}
function Assert-SoknaWorkspaceFullAccess($Workspace,[string]$Access='write'){
  if($Access-notin@('read','write')){throw 'WORKSPACE_ACCESS_INVALID'}
  $rootGrant=$null
  foreach($s in @($Workspace.scopes)){
    $scopeAccess=[string]$s.access
    if($scopeAccess-eq'deny'){throw 'WORKSPACE_BROAD_ACCESS_BLOCKED_BY_DENY: '+[string]$s.path}
    if($Access-eq'write'-and$scopeAccess-eq'read'){throw 'WORKSPACE_BROAD_WRITE_BLOCKED_BY_READ_SCOPE: '+[string]$s.path}
    if(([string]$s.path)-eq'.'){$rootGrant=$scopeAccess}
  }
  if($Access-eq'write'-and$rootGrant-ne'write'){throw 'WORKSPACE_FULL_WRITE_REQUIRED'}
  if($Access-eq'read'-and$rootGrant-notin@('read','write')){throw 'WORKSPACE_FULL_READ_REQUIRED'}
  if($null-ne$Workspace.psobject.Properties['grant_scopes']){
    $gRoot=$null;foreach($s in @($Workspace.grant_scopes)){if([string]$s.access-eq'deny'){throw 'WORKSPACE_GRANT_BROAD_ACCESS_BLOCKED'};if($Access-eq'write'-and[string]$s.access-eq'read'){throw 'WORKSPACE_GRANT_BROAD_WRITE_BLOCKED'};if([string]$s.path-eq'.'){$gRoot=[string]$s.access}}
    if($Access-eq'write'-and$gRoot-ne'write'){throw 'WORKSPACE_GRANT_FULL_WRITE_REQUIRED'};if($Access-eq'read'-and$gRoot-notin@('read','write')){throw 'WORKSPACE_GRANT_FULL_READ_REQUIRED'}
  }
  return $true
}
function Assert-SoknaWorkspaceTool($Workspace,[string]$Tool){
  $t=[IO.Path]::GetFileName(([string]$Tool).Trim()).ToLowerInvariant()
  foreach($suffix in @('.exe','.cmd','.bat')){if($t.EndsWith($suffix)){$t=$t.Substring(0,$t.Length-$suffix.Length)}}
  if([string]::IsNullOrWhiteSpace($t)){throw 'WORKSPACE_TOOL_INVALID'}
  if(@($Workspace.tools|ForEach-Object{([string]$_).ToLowerInvariant()})-notcontains$t){throw 'WORKSPACE_TOOL_NOT_ALLOWED: '+$t}
  if($null-ne$Workspace.psobject.Properties['grant_tools']-and@($Workspace.grant_tools|ForEach-Object{([string]$_).ToLowerInvariant()})-notcontains$t){throw 'WORKSPACE_GRANT_TOOL_NOT_ALLOWED: '+$t}
  return $true
}
function Register-SoknaWorkspace([string]$Id,[string]$DisplayName,[string]$Root,$Scopes,$Tools){
  if(-not(Test-SoknaWorkspaceId $Id)){throw 'WORKSPACE_ID_INVALID'}
  if(-not [IO.Path]::IsPathRooted($Root)){throw 'WORKSPACE_ROOT_MUST_BE_ABSOLUTE'}
  $root=[IO.Path]::GetFullPath($Root)
  if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'WORKSPACE_ROOT_NOT_FOUND'}
  Assert-SoknaNoReparsePath $root
  $name=([string]$DisplayName).Trim();if([string]::IsNullOrWhiteSpace($name)){$name=$Id}
  if($name.Length-gt200-or$name-match'[\x00\r\n]'){throw 'WORKSPACE_DISPLAY_NAME_INVALID'}
  $sc=Normalize-SoknaWorkspaceScopes $root $Scopes;$tl=Normalize-SoknaWorkspaceTools $Tools
  $r=Get-SoknaWorkspaceRegistry;$map=Convert-SoknaWorkspaceMapToHashtable $r.workspaces
  if($map.Contains($Id)){throw 'WORKSPACE_ALREADY_EXISTS'}
  foreach($k in $map.Keys){if(([IO.Path]::GetFullPath([string]$map[$k].root)).Equals($root,[StringComparison]::OrdinalIgnoreCase)){throw 'WORKSPACE_ROOT_ALREADY_REGISTERED'}}
  $now=(Get-Date).ToUniversalTime().ToString('o')
  $map[$Id]=[ordered]@{id=$Id;display_name=$name;kind='persistent_local';root=$root;scopes=$sc;tools=$tl;created_at=$now;updated_at=$now}
  $r.workspaces=$map;if(-not$r.default_workspace){$r.default_workspace=$Id}
  Save-SoknaWorkspaceRegistry $r
  Write-SoknaWorkspaceAudit 'workspace.register' $Id ([pscustomobject]@{root=$root;kind='persistent_local';source_preserved=$true})
  return (Get-SoknaWorkspace $Id)
}
function Update-SoknaWorkspacePermissions([string]$Id,$Scopes,$Tools){
  $r=Get-SoknaWorkspaceRegistry;$map=Convert-SoknaWorkspaceMapToHashtable $r.workspaces
  if(-not$map.Contains($Id)){throw 'UNKNOWN_WORKSPACE: '+$Id}
  $w=$map[$Id];$kind=[string]$w.kind
  if($kind-eq'remote'){$w.scopes=Normalize-SoknaRemoteScopes $Scopes}
  else{$root=[IO.Path]::GetFullPath([string]$w.root);if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'WORKSPACE_ROOT_NOT_FOUND: '+$root};Assert-SoknaNoReparsePath $root;$w.scopes=Normalize-SoknaWorkspaceScopes $root $Scopes}
  $w.tools=Normalize-SoknaWorkspaceTools $Tools;$w.updated_at=(Get-Date).ToUniversalTime().ToString('o')
  $map[$Id]=$w;$r.workspaces=$map;Save-SoknaWorkspaceRegistry $r
  Write-SoknaWorkspaceAudit 'workspace.permissions.update' $Id ([pscustomobject]@{kind=$kind;scope_count=@($w.scopes).Count;tool_count=@($w.tools).Count})
  return (Get-SoknaWorkspace $Id)
}
function Unregister-SoknaWorkspace([string]$Id){
  $r=Get-SoknaWorkspaceRegistry;$map=Convert-SoknaWorkspaceMapToHashtable $r.workspaces
  if(-not$map.Contains($Id)){throw 'UNKNOWN_WORKSPACE: '+$Id}
  $root=[string](Get-SoknaOptionalProperty $map[$Id] 'root' '');$kind=[string](Get-SoknaOptionalProperty $map[$Id] 'kind' '');$map.Remove($Id);$r.workspaces=$map
  if([string]$r.default_workspace-eq$Id){if($map.Count-gt0){$r.default_workspace=@($map.Keys|Sort-Object)[0]}else{$r.default_workspace=''}}
  Save-SoknaWorkspaceRegistry $r
  Write-SoknaWorkspaceAudit 'workspace.unregister' $Id ([pscustomobject]@{root=$root;kind=$kind;source_preserved=$true;source_deleted=$false})
  return @{ok=$true;workspace=$Id;root=$root;source_preserved=$true;source_deleted=$false}
}
function Get-SoknaWorkspaceAssessment([string]$Root){
  $full=[IO.Path]::GetFullPath($Root);$exists=Test-Path -LiteralPath $full;$isDir=Test-Path -LiteralPath $full -PathType Container
  if(-not$isDir){return @{root=$full;exists=$exists;is_directory=$false;is_git_repository=$false;file_count=0;total_bytes=0;reparse_blocked=$false}}
  Assert-SoknaNoReparsePath $full
  $count=0;[int64]$bytes=0;$stack=New-Object 'System.Collections.Generic.Stack[string]';$stack.Push($full)
  while($stack.Count-gt0){
    $dir=$stack.Pop()
    foreach($x in Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop){
      if(($x.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'WORKSPACE_REPARSE_POINT_BLOCKED: '+$x.FullName}
      if($x.PSIsContainer){$stack.Push($x.FullName)}else{$count++;$bytes+=[int64]$x.Length}
    }
  }
  return @{root=$full;exists=$true;is_directory=$true;is_git_repository=(Test-Path -LiteralPath (Join-Path $full '.git') -PathType Container);file_count=$count;total_bytes=$bytes;reparse_blocked=$false}
}
function New-SoknaManagedCopyPlan([string]$Source,[string]$Destination){
  if((-not [IO.Path]::IsPathRooted($Source)) -or (-not [IO.Path]::IsPathRooted($Destination))){throw 'WORKSPACE_COPY_PATH_MUST_BE_ABSOLUTE'}
  $src=[IO.Path]::GetFullPath($Source);$dst=[IO.Path]::GetFullPath($Destination)
  if(-not(Test-Path -LiteralPath $src -PathType Container)){throw 'WORKSPACE_SOURCE_NOT_FOUND'}
  Assert-SoknaNoReparsePath $src;Assert-SoknaNoReparsePath $dst -AllowMissing
  if((Test-SoknaWorkspaceContained $src $dst)-or(Test-SoknaWorkspaceContained $dst $src)){throw 'WORKSPACE_COPY_PATH_OVERLAP'}
  $p=@{schema='sokna-managed-copy-plan-v1';source=$src;destination=$dst;stages=@('copy','verify','test','switch');source_deletion='separate_explicit_action_outside_mvp';automatic_execution=$false}
  Write-SoknaWorkspaceAudit 'workspace.managed_copy.plan' '' ([pscustomobject]@{source=$src;destination=$dst;source_preserved=$true})
  return $p
}
function Get-SoknaWorkspacePathsVisible($Workspace,$Items){
  $out=@();foreach($x in @($Items)){try{$null=Resolve-SoknaWorkspacePath $Workspace ([string]$x) -Access 'read';$out+=$x}catch{}}
  return @($out)
}

function New-SoknaGrantRegistry(){return [ordered]@{schema='sokna-workspace-grants-v1';grants=[ordered]@{};updated_at=(Get-Date).ToUniversalTime().ToString('o')}}
function Get-SoknaGrantRegistry(){
  if(-not(Test-Path -LiteralPath $script:WorkspaceGrantPath -PathType Leaf)){Write-SoknaWorkspaceJsonAtomic $script:WorkspaceGrantPath (New-SoknaGrantRegistry)}
  $r=Get-Content -LiteralPath $script:WorkspaceGrantPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$r.schema-ne'sokna-workspace-grants-v1'){throw 'WORKSPACE_GRANT_SCHEMA_UNSUPPORTED'}
  return $r
}
function Save-SoknaGrantRegistry($r){$r.updated_at=(Get-Date).ToUniversalTime().ToString('o');Write-SoknaWorkspaceJsonAtomic $script:WorkspaceGrantPath $r}
function Test-SoknaPolicyScopes($Scopes,[string]$Rel,[string]$Access){
  $matches=@($Scopes|Where-Object{Test-SoknaScopeMatch ([string]$_.path) $Rel})
  if(@($matches|Where-Object{([string]$_.access)-eq'deny'}).Count-gt0){return $false}
  $best=$null;$bestLen=-1
  foreach($x in $matches){$a=[string]$x.access;if($a-eq'deny'){continue};$l=([string]$x.path).Length;if($l-gt$bestLen){$best=$x;$bestLen=$l}}
  if($null-eq$best){return $false};$g=[string]$best.access
  return ($g-eq'write'-or($Access-eq'read'-and$g-eq'read'))
}
function Get-SoknaWorkspaceGrant([string]$GrantId,[string]$WorkspaceId,[string]$JobId){
  if([string]::IsNullOrWhiteSpace($GrantId)-or[string]::IsNullOrWhiteSpace($JobId)){throw 'WORKSPACE_GRANT_AND_JOB_REQUIRED'}
  $r=Get-SoknaGrantRegistry;$m=Convert-SoknaWorkspaceMapToHashtable $r.grants
  if(-not$m.Contains($GrantId)){throw 'WORKSPACE_GRANT_NOT_FOUND'};$g=$m[$GrantId]
  if([string]$g.workspace_id-ne$WorkspaceId-or[string]$g.job_id-ne$JobId){throw 'WORKSPACE_GRANT_BINDING_MISMATCH'}
  if(-not[string]::IsNullOrWhiteSpace([string](Get-SoknaOptionalProperty $g 'revoked_at' ''))){throw 'WORKSPACE_GRANT_REVOKED'}
  $expires=[DateTimeOffset]::Parse([string]$g.expires_at);if([DateTimeOffset]::UtcNow-ge$expires){throw 'WORKSPACE_GRANT_EXPIRED'}
  return $g
}
function Get-SoknaWorkspaceEffectiveView([string]$WorkspaceId,[string]$GrantId,[string]$JobId){
  $w=Get-SoknaWorkspace $WorkspaceId
  if([string]::IsNullOrWhiteSpace($GrantId)){if(-not[string]::IsNullOrWhiteSpace($JobId)){throw 'JOB_SCOPED_ACCESS_REQUIRES_GRANT'};return $w}
  $g=Get-SoknaWorkspaceGrant $GrantId $w.id $JobId
  $w|Add-Member -NotePropertyName grant_id -NotePropertyValue $GrantId -Force
  $w|Add-Member -NotePropertyName job_id -NotePropertyValue $JobId -Force
  $w|Add-Member -NotePropertyName grant_scopes -NotePropertyValue @($g.scopes) -Force
  $w|Add-Member -NotePropertyName grant_tools -NotePropertyValue @($g.tools) -Force
  return $w
}
function Test-SoknaWorkspaceGrantPolicy([string]$WorkspaceId,$Scopes,$Tools){
  $w=Get-SoknaWorkspace $WorkspaceId;$sc=@($Scopes);if($sc.Count-eq0){throw 'WORKSPACE_GRANT_SCOPE_REQUIRED'}
  if([string]$w.kind-eq'remote'){$sc=Normalize-SoknaRemoteScopes $sc}else{$sc=Normalize-SoknaWorkspaceScopes ([string]$w.path) $sc}
  foreach($x in $sc){$a=([string]$x.access).ToLowerInvariant();$gp=[string]$x.path;if($a-ne'deny'-and-not(Test-SoknaPolicyScopes $w.scopes $gp $a)){throw 'WORKSPACE_GRANT_ESCALATION_BLOCKED'}}
  $tl=Normalize-SoknaWorkspaceTools $Tools;foreach($t in $tl){if(@($w.tools)-notcontains$t){throw 'WORKSPACE_GRANT_TOOL_ESCALATION_BLOCKED: '+$t}}
  return [ordered]@{ok=$true;workspace_id=[string]$w.id;scopes=$sc;tools=$tl;effective='template-intersection(workspace_policy,job_grant)'}
}
function New-SoknaWorkspaceGrant([string]$Id,[string]$WorkspaceId,[string]$JobId,[string]$Issuer,[string]$Context,$Scopes,$Tools,[int]$TtlSeconds=900){
  if(-not(Test-SoknaWorkspaceId $Id)-or-not(Test-SoknaWorkspaceId $JobId)){throw 'WORKSPACE_GRANT_OR_JOB_ID_INVALID'}
  if([string]::IsNullOrWhiteSpace($Issuer)-or$Issuer.Length-gt120){throw 'WORKSPACE_GRANT_ISSUER_INVALID'}
  if($TtlSeconds-lt1-or$TtlSeconds-gt86400){throw 'WORKSPACE_GRANT_TTL_INVALID'}
  $w=Get-SoknaWorkspace $WorkspaceId;$policy=Test-SoknaWorkspaceGrantPolicy -WorkspaceId $WorkspaceId -Scopes $Scopes -Tools $Tools;$sc=@($policy.scopes);$tl=@($policy.tools)
  $r=Get-SoknaGrantRegistry;$m=Convert-SoknaWorkspaceMapToHashtable $r.grants;if($m.Contains($Id)){throw 'WORKSPACE_GRANT_ALREADY_EXISTS'}
  $now=[DateTimeOffset]::UtcNow;$g=[ordered]@{id=$Id;workspace_id=$w.id;job_id=$JobId;issuer=$Issuer;context=$Context;scopes=$sc;tools=$tl;created_at=$now.ToString('o');expires_at=$now.AddSeconds($TtlSeconds).ToString('o');revoked_at=''}
  $m[$Id]=$g;$r.grants=$m;Save-SoknaGrantRegistry $r;Write-SoknaWorkspaceAudit 'workspace.grant.create' $w.id ([pscustomobject]@{grant_id=$Id;job_id=$JobId;issuer=$Issuer;expires_at=$g.expires_at});return $g
}
function Revoke-SoknaWorkspaceGrant([string]$Id,[string]$Issuer){if([string]::IsNullOrWhiteSpace($Issuer)-or$Issuer.Length-gt120){throw 'WORKSPACE_GRANT_ISSUER_INVALID'};$r=Get-SoknaGrantRegistry;$m=Convert-SoknaWorkspaceMapToHashtable $r.grants;if(-not$m.Contains($Id)){throw 'WORKSPACE_GRANT_NOT_FOUND'};$g=$m[$Id];if([string]::IsNullOrWhiteSpace([string]$g.revoked_at)){$g.revoked_at=[DateTimeOffset]::UtcNow.ToString('o');$m[$Id]=$g;$r.grants=$m;Save-SoknaGrantRegistry $r;Write-SoknaWorkspaceAudit 'workspace.grant.revoke' ([string]$g.workspace_id) ([pscustomobject]@{grant_id=$Id;job_id=[string]$g.job_id;issuer=$Issuer})};return @{ok=$true;grant_id=$Id;revoked=$true}}
function Register-SoknaRemoteWorkspace([string]$Id,[string]$DisplayName,[string]$Adapter,[string]$EndpointRef,[string]$RootRef,[string]$CredentialRef,$Scopes,$Tools){
  if(-not(Test-SoknaWorkspaceId $Id)-or$Adapter-notmatch'^[A-Za-z0-9._-]{1,80}$'){throw 'REMOTE_WORKSPACE_ID_INVALID'}
  if($EndpointRef-match'[@?\s]'-or$EndpointRef.Contains('://')){throw 'REMOTE_ENDPOINT_CREDENTIAL_OR_QUERY_REJECTED'}
  if($CredentialRef-match'[@?\s]'-or$CredentialRef.Contains('://')){throw 'REMOTE_CREDENTIAL_REF_INVALID'}
  $rootNorm=Normalize-SoknaRemotePath $RootRef;$sc=Normalize-SoknaRemoteScopes $Scopes
  $r=Get-SoknaWorkspaceRegistry;$m=Convert-SoknaWorkspaceMapToHashtable $r.workspaces;if($m.Contains($Id)){throw 'WORKSPACE_ALREADY_EXISTS'}
  $tl=Normalize-SoknaWorkspaceTools $Tools;$now=[DateTimeOffset]::UtcNow.ToString('o');$m[$Id]=[ordered]@{id=$Id;display_name=($(if($DisplayName){$DisplayName}else{$Id}));kind='remote';scopes=$sc;tools=$tl;remote=[ordered]@{adapter=$Adapter;endpoint_ref=$EndpointRef;root_ref=$rootNorm;credential_ref=$CredentialRef};created_at=$now;updated_at=$now};$r.workspaces=$m;Save-SoknaWorkspaceRegistry $r;Write-SoknaWorkspaceAudit 'workspace.remote.register' $Id ([pscustomobject]@{adapter=$Adapter;endpoint_ref=$EndpointRef;credential_ref_present=(-not[string]::IsNullOrWhiteSpace($CredentialRef))});return (Get-SoknaWorkspace $Id)
}
function Register-SoknaEphemeralWorkspace([string]$Id,[string]$DisplayName,[string]$Root,[string]$JobId,[int]$TtlSeconds,$Scopes,$Tools){
  if(-not(Test-SoknaWorkspaceId $Id)-or-not(Test-SoknaWorkspaceId $JobId)){throw 'EPHEMERAL_ID_OR_JOB_INVALID'}
  if($TtlSeconds-lt1-or$TtlSeconds-gt86400){throw 'EPHEMERAL_TTL_INVALID'}
  $managed=[IO.Path]::GetFullPath($script:WorkspaceEphemeralRoot);$full=[IO.Path]::GetFullPath($Root);if(-not(Test-SoknaWorkspaceContained $managed $full)-or$full-eq$managed){throw 'EPHEMERAL_ROOT_NOT_MANAGED'};Assert-SoknaNoReparsePath $full
  $r=Get-SoknaWorkspaceRegistry;$m=Convert-SoknaWorkspaceMapToHashtable $r.workspaces;if($m.Contains($Id)){throw 'WORKSPACE_ALREADY_EXISTS'};$now=[DateTimeOffset]::UtcNow;$normScopes=Normalize-SoknaWorkspaceScopes $full @($Scopes);$m[$Id]=[ordered]@{id=$Id;display_name=$DisplayName;kind='ephemeral_checkout';root=$full;scopes=$normScopes;tools=(Normalize-SoknaWorkspaceTools $Tools);owner_job_id=$JobId;expires_at=$now.AddSeconds($TtlSeconds).ToString('o');created_at=$now.ToString('o');updated_at=$now.ToString('o')};$r.workspaces=$m;Save-SoknaWorkspaceRegistry $r;Write-SoknaWorkspaceAudit 'workspace.ephemeral.register' $Id ([pscustomobject]@{job_id=$JobId;expires_at=$m[$Id].expires_at});return (Get-SoknaWorkspace $Id)
}
function Get-SoknaWorkspaceAdvancedStatus([string]$WorkspaceId,[string]$GrantId,[string]$JobId){$w=Get-SoknaWorkspace $WorkspaceId;$g=$null;$eff='workspace_policy';if($GrantId){$g=Get-SoknaWorkspaceGrant $GrantId $w.id $JobId;$eff='intersection(workspace_policy,job_grant)'};return @{ok=$true;workspace_id=$w.id;kind=$w.kind;base_scopes=@($w.scopes);base_tools=@($w.tools);grant=$g;effective=$eff;grant_registry=$script:WorkspaceGrantPath;ephemeral_root=$script:WorkspaceEphemeralRoot;remote_adapter_boundary=$script:WorkspaceRemoteAdapterRoot}}
function Invoke-SoknaWorkspaceAdvancedCleanup($ActiveJobIds){
  $active=@{};foreach($x in @($ActiveJobIds)){$active[[string]$x]=$true};$removed=0;$expired=0;$now=[DateTimeOffset]::UtcNow
  $gr=Get-SoknaGrantRegistry;$gm=Convert-SoknaWorkspaceMapToHashtable $gr.grants;foreach($id in @($gm.Keys)){try{$g=$gm[$id];if(-not[string]::IsNullOrWhiteSpace([string]$g.revoked_at)-or$now-ge[DateTimeOffset]::Parse([string]$g.expires_at)-or-not$active.ContainsKey([string]$g.job_id)){$gm.Remove($id);$expired++}}catch{$gm.Remove($id);$expired++}};$gr.grants=$gm;Save-SoknaGrantRegistry $gr
  $r=Get-SoknaWorkspaceRegistry;$wm=Convert-SoknaWorkspaceMapToHashtable $r.workspaces;foreach($id in @($wm.Keys)){$w=$wm[$id];if([string]$w.kind-ne'ephemeral_checkout'){continue};$job=[string]$w.owner_job_id;$isExpired=$true;try{$isExpired=$now-ge[DateTimeOffset]::Parse([string]$w.expires_at)}catch{};if($isExpired-or-not$active.ContainsKey($job)){$root=[IO.Path]::GetFullPath([string]$w.root);if(-not(Test-SoknaWorkspaceContained $script:WorkspaceEphemeralRoot $root)){throw 'EPHEMERAL_CLEANUP_ESCAPE'};Assert-SoknaNoReparsePath $root -AllowMissing;if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force};$wm.Remove($id);$removed++}}
  $r.workspaces=$wm;Save-SoknaWorkspaceRegistry $r;return @{ok=$true;grants_expired=$expired;ephemeral_removed=$removed}
}
function Invoke-SoknaRemoteWorkspaceAdapter($Workspace,[string]$GrantId,[string]$JobId,[string]$Path,[string]$Operation,$Args){
  if([string]$Workspace.kind-ne'remote'){throw 'REMOTE_WORKSPACE_REQUIRED'}
  $g=Get-SoknaWorkspaceGrant $GrantId $Workspace.id $JobId;if(@($Workspace.tools)-notcontains'remote.exec'-or@($g.tools)-notcontains'remote.exec'){throw 'REMOTE_EXEC_TOOL_NOT_GRANTED'}
  $rel=Normalize-SoknaRemotePath $Path;if(-not(Test-SoknaPolicyScopes $Workspace.scopes $rel 'read')-or-not(Test-SoknaPolicyScopes $g.scopes $rel 'read')){throw 'REMOTE_PATH_ACCESS_DENIED'}
  $adapter=[string]$Workspace.remote.adapter;$exe=Join-Path (Join-Path $script:WorkspaceRemoteAdapterRoot $adapter) 'adapter.exe';$exe=[IO.Path]::GetFullPath($exe);if(-not(Test-SoknaWorkspaceContained $script:WorkspaceRemoteAdapterRoot $exe)){throw 'REMOTE_ADAPTER_PATH_ESCAPE'};Assert-SoknaNoReparsePath $exe;if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'REMOTE_ADAPTER_NOT_INSTALLED'}
  $req=[ordered]@{schema='sokna-remote-workspace-request-v1';workspace_id=$Workspace.id;job_id=$JobId;operation=$Operation;path=$rel;args=@($Args);endpoint_ref=[string]$Workspace.remote.endpoint_ref;root_ref=[string]$Workspace.remote.root_ref;credential_ref=[string]$Workspace.remote.credential_ref}
  $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$exe;$psi.UseShellExecute=$false;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.CreateNoWindow=$true;$proc=New-Object Diagnostics.Process;$proc.StartInfo=$psi;[void]$proc.Start();$proc.StandardInput.WriteLine(($req|ConvertTo-Json -Depth 20 -Compress));$proc.StandardInput.Close();$out=$proc.StandardOutput.ReadToEnd();$err=$proc.StandardError.ReadToEnd();if(-not$proc.WaitForExit(120000)){try{$proc.Kill()}catch{};throw 'REMOTE_ADAPTER_TIMEOUT'};Write-SoknaWorkspaceAudit 'workspace.remote.exec' $Workspace.id ([pscustomobject]@{job_id=$JobId;grant_id=$GrantId;adapter=$adapter;operation=$Operation;path=$rel;exit_code=$proc.ExitCode});if($proc.ExitCode-ne0){throw ('REMOTE_ADAPTER_FAILED: '+$err)};try{return ($out|ConvertFrom-Json)}catch{return @{ok=$true;output=$out}}
}
function Get-SoknaWorkspaceRegistryStatus(){
  $r=Get-SoknaWorkspaceRegistry;$map=Convert-SoknaWorkspaceMapToHashtable $r.workspaces;$kinds=@{persistent_local=0;ephemeral_checkout=0;remote=0}
  foreach($id in $map.Keys){$k=[string](Get-SoknaOptionalProperty $map[$id] 'kind' '');if($kinds.ContainsKey($k)){$kinds[$k]++}}
  return @{ok=$true;schema=[string]$r.schema;registry_path=$script:WorkspaceRegistryPath;audit_path=$script:WorkspaceAuditPath;grant_registry_path=$script:WorkspaceGrantPath;ephemeral_root=$script:WorkspaceEphemeralRoot;remote_adapter_root=$script:WorkspaceRemoteAdapterRoot;default_workspace=[string]$r.default_workspace;count=$map.Count;kinds=$kinds}
}

Export-ModuleMember -Function Initialize-SoknaWorkspaceRegistry,Get-SoknaWorkspaceRegistryStatus,Get-SoknaWorkspaceMap,Get-SoknaWorkspaceList,Get-SoknaWorkspace,Get-SoknaWorkspaceEffectiveView,Resolve-SoknaWorkspacePath,Assert-SoknaWorkspaceFullAccess,Assert-SoknaWorkspaceTool,Register-SoknaWorkspace,Update-SoknaWorkspacePermissions,Unregister-SoknaWorkspace,Get-SoknaWorkspaceAssessment,New-SoknaManagedCopyPlan,Get-SoknaWorkspacePathsVisible,New-SoknaWorkspaceGrant,Get-SoknaWorkspaceGrant,Revoke-SoknaWorkspaceGrant,Register-SoknaRemoteWorkspace,Register-SoknaEphemeralWorkspace,Get-SoknaWorkspaceAdvancedStatus,Invoke-SoknaWorkspaceAdvancedCleanup,Invoke-SoknaRemoteWorkspaceAdapter,Test-SoknaWorkspaceGrantPolicy
