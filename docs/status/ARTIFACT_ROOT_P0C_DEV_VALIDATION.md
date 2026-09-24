# P0-C ArtifactRoot — Development Validation

Date: 2026-09-24
Status: **Development implementation complete; Windows CI/live not yet claimed.**

## Implemented
- native core ArtifactManager with managed root and policy.
- managed directories: incoming/staging/accepted/failed/cache/browser/logs.
- safe managed-path resolution.
- symlink/reparse fail-closed model.
- local import through staging + hash + atomic incoming transition.
- artifact metadata and append-only audit model.
- quota visibility/enforcement.
- retention cleanup with dry-run default.
- stale/interrupted staging transition cleanup.
- explicit legacy Downloads migration reporting; no automatic move/delete.
- PowerShell runtime source 2.6.0 with `artifact.root.status`, `artifact.import.local`, `artifact.cleanup` while preserving 2.5.7 as accepted baseline.
- artifact inspect/apply staging moved under managed ArtifactRoot in 2.6.0.
- Windows negative test matrix authored for junction/reparse, traversal, hash rollback, quota, retention, interrupted staging and outside-root preservation.

## Development tests executed
PASS after implementation:
- `go test ./...` in `native/agent` including ArtifactRoot negative/unit tests.
- `go test ./...` in `native/legacy/v2.5`.
- extension job-core tests.
- Extension 3.10.5 transport regression.
- autonomy-bootstrap contract test.
- `tools/tests/test_artifact_root_contract.py` => `ARTIFACT_ROOT_P0C_CONTRACTS_PASS`.

Native ArtifactRoot tests cover:
- directory creation.
- traversal rejection.
- symlink rejection and fail-closed status.
- import SHA/metadata/audit.
- hash mismatch rollback/no leaked partial.
- quota rejection.
- retention dry-run and real cleanup.
- stale interrupted staging cleanup.
- outside-root preservation.

## Not yet executed by design
`tools/runtime/releases/2.6.0/Test-ArtifactRoot260.ps1` cannot be executed in the current Linux workspace because PowerShell is absent. It is wired into Windows Agent Validation and must PASS at the later exact-RC Windows gate before any live acceptance claim.

## Activation status
- Agent 2.6.0 is **source-only development runtime**.
- It is not an accepted/live target yet.
- Agent 2.5.7 R4 remains the accepted baseline.
- Home PC remains Agent 2.5.5 / Extension 3.10.4 per handoff and is untouched.

## Next phase
P1 Universal Installer & Maintenance. Do not return to the PC; build installer/maintenance source and tests in development workspace first.
