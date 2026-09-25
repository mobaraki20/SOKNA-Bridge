#!/usr/bin/env python3
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]
AUDIT=(ROOT/'native'/'host'/'browser_audit.go').read_text(encoding='utf-8')
OUT=(ROOT/'native'/'host'/'outbound_artifact.go').read_text(encoding='utf-8')
BOOT=(ROOT/'extension'/'chrome'/'background_bootstrap.js').read_text(encoding='utf-8')
MODEL=(ROOT/'native'/'browser'/'model.go').read_text(encoding='utf-8')

assert 'browser.audit.run' in AUDIT and 'browser.audit.run' in BOOT
assert 'workspace.inspect' in AUDIT and 'workspace does not allow browser tool' in AUDIT
assert 'browser audit pages must contain 1..12 entries' in AUDIT
assert 'browser audit requires 1..20 allowed_origins' in AUDIT
assert 'audit page origin not allowed' in AUDIT
assert 'allowed_origins' in AUDIT
assert 'artifact.out.get' in AUDIT
assert 'publishArtifact' in AUDIT
assert 'manual_screenshot_transfer_required' in AUDIT and 'false' in AUDIT
assert 'screenshot' in AUDIT and 'dom' in AUDIT and 'geometry' in AUDIT and 'a11y' in AUDIT and 'console' in AUDIT and 'network' in AUDIT
assert 'baseline_id' in AUDIT and '--baseline-dir' in AUDIT
assert 'value_env' in MODEL and 'CookieSetup' in MODEL and 'StorageSetup' in MODEL
assert 'localBrowserAudit(c)' in OUT
print('R2_BROWSER_AUDIT_PASS')
