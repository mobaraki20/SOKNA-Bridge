# P1 Universal Installer & Maintenance — Development Validation

Date: 2026-09-24
Status: **Source implementation complete for development checkpoint; Windows compile/install execution deferred and unclaimed.**

## Historical inventory reused as requirements only
- `installer/bootstrap/install.ps1`: token/config, native-host registration, startup/health concepts.
- `tools/runtime/releases/2.5.7/*`: preflight, stage, recovery point, detached activation, health, rollback, ownership-state concepts.
- historical bootstrap is not reused as final product installer.

## Implemented source
- Inno Setup project: `installer/windows/SOKNA.Agent.iss`.
- deterministic build pipeline: `tools/installer/Build-P1Installer.ps1`.
- .NET 8 self-contained Maintenance host under `maintenance/Sokna.Agent.Maintenance/`.
- .NET 8 self-contained stable launcher under `maintenance/Sokna.Agent.Launcher/`.
- Native Host config locator + legacy fallback in `native/host/main.go` with Go tests.
- P1 source contract test: `tools/tests/test_p1_installer_contract.py`.
- Windows CI source checks and full-profile build hook.

## Local evidence PASS
- `python tools/tests/test_p1_installer_contract.py` => `P1_INSTALLER_MAINTENANCE_CONTRACTS_PASS`.
- `go test ./...` in `native/host` => PASS, including locator/legacy/relative-override tests.
- workflow YAML parse => PASS.
- no forbidden release PowerShell aliases in P1 build script.
- project-specific dependency scan for executable P1 source => PASS.

## Environment limitations
Current development Linux container has no `dotnet`, `powershell/pwsh`, or `ISCC.exe`.
Therefore the following are authored/wired but not claimed locally:
- C# compile/publish.
- Inno compile.
- Setup.exe clean install/uninstall.
- Windows Repair/Upgrade/rollback execution.
- runtime 2.6.0 PowerShell tests.

Full-profile Windows workflow pins Inno Setup compiler package version `6.7.3` and .NET 8 for the later exact-RC gate.

## Safety status
- user PC untouched.
- no remote/GitHub push.
- accepted Agent 2.5.7 R4 + Extension 3.10.5 remain baseline.
- Agent 2.6.0 + P1 installer remain development source only.
- SoknaCafe untouched/read-only.

## Exact next phase
P2 Workspace & Permission Manager. Build register-in-place/local-only first, explicit Read/Write/Deny path scopes, tool allowlist, inspect/unregister, assessment and safe managed-copy plan. Git/GitHub remain optional adapters, not Core prerequisites. No user-PC work yet.

## P1 hardening pass — same development checkpoint
Additional source hardening completed before packaging:
- lifecycle SafePath now rejects a reparse/junction at the owned root itself, not only descendants.
- Upgrade requires the current maintenance runtime to match its installed manifest before cross-version mutation; same-version Upgrade still routes to Repair so corruption is recoverable.
- cross-version Upgrade stages all new runtime files, backs up the exact previous maintenance-owned manifest set, removes files dropped by the new version, and restores them on rollback.
- transaction evidence now records staged/stopped/switched/committed/rolled_back stages plus previous ownership state.
- health after Repair/Upgrade/Rollback uses a bounded retry window instead of a single race-prone probe.
- PID ownership now includes process start-time correlation to protect against PID reuse. Stop/Repair can still terminate an owned process when the runtime file on disk is corrupt; health remains strict on current file hash.
- build pipeline rejects dirty source by default and records exact commit; generated build paths are ignored.
- silent installer accepts `/ArtifactRoot=...`, enabling isolated clean-system CI.
- authored `tools/installer/Test-P1Windows.ps1` performs clean install, ArtifactRoot verification, support-bundle secret-leak negative check, corrupt-runtime Repair, add/remove-file Upgrade, manual rollback, injected failed Upgrade with automatic rollback, and uninstall with ArtifactRoot preservation.
- full-profile Windows workflow now calls that acceptance script after building Setup.exe.

Local evidence after hardening PASS:
- `python tools/tests/test_p1_installer_contract.py`
- `go test ./...` in `native/host`
- `go test ./...` in `native/agent`
- `go test ./...` in `native/legacy/v2.5`
- `node tools/tests/test_agent_job_core.mjs`
- `node tools/tests/test_transport_v3105.mjs`
- `python tools/tests/test_autonomy_bootstrap.py`
- `python tools/tests/test_artifact_root_contract.py`
- workflow YAML parse.

The local environment still has no PowerShell/.NET SDK/Inno compiler, so the newly authored Windows lifecycle acceptance remains **wired but unexecuted locally**. No Windows PASS is claimed until the later independent exact-RC gate.
