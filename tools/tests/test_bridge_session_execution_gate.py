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
print('BRIDGE_SESSION_EXECUTION_GATE_CONTRACTS_PASS')
