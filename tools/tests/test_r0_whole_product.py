from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[2]

def text(path):
    return (ROOT/path).read_text(encoding='utf-8-sig')

def need(path,*terms):
    s=text(path)
    for t in terms:
        assert t in s, f'{path}: missing {t}'
    return s

agent=need(Path('native/runtime/v2.7.1/agent.ps1'),
    'Sokna.ArtifactRoot.psm1','Sokna.Workspace.psm1','Sokna.Browser.psm1','Sokna.ArtifactProvider.psm1','Sokna.Component.psm1',
    'Initialize-SoknaArtifactRoot','Initialize-SoknaWorkspaceRegistry','Initialize-SoknaBrowserQA','Initialize-SoknaArtifactProviders','Initialize-SoknaComponentManager',
    'New-SoknaWorkspaceGrant','RevokeAutomationGrantForJob','Release-SoknaAutomationRun')
# Import/init order is part of the dependency graph: ArtifactRoot -> Workspace -> Browser -> Provider -> Component.
init_terms=['Initialize-SoknaArtifactRoot','Initialize-SoknaWorkspaceRegistry','Initialize-SoknaBrowserQA','Initialize-SoknaArtifactProviders','Initialize-SoknaComponentManager']
pos=[agent.rfind(x) for x in init_terms]
assert pos==sorted(pos) and min(pos)>=0, f'init order invalid: {pos}'

caps=json.loads(text(Path('native/runtime/v2.7.1/AGENT_CAPABILITIES.json')))
required_actions={
    'artifact.root.status','artifact.provider.status','workspace.registry.status','browser.qa.status','component.registry.status',
    'artifact.provider.acquire','artifact.provider.verify','browser.recipe.run','workspace.grant.create','workspace.remote.exec',
    'component.dependency.acquire','component.release.apply','automation.register','automation.tick','automation.trigger','job.submit'
}
assert required_actions.issubset(set(caps['actions'])), sorted(required_actions-set(caps['actions']))

build=need(Path('tools/installer/Build-P1Installer.ps1'),
    "Copy-Tree (Join-Path $RepoRoot 'native\\runtime\\v2.7.0') $runtimeDest",
    "native\\browser",'sokna-browser-qa.exe',"native\\provider",'sokna-artifact-provider.exe',
    "StartsWith('runtime/'", "'maintenance'", "'installer'")
iss=need(Path('installer/windows/SOKNA.Agent.iss'), 'recursesubdirs createallsubdirs','--expected-version "2.7.1"')
# The installed runner lookup used by runtime must match the payload layout produced by Build-P1Installer.
need(Path('native/runtime/v2.7.1/Sokna.Browser.psm1'), "Join-Path $installRoot 'browser'", 'sokna-browser-qa.exe')
need(Path('native/runtime/v2.7.1/Sokna.ArtifactProvider.psm1'), "Join-Path $installRoot 'provider'", 'sokna-artifact-provider.exe')

health=need(Path('maintenance/Sokna.Agent.Maintenance/HealthDiagnostics.cs'),
    'artifact.root.status','workspace.registry.status','browser.qa.status','artifact.provider.status','component.registry.status',
    '["browser_runner"]','["artifact_provider_runner"]','wholeProductOk','subsystemChecks.Values.All')
models=need(Path('maintenance/Sokna.Agent.Maintenance/Models.cs'),'IReadOnlyDictionary<string, bool>? Subsystems')
support=need(Path('maintenance/Sokna.Agent.Maintenance/SupportBundle.cs'),
    'workspaces.json','workspace-grants.json','components.json','automations.json','component-transactions',
    'workspace-audit.jsonl','component-audit.jsonl','automation-audit.jsonl','artifact-audit.jsonl',
    'SecretRedactor.RedactText','CopyRedactedJsonDir')
assert 'Path.Combine(stateDir, "jobs")' not in support and 'Path.Combine(installRoot, "jobs")' not in support, 'support bundle must not copy jobs'

component=need(Path('native/runtime/v2.7.1/Sokna.Component.psm1'),
    'Artifact Provider + verified ArtifactRoot only','COMPONENT_PROCESS_OWNERSHIP_MISMATCH','COMPONENT_SERVICE_OWNERSHIP_MISMATCH',
    'stage->verify->activate->health->commit','pending_run_key','Test-SoknaWorkspaceGrantPolicy')
apply_block=agent.split('"component.release.apply"',1)[1].split('"component.start"',1)[0]
assert apply_block.index('Invoke-SoknaArtifactProviderVerify') < apply_block.index('Install-SoknaComponentRelease') < apply_block.index('Activate-SoknaComponentRelease')
acq_block=agent.split('"component.dependency.acquire"',1)[1].split('"component.release.apply"',1)[0]
assert 'Invoke-SoknaArtifactProviderAcquire' in acq_block and 'Activate-SoknaComponentRelease' not in acq_block

# Scheduled runs must obtain a fresh job-bound P5 grant and completion must revoke/release it.
submit=agent.split('function SubmitAutomationClaim',1)[1].split('function InvokeAutomationDispatch',1)[0]
assert 'New-SoknaWorkspaceGrant' in submit and '-JobId $jobId' in submit and 'Remove-Item -LiteralPath $jp' in submit
revoke=agent.split('function RevokeAutomationGrantForJob',1)[1].split('function SubmitAutomationClaim',1)[0]
assert 'Revoke-SoknaWorkspaceGrant' in revoke and 'Release-SoknaAutomationRun' in revoke

win=need(Path('tools/installer/Test-P1Windows.ps1'),
    'SUPPORT_BUNDLE_WHOLE_PRODUCT_STATE_MISSING','health','--expected-version','2.7.1')
wf=need(Path('.github/workflows/windows-agent-validation.yml'),
    'test_p6_component_automation.py','Test-ComponentAutomation271.ps1','Test-P1Windows.ps1')
print('R0_WHOLE_PRODUCT_CONTRACTS_PASS')
