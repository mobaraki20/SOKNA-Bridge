from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]

def need(path,*terms):
    s=(ROOT/path).read_text(encoding='utf-8-sig')
    for t in terms:
        assert t in s, f'{path}: missing {t}'
    return s

need(Path('docs/contracts/ADVANCED_WORKSPACE_PERMISSION_CONTRACT_V1_FA.md'),'intersection','ephemeral_checkout','sokna-remote-workspace-request-v1','cross-job')
need(Path('native/agent/workspace_advanced.go'),'WorkspaceGrantSchema','RegisterEphemeral','RegisterRemote','CreateGrant','EffectiveAuthorizePath','CleanupAdvanced','grant exceeds workspace policy','grant workspace/job binding mismatch')
need(Path('native/agent/workspace_advanced_test.go'),'TestGrantIntersectionAndEscalationBlocked','TestGrantExpiryRevocationAndCrossJob','TestEphemeralOwnershipAndOrphanCleanup','TestRemoteWorkspaceBoundary','TestJobScopedAccessRequiresGrant')
ps=need(Path('native/runtime/v2.6.1/Sokna.Workspace.psm1'),'New-SoknaWorkspaceGrant','Get-SoknaWorkspaceEffectiveView','Register-SoknaRemoteWorkspace','Register-SoknaEphemeralWorkspace','Invoke-SoknaRemoteWorkspaceAdapter','Invoke-SoknaWorkspaceAdvancedCleanup','WORKSPACE_GRANT_ESCALATION_BLOCKED','REMOTE_PATH_ESCAPE','EPHEMERAL_CLEANUP_ESCAPE')
agent=need(Path('native/runtime/v2.6.1/agent.ps1'),'workspace.policy.status','workspace.grant.create','workspace.grant.revoke','workspace.remote.register','workspace.remote.exec','workspace.ephemeral.checkout','workspace.advanced.cleanup','Get-SoknaWorkspaceEffectiveView')
assert "grant_id=$grantId" in agent
assert "NotePropertyName grant_id" in agent and "NotePropertyName job_id" in agent
caps=json.loads((ROOT/'native/runtime/v2.6.1/AGENT_CAPABILITIES.json').read_text(encoding='utf-8'))
for a in ['workspace.policy.status','workspace.grant.create','workspace.grant.revoke','workspace.remote.register','workspace.remote.exec','workspace.ephemeral.checkout','workspace.advanced.cleanup']:
    assert a in caps['actions']
wf=need(Path('.github/workflows/windows-agent-validation.yml'),'test_p5_advanced_workspaces.py','Test-AdvancedWorkspace261.ps1')
need(Path('docs/status/P5_ADVANCED_WORKSPACES_DEV_VALIDATION.md'),'P5','Windows','not claimed','P6')
need(Path('docs/handoffs/CURRENT_DEVELOPMENT_HANDOFF_FA.md'),'P5 completion checkpoint — Advanced Workspaces / Permissions')
manifest=json.loads((ROOT/'docs/status/P5_ADVANCED_WORKSPACES_MANIFEST.json').read_text(encoding='utf-8'))
assert manifest['schema']=='sokna-p5-advanced-workspaces-manifest-v1'
assert manifest['base_checkpoint']=='facf5b23ae77dfe80e92d1151a3f70eb82e072fb'
assert manifest['local_source_regression_passed'] is True
assert manifest['windows_advanced_workspace_acceptance_authored'] is True
assert manifest['windows_advanced_workspace_execution_claimed'] is False
assert manifest['home_pc_touched'] is False and manifest['github_pushed'] is False
seen=set()
for entry in manifest['files']:
    assert entry['path'] not in seen and entry['path']!='docs/status/P5_ADVANCED_WORKSPACES_MANIFEST.json'
    seen.add(entry['path'])
    assert isinstance(entry['bytes'],int) and entry['bytes']>=0
    assert len(entry['sha256'])==64 and all(c in '0123456789abcdef' for c in entry['sha256'])
print('P5_ADVANCED_WORKSPACE_CONTRACTS_PASS')
