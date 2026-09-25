#!/usr/bin/env python3
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMPILER_PATH = ROOT / "tools" / "sokna_command_compiler.py"
CONTENT = (ROOT / "extension" / "chrome" / "content.js").read_text(encoding="utf-8")
DOM_CORE = (ROOT / "extension" / "chrome" / "dom_core.js").read_text(encoding="utf-8")
PROTOCOL = (ROOT / "extension" / "chrome" / "protocol.js").read_text(encoding="utf-8")
BACKGROUND = (ROOT / "extension" / "chrome" / "background.js").read_text(encoding="utf-8")
BACKGROUND_BOOTSTRAP = (ROOT / "extension" / "chrome" / "background_bootstrap.js").read_text(encoding="utf-8")
SEMANTIC_GATE = (ROOT / "extension" / "chrome" / "semantic_gate.js").read_text(encoding="utf-8")
SEMANTIC_CORE = (ROOT / "extension" / "chrome" / "semantic_core.js").read_text(encoding="utf-8")
SEMANTIC_INTENT = (ROOT / "extension" / "chrome" / "semantic_intent.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "extension" / "chrome" / "manifest.json").read_text(encoding="utf-8"))

spec = importlib.util.spec_from_file_location("sokna_command_compiler", COMPILER_PATH)
assert spec and spec.loader
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)

# Canonical semantic compiler: no V2/B64/V3/V4 carrier is generated in normal flow.
r = compiler.compile_semantic({"intent": "exec", "action": "ping", "params": {}})
assert r["ok"] and r["transport"] == "semantic-intent-v1" and r["route"] == "control"
assert r["marker"].startswith("[SOKNA-INTENT]") and r["marker"].endswith("[/SOKNA-INTENT]")
assert "SOKNA3CMD:" not in r["marker"] and "SOKNA4CMD:" not in r["marker"] and "SOKNA-CMD-B64" not in r["marker"]
cmd = r["command"]
assert cmd["action"] == "ping" and cmd["id"].startswith("cmd-")
assert cmd["protocolVersion"] == "2" and cmd["schemaVersion"] == "2"
assert cmd["kind"] == "command" and cmd["messageId"] == cmd["id"] and cmd["correlationId"] == cmd["id"]
assert "timestamp" in cmd and isinstance(cmd["timestamp"], int)

try:
    compiler.compile_semantic({"intent": "exec", "action": "ping", "params": {}}, transport="v4")
    raise AssertionError("legacy transport must be rejected from normal semantic flow")
except compiler.CompileError as exc:
    assert exc.code == "ROUTE_POLICY_VIOLATION"

batch = compiler.compile_semantic({
    "intent": "batch",
    "workspace": "SOKNA-Bridge",
    "steps": [
        {"name": "inspect", "action": "repo.inspect", "params": {"workspace": "SOKNA-Bridge"}},
        {"name": "status", "action": "git.status", "params": {"workspace": "SOKNA-Bridge"}},
    ],
})
assert batch["route"] == "batch"
assert batch["command"]["action"] == "job.batch"
assert len(batch["command"]["params"]["steps"]) == 2
assert batch["command"]["protocolVersion"] == "2"

job = compiler.compile_semantic({"intent": "job", "workspace": "SOKNA-Bridge", "path": "tools/plans/example.json"})
assert job["route"] == "job" and job["command"]["action"] == "job.submit"

sha = "a" * 64
artifact = compiler.compile_semantic({"intent": "artifact", "workspace": "SOKNA-Bridge", "filename": "change.zip", "expected_sha256": sha})
assert artifact["route"] == "artifact" and artifact["command"]["action"] == "artifact.chat.apply"

try:
    compiler.compile_semantic({"intent": "exec", "action": "file.write", "params": {"content": "x" * 3000}})
    raise AssertionError("oversize control payload must not compile")
except compiler.CompileError as exc:
    assert exc.code == "ARTIFACT_ROUTE_REQUIRED" and exc.canonical_route == "artifact"

try:
    compiler.compile_semantic({"intent": "batch", "workspace": "SOKNA-Bridge", "steps": []})
    raise AssertionError("empty batch must fail")
except compiler.CompileError as exc:
    assert exc.code == "SCHEMA_INVALID"

# Browser-side semantic compiler must emit the same mandatory envelope fields.
for token in [
    'PROTOCOL_VERSION="2"',
    'SCHEMA_VERSION="2"',
    'messageId:id',
    'correlationId:id',
    'kind:"command"',
    'schemaVersion:SCHEMA_VERSION',
    'timestamp:Date.now()',
]:
    assert token in SEMANTIC_CORE, f"missing semantic envelope field: {token}"

# Active runtime command discovery must be semantic-only; legacy command parsers are gone.
for legacy in ["SOKNA3CMD:", "SOKNA4CMD:", "SOKNA-CMD-B64", "SOKNA-V2-CMD"]:
    assert legacy not in CONTENT, f"legacy marker still present in content runtime: {legacy}"
    assert legacy not in DOM_CORE, f"legacy marker still present in DOM runtime: {legacy}"
    assert legacy not in PROTOCOL, f"legacy marker still present in protocol runtime: {legacy}"
assert '[SOKNA-INTENT]' in SEMANTIC_INTENT
assert 'commandDiscovery:"semantic-intent-only"' in CONTENT
assert 'legacyCommandParsers:false' in CONTENT

# Fail-closed validation exists at both page-side and service-worker-side boundaries.
assert 'UNIFIED_ENVELOPE_INVALID:' in SEMANTIC_GATE
assert 'SEMANTIC_ROUTE_REQUIRED' in SEMANTIC_GATE
assert 'PROTO?.validateEnvelope?.(m.command,{kind:"command"})' in BACKGROUND_BOOTSTRAP
assert 'SEMANTIC_ROUTE_REQUIRED' in BACKGROUND_BOOTSTRAP
assert 'executed:false' in BACKGROUND_BOOTSTRAP
assert MANIFEST["background"]["service_worker"] == "background_bootstrap.js"

# Background keeps correlated machine-readable rejection behavior.
assert 'if(!VALID_COMMAND_ID.test(cid))return{ok:true,ignored:true,uncorrelated:true}' in BACKGROUND
assert 'executed:false' in BACKGROUND

print("R2_CONTRACT_RELIABILITY_PASS")
