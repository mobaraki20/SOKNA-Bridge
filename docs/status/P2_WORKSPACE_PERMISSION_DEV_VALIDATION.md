# P2 Workspace & Permission Manager — Development Validation

Date: 2026-09-24
Status: **Source implementation complete for development checkpoint; Windows PowerShell execution deferred and unclaimed until Windows gate.**

## Implemented
- persistent `sokna-workspace-registry-v1` state and JSONL audit;
- Persistent Local/register-in-place workspace model independent of Git;
- explicit Read/Write/Deny scopes with deny precedence;
- traversal and reparse/symlink/junction fail-closed policy;
- per-workspace tool allowlist;
- runtime integration for scope-aware file enumeration/read/write/search;
- broad process/Git execution barrier = full-root access + explicit tool permission;
- register/list/inspect/update permissions/unregister actions;
- existing-folder assessment without Git prerequisite;
- non-destructive managed-copy plan: Copy -> Verify -> Test -> Switch;
- legacy `config.workspaces` migration preserving source and mapping `write_enabled=false` to read-only;
- deterministic ID conversion for invalid legacy workspace names and preservation of legacy expected-repo hint;
- negative Go tests, source contract test and Windows 2.6.0 path/reparse matrix.

## Safety semantics
- unregister never deletes source.
- migration grants no tools automatically.
- Git/GitHub are optional adapters, not Core prerequisites.
- local-only file mutation does not require Git freshness.
- broad tool execution is deliberately unavailable for partial-scope workspaces because the external process cannot be reliably filesystem-sandboxed by the current runtime.
- registry is revalidated on inspect so persisted policy tampering fails closed.

## Local evidence
- `go test ./...` under `native/agent` covers native manager and negative matrix.
- `python tools/tests/test_p2_workspace_permissions.py` validates runtime/capability/CI integration.
- `python tools/tests/test_artifact_root_contract.py` => PASS.
- `python tools/tests/test_p1_installer_contract.py` => PASS.
- `python tools/tests/test_p2_workspace_permissions.py` => `P2_WORKSPACE_PERMISSION_CONTRACTS_PASS`.
- `python tools/tests/test_autonomy_bootstrap.py` => PASS.
- `node tools/tests/test_agent_job_core.mjs` => PASS.
- `node tools/tests/test_transport_v3105.mjs` => PASS.
- `go test ./...` in `native/agent`, `native/host`, and `native/legacy/v2.5` => PASS.
- Windows workflow YAML parse and `git diff --check` => PASS.

## Environment limitation
Current Linux development container has no Windows PowerShell. `tools/runtime/releases/2.6.0/Test-Workspace260.ps1` is wired into Windows validation but its Windows PASS is not claimed locally.

## Activation status
- home PC untouched.
- no Bridge command and no runtime activation.
- no GitHub push.
- accepted Agent 2.5.7 R4 + Extension 3.10.5 remain baseline.
- 2.6.0 remains development source.

## Exact next phase after checkpoint
P3 — Browser / Screenshot / Visual QA. Start with controlled-browser foundation and ArtifactRoot-backed evidence; no PC/live activation yet.
