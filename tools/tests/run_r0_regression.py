from pathlib import Path
import subprocess, sys

ROOT=Path(__file__).resolve().parents[2]

def run(cmd,cwd=ROOT):
    print('==>', ' '.join(cmd), flush=True)
    subprocess.run(cmd,cwd=cwd,check=True)

for name in [
    'test_autonomy_bootstrap.py','test_artifact_root_contract.py','test_p1_installer_contract.py',
    'test_p2_workspace_permissions.py','test_p3_browser_visual_qa.py','test_p4_artifact_providers.py',
    'test_p5_advanced_workspaces.py','test_p6_component_automation.py','test_bridge_session_execution_gate.py',
    'test_windows_release_hardening.py','test_windows_adversarial_gate.py','test_r0_whole_product.py','test_r1_release_candidate.py']:
    run([sys.executable, str(ROOT/'tools/tests'/name)])
for name in ['test_agent_job_core.mjs','test_terminal_status_delivery.mjs','test_transport_v3105.mjs']:
    run(['node',str(ROOT/'tools/tests'/name)])
for rel in ['native/agent','native/host','native/legacy/v2.5','native/browser','native/provider']:
    run(['go','test','./...'],ROOT/rel)
    run(['go','vet','./...'],ROOT/rel)
run(['git','diff','--check'])
print('R0_FULL_LOCAL_REGRESSION_PASS')
