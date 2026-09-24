$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$module=Join-Path $repo 'native\runtime\v2.6.0\Sokna.Workspace.psm1'
Import-Module $module -Force
$root=Join-Path ([IO.Path]::GetTempPath()) ('sokna-p5-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force|Out-Null
try {
  $cfgPath=Join-Path $root 'config.json';'{}'|Set-Content $cfgPath -Encoding UTF8;$cfg=Get-Content $cfgPath -Raw|ConvertFrom-Json
  $null=Initialize-SoknaWorkspaceRegistry -Config $cfg -ConfigPath $cfgPath -RuntimeRoot $root
  $local=Join-Path $root 'local';New-Item -ItemType Directory -Path (Join-Path $local 'secret') -Force|Out-Null;'ok'|Set-Content (Join-Path $local 'a.txt') -Encoding UTF8
  $w=Register-SoknaWorkspace -Id 'main' -DisplayName 'Main' -Root $local -Scopes @([pscustomobject]@{path='.';access='write'},[pscustomobject]@{path='secret';access='deny'}) -Tools @('git','node','remote.exec')

  $g=New-SoknaWorkspaceGrant -Id 'g1' -WorkspaceId 'main' -JobId 'job1' -Issuer 'ci' -Context 'read-only' -Scopes @([pscustomobject]@{path='.';access='read'}) -Tools @('git') -TtlSeconds 600
  $eff=Get-SoknaWorkspaceEffectiveView -WorkspaceId 'main' -GrantId 'g1' -JobId 'job1'
  $null=Resolve-SoknaWorkspacePath $eff 'a.txt' -Access read
  try{$null=Resolve-SoknaWorkspacePath $eff 'a.txt' -Access write;throw 'P5_GRANT_WRITE_ESCALATION'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_'){throw}}
  try{$null=Resolve-SoknaWorkspacePath $eff 'secret\x' -Access read -AllowMissing;throw 'P5_BASE_DENY_BYPASS'}catch{if($_.Exception.Message-notmatch'WORKSPACE_PATH_DENIED'){throw}}
  $null=Assert-SoknaWorkspaceTool $eff 'git'
  try{$null=Assert-SoknaWorkspaceTool $eff 'node';throw 'P5_GRANT_TOOL_ESCALATION'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_TOOL_NOT_ALLOWED'){throw}}
  try{$null=Get-SoknaWorkspaceEffectiveView -WorkspaceId 'main' -GrantId 'g1' -JobId 'job2';throw 'P5_CROSS_JOB_BYPASS'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_BINDING_MISMATCH'){throw}}
  try{$null=New-SoknaWorkspaceGrant -Id 'bad' -WorkspaceId 'main' -JobId 'job1' -Issuer 'ci' -Scopes @([pscustomobject]@{path='secret';access='read'}) -Tools @() -TtlSeconds 60;throw 'P5_DENY_EXPANSION_BYPASS'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_ESCALATION_BLOCKED'){throw}}
  $null=Revoke-SoknaWorkspaceGrant -Id 'g1' -Issuer 'ci'
  try{$null=Get-SoknaWorkspaceEffectiveView -WorkspaceId 'main' -GrantId 'g1' -JobId 'job1';throw 'P5_REVOKE_BYPASS'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_REVOKED'){throw}}

  # Ephemeral checkout record must stay under managed state and is removed when owner job is orphaned.
  $ep=Join-Path (Join-Path (Join-Path $root 'state') 'ephemeral') 'jobE\ep1';New-Item -ItemType Directory -Path $ep -Force|Out-Null;'tmp'|Set-Content (Join-Path $ep 'x.txt') -Encoding UTF8
  $ew=Register-SoknaEphemeralWorkspace -Id 'ep1' -DisplayName 'Ephemeral' -Root $ep -JobId 'jobE' -TtlSeconds 3600 -Scopes @([pscustomobject]@{path='.';access='write'}) -Tools @('git')
  if($ew.kind-ne'ephemeral_checkout'){throw 'P5_EPHEMERAL_KIND'}
  $keep=Invoke-SoknaWorkspaceAdvancedCleanup -ActiveJobIds @('jobE');if(-not(Test-Path $ep)){throw 'P5_ACTIVE_EPHEMERAL_REMOVED'}
  $gone=Invoke-SoknaWorkspaceAdvancedCleanup -ActiveJobIds @();if(Test-Path $ep){throw 'P5_ORPHAN_EPHEMERAL_RETAINED'}
  try{$badRoot=Join-Path $root 'outsideEp';New-Item -ItemType Directory -Path $badRoot -Force|Out-Null;$null=Register-SoknaEphemeralWorkspace -Id 'epbad' -DisplayName 'Bad' -Root $badRoot -JobId 'jobE' -TtlSeconds 60 -Scopes @([pscustomobject]@{path='.';access='write'}) -Tools @();throw 'P5_EPHEMERAL_ROOT_ESCAPE'}catch{if($_.Exception.Message-notmatch'EPHEMERAL_ROOT_NOT_MANAGED'){throw}}

  # Remote adapter is external and receives only opaque refs, never credential values.
  $remote=Register-SoknaRemoteWorkspace -Id 'remote1' -DisplayName 'Remote' -Adapter 'fake' -EndpointRef 'prod01' -RootRef 'srv/app' -CredentialRef 'cred-prod' -Scopes @([pscustomobject]@{path='.';access='read'},[pscustomobject]@{path='tmp';access='deny'}) -Tools @('remote.exec')
  $rg=New-SoknaWorkspaceGrant -Id 'rg' -WorkspaceId 'remote1' -JobId 'jobR' -Issuer 'ci' -Scopes @([pscustomobject]@{path='.';access='read'}) -Tools @('remote.exec') -TtlSeconds 600
  $adapterDir=Join-Path (Join-Path $root 'adapters') 'fake';New-Item -ItemType Directory -Path $adapterDir -Force|Out-Null;$adapterExe=Join-Path $adapterDir 'adapter.exe'
  $src=@'
using System; using System.IO;
public class Adapter { public static void Main(){ var x=Console.In.ReadLine(); Console.Write("{\"ok\":true,\"transport\":\"fake\"}"); } }
'@
  Add-Type -TypeDefinition $src -OutputAssembly $adapterExe -OutputType ConsoleApplication
  $rv=Get-SoknaWorkspaceEffectiveView -WorkspaceId 'remote1' -GrantId 'rg' -JobId 'jobR'
  $rr=Invoke-SoknaRemoteWorkspaceAdapter -Workspace $rv -GrantId 'rg' -JobId 'jobR' -Path 'docs/readme.md' -Operation 'read' -Args @();if(-not$rr.ok){throw 'P5_REMOTE_ADAPTER_FAILED'}
  try{$null=Invoke-SoknaRemoteWorkspaceAdapter -Workspace $rv -GrantId 'rg' -JobId 'jobR' -Path '..\escape' -Operation 'read' -Args @();throw 'P5_REMOTE_PATH_ESCAPE'}catch{if($_.Exception.Message-notmatch'REMOTE_PATH_ESCAPE'){throw}}
  try{$null=Register-SoknaRemoteWorkspace -Id 'remoteBad' -DisplayName 'Bad' -Adapter 'fake' -EndpointRef 'user@host' -RootRef 'srv' -CredentialRef '' -Scopes @([pscustomobject]@{path='.';access='read'}) -Tools @();throw 'P5_REMOTE_CREDENTIAL_ENDPOINT'}catch{if($_.Exception.Message-notmatch'REMOTE_ENDPOINT_CREDENTIAL'){throw}}

  $orphan=New-SoknaWorkspaceGrant -Id 'orphan' -WorkspaceId 'main' -JobId 'missingJob' -Issuer 'ci' -Scopes @([pscustomobject]@{path='.';access='read'}) -Tools @() -TtlSeconds 600
  $clean=Invoke-SoknaWorkspaceAdvancedCleanup -ActiveJobIds @();try{$null=Get-SoknaWorkspaceGrant 'orphan' 'main' 'missingJob';throw 'P5_ORPHAN_GRANT_RETAINED'}catch{if($_.Exception.Message-notmatch'WORKSPACE_GRANT_NOT_FOUND'){throw}}

  [ordered]@{ok=$true;schema='sokna-p5-advanced-workspace-windows-acceptance-v1';grant_intersection=$true;cross_job_fail_closed=$true;revoke_fail_closed=$true;ephemeral_orphan_cleanup=$true;remote_adapter_boundary=$true;remote_path_escape_blocked=$true;orphan_grant_cleanup=$true}|ConvertTo-Json -Compress
} finally {
  Remove-Module Sokna.Workspace -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
