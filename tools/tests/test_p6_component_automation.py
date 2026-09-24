from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]

def need(path,*terms):
    s=(ROOT/path).read_text(encoding='utf-8-sig')
    for t in terms:
        assert t in s, f'{path}: missing {t}'
    return s

need(Path('docs/contracts/COMPONENT_AUTOMATION_LIFECYCLE_CONTRACT_V1_FA.md'),'PID + process start time','Artifact Provider','stage -> verify -> activate -> bounded health -> commit','grant template','pending claim')
need(Path('native/agent/component_lifecycle.go'),'ComponentRegistrySchema','CanStopOwnedProcess','NewComponentTransaction','RequiresRollback','AutomationSpec','EvaluateAutomation','missed_skipped','concurrency_limit')
need(Path('native/agent/component_lifecycle_test.go'),'TestComponentValidationAndLKGCommit','TestComponentTransactionRollbackOnHealthFailure','TestOwnedProcessProtection','TestAutomationIntervalDedupeMissedAndConcurrency','TestAutomationTriggerDedupe')
ps=need(Path('native/runtime/v2.6.0/Sokna.Component.psm1'),'sokna-component-registry-v1','COMPONENT_PROCESS_OWNERSHIP_MISMATCH','COMPONENT_SERVICE_OWNERSHIP_MISMATCH','COMPONENT_ARCHIVE_PATH_ESCAPE','COMPONENT_ARCHIVE_SYMLINK_BLOCKED','COMPONENT_ARTIFACT_OUTSIDE_ARTIFACT_ROOT','Activate-SoknaComponentRelease','Rollback-SoknaComponent','AUTOMATION_INTERVAL_MIN_60','Test-SoknaWorkspaceGrantPolicy','pending_run_key','Release-SoknaAutomationRun')
ws=need(Path('native/runtime/v2.6.0/Sokna.Workspace.psm1'),'Test-SoknaWorkspaceGrantPolicy','WORKSPACE_GRANT_ESCALATION_BLOCKED','WORKSPACE_GRANT_TOOL_ESCALATION_BLOCKED')
agent=need(Path('native/runtime/v2.6.0/agent.ps1'),'COMPONENT_MANAGER_MODULE_MISSING','Initialize-SoknaComponentManager','component.dependency.acquire','Invoke-SoknaArtifactProviderAcquire','component.release.apply','Invoke-SoknaArtifactProviderVerify','automation.register','automation.tick','automation.trigger','SubmitAutomationClaim','RevokeAutomationGrantForJob','RunScheduler','SchedulerParentPid')
# ensure acquire never implies apply/start in the same dependency action block
acq=agent.split('"component.dependency.acquire"',1)[1].split('"component.release.apply"',1)[0]
assert 'Invoke-SoknaArtifactProviderAcquire' in acq and 'Start-SoknaComponent' not in acq and 'Activate-SoknaComponentRelease' not in acq
# Submission failure must be retryable: revoke only the fresh per-run grant, remove the placeholder job, then outer dispatch restores the claim.
submit=agent.split('function SubmitAutomationClaim',1)[1].split('function InvokeAutomationDispatch',1)[0]
assert 'Remove-Item -LiteralPath $jp' in submit
assert 'Revoke-SoknaWorkspaceGrant' in submit
assert 'RevokeAutomationGrantForJob $j' not in submit
caps=json.loads((ROOT/'native/runtime/v2.6.0/AGENT_CAPABILITIES.json').read_text(encoding='utf-8'))
for a in ['component.registry.status','component.register','component.dependency.acquire','component.release.apply','component.start','component.stop','component.health','component.rollback','component.remove','automation.register','automation.tick','automation.trigger']:
    assert a in caps['actions']
assert 'sokna-component-registry-v1' in caps['schema'] and 'sokna-automation-registry-v1' in caps['schema']
wf=need(Path('.github/workflows/windows-agent-validation.yml'),'test_p6_component_automation.py','Test-ComponentAutomation260.ps1')
need(Path('docs/status/P6_COMPONENT_AUTOMATION_DEV_VALIDATION.md'),'P6','R0','R1','Windows','not claimed')
print('P6_COMPONENT_AUTOMATION_CONTRACTS_PASS')
