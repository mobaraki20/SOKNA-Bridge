from pathlib import Path
import json
root=Path(__file__).resolve().parents[2]
read=(root/'00_READ_FIRST_NEW_CHAT.md').read_text(encoding='utf-8')
gate=(root/'docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md').read_text(encoding='utf-8')
kb=(root/'docs/knowledge/agent-lessons.jsonl').read_text(encoding='utf-8').splitlines()
assert 'docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md' in read
for x in ['job.batch','plan.run','job.submit','artifact.inspect','artifact.apply','result.get','Result-First','outer command','sokna_carrier_guard.py']:
    assert x in gate, x
rows=[json.loads(x) for x in kb if x.strip()]
ids={x.get('id') for x in rows}
assert 'KB-CTRL-004' in ids
assert 'KB-HANDOFF-001' in ids
for need in ['KB-CTRL-006','KB-CI-004','KB-PS-004','KB-PS-005','KB-PS-006','KB-CTRL-007','KB-LOG-001','KB-PS-007','KB-WS-001','KB-CTRL-008','KB-PROVIDER-002','KB-BROWSER-001','KB-CTRL-009','KB-PS-008','KB-CI-005']:
    assert need in ids,need
assert 'polling دستی chat-by-chat' in gate
print('BRIDGE_SESSION_EXECUTION_GATE_CONTRACTS_PASS')

gate=(root/'docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md').read_text(encoding='utf-8')
assert 'Extension 3.10.5 only auto-registers' in gate
assert 'Extension 3.10.6 was live-tested' in gate
assert 'Candidate Extension 3.10.7' in gate
assert 'Extension 3.10.8 gives' in gate
