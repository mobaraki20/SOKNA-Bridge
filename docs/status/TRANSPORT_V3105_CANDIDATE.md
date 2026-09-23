# SOKNA Bridge Extension 3.10.5 — Candidate

Date: 2026-09-23
Status: LIVE ACCEPTED / BASELINE READY

Scope:
- correlated malformed V4 carriers with a valid outer command id must create a retryable chat-visible transport NACK;
- invalid/unrecoverable outer ids stay diagnostics-only;
- broad snapshot cross-pairs are skipped at a nested newer START and cannot manufacture an old-id NACK or hide the newer complete carrier;
- carrier generation tooling supports legacy V3 (<3.10) and guarded V4 (>=3.10);
- onboarding/KB records Bridge access-plane, full-source-once, workspace-first/batch-first, milestone-push, and old-PC version probing rules.


R4 CI wiring correction:
- R3 published successfully as commit `5b9683576c2cc72b51e515fd0d92c3be86c24ee0` on `fix/extension-correlated-nack-3105-r3`.
- GitHub Windows run `35881300733` failed only in `Carrier generator legacy/current`: Python received empty stdin from the PowerShell pipeline.
- R4 keeps the 3.10.5 transport code unchanged and changes that gate to explicit `--json` arguments with process-exit checks.

Acceptance required before baseline promotion:
1. local deterministic tests PASS;
2. GitHub Windows CI PASS on exact candidate commit;
3. unpacked Extension reload + page reload/re-arm;
4. valid malformed correlated V4 -> exactly one NACK with same commandId, executed=false, retryable=true;
5. invalid outer id -> no chat-visible NACK;
6. valid V4 command remains executable;
7. Result-First and Code-Activation barriers remain PASS.

## LIVE ACCEPTED 2026-09-23
CI 35890985925 PASS @ 42aa96806b674298fecc2890022efd46844d9444.
Runtime 3.10.5; Agent 2.5.4.
V4 valid PASS: v3105-valid-1.
Malformed correlated PASS: v3105-badjson-1 => invalid_json, executed=false, retryable=true.
Invalid outer id PASS: diagnostics-only invalid_outer_id; no visible anonymous NACK.
