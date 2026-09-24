from pathlib import Path
import json,re

ROOT=Path(__file__).resolve().parents[2]
MODEL=(ROOT/'native/provider/model.go').read_text(encoding='utf-8')
PROVIDER=(ROOT/'native/runtime/v2.6.0/Sokna.ArtifactProvider.psm1').read_text(encoding='utf-8')
BROWSER=(ROOT/'tools/runtime/releases/2.6.0/Test-BrowserQA260.ps1').read_text(encoding='utf-8')
PREFLIGHT=(ROOT/'tools/ci/Test-WindowsAdversarialPreflight.ps1').read_text(encoding='utf-8')
WORKFLOW=(ROOT/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
GATE=(ROOT/'docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md').read_text(encoding='utf-8')
KB=(ROOT/'docs/knowledge/agent-lessons.jsonl').read_text(encoding='utf-8')

# Go omitempty fields are absent, not merely zero/null. PowerShell StrictMode consumers
# must use the optional-property helper instead of direct $r.foo access.
block=re.search(r'type\s+ProviderResult\s+struct\s*\{(.*?)\n\}',MODEL,re.S)
assert block, 'PROVIDER_RESULT_MODEL_NOT_FOUND'
optional=sorted(set(re.findall(r'json:"([^",]+),omitempty"',block.group(1))))
assert 'resumed_bytes' in optional and 'signature_ok' in optional
for name in optional:
    assert not re.search(rf'\$r\.{re.escape(name)}\b',PROVIDER,re.I), f'OPTIONAL_PROVIDER_DIRECT_ACCESS:{name}'
assert "Get-SoknaProviderOptional $r 'resumed_bytes' 0" in PROVIDER
assert "Get-SoknaProviderOptional $r 'signature_ok' $false" in PROVIDER

# The actual Windows preflight must include parser, lexical, schema-shape and pure
# Windows matrix checks. It is not allowed to degrade into a documentation-only gate.
for marker in [
    'Set-StrictMode -Version Latest',
    'Management.Automation.Language.Parser',
    'WIN_ADV_PS51_LEXICAL',
    'ProviderResult',
    'WIN_ADV_PROVIDER_OPTIONAL_DIRECT_ACCESS',
    'WIN_ADV_PROVIDER_HELPER_SEMANTICS',
    'Test-ArtifactRoot260.ps1',
    'Test-Workspace260.ps1',
    'Test-AdvancedWorkspace260.ps1',
    'sokna-windows-adversarial-preflight-v1',
]:
    assert marker in PREFLIGHT, marker

assert 'id: windows_adversarial' in WORKFLOW
assert 'steps.windows_adversarial.outcome' in WORKFLOW
assert "'WINDOWS_ADVERSARIAL','WINDOWS_COMPAT'" in WORKFLOW

# Browser fixtures must not depend on incidental browser network behavior and must
# expose bounded diagnostics immediately when a supposedly clean run is dirty.
for marker in [
    'Wait-HttpReady',
    'favicon.png',
    'WriteAllBytes',
    'Get-BrowserFailureDiagnostic',
    'Get-JsonOptional',
    'TcpListener',
    'diagnostics=',
]:
    assert marker in BROWSER, marker
assert 'href="data:,"' not in BROWSER

# Process rules are durable, not conversational-only.
for marker in ['Windows Adversarial Preflight','Local PASS','exact-commit Windows','RC tag']:
    assert marker in GATE, marker
for kb_id in ['KB-CI-006','KB-PS-009','KB-BROWSER-002','KB-RELEASE-001']:
    assert kb_id in KB, kb_id

print('WINDOWS_ADVERSARIAL_GATE_CONTRACTS_PASS')
