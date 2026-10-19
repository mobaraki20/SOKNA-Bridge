#!/usr/bin/env python3
"""Native Messaging *binary-protocol* smoke (NOT Chrome/Edge extension UAT).
No source imports and no account or browser state mutations.
"""
import argparse
import json
import os
import struct
import subprocess
import sys
from pathlib import Path


def frame(obj):
    b = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(b)) + b


def parse_frames(raw):
    results = []
    pos = 0
    while pos < len(raw):
        if len(raw) - pos < 4:
            raise AssertionError("TRUNCATED_NATIVE_RESPONSE_HEADER")
        n = struct.unpack_from("<I", raw, pos)[0]
        pos += 4
        if n <= 0 or n > 900 * 1024 or len(raw) - pos < n:
            raise AssertionError("INVALID_NATIVE_RESPONSE_FRAME")
        obj = json.loads(raw[pos:pos + n])
        pos += n
        results.append(obj)
    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    args = p.parse_args()
    exe = Path(args.host).resolve(strict=True)
    if not exe.is_file():
        raise ValueError("HOST_EXE_MISSING")
    requests = [
        {"type": "host.ping", "request_id": "ping-1"},
        {"type": "unrecognized.test.action", "request_id": "bad-2"},
        {"type": "agent.exec", "request_id": "invalid-3", "command": {"action": "ping", "id": "../invalid"}},
    ]
    payload = b"".join(frame(x) for x in requests)
    env = os.environ.copy()
    env.pop("SOKNA_V3_AGENT_ENDPOINT", None)
    env.pop("SOKNA_V3_AGENT_TOKEN", None)
    process = subprocess.Popen([str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    try:
        stdout, stderr = process.communicate(input=payload, timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise AssertionError("NATIVE_HOST_TIMEOUT")
    if process.returncode != 0:
        raise AssertionError("NATIVE_HOST_EXIT_FAILURE: " + stderr.decode("utf-8", "replace")[:160])
    replies = parse_frames(stdout)
    assert len(replies) == len(requests), "NATIVE_HOST_REPLY_COUNT_MISMATCH"
    assert replies[0].get("ok") is True and replies[0].get("type") == "host.pong" and replies[0].get("request_id") == "ping-1", "HOST_PING_ROUNDTRIP_FAILED"
    assert replies[1].get("ok") is False and replies[1].get("request_id") == "bad-2", "UNRECOGNIZED_NATIVE_TYPE_NOT_REJECTED"
    assert replies[2].get("ok") is False and replies[2].get("request_id") == "invalid-3", "BAD_COMMAND_ID_NOT_REJECTED"
    print("NATIVE_MESSAGING_FRAMING_AND_REJECTION_PASS; CHROME_EDGE_EXTENSION_UAT_NOT_RUN")


if __name__ == "__main__":
    main()
