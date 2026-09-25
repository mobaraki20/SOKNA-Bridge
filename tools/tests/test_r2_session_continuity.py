#!/usr/bin/env python3
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]
SESSION=(ROOT/'native'/'host'/'session_continuity.go').read_text(encoding='utf-8')
GATE=(ROOT/'extension'/'chrome'/'background_bootstrap.js').read_text(encoding='utf-8')
OUT=(ROOT/'native'/'host'/'outbound_artifact.go').read_text(encoding='utf-8')
TEST=(ROOT/'native'/'host'/'session_continuity_test.go').read_text(encoding='utf-8')

for action in ['bridge.bootstrap','session.open','session.resume','session.checkpoint','session.close','session.list']:
    assert f'"{action}"' in SESSION or f'"{action}"' in GATE, action
assert 'sokna-work-session-v1' in SESSION
assert 'sokna-bridge-bootstrap-v1' in SESSION
assert 'protocol_version' in SESSION and 'schema_version' in SESSION
assert 'route_policy' in SESSION and 'file_delivery_rules' in SESSION and 'github_rules' in SESSION and 'session_rules' in SESSION
assert 'local_path_is_delivery' in SESSION and 'protected ref only' in SESSION
assert 'mutation_requires_ready_session' in SESSION
assert 'active.json' in SESSION
assert 'sensitiveKey' in SESSION and 'token' in SESSION and 'secret' in SESSION and 'credential' in SESSION
assert 'localSession(c)' in OUT
assert 'bootstrappedConversations' in GATE
assert 'conversationKey(sender)' in GATE
assert 'BOOTSTRAP_REQUIRED' in GATE
assert 'SESSION_NOT_READY' in GATE
assert 'bridge.bootstrap before mutation/execution' in GATE
assert 'executed:false' in GATE
assert 'recoveryActions' in GATE
assert 'TestWorkSessionPersistsCheckpointAndCloses' in TEST
assert 'TestBootstrapIsFailClosedWhenAgentUnavailable' in TEST
print('R2_SESSION_CONTINUITY_PASS')
