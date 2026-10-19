"""Behavioral: Go null failures, negative evidence, no false Windows qualification."""
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('bridge_operator', ROOT / 'tools/qa/operator_evidence_report.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    plan = d / 'matrix.json'
    plan.write_text(json.dumps({
        'schema': m.MATRIX_SCHEMA,
        'cases': [{'id': f'case-{n:03d}', 'status': 'NOT_RUN'} for n in range(75)]
    }), encoding='utf8')
    base = {
        'schema': m.BLACKBOX_SCHEMA,
        'qualification': 'isolated_native_host_only_not_windows_installer_uat',
        'host_executable': 'host.exe',
        'passed': [f'scenario-{n}' for n in range(19)],
        'passed_count': 19, 'failures': None, 'failed_count': 0
    }
    blackbox = d / 'blackbox.json'
    def write(value): blackbox.write_text(json.dumps(value), encoding='utf8')
    write(base)
    assert m.blackbox(blackbox)['status'] == 'PASS'
    summary = m.summarize(plan, blackbox)
    assert summary['gates']['native_host_binary'] == 'PASS'
    assert summary['gates']['windows_installer_install_upgrade_rollback'] == 'NOT_RUN'
    assert summary['gates']['chrome_edge_actual_extension_uat'] == 'NOT_RUN'
    assert summary['planned_scenarios']['planned_count'] == 75
    assert summary['ready_for_github_transfer'] is False
    assert summary['qualified_for_windows_install'] is False
    assert 'host.exe' not in json.dumps(summary)
    def reject(obj):
        write(obj)
        try: m.blackbox(blackbox)
        except ValueError: return
        raise AssertionError('unsafe test result accepted')
    reject({**base, 'passed_count': 18})
    reject({**base, 'failed_count': 1})
    reject({**base, 'passed': base['passed'][:18] + ['scenario-0']})
    reject({**base, 'qualification': 'windows_installer_uat_passed'})
    reject({**base, 'failures': 'private path or token'})
    write({**base, 'failed_count': 1, 'failures': ['private token path']})
    bad = m.blackbox(blackbox)
    assert bad['status'] == 'FAIL' and 'private token path' not in json.dumps(bad)
    inv = d / 'inventory.json'
    inv.write_text(json.dumps({
        'schema': m.INVENTORY_SCHEMA, 'evidence_kind': 'read_only_metadata_snapshot',
        'real_uat_qualified': False, 'services': [],
        'installed_entries': [], 'executable_hashes': [],
        'secret': 'DO_NOT_COPY'
    }), encoding='utf8')
    result = m.summarize(plan, None, inv)
    assert 'DO_NOT_COPY' not in json.dumps(result)
    assert result['gates']['windows_inventory'] == 'INVENTORY_ONLY'
    inv.write_text(json.dumps({
        'schema': m.INVENTORY_SCHEMA, 'evidence_kind': 'read_only_metadata_snapshot',
        'real_uat_qualified': True
    }), encoding='utf8')
    try: m.inventory(inv)
    except ValueError: pass
    else: raise AssertionError('false UAT indicator accepted')
    write(base)
    out = d / 'new.json'
    cmd = [sys.executable, str(ROOT / 'tools/qa/operator_evidence_report.py'),
           '--matrix', str(plan), '--blackbox', str(blackbox), '--output', str(out)]
    good = subprocess.run(cmd, capture_output=True, text=True)
    assert good.returncode == 0 and out.exists(), (good.returncode, good.stderr)
    assert subprocess.run(cmd, capture_output=True).returncode == 2
print('W11_OPERATOR_EVIDENCE_REPORT_NEGATIVES_PASS')
