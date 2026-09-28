from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]

def req(cond, msg):
    if not cond:
        raise AssertionError(msg)

files = {
    'go': ROOT/'native/agent/workspace_manager.go',
    'gotest': ROOT/'native/agent/workspace_manager_test.go',
    'psm': ROOT/'native/runtime/v2.7.1/Sokna.Workspace.psm1',
    'agent': ROOT/'native/runtime/v2.7.1/agent.ps1',
    'caps': ROOT/'native/runtime/v2.7.1/AGENT_CAPABILITIES.json',
    'contract': ROOT/'docs/contracts/WORKSPACE_PERMISSION_MANAGER_V1_FA.md',
    'win': ROOT/'tools/runtime/releases/2.7.1/Test-Workspace271.ps1',
    'workflow': ROOT/'.github/workflows/windows-agent-validation.yml',
}
for k,p in files.items(): req(p.is_file(), f'missing {k}: {p}')

go=files['go'].read_text(encoding='utf-8')
got=files['gotest'].read_text(encoding='utf-8')
psm=files['psm'].read_text(encoding='utf-8')
agent=files['agent'].read_text(encoding='utf-8')
workflow=files['workflow'].read_text(encoding='utf-8')
win=files['win'].read_text(encoding='utf-8')
caps=json.loads(files['caps'].read_text(encoding='utf-8-sig'))

for marker in ['sokna-workspace-registry-v1','persistent_local','WorkspaceDeny','PlanManagedCopy','MigrateLegacy','source_deleted']:
    req(marker in go, f'Go manager missing {marker}')
for marker in ['WORKSPACE_REPARSE_POINT_BLOCKED','WORKSPACE_PATH_DENIED','WORKSPACE_FULL_WRITE_REQUIRED','WORKSPACE_TOOL_NOT_ALLOWED','sokna-workspace-audit-v1','copy','verify','test','switch']:
    req(marker in psm, f'PowerShell policy missing {marker}')
for marker in ['TestWorkspacePersistentLocalDoesNotRequireGit','TestWorkspaceScopesDenyPrecedenceAndSpecificWrite','TestWorkspaceTraversalAndSymlinkFailClosed','TestWorkspaceToolAllowlist','TestWorkspaceInspectFailsClosedOnTamperedScope','TestWorkspaceManagedCopyRejectsSymlinkDestinationAncestor']:
    req(marker in got, f'Go negative test missing {marker}')

for action in ['workspace.registry.status','workspace.list','workspace.inspect','workspace.register','workspace.permissions.update','workspace.unregister','workspace.assess','workspace.managed_copy.plan']:
    req(action in caps['actions'], f'capability action missing {action}')
    req(f'"{action}"' in agent, f'agent action missing {action}')

req('Import-Module $workspaceModule -Force' in agent, 'runtime does not import workspace module')
req('Initialize-SoknaWorkspaceRegistry' in agent, 'runtime does not initialize workspace registry')
req('GetReadableWorkspaceEntries' in agent and 'GetReadableWorkspaceFiles' in agent, 'scope-aware enumeration helpers missing')
req("SafePath $w $rel 'read'" in agent, 'file read is not policy-routed')
req("SafePath $w $rel 'write'" in agent, 'file write is not policy-routed')
req('Assert-SoknaWorkspaceFullAccess' in agent, 'broad execution full-access barrier missing')
req('AssertWorkspaceTool $w $exe' in agent, 'process tool allowlist barrier missing')
req('local_only_workspace' in agent and 'git_guard_not_permitted' in agent, 'optional Git freshness semantics missing')
req('if(-not$w.write_enabled)' not in agent, 'legacy write_enabled gate remains authoritative')

for marker in ['P2_WORKSPACE_WINDOWS_PASS','New-Item -ItemType Junction','WORKSPACE_PATH_DENIED','source_deleted']:
    req(marker in win, f'Windows matrix missing {marker}')
req('test_p2_workspace_permissions.py' in workflow, 'P2 source contract not wired to CI')
req('Test-Workspace271.ps1' in workflow, 'P2 Windows matrix not wired to CI')
req('workspace_registry=sokna-workspace-registry-v1' in caps.get('schema',''), 'capability schema missing workspace registry')

# P2 executable implementation must stay project-agnostic.
for p in [files['go'], files['psm'], files['agent']]:
    low=p.read_text(encoding='utf-8').lower()
    req('soknacafe' not in low, f'project hard-code in {p}')

print('P2_WORKSPACE_PERMISSION_CONTRACTS_PASS')
