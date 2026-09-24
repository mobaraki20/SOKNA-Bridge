import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
mod = (ROOT / 'native/runtime/v2.6.0/Sokna.ArtifactRoot.psm1').read_text(encoding='utf-8-sig')
agent = (ROOT / 'native/runtime/v2.6.0/agent.ps1').read_text(encoding='utf-8-sig')
caps = json.loads((ROOT / 'native/runtime/v2.6.0/AGENT_CAPABILITIES.json').read_text(encoding='utf-8-sig'))
old_agent = (ROOT / 'native/runtime/v2.5.7/agent.ps1').read_text(encoding='utf-8-sig')

assert caps['agent'] == '2.6.0'
for action in ['artifact.root.status', 'artifact.import.local', 'artifact.cleanup', 'artifact.inspect', 'artifact.apply']:
    assert action in caps['actions'], action
for directory in ['incoming','staging','accepted','failed','cache','browser','logs']:
    assert f"'{directory}'" in mod, directory

# Managed-default must be under SOKNA/Bridge, not Downloads. Downloads is legacy migration evidence only.
assert "SOKNA\\Bridge\\artifacts" in mod
assert "legacy_root" in mod and "Downloads" in mod and "legacy_auto_migrate" in mod
assert "instruction='use artifact.import.local for legacy/outside-root files'" in mod

# Safety and storage controls.
for marker in [
    'ARTIFACT_PATH_OUTSIDE_ROOT',
    'ARTIFACT_REPARSE_POINT_BLOCKED',
    'ARTIFACT_ROOT_QUOTA_EXCEEDED',
    'max_root_bytes',
    'max_artifact_bytes',
    'retention',
    'quota_remaining_bytes',
    'artifact-events.jsonl',
    'artifact-metadata',
    "phase='quota_rejected'",
    "phase='hash_rejected'",
    "phase='imported'",
    "action='artifact.cleanup'",
]:
    assert marker in mod, marker

# Import must use staging before incoming and never auto-execute.
assert "Join-Path 'staging' ('.partial-'" in mod
assert 'Move-Item -LiteralPath $tmp -Destination $final' in mod
assert 'Invoke-SoknaArtifactCleanup -Execute' in agent
assert 'artifact.import.local' in agent
assert 'New-SoknaArtifactStage' in agent
assert 'SOKNA\\Bridge\\artifact-stage' not in agent

# Accepted baseline is preserved, not rewritten in place.
assert '2.5.7' in old_agent
assert 'artifact.root.status' not in old_agent

# P0-C is source-only until later Windows/live gates.
assert '2.6.0' in agent
print('ARTIFACT_ROOT_P0C_CONTRACTS_PASS')
