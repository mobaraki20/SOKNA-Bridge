from pathlib import Path
import re,json
ROOT=Path(__file__).resolve().parents[2]
plan=json.loads((ROOT/'tools/plans/validate-and-promote-rc9.json').read_text(encoding='utf-8'))
steps=plan['steps']
actions=[x['action'] for x in steps]
assert actions==['process.run','git.add','process.run','git.commit','process.run','process.run','process.run','process.run','process.run','process.run']
assert steps[0]['name']=='working-diff-check'
ci_i=next(i for i,x in enumerate(steps) if x['name']=='exact-commit-full-windows-ci')
tag_i=next(i for i,x in enumerate(steps) if x['name']=='tag-rc9-only-after-ci-pass')
assert ci_i < tag_i
assert steps[tag_i]['params']['args']==['tag','sokna-agent-2.6.0-rc9']
assert steps[ci_i]['stop_on_error'] is True
wf=(ROOT/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
helper=(ROOT/'tools/ci/Invoke-GitHubWindowsCI.ps1').read_text(encoding='utf-8')
preflight=(ROOT/'tools/ci/Test-WindowsAgentEnvironment.ps1').read_text(encoding='utf-8')
adv=(ROOT/'tools/ci/Test-WindowsAdversarialPreflight.ps1').read_text(encoding='utf-8')
ws=(ROOT/'tools/runtime/releases/2.6.0/Test-Workspace260.ps1').read_text(encoding='utf-8')
br=(ROOT/'tools/runtime/releases/2.6.0/Test-BrowserQA260.ps1').read_text(encoding='utf-8')
gate=(ROOT/'docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md').read_text(encoding='utf-8')

assert '@($lw.tools).Count' in ws and '$lw.tools.Count' not in ws
assert '@($dry.files).Count' in br and '$dry.files.Count' not in br
for x in ['Windows adversarial preflight','Windows PowerShell/runtime compatibility preflight','Windows diagnostic gate','continue-on-error: true','SOKNA_VALIDATION_PROFILE']:
    assert x in wf,x
for ident in ['windows_adversarial','native_provider','win_workspace','win_advanced_workspace','win_artifact_provider','win_browser','win_component']:
    assert f'id: {ident}' in wf,ident
    assert f'steps.{ident}.outcome' in wf,ident
for x in ["[string]$ExpectedCommit = ''",'expected_commit=$ExpectedCommit','CI_EXPECTED_COMMIT_LOCAL_MISMATCH','--log-failed']:
    assert x in helper,x
for x in ['gh run view $runId --log','continue-on-error hides the original failing steps','Windows diagnostic gate','$rootFailures',r'##\[error\]']:
    assert x in helper,x
assert "ls-files '*.ps1' '*.psm1'" in preflight
assert "[string]$RuntimeVersion = '2.6.0'" in preflight
assert "Copy-Item (Join-Path $runtime '*') $root -Recurse -Force" in preflight
for x in ['WIN_ADV_PROVIDER_OPTIONAL_DIRECT_ACCESS','WIN_ADV_PROVIDER_HELPER_SEMANTICS','Test-AdvancedWorkspace260.ps1']:
    assert x in adv,x
for x in ['polling دستی chat-by-chat','job.submit','diagnostic gate','patch-one-line','Windows Adversarial Preflight','RC tag قبل از exact-commit Windows full PASS ممنوع است']:
    assert x in gate,x
critical=[ROOT/'tools/ci/Invoke-GitHubWindowsCI.ps1',ROOT/'tools/ci/Write-ExactRCEvidence.ps1',ROOT/'tools/installer/Build-P1Installer.ps1']
pat=re.compile(r'=\s*\(&\s*(?:git|gh)\b[^\r\n]*\)\.Trim\(',re.I)
for f in critical:
    assert not pat.search(f.read_text(encoding='utf-8')),f
runtime=ROOT/'native'/'runtime'/'v2.6.0'
for ps in [*runtime.glob('*.ps1'),*runtime.glob('*.psm1')]:
    text=ps.read_text(encoding='utf-8')
    assert 'return[ordered]@' not in text,f'PS5_RETURN_ORDERED_SPACING:{ps}'
    assert not re.search(r"\breturn(?=[\$\[\(\'\"])",text),f'PS5_RETURN_LEXICAL_SPACING:{ps}'
    assert not re.search(r"\bthrow(?=[\$\'\"])",text),f'PS5_THROW_LEXICAL_SPACING:{ps}'
workspace=(runtime/'Sokna.Workspace.psm1').read_text(encoding='utf-8')
assert "$view['owner_job_id']" in workspace and "$view['expires_at']" in workspace
assert "$null=Assert-SoknaWorkspaceFullAccess -Workspace $view -Access 'write'" in workspace
jobcore=(ROOT/'extension/chrome/agent_job_core.js').read_text(encoding='utf-8')
background=(ROOT/'extension/chrome/background.js').read_text(encoding='utf-8')
assert 'findSubmittedJobs' in jobcore
assert 'JOBCORE.findSubmittedJobs(command.action,result)' in background
assert 'JOB_WATCH_DIAG_KEY="job_watch_diag_v1"' in background
assert 'const q=await queueStatusEvent' in background
assert 'lastTerminalDeliveryOk' in background and 'jobWatchIds' in background
content=(ROOT/'extension/chrome/content.js').read_text(encoding='utf-8')
assert 'statusEnvelope({eventId:id,...rec.result})' in background
assert 'p.match(/"eventId"' in content
print('WINDOWS_RELEASE_HARDENING_PASS')
