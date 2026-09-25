# SOKNA Bridge - READ FIRST / New Chat
Status: MANDATORY.

**First read:** `docs/handoffs/ARCHITECTURE_ROADMAP_2026-09-25_FA.md`.
This is the current architecture/reliability roadmap and records the 2026-09-25 decisions about semantic command compilation, contract simplification, fail-silent/NACK closure, ACK/activity monitoring, durable job events, outbound artifacts, Browser Inspection, new-chat continuity, the current P1 installer blocker, and the phased continuation plan. Do not issue a Bridge command before reading it.

**Then read:** `docs/handoffs/R2_IMPLEMENTATION_EXECUTION_ORDER_2026-09-25_FA.md`.
This is the canonical execution order when older roadmap wording conflicts: complete R2-A through R2-E first, then P1-FIX, then R3 exact-commit whole-product Windows acceptance, and only after all gates PASS produce the user-test Setup.exe. The installer is the final validated output, not the next development step.

**Then read:** `docs/contracts/AI_SESSION_BOOTSTRAP_CONTINUITY_V1_FA.md`.
This contract defines the product-level solution for ChatGPT context exhaustion: Chat is an ephemeral client, while Agent/Bridge must persist work-session state and expose a self-describing machine-readable bootstrap so a new AI chat learns the correct command protocol, route policy, artifact/file transfer rules, Git/GitHub capability, resumable jobs, evidence refs and exact continuation state without the user teaching it again.

**Then read:** `docs/contracts/AI_SESSION_ENFORCEMENT_GATE_V1_FA.md`.
This is not advisory documentation. It defines the mandatory fail-closed execution gate: before bootstrap/compatibility/session state is valid, only discovery/recovery actions are allowed. Mutating/executable commands must be blocked before Native Host/Agent forwarding. Route, schema, capability, artifact/file, workspace, Git/GitHub, correlation and duplicate/idempotency checks are enforced by Bridge/compiler; AI memory or voluntary compliance is never the reliability boundary.

Then read `docs/handoffs/CURRENT_DEVELOPMENT_HANDOFF_FA.md` for historical implementation checkpoints and detailed prior evidence. D0 through P6, R0 Whole-product Integration, and the R1 source-freeze work are implemented as development checkpoints; no Windows exact-RC/live acceptance is claimed. RC1 is superseded. RC2 added Windows portability corrections, but later checkpoints and the current roadmap supersede stale next-action wording in older handoffs. Always verify current branch/HEAD, CI and live versions before acting.

- Canonical development branch: `dev/bootstrap-v2.5`. Treat the checked-out repository HEAD as the durable source; verify it with Git before any sync/reset/clean and never rely on a hard-coded SHA in this file.
- SoknaCafe remains a separate Reference Workload. Do not introduce project-specific dependencies into SOKNA Bridge Core.
- Read `docs/handoffs/FAST_WORK_ROUTE_AND_EXT3105_HANDOFF_FA.md` for the permanent Bridge/GitHub routing history, but prefer the current roadmap where newer decisions conflict with older wording.
- SOKNA Bridge is the Chat agent's access plane to the user PC. Do not ask the user to restate the Bridge architecture in every new chat.
- Development is workspace-first and batch-first. Read/patch/test/package off the user PC. GitHub is a milestone/CI boundary, not a scratchpad.
- The normal executable path is now semantic-only: AI emits semantic intent, the deterministic compiler builds the unified versioned command envelope, and Extension/Bridge validates it fail-closed. V2/B64/V3/V4 command carriers and `tools/sokna_carrier_guard.py` are retired from the active runtime and must not be reintroduced.
- Read `docs/AI_AGENT_OPERATING_CONTRACT_V2.md`, `docs/AI_AGENT_COMMAND_PREFLIGHT_V1.md`, and `docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md` before Bridge execution while they remain active contracts.
- Result-First applies between outer commands, not steps inside one bounded batch/plan. For 2+ deterministic bounded steps prefer one batch; long work uses durable jobs; bulky bytes use Artifact Plane.
- Before non-basic actions, probe live `ping` + `agent.capabilities`; never guess runtime version, action name, schema or transport.
- Any correlated invalid command must become a machine-readable NACK; fail-silent paths are defects, not acceptable behavior.
- Chat should receive only concise started/final/failure status. Detailed step/job/process state belongs in the planned Activity Monitor backed by Agent event data.
- Browser/UI inspection target is controlled autonomous inspection (navigate/click/capture evidence), not live screen sharing. Browser evidence must use Result/Artifact planes and should not require the user to relay screenshots manually.
- Chat exhaustion is a normal operating condition: the target architecture is `bridge.bootstrap + persistent work_session + session.resume`; docs are bootstrap/fallback during migration, not the final source of operational memory.
- A new AI chat must not rely on remembered rules for carrier format, file size routing, batch/job choice, Artifact Plane, or Git/GitHub use. Those must be advertised/enforced by Bridge/compiler policy.
- Enforcement target is fail-closed: until bootstrap/session handshake is `ready`, mutation/execution forwarding is forbidden; wrong route/schema/capability/artifact usage must return a machine-readable rejection with `executed=false`.
- Preserve unknown untracked files. Acceptance endpoints are evidence/activation targets, not development workspaces.
- No release/live claim without exact Windows evidence.

## Current critical continuation
Read the current roadmap plus the canonical R2 execution-order handoff. Complete R2-A through R2-E first; then fix and prove P1 Windows lifecycle; then R3 whole-product exact-commit Windows acceptance; only after those gates PASS may a user-test Setup.exe be produced and handed over.
