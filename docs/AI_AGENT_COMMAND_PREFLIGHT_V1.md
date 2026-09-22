# SOKNA Bridge — AI Command Preflight Contract V1

Status: MANDATORY for every AI agent that emits a Bridge command.

1. Do not hand-assemble or hand-edit an encoded carrier.
2. Preferred carrier is V4; documentation writes it only in broken non-executable notation: `SOKNA4-CMD:<command-id>:<base64url-json>:SOKNA4-END`.
3. Before emission, the sender MUST serialize the command to compact UTF-8 JSON, parse it back, Base64URL encode it, decode it back, parse it again, and verify the round trip is identical.
4. The outer command id MUST match `i`/`id` inside the decoded JSON.
5. Raw UTF-8 JSON MUST be <= 800 bytes and final carrier MUST be <= 1200 characters.
6. Required command structure MUST be present (`i` + `o` for compact, or `id` + `action` for expanded; parameter maps must be objects).
7. If the sender cannot perform this preflight, it MUST NOT emit a Bridge command.
8. Result-First Barrier remains mandatory: one command at a time; no next command until RESULT or transport NACK resolves the previous attempt.
9. A `[SOKNA-V2-STATUS]` with `kind="transport-nack"` and `executed=false` means the command was rejected before execution. Correct it and use a new command id.
10. Correlatable malformed complete carriers (valid recoverable command id), outer-id mismatches, invalid JSON/Base64URL, budget failures, and V4 incomplete carriers with a recently observed valid outer id MUST produce an automatic transport NACK; the user should not need to open Health to discover the error.
10a. An invalid/unrecoverable outer id is not safely correlatable and MUST NOT create a chat-visible NACK. It is recorded in local diagnostics only. Mandatory sender preflight MUST prevent this class before emission.

Reference implementation: `tools/sokna_carrier_guard.py`.

11. The exact executable start/end markers are reserved for real commands only. Documentation, explanations, examples, and code samples MUST NOT contain a complete literal `SOKNA4-CMD:...:SOKNA4-END` or `SOKNA3-CMD:...:SOKNA3-END` carrier. Break the marker in examples (for example `SOKNA4-CMD:<id>:...:SOKNA4-END`) so page scanners cannot mistake prose for an executable command.
12. On arm/re-arm, the page baseline is discovery-only. Historical valid carriers are marked seen and historical malformed carrier fingerprints are seeded silently; baseline scanning MUST NOT emit transport NACKs for old examples or old malformed text.

13. Chat-visible transport NACKs MUST carry a syntactically valid commandId matching `^[A-Za-z0-9._-]{1,96}$`. A scanner diagnostic without such an id is uncorrelated noise and MUST remain local.
14. V4 snapshot parsing MUST reject cross-message/prose pairing: a guarded carrier is one contiguous token; broad ancestor text containing whitespace between V4 start/end is diagnostic-only and must not generate a chat-visible NACK.
