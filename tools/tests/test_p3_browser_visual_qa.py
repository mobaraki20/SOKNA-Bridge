#!/usr/bin/env python3
from pathlib import Path
import json, re

ROOT=Path(__file__).resolve().parents[2]
required=[
 'native/browser/go.mod','native/browser/main.go','native/browser/model.go','native/browser/cdp.go','native/browser/chromium.go','native/browser/pngdiff.go','native/browser/browser_test.go',
 'native/runtime/v2.6.1/Sokna.Browser.psm1','docs/contracts/BROWSER_VISUAL_QA_CONTRACT_V1_FA.md','docs/browser/P3_ACCEPTANCE_RECIPE_V1.json',
 'tools/runtime/releases/2.6.1/Test-BrowserQA261.ps1'
]
for rel in required:
    assert (ROOT/rel).is_file(), f'missing {rel}'

agent=(ROOT/'native/runtime/v2.6.1/agent.ps1').read_text(encoding='utf-8')
for marker in ['Sokna.Browser.psm1','Initialize-SoknaBrowserQA','"browser.qa.status"','"browser.recipe.run"','"browser.baseline.promote"','"browser.live.capture.policy"',"AssertWorkspaceTool $w 'browser'","SafePath $w $rel 'read'"]:
    assert marker in agent, f'agent browser integration missing {marker}'

caps=json.loads((ROOT/'native/runtime/v2.6.1/AGENT_CAPABILITIES.json').read_text(encoding='utf-8'))
for action in ['browser.qa.status','browser.recipe.run','browser.baseline.promote','browser.live.capture.policy']:
    assert action in caps['actions'], f'capability missing {action}'
assert 'browser_qa=sokna-browser-qa-report-v1' in caps['schema']

browser=(ROOT/'native/runtime/v2.6.1/Sokna.Browser.psm1').read_text(encoding='utf-8')
for marker in ["Join-Path 'browser' (Join-Path 'runs'", "Join-Path 'browser' (Join-Path 'baselines'",'BROWSER_RUN_SIZE_LIMIT','ARTIFACT_ROOT_QUOTA_EXCEEDED','BROWSER_REPARSE_POINT_BLOCKED','Set-SoknaArtifactMetadata','Write-SoknaArtifactAudit','permission_required=$true','hidden_capture=$false','credential_export=$false','BROWSER_BASELINE_ALREADY_EXISTS','BROWSER_BASELINE_WORKSPACE_MISMATCH','BROWSER_RUN_WORKSPACE_MISMATCH','sokna-browser-run-manifest-v1']:
    assert marker in browser, f'PowerShell browser contract missing {marker}'
assert 'Downloads' not in browser, 'browser output must not fall back to Downloads'
assert not re.search(r'(?im)(^|[;\s])(gci|gc|cp|mv|rm|kill|sleep|gfh)(?=\s|;|$)', browser), 'forbidden PowerShell alias in browser module'

model=(ROOT/'native/browser/model.go').read_text(encoding='utf-8')
for marker in ['sokna-browser-recipe-v1','PASS','FAIL','allowed_origins','value_env','only http/https URLs are allowed','userinfo/credentials in URL are forbidden']:
    assert marker in model or marker in (ROOT/'native/browser/main.go').read_text(encoding='utf-8'), f'native browser contract missing {marker}'

qa=(ROOT/'native/browser/qa.go').read_text(encoding='utf-8')
for marker in ['Accessibility.getFullAXTree','Page.captureScreenshot','full-page capture exceeds safety dimensions','horizontalOverflow','visual_changed_ratio','console_errors','network_failures','network_slow_resources','network_cors_errors','visual-diff','EvidenceID: evidenceForAssertion','page-metadata','knownRecipeSecrets']:
    assert marker in qa, f'QA implementation missing {marker}'

redact=(ROOT/'native/browser/redact.go').read_text(encoding='utf-8')
for marker in ['REDACTED','Bearer','token|secret|password','RawQuery','knownRecipeSecrets','redactArtifactValue']:
    assert marker in redact, f'redaction implementation missing {marker}'

build=(ROOT/'tools/installer/Build-P1Installer.ps1').read_text(encoding='utf-8')
for marker in ["Join-Path $RepoRoot 'native\\browser'",'GO_BROWSER_QA_TEST_FAILED','sokna-browser-qa.exe']:
    assert marker in build, f'installer browser build missing {marker}'

workflow=(ROOT/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
for marker in ['P3 browser and visual QA source contracts','Native browser QA tests','Browser QA 2.6.1 Windows acceptance']:
    assert marker in workflow, f'CI browser gate missing {marker}'

recipe=json.loads((ROOT/'docs/browser/P3_ACCEPTANCE_RECIPE_V1.json').read_text(encoding='utf-8'))
assert recipe['schema']=='sokna-browser-recipe-v1'
assert len(recipe['viewports'])>=2 and recipe['captures']['full_page'] and recipe['captures']['a11y']

win=(ROOT/'tools/runtime/releases/2.6.1/Test-BrowserQA261.ps1').read_text(encoding='utf-8')
for marker in ['P3_BROWSER_SECRET_LEAK','P3_BASELINE_CROSS_WORKSPACE_ALLOWED','P3_VISUAL_CHANGE_NOT_DETECTED','P3_UNSAFE_URL_VALIDATION_BYPASSED']:
    assert marker in win, f'Windows P3 acceptance missing {marker}'

assert '$global:LASTEXITCODE=0' in win, 'negative native exit must be cleared after expected failure'

print('P3_BROWSER_VISUAL_QA_CONTRACTS_PASS')
