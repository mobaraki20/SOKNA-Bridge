# CURRENT AGENT HANDOFF — 2.5.7 Candidate

Date: 2026-09-23
Scope: SOKNA Agent / SOKNA-Bridge only.

## Mandatory first reads in a new chat

1. `docs/contracts/AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md`
2. `docs/contracts/AGENT_CHANGE_EXECUTION_POLICY_V1.json`
3. this handoff
4. `docs/status/AGENT_257_LOCAL_VALIDATION.md`

Do not restart discovery from chat history if these files are available.

## Project boundary

SOKNA Agent is universal/project-agnostic. SoknaCafe is independent and is only a reference workload. Cafe must never become a dependency, default workspace, installer target or permission assumption of Agent.

## Repository state before 2.5.7 rollout

Repository: `mobaraki20/SOKNA-Bridge`
Branch: `dev/bootstrap-v2.5`
Known source checkpoint before this candidate: `06d901a` (`agent: add local artifact runtime v2.5.6`)

Important earlier commits:
- `27b78f5` — universal architecture + Fast Work Path Pilot docs
- `06d901a` — Agent 2.5.6 artifact runtime source

## Live state before rollout

- Live Agent: 2.5.5
- Live Extension: 3.10.3
- Agent 2.5.6 is source-only, NOT accepted live.
- 2.5.7 is the next candidate; skip activating 2.5.6.

## Current safe machine state from previous attempt

- live `agent.ps1` was never switched away from 2.5.5.
- 2.5.6 `.next` files were staged and hash-verified but not activated.
- 2.5.5 backup files were created and should be retained until 2.5.7 acceptance.
- a generated helper `a256.ps1` is corrupt and MUST NOT be executed. The 2.5.7 completion flow removes only this known helper and known `.next` files after acceptance.

## Untracked repo paths to preserve

Do not delete blindly:
- `extension/README_APPLY.txt`
- `extension/chrome/.guard-harness.html`
- `extension/chrome/Test/`
- `extension/docs/`
- `extension/tools/`
- `installer/bootstrap/.parts/`
- `installer/bootstrap/prereqs.ps1`
- `tools/plans/`

## Fixed execution contract

The 2026-09-23 trial/error incident is now formalized in `AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md`.
Critical rules include:
- full canonical source before non-trivial work;
- user machine is acceptance environment, not development environment;
- complete artifact must contain deployment/rollback/acceptance/handoff;
- Control Plane command JSON target <=600 bytes;
- no inline lifecycle scripts/base64 payloads;
- no release-script PowerShell aliases;
- two-strike remote rule;
- expected SHA mandatory for apply;
- exact manifest file list;
- mandatory audit;
- stable launcher + persistent activation state;
- exact staging and complete handoff.

## 2.5.7 candidate contents

Runtime:
- `native/runtime/v2.5.7/agent.ps1`
- `native/runtime/v2.5.7/AGENT_CAPABILITIES.json`

Release lifecycle:
- `Preflight-AgentRuntime257.ps1`
- `Stage-AgentRuntime257.ps1`
- `Activate-AgentRuntime.ps1`
- `Agent-Launcher.ps1`
- `Rollback-AgentRuntime.ps1`
- `Acceptance-AgentRuntime257.ps1`
- `Finalize-RepoUpdate257.ps1`
- `Complete-AgentRuntime257.ps1`

Key 2.5.7 changes:
- artifact.apply requires expected SHA;
- stronger ZIP/path/size protections;
- declared patch file equality;
- mandatory handoff for apply;
- mandatory pre-mutation audit and rollback on audit-finalization failure;
- stable launcher for interrupted activation recovery;
- runtime-state ownership metadata;
- real acceptance apply/reverse probe and audit verification.

## Local validation evidence

- Round 1: 21/21 PASS
- Round 2: 21/21 PASS
- Round 3: 27/27 PASS

Windows PowerShell parsing is intentionally deferred to the fail-closed Windows preflight because the assistant local workspace is not Windows.

## Exact next action

If rollout package has NOT yet been downloaded:
1. download the single final `SOKNA-Agent-2.5.7-R4-Release.zip` supplied by the assistant;
2. verify the externally supplied SHA-256;
3. use one short control command to verify hash, extract into the managed incoming directory, and run `Stage-AgentRuntime257.ps1`;
4. wait for Agent 2.5.7 to answer. If it does not, inspect `runtime-state.json` and `logs/runtime-activation.jsonl`; stable launcher should have rolled back to 2.5.5 when target files are incomplete.
5. if 2.5.7 responds, execute `Complete-AgentRuntime257.ps1`. It runs acceptance first; repo finalization/commit/push occurs only after acceptance PASS.
6. record actual elapsed time, round trips, failures and manual actions.

If Windows preflight fails, STOP. Do not repair commands interactively on the user machine. Return to local Workspace, fix the package, rerun local matrix, and issue a new artifact.

## Rollback

Activation creates a transaction-specific recovery directory and `activation-plan.json` with hashes. Manual rollback uses `Rollback-AgentRuntime.ps1 -PlanPath <activation-plan.json>`. It verifies backup hashes before restore and health-checks the restored version.

## ArtifactRoot requirement

Future Installer/Settings must allow the user to choose ArtifactRoot/DownloadRoot. Agent downloads must remain inside that managed root with source/path/size/hash/time/job/workspace/validation/cleanup audit. 2.5.7 still performs local import only; automatic remote download remains intentionally deferred.


## R2 Windows preflight correction

The first 2.5.7 package preflight failed closed before mutation with `PREFLIGHT_CURRENT_HEALTH` timeout. This was diagnosed locally as a self-call deadlock: preflight was executed by the current Agent through `process.run` and then synchronously called the same Agent API.

Historical note: R2 replaced the original release but is now superseded by R4; do not activate the original or R2 packages again.
R4 retains the R2 AgentMediated self-call fix and adds the mandatory Windows Startup-Probe barrier plus runtime stdout/stderr evidence.
No activation/restart occurred during the failed R1 preflight; live runtime remains 2.5.5.


## Windows R2 activation evidence / R4 hardening
- R2 preflight AgentMediated: PASS.
- transaction `rt257-1790141694403-2e4f9b9b` target health failed before acceptance.
- automatic rollback: PASS؛ active runtime returned safely to 2.5.5.
- R4 requirement: target `-StartupProbe` must PASS on Windows before live stop/switch; launcher must persist stdout/stderr/exit evidence.
- R2 is superseded for further activation attempts.


## Current authorized release
- Authorized candidate: `SOKNA-Agent-2.5.7-R4-Release.zip`.
- R1/original, R2 and R3 are superseded and must not be activated.
- Next Windows action: verify R4 SHA -> AgentMediated preflight -> StartupProbe; live stop/switch is permitted only after both gates PASS.

- R4 local validation: verifier PASS + contract/model 40/40 PASS + negative mutation 5/5 PASS. Windows R4 startup-probe/activation still pending.


## R4 state-schema regression fix
R3 Windows activation root cause was reproduced exactly: Agent-Launcher attempted to assign `active_version` and `recovered_at` onto a PSCustomObject that did not contain those properties, causing `ExceptionWhenSetting` before the target runtime was launched. A second same-family latent issue was found in acceptance for `accepted_at`. R4 changes only the lifecycle state schema: mutable lifecycle fields are predeclared before launcher/acceptance mutation. No new runtime feature or extra activation layer was added.
