# P5 Advanced Workspaces / Permissions — Development Validation

Date: 2026-09-24
Status: development source complete; Windows runtime acceptance authored/deferred; no live activation.

## Implemented
- Native policy model for temporary grants bound to workspace + job.
- Effective path/tool access = base workspace policy intersection active grant.
- Escalation, Deny bypass, stale/revoked/expired/cross-job use fail closed.
- `ephemeral_checkout` ownership metadata, managed-root restriction and orphan/expiry cleanup.
- Remote Workspace metadata with opaque adapter/endpoint/credential references and no protocol dependency in Core.
- External remote adapter boundary with audited stdin request contract and no credential-value resolution in Core.
- Runtime 2.6.0 actions: policy status, grant create/revoke, remote register/exec, ephemeral checkout, advanced cleanup.
- Job grant propagation through detached plan execution.
- richer registry/status surface for future UI.

## Local evidence executed
PASS:
- `native/agent`: `go test ./...`, `go vet ./...`.
- grant escalation / base Deny / tool expansion tests.
- expiry/revoke/cross-job tests.
- ephemeral managed-root + orphan cleanup tests.
- remote metadata/path/credential boundary tests.
- P0-C/P1/P2/P3/P4/P5 Python contracts.
- job core Node tests and Extension 3.10.5 transport regression.
- all Go modules: agent, legacy/v2.5, host, browser, provider.
- Windows amd64 cross-build: agent/browser/provider produce PE32+ x86-64 binaries.
- workflow YAML + capability JSON parse and `git diff --check`.

## Windows gate authored, not claimed
`tools/runtime/releases/2.6.0/Test-AdvancedWorkspace260.ps1` validates grant intersection, cross-job/revoke, managed ephemeral orphan cleanup, external remote adapter boundary, path escape and orphan grant recovery. This Linux environment has no Windows PowerShell, so execution PASS is intentionally not claimed.

## Compatibility note
Legacy jobs without grant continue to run against base workspace policy. Any execution carrying `job_id + grant_id` is strict intersection. Whether all future jobs become grant-required is an R0/R1 change-control decision, not silently changed in P5.

## Safety state
- home PC touched: false
- Bridge command issued: false
- GitHub pushed: false
- accepted live baseline remains Agent 2.5.7 R4 + Extension 3.10.5
- development runtime 2.6.0 remains source-only

## Exact next action
P6 — Advanced Automation / Component Lifecycle.
