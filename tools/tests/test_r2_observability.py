#!/usr/bin/env python3
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOST = (ROOT / "native" / "host" / "main.go").read_text(encoding="utf-8")
HOST_TEST = (ROOT / "native" / "host" / "main_test.go").read_text(encoding="utf-8")
BOOTSTRAP = (ROOT / "extension" / "chrome" / "background_bootstrap.js").read_text(encoding="utf-8")
POPUP = (ROOT / "extension" / "chrome" / "popup.js").read_text(encoding="utf-8")
HTML = (ROOT / "extension" / "chrome" / "popup.html").read_text(encoding="utf-8")

for action in ['"job.list"', '"job.events"', '"bridge.activity"']:
    assert action in HOST, f"missing observability action {action}"
# Assert the semantic source value, not gofmt/whitespace formatting.
assert '"agent-job-store"' in HOST and 'Source' in HOST
assert 'owned_processes' in HOST
assert 'worker_pid' in HOST
assert 'events.jsonl' in HOST
assert 'job-state.json' in HOST
assert 'command.accepted' in HOST
assert 'command.completed' in HOST
assert 'command.failed' in HOST
assert 'job.running' in HOST and 'job.completed' in HOST and 'job.failed' in HOST
assert 'maxActivityBytes' in HOST

# Journal must be metadata-only; command params are not copied into ActivityEvent.
activity_struct = HOST.split('type ActivityEvent struct {', 1)[1].split('}', 1)[0]
assert 'Params' not in activity_struct and 'Token' not in activity_struct
assert 'TestCommandActivityDoesNotPersistParamsOrSecrets' in HOST_TEST
assert 'TestJobEventsAreDurableAndDeduplicatedByState' in HOST_TEST

# Extension monitor path must be native-host backed, not a fake local UI counter.
assert 'ACTIVITY_SNAPSHOT' in BOOTSTRAP
assert 'bridge.activity' in BOOTSTRAP and 'job.events' in BOOTSTRAP
assert 'sendNativeMessage' in BOOTSTRAP
# Host-local observability commands must pass the capability gate even though they
# are not actions exposed by the HTTP Agent capability manifest.
for action in ['"job.list"', '"job.events"', '"bridge.activity"']:
    assert action in BOOTSTRAP, f"host-local action blocked by capability preflight: {action}"
assert 'ACTIVITY_SNAPSHOT' in POPUP
assert 'setInterval' not in POPUP, 'Activity UI must not continuously poll and generate self-noise'
assert 'refreshActivity' in POPUP
assert 'Advanced diagnostics' in HTML
for action in ['"bridge.activity":true','"job.list":true','"job.events":true','"ping":true','"agent.capabilities":true']:
    assert action in HOST, f'read-only observability action must be quiet: {action}'
assert 'shouldRecordCommandActivity' in HOST

print('R2_OBSERVABILITY_PASS')
