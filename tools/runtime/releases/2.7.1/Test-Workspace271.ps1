$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$module=Join-Path $repo 'native\runtime\v2.7.1\Sokna.Workspace.psm1'
Import-Module $module -Force
$root=Join-Path ([IO.Path]::GetTempPath()) ('sokna-p2-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force|Out-Null
try {
  $cfgPath=Join-Path $root 'config.json'
  '{}'|Set-Content -LiteralPath $cfgPath -Encoding UTF8
  $cfg=Get-Content $cfgPath -Raw|ConvertFrom-Json
  $null=Initialize-SoknaWorkspaceRegistry -Config $cfg -ConfigPath $cfgPath -RuntimeRoot $root
  $st=Get-SoknaWorkspaceRegistryStatus
  if($st.count-ne0){throw 'P2_ZERO_WORKSPACE_INIT_FAILED'}

  $src=Join-Path $root 'plain';New-Item -ItemType Directory -Path (Join-Path $src 'editable\secret') -Force|Out-Null
  New-Item -ItemType Directory -Path (Join-Path $src 'readonly') -Force|Out-Null
  'keep'|Set-Content (Join-Path $src 'sentinel.txt') -Encoding UTF8
  $scopes=@(
    [pscustomobject]@{path='.';access='read'},
    [pscustomobject]@{path='editable';access='write'},
    [pscustomobject]@{path='editable\secret';access='deny'}
  )
  $w=Register-SoknaWorkspace -Id 'plain' -DisplayName 'Plain local' -Root $src -Scopes $scopes -Tools @('node.exe')
  if($w.kind-ne'persistent_local'){throw 'P2_KIND_FAILED'}
  $null=Resolve-SoknaWorkspacePath $w 'readonly\x.txt' -Access read -AllowMissing
  $null=Resolve-SoknaWorkspacePath $w 'editable\x.txt' -Access write -AllowMissing
  try{$null=Resolve-SoknaWorkspacePath $w 'readonly\x.txt' -Access write -AllowMissing;throw 'P2_READ_SCOPE_ALLOWED_WRITE'}catch{if($_.Exception.Message-notmatch'WORKSPACE_WRITE_NOT_GRANTED'){throw}}
  try{$null=Resolve-SoknaWorkspacePath $w 'editable\secret\x.txt' -Access read -AllowMissing;throw 'P2_DENY_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_PATH_DENIED'){throw}}
  try{$null=Resolve-SoknaWorkspacePath $w '..\escape.txt' -Access read -AllowMissing;throw 'P2_TRAVERSAL_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_PATH_'){throw}}
  $null=Assert-SoknaWorkspaceTool $w 'node'
  try{$null=Assert-SoknaWorkspaceTool $w 'git';throw 'P2_TOOL_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_TOOL_NOT_ALLOWED'){throw}}
  try{$null=Assert-SoknaWorkspaceFullAccess $w write;throw 'P2_BROAD_SCOPE_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_BROAD_(WRITE_BLOCKED_BY_READ_SCOPE|ACCESS_BLOCKED_BY_DENY)'){throw}}

  $junction=Join-Path $src 'junction';$outside=Join-Path $root 'outside';New-Item -ItemType Directory -Path $outside -Force|Out-Null
  New-Item -ItemType Junction -Path $junction -Target $outside|Out-Null
  try{$null=Resolve-SoknaWorkspacePath $w 'junction\x.txt' -Access read -AllowMissing;throw 'P2_JUNCTION_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_REPARSE_POINT_BLOCKED'){throw}}

  $plan=New-SoknaManagedCopyPlan -Source $src -Destination (Join-Path $root 'managed')
  if(($plan.stages -join ',')-ne'copy,verify,test,switch'-or$plan.automatic_execution){throw 'P2_COPY_PLAN_FAILED'}
  try{$null=New-SoknaManagedCopyPlan -Source $src -Destination (Join-Path $src 'nested');throw 'P2_COPY_OVERLAP_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_COPY_PATH_OVERLAP'){throw}}

  $u=Unregister-SoknaWorkspace -Id 'plain'
  if($u.source_deleted-ne$false-or-not(Test-Path (Join-Path $src 'sentinel.txt'))){throw 'P2_UNREGISTER_DELETED_SOURCE'}

  # Legacy migration: source config remains, write_enabled=false => read-only, tools empty.
  $legacyRoot=Join-Path $root 'legacy';New-Item -ItemType Directory -Path $legacyRoot -Force|Out-Null
  $legacyCfgPath=Join-Path $root 'legacy-config.json'
  @{default_workspace='Legacy Name';workspaces=@{'Legacy Name'=@{path=$legacyRoot;write_enabled=$false;expected_repo='example/legacy'}}}|ConvertTo-Json -Depth 8|Set-Content $legacyCfgPath -Encoding UTF8
  $legacyCfg=Get-Content $legacyCfgPath -Raw|ConvertFrom-Json
  $legacyState=Join-Path $root 'legacy-state.json';$legacyCfg|Add-Member -NotePropertyName workspace_registry_path -NotePropertyValue $legacyState
  $null=Initialize-SoknaWorkspaceRegistry -Config $legacyCfg -ConfigPath $legacyCfgPath -RuntimeRoot $root
  $items=@(Get-SoknaWorkspaceList);if($items.Count-ne1){throw 'P2_LEGACY_COUNT_FAILED'}
  $lw=Get-SoknaWorkspace $items[0].id
  if(@($lw.tools).Count-ne0){throw 'P2_LEGACY_TOOL_AUTO_GRANT'}
  try{$null=Resolve-SoknaWorkspacePath $lw 'x.txt' -Access write -AllowMissing;throw 'P2_LEGACY_READONLY_BYPASSED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_WRITE_NOT_GRANTED'){throw}}
  if(-not(Test-Path $legacyCfgPath)){throw 'P2_LEGACY_SOURCE_CONFIG_REMOVED'}

  Write-Output 'P2_WORKSPACE_WINDOWS_PASS'
} finally {
  Remove-Module Sokna.Workspace -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
