import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[2]
policy=json.loads((root/'docs/contracts/EXECUTION_ENVIRONMENT_POLICY_V1.json').read_text(encoding='utf-8'))
assert policy['blocked_runtime_versions']==['2.5.6']
assert policy['github_cost_guard']['artifact_retention_days']==5
assert policy['assistant_access_contract']['access_plane']=='SOKNA Bridge'
assert policy['development_flow']['forbid_push_per_small_edit'] is True
assert policy['source_acquisition']['forbid_repeated_piecemeal_bridge_reads_as_source_strategy'] is True
ap=json.loads((root/'docs/contracts/ARTIFACT_PROVIDER_POLICY_V1.json').read_text(encoding='utf-8'))
assert ap['providers']['chat_attachment']['status']=='candidate-rc9'
assert ap['providers']['github_actions_artifact']['must_not_back_result_plane'] is True
manifest=json.loads((root/'extension/chrome/manifest.json').read_text(encoding='utf-8'))
assert manifest['version']=='3.12.6'
bg=(root/'extension/chrome/background.js').read_text(encoding='utf-8')
for x in ['JOB_WATCH_KEY','job.get','queueStatusEvent','result_first_barrier','resumeJobWatches','agent_job_core.js']: assert x in bg,x
assert 'artifact.begin' not in bg and 'ARTIFACT_CANDIDATE' not in bg
wf=(root/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
for x in ['windows-2025','request_id','run-name:','cancel-in-progress: true']: assert x in wf,x
for x in ['R2 semantic reliability and round-trip contracts','test_r2_contract_reliability.py','test_r2_observability.py','test_r2_outbound_artifacts.py','test_r2_browser_audit.py','test_r2_session_continuity.py','test_capability_gate.mjs']: assert x in wf,x
for x in ['--json-b64 $v3B64','--json-b64 $v4B64','CARRIER_V3_GENERATOR_PROCESS_FAILED','CARRIER_V4_GENERATOR_PROCESS_FAILED','id: carrier','sokna_carrier_guard.py']: assert x not in wf,x
ci=(root/'tools/ci/Invoke-GitHubWindowsCI.ps1').read_text(encoding='utf-8')
for x in ['request_id=$requestId','--log-failed','CI_SHA_MISMATCH','displayTitle','expected_commit=$ExpectedCommit','CI_EXPECTED_COMMIT_LOCAL_MISMATCH']: assert x in ci,x
expected={'quick':(900,1200),'full':(1800,2100)}
for p,(inner,outer) in expected.items():
 obj=json.loads((root/f'tools/plans/github-windows-ci-{p}.json').read_text(encoding='utf-8'));q=obj['steps'][0]['params'];assert obj['steps'][0]['action']=='process.run';assert q['timeout_sec']==outer;i=q['args'].index('-TimeoutSec');assert q['args'][i+1]==str(inner)
lessons=[json.loads(x) for x in (root/'docs/knowledge/agent-lessons.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
ids={x['id'] for x in lessons}
for need in ['KB-CTRL-001','KB-RUNTIME-001','KB-DEV-001','KB-DEV-002','KB-PS-001','KB-PS-002','KB-CI-001','KB-CI-002','KB-ASYNC-001','KB-CTRL-002','KB-SRC-001','KB-ROUTE-001','KB-ROUTE-002','KB-CTRL-003','KB-PC-001','github-windows-python-stdin-explicit-json','KB-ART-CHAT-001']: assert need in ids,need

activate=(root/'tools/activation/Activate-AutonomyBootstrap.ps1').read_text(encoding='utf-8')
for x in ['ACTIVATION_FULL_CI_NOT_PASSED',"manifest.version -ne '3.12.6'",'source-ci-ticket.json','extension_reload_required']:
    assert x in activate,x
assert '2.5.7' not in activate
ci=(root/'tools/ci/Invoke-GitHubWindowsCI.ps1').read_text(encoding='utf-8')
for x in ['source-ci-ticket.json',"profile = 'full'","ci_conclusion = 'success'"]: assert x in ci,x
assert 'gh run download' not in ci
for forbidden in ['native/host','artifact.begin','sandbox:']:
    assert forbidden not in activate,forbidden
assert 'Environment selector and knowledge helpers' in wf

read_first=(root/'00_READ_FIRST_NEW_CHAT.md').read_text(encoding='utf-8')
for x in ['SOKNA Bridge is the Chat agent\'s access plane','semantic-only','bridge.bootstrap + persistent work_session + session.resume','No release/live claim without exact Windows evidence.']:
    assert x in read_first,x
guard_path=root/'tools/sokna_carrier_guard.py'
assert not guard_path.exists(), 'legacy V3/V4 carrier guard must remain retired from the active source tree'
handoff=(root/'docs/handoffs/FAST_WORK_ROUTE_AND_EXT3105_HANDOFF_FA.md').read_text(encoding='utf-8')
for x in ['Agent 2.5.4 + Extension 3.9.5','GitHub is a durable checkpoint','programmatic only']:
    assert x in handoff,x

print('AUTONOMY_BOOTSTRAP_CONTRACTS_PASS')
