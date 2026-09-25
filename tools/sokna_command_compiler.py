#!/usr/bin/env python3
"""Compile high-level SOKNA semantic intents into guarded Bridge commands.

The AI-facing contract is intentionally smaller than the transport contract.  Callers
provide intent + semantic parameters; this module owns command ids, route selection,
command shape, V3/V4 selection, payload budgeting and carrier round-trip validation.
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import re
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
_GUARD_SPEC = importlib.util.spec_from_file_location("sokna_carrier_guard", HERE / "sokna_carrier_guard.py")
if _GUARD_SPEC is None or _GUARD_SPEC.loader is None:
    raise RuntimeError("carrier guard unavailable")
_guard = importlib.util.module_from_spec(_GUARD_SPEC)
_GUARD_SPEC.loader.exec_module(_guard)

SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,180}$")
MAX_BATCH_STEPS = 64


class CompileError(ValueError):
    def __init__(self, code: str, message: str, *, canonical_route: str | None = None):
        super().__init__(message)
        self.code = code
        self.canonical_route = canonical_route

    def as_dict(self) -> dict:
        out = {"ok": False, "error": self.code, "message": str(self), "executed": False}
        if self.canonical_route:
            out["canonical_route"] = self.canonical_route
        return out


def _obj(value, name: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise CompileError("SCHEMA_INVALID", f"{name} must be an object")
    return value


def _text(value, name: str, *, required: bool = True) -> str:
    v = str(value or "").strip()
    if required and not v:
        raise CompileError("SCHEMA_INVALID", f"{name} is required")
    return v


def _command_id(spec: dict) -> str:
    supplied = str(spec.get("id") or "").strip()
    if supplied:
        if not _guard.ID_RE.fullmatch(supplied):
            raise CompileError("SCHEMA_INVALID", "invalid command id")
        return supplied
    return "cmd-" + uuid.uuid4().hex


def _batch_steps(raw_steps) -> list[dict]:
    if not isinstance(raw_steps, list) or not raw_steps:
        raise CompileError("SCHEMA_INVALID", "batch steps must be a non-empty array")
    if len(raw_steps) > MAX_BATCH_STEPS:
        raise CompileError("SCHEMA_INVALID", f"batch steps exceed {MAX_BATCH_STEPS}")
    out = []
    for idx, raw in enumerate(raw_steps, 1):
        if not isinstance(raw, dict):
            raise CompileError("SCHEMA_INVALID", f"batch step {idx} must be an object")
        action = _text(raw.get("action"), f"batch step {idx}.action")
        params = _obj(raw.get("params"), f"batch step {idx}.params")
        name = str(raw.get("name") or f"step-{idx}").strip()
        if not SAFE_NAME_RE.fullmatch(name):
            raise CompileError("SCHEMA_INVALID", f"invalid batch step {idx}.name")
        out.append({
            "name": name,
            "action": action,
            "params": params,
            "stop_on_error": bool(raw.get("stop_on_error", True)),
        })
    return out


def semantic_command(spec: dict) -> tuple[dict, str]:
    if not isinstance(spec, dict):
        raise CompileError("SCHEMA_INVALID", "semantic request must be a JSON object")
    intent = str(spec.get("intent") or "exec").strip().lower()
    cid = _command_id(spec)

    if intent == "exec":
        action = _text(spec.get("action"), "action")
        params = _obj(spec.get("params"), "params")
        return {"id": cid, "action": action, "params": params}, "control"

    if intent == "batch":
        workspace = _text(spec.get("workspace"), "workspace")
        steps = _batch_steps(spec.get("steps"))
        return {"id": cid, "action": "job.batch", "params": {"workspace": workspace, "steps": steps}}, "batch"

    if intent == "job":
        workspace = _text(spec.get("workspace"), "workspace")
        path = _text(spec.get("path"), "path")
        params = {"workspace": workspace, "path": path}
        expected = str(spec.get("expected_sha256") or "").strip()
        if expected:
            if not SHA256_RE.fullmatch(expected):
                raise CompileError("SCHEMA_INVALID", "expected_sha256 must be 64 hex characters")
            params["expected_sha256"] = expected.lower()
        return {"id": cid, "action": "job.submit", "params": params}, "job"

    if intent == "artifact":
        workspace = _text(spec.get("workspace"), "workspace")
        filename = _text(spec.get("filename"), "filename")
        if not SAFE_NAME_RE.fullmatch(filename) or not filename.lower().endswith(".zip"):
            raise CompileError("SCHEMA_INVALID", "artifact filename must be a safe .zip basename")
        expected = _text(spec.get("expected_sha256"), "expected_sha256")
        if not SHA256_RE.fullmatch(expected):
            raise CompileError("SCHEMA_INVALID", "expected_sha256 must be 64 hex characters")
        params = {"workspace": workspace, "filename": filename, "expected_sha256": expected.lower()}
        artifact_id = str(spec.get("artifact_id") or "").strip()
        if artifact_id:
            if not SAFE_NAME_RE.fullmatch(artifact_id):
                raise CompileError("SCHEMA_INVALID", "invalid artifact_id")
            params["artifact_id"] = artifact_id
        return {"id": cid, "action": "artifact.chat.apply", "params": params}, "artifact"

    raise CompileError("ROUTE_POLICY_VIOLATION", f"unsupported semantic intent: {intent}")


def compile_semantic(spec: dict, *, extension_version: str = "3.10.9", transport: str | None = None) -> dict:
    command, route = semantic_command(spec)
    selected = transport or _guard.transport_for_extension(extension_version)
    try:
        carrier, raw_bytes, carrier_chars = _guard.build(command, selected)
    except ValueError as exc:
        msg = str(exc)
        if "raw payload" in msg or "carrier" in msg and "chars" in msg:
            raise CompileError(
                "ARTIFACT_ROUTE_REQUIRED",
                "semantic command exceeds Control Plane budget; move bulky data to Artifact/plan reference",
                canonical_route="artifact",
            ) from exc
        raise CompileError("SCHEMA_INVALID", msg) from exc
    return {
        "ok": True,
        "intent": str(spec.get("intent") or "exec").lower(),
        "route": route,
        "transport": selected,
        "command": command,
        "carrier": carrier,
        "rawBytes": raw_bytes,
        "carrierChars": carrier_chars,
    }


def _input(ns) -> str:
    if ns.json is not None and ns.json_b64 is not None:
        raise CompileError("SCHEMA_INVALID", "use only one of --json or --json-b64")
    if ns.json_b64 is not None:
        try:
            return base64.b64decode(ns.json_b64, validate=True).decode("utf-8")
        except Exception as exc:
            raise CompileError("SCHEMA_INVALID", "invalid --json-b64 payload") from exc
    return ns.json if ns.json is not None else sys.stdin.read()


def main() -> int:
    ap = argparse.ArgumentParser(description="Compile semantic SOKNA intent into a guarded Bridge carrier")
    ap.add_argument("--json", help="semantic request JSON; omit to read stdin")
    ap.add_argument("--json-b64", help="UTF-8 Base64 semantic request JSON")
    ap.add_argument("--extension-version", default="3.10.9")
    ap.add_argument("--transport", choices=["v3", "v4"])
    ap.add_argument("--meta", action="store_true", help="print compile metadata JSON before carrier")
    ns = ap.parse_args()
    try:
        spec = json.loads(_input(ns))
        result = compile_semantic(spec, extension_version=ns.extension_version, transport=ns.transport)
    except CompileError as exc:
        print(json.dumps(exc.as_dict(), separators=(",", ":")), file=sys.stderr)
        return 2
    except Exception as exc:
        err = CompileError("SCHEMA_INVALID", str(exc))
        print(json.dumps(err.as_dict(), separators=(",", ":")), file=sys.stderr)
        return 2
    if ns.meta:
        meta = {k: v for k, v in result.items() if k not in {"carrier", "command"}}
        meta["commandId"] = result["command"]["id"]
        meta["action"] = result["command"]["action"]
        print(json.dumps(meta, separators=(",", ":")))
    print(result["carrier"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
