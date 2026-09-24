# Development Baseline Report — 2026-09-24

Source snapshot: user-supplied `CURRENT_SOURCE/SOKNA-Bridge-dev-bootstrap-v2.5`
Recorded canonical origin state: branch `dev/bootstrap-v2.5`, HEAD `402eae1b23df7bb7e829ff8e3656c816fb6a4442`.
Accepted product baseline preserved: Agent 2.5.7 R4 + Extension 3.10.5.
Home PC was not contacted or upgraded.

## Baseline integrity
- `.ci/R4.zip` SHA-256 = `60d334712b61308a4153915b5de81357471d6f863955735ab0677ac1e3aeafd1` and matches `.ci/R4.sha256`.
- Extension manifest = 3.10.5.
- Agent capability manifest = 2.5.7.

## Baseline tests before new mutation
PASS:
- `native/agent`: `go test ./...`
- `native/legacy/v2.5`: `go test ./...`
- `node tools/tests/test_agent_job_core.mjs` => 6 tests PASS.
- `node tools/tests/test_transport_v3105.mjs` => `TRANSPORT_V3105_REGRESSION_PASS`.
- `python tools/tests/test_autonomy_bootstrap.py` => `AUTONOMY_BOOTSTRAP_CONTRACTS_PASS`.

Development environment limitation: PowerShell/pwsh is not installed in this Linux workspace. Windows-specific tests must remain authored but unclaimed until the independent Windows CI gate.

## Gap matrix

| Phase | Existing evidence | State at D0 | Executable gap |
|---|---|---|---|
| P0-A contracts | Control/Result/Artifact contracts, execution policies, handoffs | Done | preserve/regress |
| P0-B artifact inspect/apply | Agent 2.5.7 inspect/apply, hash/manifest/zip safety/audit | Done/accepted baseline | preserve behavior |
| P0-C ArtifactRoot | 2.5.7 only had simple root + Downloads fallback + external staging/log paths | Dev implemented | Windows runtime gate deferred |
| P1 Installer/Maintenance | historical PowerShell bootstrap + 2.5.7 release lifecycle helpers | Dev implemented | .NET/Inno/Windows execution gate deferred; no live claim |
| P2 Workspace/Permissions | workspace map, expected repo, write_enabled, safe path | Dev implemented | Windows PowerShell gate deferred |
| P3 Browser/Visual QA | architecture/selector references only | Dev implemented | Windows controlled-browser acceptance deferred; local container Chromium was unsuitable for live HTTP acceptance |
| P4 Providers | provider contract/policy + local artifact concepts | Dev implemented | Windows provider integration gate authored; whole-product Windows gate deferred |
| P5 Advanced Workspace | Ephemeral/Remote + job grants + remote adapter boundary | Dev implemented | Windows advanced-workspace acceptance authored; whole-product gate deferred |
| P6 Component/Automation | job engine foundation and process actions | Dev implemented | Windows component/automation acceptance authored; exact-RC gate deferred |
| R0/R1 | historical per-feature validation only | R0 complete; R1 freeze prepared | exact source candidate must pass full Windows CI |
| CI/LIVE | Windows workflows exist for accepted baseline | Later gate | exact-RC Windows gate, then consolidated real-PC acceptance |

## D0 conclusion
The repository is healthy enough to continue from P0-C without rediscovery. No reason exists to touch the user PC until whole-product RC/CI as defined in the master handoff.
