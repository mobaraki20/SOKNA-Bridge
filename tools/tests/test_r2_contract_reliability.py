#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMPILER_PATH = ROOT / "tools" / "sokna_command_compiler.py"
CONTENT = (ROOT / "extension" / "chrome" / "content.js").read_text(encoding="utf-8")
BACKGROUND = (ROOT / "extension" / "chrome" / "background.js").read_text(encoding="utf-8")

spec = importlib.util.spec_from_file_location("sokna_command_compiler", COMPILER_PATH)
assert spec and spec.loader
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)

# Semantic compiler: caller gives intent; compiler owns command shape and transport.
r = compiler.compile_semantic({"intent": "exec", "action": "ping", "params": {}}, extension_version="3.10.9")
assert r["ok"] and r["transport"] == "v4" and r["route"] == "control"
assert r["command"]["action"] == "ping" and r["command"]["id"].startswith("cmd-")
assert r["carrier"].startswith("SOKNA4CMD:" + r["command"]["id"] + ":")

r3 = compiler.compile_semantic({"intent": "exec", "action": "ping", "params": {}}, extension_version="3.9.9")
assert r3["transport"] == "v3" and r3["carrier"].startswith("SOKNA3CMD:")

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

# Legacy intake must no longer fail silently. Correlatable malformed V2/B64 commands
# are converted into TRANSPORT_DIAG records that background can turn into NACKs.
assert "function legacyFailure(" in CONTENT
assert 'legacyFailure(raw,"legacy-v2","invalid_json"' in CONTENT
assert 'legacyFailure(raw,"legacy-v2","invalid_compact_command"' in CONTENT
assert 'legacyFailure(raw||encoded,"legacy-b64",raw?"invalid_json":"invalid_base64url"' in CONTENT
assert "function commands(text,report=true)" in CONTENT
assert "for(const c of commands(t,false))" in CONTENT  # historical baseline stays quiet

m = re.search(r"function commands\(text,report=true\)\{(?P<body>.*?)\n\}\n\nfunction b64urlDecodeUtf8", CONTENT, re.S)
assert m, "legacy V2 parser not found"
assert "catch{}" not in m.group("body"), "legacy V2 parser still contains fail-silent catch"

# Background already has the correlated, final-only NACK barrier; keep it mandatory.
assert 'd.final===true&&hard.has(d.reason)&&correlated' in BACKGROUND
assert 'if(!VALID_COMMAND_ID.test(cid))return{ok:true,ignored:true,uncorrelated:true}' in BACKGROUND
assert 'executed:false' in BACKGROUND

print("R2_CONTRACT_RELIABILITY_PASS")
