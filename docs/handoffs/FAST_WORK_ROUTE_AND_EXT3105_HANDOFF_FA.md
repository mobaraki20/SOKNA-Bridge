# Handoff — Fast Work Route + Extension 3.10.5 Candidate

Date: 2026-09-23
Status: MANDATORY continuation context

## Permanent access/routing facts
- Chat/assistant must not assume direct authenticated GitHub access or direct access to the user's Windows filesystem. SOKNA Bridge is the access/control plane for those operations. The user must not be asked to restate this in a new chat.
- For non-trivial work, acquire full canonical source once into the development workspace. Repeated `file.read`/snippet collection over Bridge is a last resort, not the development workflow.
- Preferred source route: exact archive already present in development workspace -> one Bridge/artifact acquisition -> verified mirror -> targeted Bridge reads only if no full-source route exists.
- Development is workspace-first and batch-first. Do read/patch/test/package off the user PC.
- GitHub is a durable checkpoint and independent CI boundary, not a scratchpad. Do not push after each small edit; push a validated candidate at a meaningful checkpoint.
- Real PCs are for access, activation and acceptance. Probe live Agent/Extension first because secondary PCs may lag the accepted baseline.
- Carrier generation is programmatic only using `tools/sokna_carrier_guard.py`; Extension <3.10 uses generated V3, >=3.10 uses generated V4. Never hand-assemble Base64/carriers.

## Current version facts
- Accepted baseline before this candidate: Agent 2.5.5 + Extension 3.10.4.
- Cafe PC observed 2026-09-23: Agent 2.5.4 + Extension 3.9.5, repo HEAD `11c93bc`; it is not the canonical development baseline.
- Extension 3.10.5 is a development candidate until local tests + exact-commit Windows CI + live reload/re-arm acceptance PASS.

## 3.10.5 bug fix
Observed failure: a malformed complete V4 carrier with a valid recoverable outer command id could record `carrier_parse_failed` in Health but remain silent in chat because whitespace-path `final` depended on short-lived recent-start evidence.

Fix:
- shared protocol frame scanner rejects old-START/new-END cross-pairs by detecting a nested newer START and restarting there;
- self-contained malformed complete V4 frame + valid outer id is correlatable and final -> background queues exactly one retryable NACK;
- invalid/unrecoverable outer id remains diagnostics-only;
- valid newer carrier inside a broad ancestor snapshot is no longer hidden by an old partial START.

## Exact continuation
1. Run local deterministic suite.
2. Build one candidate artifact/overlay with hashes and this handoff.
3. At the meaningful checkpoint only, apply to a fresh exact canonical repo checkout, commit once, push once.
4. Run GitHub Windows full CI on the exact commit.
5. Only after CI PASS, upgrade/reload an acceptance PC and run malformed-correlated / invalid-outer / valid-command live tests.
6. Promote 3.10.5 only after Code-Activation and Result-First barriers PASS.

## R3 -> R4 CI correction
- R3 publish reached GitHub successfully: branch `fix/extension-correlated-nack-3105-r3`, commit `5b9683576c2cc72b51e515fd0d92c3be86c24ee0`.
- Windows CI run `35881300733` failed only in the carrier-generator step because the PowerShell pipe delivered empty stdin to Python.
- R4 does not change the Extension 3.10.5 transport fix. It changes CI carrier invocation to serialize in PowerShell and pass via `--json`, checks native process exit codes, and adds a regression contract preventing the pipe form from returning.

## Final live acceptance - 2026-09-23
- GitHub Windows CI: PASS, run 35890985925, HEAD 42aa96806b674298fecc2890022efd46844d9444.
- Runtime: Extension 3.10.5; Agent 2.5.4.
- Valid V4: v3105-valid-1 PASS.
- Correlated malformed V4: v3105-badjson-1 -> transport-nack invalid_json, executed=false, retryable=true PASS.
- Invalid outer id: diagnostics-only invalid_outer_id; no chat-visible anonymous NACK PASS.
