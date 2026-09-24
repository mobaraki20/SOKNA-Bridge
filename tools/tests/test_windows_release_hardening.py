from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[2]
import json
publish_plan=json.loads((ROOT/'tools/plans/publish-rc6.json').read_text(encoding='utf-8'))
actions=[x['action'] for x in publish_plan['steps']]
assert actions==['process.run','git.add','process.run','git.commit','process.run','process.run','process.run','process.run']
assert publish_plan['steps'][4]['params']['args']==['tag','sokna-agent-2.6.0-rc6']
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
# PowerShell 5.1 runtime lexical/strict-mode regressions discovered by exact-RC CI.
runtime = ROOT / "native" / "runtime" / "v2.6.0"
for ps in [*runtime.glob("*.ps1"), *runtime.glob("*.psm1")]:
    text = ps.read_text(encoding="utf-8")
    assert "return[ordered]@" not in text, f"PS5_RETURN_ORDERED_SPACING:{ps}"
workspace = (runtime / "Sokna.Workspace.psm1").read_text(encoding="utf-8")
assert "$view['owner_job_id']" in workspace and "$view['expires_at']" in workspace, "PS5_ORDERED_DICTIONARY_DYNAMIC_KEY"
jobcore = (ROOT / "extension" / "chrome" / "agent_job_core.js").read_text(encoding="utf-8")
background = (ROOT / "extension" / "chrome" / "background.js").read_text(encoding="utf-8")
assert "findSubmittedJobs" in jobcore, "NESTED_JOB_DISCOVERY_CORE"
assert "JOBCORE.findSubmittedJobs(command.action,result)" in background, "NESTED_JOB_WATCH_REGISTRATION"

print('WINDOWS_RELEASE_HARDENING_PASS')
