from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[2]
import json
publish_plan=json.loads((ROOT/'tools/plans/publish-rc5-and-submit-ci.json').read_text(encoding='utf-8'))
actions=[x['action'] for x in publish_plan['steps']]
assert actions==['process.run','git.add','process.run','git.commit','process.run','process.run','job.submit']
assert publish_plan['steps'][-1]['params']['path']=='tools/plans/github-windows-ci-full.json'
assert publish_plan['steps'][4]['params']['args']==['tag','sokna-agent-2.6.0-rc5']
wf=(ROOT/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
helper=(ROOT/'tools/ci/Invoke-GitHubWindowsCI.ps1').read_text(encoding='utf-8')
preflight=(ROOT/'tools/ci/Test-WindowsAgentEnvironment.ps1').read_text(encoding='utf-8')
ws=(ROOT/'tools/runtime/releases/2.6.0/Test-Workspace260.ps1').read_text(encoding='utf-8')
br=(ROOT/'tools/runtime/releases/2.6.0/Test-BrowserQA260.ps1').read_text(encoding='utf-8')
gate=(ROOT/'docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md').read_text(encoding='utf-8')

assert '@($lw.tools).Count' in ws and '$lw.tools.Count' not in ws
assert '@($dry.files).Count' in br and '$dry.files.Count' not in br
for x in ['Windows PowerShell/runtime compatibility preflight','Windows diagnostic gate','continue-on-error: true','SOKNA_VALIDATION_PROFILE']:
    assert x in wf,x
for ident in ['native_provider','win_workspace','win_advanced_workspace','win_artifact_provider','win_browser','win_component']:
    assert f'id: {ident}' in wf,ident
    assert f'steps.{ident}.outcome' in wf,ident
for x in ["[string]$ExpectedCommit = ''",'expected_commit=$ExpectedCommit','CI_EXPECTED_COMMIT_LOCAL_MISMATCH','--log-failed']:
    assert x in helper,x
assert "ls-files '*.ps1' '*.psm1'" in preflight
assert "[string]$RuntimeVersion = '2.6.0'" in preflight
assert "Copy-Item (Join-Path $runtime '*') $root -Recurse -Force" in preflight
for x in ['polling دستی chat-by-chat','job.submit','diagnostic gate','patch-one-line']:
    assert x in gate,x
# Release-critical native command captures must not call .Trim() directly on (& git/gh ...).
critical=[
    ROOT/'tools/ci/Invoke-GitHubWindowsCI.ps1',
    ROOT/'tools/ci/Write-ExactRCEvidence.ps1',
    ROOT/'tools/installer/Build-P1Installer.ps1',
]
pat=re.compile(r'=\s*\(&\s*(?:git|gh)\b[^\r\n]*\)\.Trim\(',re.I)
for f in critical:
    assert not pat.search(f.read_text(encoding='utf-8')),f
print('WINDOWS_RELEASE_HARDENING_PASS')
