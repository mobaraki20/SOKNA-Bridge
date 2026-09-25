#!/usr/bin/env python3
import importlib.util
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMPILER_PATH = ROOT / "tools" / "sokna_command_compiler.py"
CONTENT = (ROOT / "extension" / "chrome" / "content.js").read_text(encoding="utf-8")
BACKGROUND = (ROOT / "extension" / "chrome" / "background.js").read_text(encoding="utf-8")
SEMANTIC_CORE = (ROOT / "extension" / "chrome" / "semantic_core.js").read_text(encoding="utf-8")

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

# Explicit requests for a retired legacy transport are rejected.
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

# During migration, any still-present legacy intake must never fail silently.
# These assertions are temporary and will be replaced by absence assertions when
# physical retirement of content.js legacy parsers lands.
assert "function legacyFailure(" in CONTENT
assert 'legacyFailure(raw,"legacy-v2","invalid_json"' in CONTENT
assert 'legacyFailure(raw,"legacy-v2","invalid_compact_command"' in CONTENT
assert 'legacyFailure(raw||encoded,"legacy-b64",raw?"invalid_json":"invalid_base64url"' in CONTENT
m = re.search(r"function commands\(text,report=true\)\{(?P<body>.*?)\n\}\n\nfunction b64urlDecodeUtf8", CONTENT, re.S)
assert m, "legacy V2 parser not found during migration"
assert "catch{}" not in m.group("body"), "legacy V2 parser still contains fail-silent catch"

# Background correlated, final-only NACK barrier remains mandatory until the new
# unified NACK envelope fully replaces transport diagnostics.
assert 'd.final===true&&hard.has(d.reason)&&correlated' in BACKGROUND
assert 'if(!VALID_COMMAND_ID.test(cid))return{ok:true,ignored:true,uncorrelated:true}' in BACKGROUND
assert 'executed:false' in BACKGROUND

print("R2_CONTRACT_RELIABILITY_PASS")
