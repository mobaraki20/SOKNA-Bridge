#!/usr/bin/env python3
"""Compile high-level SOKNA semantic intents into the canonical semantic-intent path.

The AI-facing contract is intentionally transport-agnostic. Callers provide intent and
semantic parameters. This module owns ids, route selection, schema validation, command
envelope construction, control-plane budgeting and the semantic marker emitted for the
Extension. It does NOT build V2/B64/V3/V4 carriers.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import uuid

ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,96}$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,180}$")
MAX_BATCH_STEPS = 64
MAX_CONTROL_BYTES = 800
SEMANTIC_START = "[SOKNA-INTENT]"
SEMANTIC_END = "[/SOKNA-INTENT]"
PROTOCOL_VERSION = "2"
SCHEMA_VERSION = "2"


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
        if not ID_RE.fullmatch(supplied):
            raise CompileError("SCHEMA_INVALID", "invalid command id")
        return supplied
    return "cmd-" + uuid.uuid4().hex


def _parent_id(spec: dict) -> str:
    value = str(spec.get("parent_id") or "").strip()
    if value and not ID_RE.fullmatch(value):
        raise CompileError("SCHEMA_INVALID", "invalid parent_id")
    return value


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


def _envelope(cid: str, action: str, params: dict, parent_id: str) -> dict:
    # Keep id/action/params for current Agent compatibility while making the canonical
    # control envelope explicit and versioned end-to-end.
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "messageId": cid,
        "correlationId": cid,
        "parentId": parent_id,
        "kind": "command",
        "action": action,
        "schemaVersion": SCHEMA_VERSION,
        "timestamp": int(time.time() * 1000),
        "id": cid,
        "params": params,
    }


def semantic_command(spec: dict) -> tuple[dict, str, dict]:
    if not isinstance(spec, dict):
        raise CompileError("SCHEMA_INVALID", "semantic request must be a JSON object")
    intent = str(spec.get("intent") or "exec").strip().lower()
    cid = _command_id(spec)
    parent_id = _parent_id(spec)

    if intent == "exec":
        action = _text(spec.get("action"), "action")
        params = _obj(spec.get("params"), "params")
        semantic = {"intent": "exec", "id": cid, "action": action, "params": params}
        if parent_id:
            semantic["parent_id"] = parent_id
        return _envelope(cid, action, params, parent_id), "control", semantic

    if intent == "batch":
        workspace = _text(spec.get("workspace"), "workspace")
        steps = _batch_steps(spec.get("steps"))
        params = {"workspace": workspace, "steps": steps}
        semantic = {"intent": "batch", "id": cid, "workspace": workspace, "steps": steps}
        if parent_id:
            semantic["parent_id"] = parent_id
        return _envelope(cid, "job.batch", params, parent_id), "batch", semantic

    if intent == "job":
        workspace = _text(spec.get("workspace"), "workspace")
        path = _text(spec.get("path"), "path")
        params = {"workspace": workspace, "path": path}
        semantic = {"intent": "job", "id": cid, "workspace": workspace, "path": path}
        expected = str(spec.get("expected_sha256") or "").strip()
        if expected:
            if not SHA256_RE.fullmatch(expected):
                raise CompileError("SCHEMA_INVALID", "expected_sha256 must be 64 hex characters")
            expected = expected.lower()
            params["expected_sha256"] = expected
            semantic["expected_sha256"] = expected
        if parent_id:
            semantic["parent_id"] = parent_id
        return _envelope(cid, "job.submit", params, parent_id), "job", semantic

    if intent == "artifact":
        workspace = _text(spec.get("workspace"), "workspace")
        filename = _text(spec.get("filename"), "filename")
        if not SAFE_NAME_RE.fullmatch(filename) or not filename.lower().endswith(".zip"):
            raise CompileError("SCHEMA_INVALID", "artifact filename must be a safe .zip basename")
        expected = _text(spec.get("expected_sha256"), "expected_sha256")
        if not SHA256_RE.fullmatch(expected):
            raise CompileError("SCHEMA_INVALID", "expected_sha256 must be 64 hex characters")
        expected = expected.lower()
        params = {"workspace": workspace, "filename": filename, "expected_sha256": expected}
        semantic = {"intent": "artifact", "id": cid, "workspace": workspace, "filename": filename, "expected_sha256": expected}
        artifact_id = str(spec.get("artifact_id") or "").strip()
        if artifact_id:
            if not SAFE_NAME_RE.fullmatch(artifact_id):
                raise CompileError("SCHEMA_INVALID", "invalid artifact_id")
            params["artifact_id"] = artifact_id
            semantic["artifact_id"] = artifact_id
        if parent_id:
            semantic["parent_id"] = parent_id
        return _envelope(cid, "artifact.chat.apply", params, parent_id), "artifact", semantic

    raise CompileError("ROUTE_POLICY_VIOLATION", f"unsupported semantic intent: {intent}")


def compile_semantic(spec: dict, *, extension_version: str | None = None, transport: str | None = None) -> dict:
    # extension_version/transport remain accepted for temporary caller compatibility,
    # but legacy transport selection is intentionally ignored in the canonical path.
    if transport and transport not in {"semantic", "semantic-intent", "semantic-intent-v1"}:
        raise CompileError("ROUTE_POLICY_VIOLATION", "legacy carrier transport is retired from normal semantic flow")
    command, route, semantic = semantic_command(spec)
    raw = json.dumps(command, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(raw) > MAX_CONTROL_BYTES:
        raise CompileError(
            "ARTIFACT_ROUTE_REQUIRED",
            "semantic command exceeds Control Plane budget; move bulky data to Artifact/plan reference",
            canonical_route="artifact",
        )
    semantic_json = json.dumps(semantic, separators=(",", ":"), ensure_ascii=False)
    marker = SEMANTIC_START + semantic_json + SEMANTIC_END
    return {
        "ok": True,
        "intent": semantic["intent"],
        "route": route,
        "transport": "semantic-intent-v1",
        "command": command,
        "semantic": semantic,
        "carrier": marker,  # compatibility key; value is semantic marker, never V2/B64/V3/V4.
        "marker": marker,
        "rawBytes": len(raw),
        "carrierChars": len(marker),
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
    ap = argparse.ArgumentParser(description="Compile semantic SOKNA intent into the canonical Extension semantic marker")
    ap.add_argument("--json", help="semantic request JSON; omit to read stdin")
    ap.add_argument("--json-b64", help="UTF-8 Base64 semantic request JSON")
    ap.add_argument("--extension-version", default="", help=argparse.SUPPRESS)
    ap.add_argument("--transport", help=argparse.SUPPRESS)
    ap.add_argument("--meta", action="store_true", help="print compile metadata JSON before marker")
    ns = ap.parse_args()
    try:
        spec = json.loads(_input(ns))
        result = compile_semantic(spec, extension_version=ns.extension_version or None, transport=ns.transport)
    except CompileError as exc:
        print(json.dumps(exc.as_dict(), separators=(",", ":")), file=sys.stderr)
        return 2
    except Exception as exc:
        err = CompileError("SCHEMA_INVALID", str(exc))
        print(json.dumps(err.as_dict(), separators=(",", ":")), file=sys.stderr)
        return 2
    if ns.meta:
        meta = {k: v for k, v in result.items() if k not in {"carrier", "marker", "command", "semantic"}}
        meta["commandId"] = result["command"]["id"]
        meta["action"] = result["command"]["action"]
        meta["protocolVersion"] = result["command"]["protocolVersion"]
        print(json.dumps(meta, separators=(",", ":")))
    print(result["marker"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
