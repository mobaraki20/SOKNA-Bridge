# Agent 2.5.7 Local Validation â€” 2026-09-23

Status: LIVE ACCEPTED / WINDOWS R4 PASS

## Why 2.5.7 exists

Agent 2.5.6 source was committed at `06d901a` but intentionally was not activated. Review of the 2.5.6 artifact runtime and the failed activation attempts exposed additional gaps. 2.5.7 is the hardened candidate built before any further live mutation.

## Failures converted into contract rules

- carrier >800 bytes -> safe decoded command budget defaults to <=600 bytes.
- malformed JSON/carrier -> commands must be programmatically generated/validated; code does not travel inline.
- invalid PowerShell alias (`gfh`) -> aliases forbidden in release scripts.
- nested cmd/PowerShell quoting failure -> lifecycle logic must be file-based inside the artifact.
- corrupt inline activation helper -> helper must be hashed, parsed and shipped as a file.
- runtime path/PID/parent discovery after apply -> lifecycle metadata and stable launcher are required before activation.
- too-small artifact boundary -> artifact must contain deploy + activation + rollback + acceptance + handoff, not only source patch.
- repeated remote trial/error -> two-strike remote rule.

## 2.5.7 hardening beyond 2.5.6

- expected package SHA is mandatory for `artifact.apply`.
- target workspace/branch/base are mandatory for apply.
- manifest file list must exactly equal files touched by patch.
- handoff + hash mandatory for apply.
- ZIP entry count/unpacked size/entry size/suspicious compression ratio limits.
- traversal/colon/control-character/reparse-point protections.
- audit `prepared` must succeed before mutation.
- audit finalization failure attempts reverse-apply rollback.
- activation payload and backup hashes are reverified immediately before stopping live Agent.
- stable `Agent-Launcher.ps1` + persistent `runtime-state.json` recover interrupted activation on next startup.
- activation failure before mutation aborts without unnecessary rollback.
- activation failure after mutation restores hash-verified backup and health-checks old runtime.
- acceptance probe performs first-class `artifact.inspect`, `artifact.apply`, reverse cleanup, audit verification and tracked-clean verification.

## Local test rounds

### Round 1
21 / 21 PASS.
Covered artifact trust failures, apply/reverse, dirty tracked tree, untracked preservation, ZIP traversal/bomb/entry-count, handoff, command budget, alias lint, script balance, rollback/acceptance/finalize invariants.

### Round 2
21 / 21 PASS after adding stage-hash revalidation and pre-mutation rollback guard.

### Round 3
27 / 27 PASS after stable launcher/interrupted-activation recovery and bootstrap-budget tests were added.

## Important limitation of local environment

The assistant build workspace is not Windows and does not contain Windows PowerShell. Therefore local validation includes reference-model behavior tests, Git tests, archive/security tests, static PowerShell balance/lint, hash/integrity tests and state-machine recovery tests, but not the Microsoft PowerShell parser/runtime itself.

For that reason the first Windows step is a fail-closed preflight: every package `.ps1` is parsed by `System.Management.Automation.Language.Parser`, all package hashes are checked, current Agent 2.5.5 ping/capabilities are checked, PID ownership is checked and recovery/update directories are write-tested. Activation is forbidden if this preflight fails.

## Windows acceptance required before release acceptance

1. package ZIP hash PASS;
2. package PowerShell parser PASS;
3. current 2.5.5 live health PASS;
4. stage hashes and backup hashes PASS;
5. activation to 2.5.7 health + capabilities PASS or automatic rollback to 2.5.5;
6. artifact inspect/apply/reverse probe PASS;
7. artifact audit events PASS;
8. tracked repo clean after probe;
9. exact source/docs release commit and push;
10. final handoff retained.

Until those Windows gates pass, 2.5.7 is a candidate, not an accepted live runtime.


## R2 correction after first Windows preflight

The first Windows preflight correctly failed closed with `PREFLIGHT_CURRENT_HEALTH: The operation has timed out`. Root cause was not Agent 2.5.5 health: the preflight was launched *by* Agent 2.5.5 through `process.run`, then synchronously called the same Agent HTTP API. The live Agent was waiting for the child process to finish, creating a self-call/re-entrancy deadlock.

R2 changes:
- Preflight has explicit `AgentMediated` vs `External` invocation modes.
- Stage always uses `AgentMediated`.
- Agent-mediated preflight verifies control-plane invocation context, live PID ownership, runtime version on disk, capability version on disk, config and recovery writability; it does not make HTTP calls to the blocked Agent.
- External mode retains HTTP ping + capabilities.
- Detached activation helper still performs HTTP health against the restarted target runtime.
- execution contract/policy now forbids synchronous self-calls into the blocked current Agent.

### R2 local round 4
30 / 30 PASS including explicit self-call/re-entrancy guards, AgentMediated mode selection and policy enforcement.

### R2 local round 5
31 / 31 PASS after enforcing Master Handoff installation and READ_FIRST linkage in repo finalization.


## R3 hardening after real Windows R2 rollback
- Added `-StartupProbe` target mode.
- Added Windows startup probe gate before live mutation.
- Added launcher stdout/stderr/exit-code persistence.
- Added activation health-failure diagnostics.
- R2 rollback evidence confirmed automatic recovery to 2.5.5.


## R3 Windows activation evidence
- R3 external ZIP hash: PASS.
- AgentMediated Windows preflight: PASS.
- Windows `StartupProbe`: PASS.
- Activation still failed health and auto-rollback restored 2.5.5 successfully.
- Read-only forensic collection showed target runtime logs were absent.
- The root cause was reproduced exactly in an isolated Windows sandbox: `Agent-Launcher.ps1` attempted to assign `active_version` to a `PSCustomObject` whose schema did not contain that property, producing `ExceptionWhenSetting` before target runtime launch.

## R4 final local validation
- R4 scope is deliberately narrow: lifecycle state-schema fix only; no new runtime feature or extra activation layer.
- `active_version`, `recovered_at`, and `accepted_at` are predeclared before later lifecycle mutation.
- Dedicated `State-Schema-Regression257.ps1` ships in the release and mirrors into the repo overlay.
- Final release verifier: PASS on frozen bytes.
- Independent contract/model suite: 48/48 PASS on frozen bytes.
- Negative mutation verifier tests: 5/5 PASS (payload hash corruption, undeclared file, missing startup probe, launcher mutation, policy mutation all rejected).
- Frozen release contains 35 manifest-declared files and 22 PowerShell files; bootstrap control command reference remains 535 bytes.
- Windows R4 state-schema regression, activation, and live acceptance: PASS.



## R4 state-schema regression fix
R3 Windows activation root cause was reproduced exactly: Agent-Launcher attempted to assign `active_version` and `recovered_at` onto a PSCustomObject that did not contain those properties, causing `ExceptionWhenSetting` before the target runtime was launched. A second same-family latent issue was found in acceptance for `accepted_at`. R4 changes only the lifecycle state schema: mutable lifecycle fields are predeclared before launcher/acceptance mutation. No new runtime feature or extra activation layer was added.
