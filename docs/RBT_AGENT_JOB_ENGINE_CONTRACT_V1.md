# Reliable Browser Transport + Agent Job Engine Contract v1

## Baseline
- V3.9.5 remains the fallback until the new transport passes promotion tests.
- No V3.9.6 implementation is assumed.
- Chat is control plane; local/GitHub storage is data plane.

## Architecture
- Chat: intent, approval, summary.
- Extension: detect/reconcile commands, deliver results, protect drafts/attachments.
- Native Host: thin framing/validation/auth/IPC bridge.
- Agent: deterministic local job engine for workspace, files, Git, tools, audit, recovery and idempotency.

## Inbound
- MutationObserver is fast path only.
- Correctness requires reconciliation/rescan of recent final assistant messages.
- Large payloads use references; carriers stay short.

## Outbound
State machine:
`queued -> sending -> submitted -> observed_in_conversation -> delivered`

Rules:
- `delivered` is final/monotonic.
- One delivery attempt per RESULT ID at a time (single-flight).
- Before retry, scan conversation for the RESULT ID; if already present, mark delivered without repost.
- Final ACK is a real user-message bubble containing the RESULT ID.
- Composer-empty means at most `submitted`.
- User draft/attachment blocks auto-submit and keeps RESULT queued.
- After filling composer, wait for input/render readiness and enabled Send control before submit.

## Agent Job Engine
- Support bounded high-level jobs such as `inspect_read`, `inspect_and_fix`, `patch_and_test`, `commit_and_push`.
- Agent is not a second AI; ChatGPT reasons, Agent executes deterministically.
- Large outputs return references such as `file_ref`, `diff_ref`, `result_ref`.

## Workspace and permissions
- Persistent Local
- Temporary/Ephemeral Checkout
- GitHub Remote without permanent clone
- Path scope: Read / Write / Deny
- Tool/app allowlist
- Job-scoped temporary permissions + audit log
- `SoknaCafe` remains strict read-only
