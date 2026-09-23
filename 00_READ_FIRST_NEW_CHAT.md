# SOKNA Bridge - READ FIRST / New Chat
Status: MANDATORY.

- Canonical: HOME `C:\SOKNA\SOKNA-Bridge`, branch `dev/bootstrap-v2.5`. Treat the checked-out repository HEAD as the durable source; verify it with Git before any sync/reset/clean and never rely on a hard-coded SHA in this file.
- SoknaCafe remains read-only.
- Read `docs/handoffs/FAST_WORK_ROUTE_AND_EXT3105_HANDOFF_FA.md` for the permanent Bridge/GitHub routing contract and current 3.10.5 candidate continuation.
- SOKNA Bridge is the Chat agent's access plane to the user PC and authenticated GitHub operations. Do not assume direct GitHub/Windows access and do not ask the user to restate this in a new chat.
- Before non-trivial work, choose the fastest valid route: reuse an exact full-source archive already in the development workspace; otherwise acquire full canonical source once through Bridge/artifact transfer. Never reconstruct source with repeated file.read round-trips.
- Development is workspace-first and batch-first. Read/patch/test/package off the user PC. GitHub is a milestone/CI boundary, not a scratchpad: do not push each small edit; push one validated candidate at a meaningful checkpoint.
- Real PCs may lag the accepted Agent/Extension baseline. Probe the live version first and use its version-matched transport/capabilities; never treat an older PC as the canonical development baseline.
- All carriers MUST be generated and round-trip validated programmatically with `tools/sokna_carrier_guard.py` (V3 for Extension <3.10, V4 for >=3.10). Hand-assembled Base64/carriers are forbidden.
- Read `docs/AI_AGENT_OPERATING_CONTRACT_V2.md` + `docs/AI_AGENT_COMMAND_PREFLIGHT_V1.md` before any command. Use V4 + preflight; never hand-edit carriers.
- Before non-basic actions, call `agent.capabilities` advertised by `ping`; older runtimes use their version-matched manifest. Never guess action names or schemas.
- Result-first + Code-Activation barriers are mandatory.
- Accepted baseline before the current candidate: Extension 3.10.4 + Agent 2.5.5. Individual PCs may be older; probe before use.
- Preserve unknown untracked files. PowerShell shown to user must be lowercase.

## Autonomy Bootstrap checkpoint (2026-09-23)
See `docs/AUTONOMY_BOOTSTRAP_V1_FA.md`. Windows release candidates require GitHub Windows PASS before real-PC acceptance; runtime 2.5.6 remains blocked.
