import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[2]
policy=json.loads((root/'docs/contracts/EXECUTION_ENVIRONMENT_POLICY_V1.json').read_text(encoding='utf-8'))
assert policy['blocked_runtime_versions']==['2.5.6']
assert policy['github_cost_guard']['artifact_retention_days']==5
ap=json.loads((root/'docs/contracts/ARTIFACT_PROVIDER_POLICY_V1.json').read_text(encoding='utf-8'))
assert ap['providers']['chat_attachment']['status']=='feasibility-only'
assert ap['providers']['github_actions_artifact']['must_not_back_result_plane'] is True
manifest=json.loads((root/'extension/chrome/manifest.json').read_text(encoding='utf-8'))
assert manifest['version']=='3.10.4'
bg=(root/'extension/chrome/background.js').read_text(encoding='utf-8')
for x in ['JOB_WATCH_KEY','job.get','queueStatusEvent','result_first_barrier','resumeJobWatches','agent_job_core.js']: assert x in bg,x
assert 'artifact.begin' not in bg and 'ARTIFACT_CANDIDATE' not in bg
wf=(root/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
for x in ['windows-2025','request_id','run-name:','cancel-in-progress: true']: assert x in wf,x
ci=(root/'tools/ci/Invoke-GitHubWindowsCI.ps1').read_text(encoding='utf-8')
for x in ['request_id=$requestId','--log-failed','CI_SHA_MISMATCH','displayTitle']: assert x in ci,x
for p in ['quick','full']:
 obj=json.loads((root/f'tools/plans/github-windows-ci-{p}.json').read_text(encoding='utf-8'));assert obj['steps'][0]['action']=='process.run';assert obj['steps'][0]['params']['timeout_sec']==1200
lessons=[json.loads(x) for x in (root/'docs/knowledge/agent-lessons.jsonl').read_text().splitlines() if x.strip()]
ids={x['id'] for x in lessons}
for need in ['KB-CTRL-001','KB-RUNTIME-001','KB-DEV-001','KB-DEV-002','KB-PS-001','KB-PS-002','KB-CI-001','KB-CI-002','KB-ASYNC-001','KB-CTRL-002','KB-SRC-001']: assert need in ids,need

activate=(root/'tools/activation/Activate-AutonomyBootstrap.ps1').read_text(encoding='utf-8')
for x in ['ACTIVATION_FULL_CI_NOT_PASSED',"manifest.version -ne '3.10.4'",'source-ci-ticket.json','extension_reload_required']:
    assert x in activate,x
assert '2.5.7' not in activate
ci=(root/'tools/ci/Invoke-GitHubWindowsCI.ps1').read_text(encoding='utf-8')
for x in ['source-ci-ticket.json',"profile = 'full'","ci_conclusion = 'success'"]: assert x in ci,x
assert 'gh run download' not in ci
for forbidden in ['native/host','artifact.begin','sandbox:']:
    assert forbidden not in activate,forbidden
assert 'Environment selector and knowledge helpers' in wf
print('AUTONOMY_BOOTSTRAP_CONTRACTS_PASS')
