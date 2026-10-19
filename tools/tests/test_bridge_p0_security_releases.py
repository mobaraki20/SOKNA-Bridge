"""Regression gate for application-neutral process execution and disabled R14 publish paths."""
from pathlib import Path
import re

root=Path(__file__).resolve().parents[2]
agent=(root/'native/runtime/v2.7.1/agent.ps1').read_text(encoding='utf-8')
block=agent.split('    "process.run" {',1)[1].split('\n    "git.status"',1)[0]
assert "PROCESS_RUN_REQUIRES_EXPLICIT_WRITE_GRANT" in block
assert "-is [bool]" in block and "$p.mutating -eq $true" in block
assert "-Access 'write'" in block
assert "GetOptionalFreshnessGuard $w" in block
assert "-Access $access" not in block and "if($mutating)" not in block
contracts=(root/'extension/chrome/action_contracts_core.js').read_text(encoding='utf-8')
line=next(x for x in contracts.splitlines() if x.strip().startswith('"process.run":tool('))
assert 'const:true' in line and '["workspace","exe","mutating"]' in line
for name in ('r14-final.yml','r14-apply-capture-fix.yml','r14-source-normalize.yml','r14-publish-qualified.yml'):
    workflow=(root/'.github/workflows'/name).read_text(encoding='utf-8')
    assert 'workflow_dispatch:' in workflow
    assert not re.search(r'(?m)^\s+push:\s*$',workflow)
    assert 'contents: read' in workflow
    assert 'contents: write' not in workflow
    assert 'if: ${{ false }}' in workflow
print('BRIDGE_P0_WRITE_GRANT_AND_RETIRED_RELEASE_GATES_PASS')
