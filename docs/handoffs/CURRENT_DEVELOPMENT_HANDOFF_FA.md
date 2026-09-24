# CURRENT DEVELOPMENT HANDOFF — 2026-09-24

## مرجع
این handoff ادامه‌ی `SOKNA_AGENT_NEW_CHAT_MASTER_HANDOFF_2026-09-24` است. تصمیم نهایی پابرجاست: توسعه تا whole-product RC خارج از PC کاربر؛ Windows/live فقط gate نهایی.

## baseline پذیرفته‌شده
- canonical recorded repo: `dev/bootstrap-v2.5` @ `402eae1b23df7bb7e829ff8e3656c816fb6a4442`.
- accepted Agent: 2.5.7 R4.
- accepted Extension: 3.10.5.
- 2.5.6 برای activation ممنوع.
- SoknaCafe STRICT READ-ONLY.

## Development checkpoints completed
> Timeline note: lines inside older phase checkpoints saying "user PC untouched" describe the state when those checkpoints were created. They are superseded by the 2026-09-24 pre-CI endpoint incident section below; Bridge baseline alignment and a temporary uncommitted RC overlay later occurred, but Agent 2.6.0 was never installed/activated and nothing was pushed.

### D0 + P0-C ArtifactRoot
- managed ArtifactRoot core + runtime 2.6.0 source-only.
- quota/retention/import/audit/cleanup/path safety.
- P0-C local/native contracts PASS؛ Windows PowerShell gate deferred.

### P1 Universal Installer & Maintenance
- Inno Setup source owner: `installer/windows/SOKNA.Agent.iss`.
- reproducible build source: `tools/installer/Build-P1Installer.ps1`.
- self-contained .NET 8 Maintenance source: preflight/status/health/start/stop/diagnostics/support-bundle/Repair/runtime Upgrade/rollback/config migration.
- stable self-contained .NET launcher with PID/path/hash ownership evidence.
- ArtifactRoot picker + strict separation from InstallRoot.
- legacy config copy migration; legacy source preserved.
- native-host canonical install locator + legacy config fallback.
- manifest file ownership split: runtime=`maintenance`; lifecycle/extension/native-host=`installer` so running lifecycle executables are never self-overwritten.
- Setup-owned change/corruption requires exact Setup rather than unsafe in-process replacement.
- support bundle minimum files + secret redaction.
- Windows workflow contains P1 source checks, full-profile .NET/Inno build, and clean-system lifecycle acceptance (install/repair/add-remove upgrade/manual rollback/failed-upgrade automatic rollback/support-bundle redaction/uninstall).
- P1 hardening: root-level reparse rejection, process start-time ownership correlation, corruption-safe stop vs strict health integrity, removed-runtime-file cleanup/restore, transaction stage evidence, bounded health retry, and dirty-source build rejection.

## Evidence currently executed locally
PASS:
- native agent Go suite.
- legacy v2.5 Go suite.
- native host Go suite including config locator migration tests.
- job core Node tests.
- transport 3.10.5 regression.
- autonomy-bootstrap contracts.
- ArtifactRoot P0-C source contracts.
- P1 installer/maintenance source contracts.
- P2 workspace/permission source contracts.
- P3 browser/visual QA source contracts + native browser Go tests + Windows cross-build.
- P4 artifact-provider source contracts + native provider Go tests/vet/CLI probe.
- P5 advanced-workspace source contracts + native agent grant/ephemeral/remote tests + Windows cross-build.
- workflow YAML parse.

Current Linux development environment has no PowerShell, .NET SDK or Inno compiler. C# publish/Inno compile/Windows runtime tests are therefore **not** claimed locally; they are intentionally wired for later Windows full-profile/exact-RC CI.

## Activation status
- home PC untouched؛ no Bridge command issued.
- no GitHub push.
- 2.5.7 R4 / Extension 3.10.5 remain accepted baseline.
- 2.6.0 + P1/P2/P3/P4/P5 are development source only.

## Phase status
- D0: Done.
- P0-C: development implementation complete; Windows gate deferred.
- P1: development source implementation complete; Windows build/install gate deferred.
- P2: development source implementation complete; Windows PowerShell gate deferred.
- P3: development source implementation complete; Windows controlled-browser gate deferred.
- P4: development source implementation complete; Windows provider gate authored/deferred.
- P5: development source implementation complete; Windows advanced-workspace gate authored/deferred.
- P6: development source implementation complete; Windows component/automation gate authored/deferred.
- R0: development whole-product integration complete; Windows exact-RC gate deferred.
- R1: exact source Release Candidate freeze implemented; concrete commit is bound by the generated RC manifest/tag after the clean checkpoint commit.
- CI: **Exact Next Action — exact-RC Windows full-profile validation**.
- LIVE: only after CI PASS.

## P2 completion checkpoint — Workspace & Permission Manager
- Persistent Local/register-in-place registry implemented without Git prerequisite.
- explicit Read/Write/Deny scopes with deny precedence and traversal/reparse fail-closed.
- per-workspace tool allowlist; broad process/Git execution requires full-root access + explicit tool permission.
- register/list/inspect/update/unregister, assessment, non-destructive managed-copy plan implemented.
- legacy config.workspaces migration preserves source; write_enabled=false becomes read-only; tools require explicit review.
- runtime file enumeration/search/write paths are policy-aware.
- native Go negative tests + source contract + Windows path/reparse matrix authored.
- user PC untouched; no runtime activation and no GitHub push.

## P3 completion checkpoint — Browser / Screenshot / Visual QA
- native Go controlled-browser runner implemented on Chromium DevTools Protocol without mandatory npm/Playwright dependency.
- explicit viewport matrix + goto/wait/click/type/select actions.
- viewport/full-page/element screenshots, DOM, geometry/layout, accessibility, console and network evidence.
- PASS/FAIL assertions carry evidence artifact IDs with page-metadata fallback.
- visual baseline/current/diff with changed ratio + dimension mismatch; baseline is immutable.
- browser runs and baselines are Workspace-owned; cross-workspace promote/consume fails closed before run creation.
- sensitive query/console patterns and `value_env` secrets are redacted from persisted text evidence.
- all browser evidence is ArtifactRoot-backed, hash/size verified, registered and audited; run quota and reparse/symlink boundaries are fail-closed.
- live browser capture remains intentionally disabled; explicit consent-per-session policy is exposed and hidden capture/credential extraction are forbidden.
- Agent 2.6.0 capabilities, installer payload build and Windows full-profile browser acceptance are wired.
- native Go/source tests pass locally; Windows browser execution is authored but not claimed in this Linux environment.
- local container Chromium was unsuitable for live HTTP acceptance, so no Linux browser PASS is claimed.
- user PC untouched; no runtime activation and no GitHub push.

## P4 completion checkpoint — Artifact Providers / Auto-download
- native dependency-light provider runner with a common probe/acquire/verify interface.
- Local File migrated to provider path; Managed Folder/LAN is configured-root + relative-path only.
- HTTPS direct, GitHub Release Assets and object-storage HTTPS adapters implemented without provider SDK dependency.
- Google Drive/OneDrive remain explicit external plugin/presigned URL boundaries; Core owns no OAuth lifecycle.
- remote acquire requires expected SHA-256; all accepted artifacts are re-hashed before registration.
- optional Ed25519-over-SHA256 signature verification; `required=true` fails closed.
- stable ArtifactRoot staging partial, Range resume, bounded retry/backoff/timeout and atomic incoming finalize.
- root remaining quota participates in effective download limit; resumable partial bytes are credited.
- raw credential-bearing URL/userinfo rejected; signed URL only through `url_env`; persisted refs remove query/fragment.
- `credential_env` passes only env-name; credential value is never persisted and cross-origin redirect drops Authorization.
- runner error text redacts URL queries, sensitive query key values and Bearer material.
- transport interruption keeps resumable partial; hash/signature mismatch removes poisoned partial.
- metadata/audit retain provider, redacted source reference, workspace/job correlation, retry/resume/signature state and `auto_execute=false`.
- Agent 2.6.0 advertises provider status/probe/acquire/verify; old `artifact.import.local` is a compatibility wrapper over `local_file` provider.
- installer builds provider binary; Windows provider acceptance + deterministic native retry/resume tests are wired.
- local native/provider tests + source contracts pass; Windows execution remains authored but unclaimed in this Linux environment.
- user PC untouched; no runtime activation and no GitHub push.

## P5 completion checkpoint — Advanced Workspaces / Permissions
- `ephemeral_checkout` workspace kind with owner-job binding, bounded TTL and managed-state-only cleanup.
- runtime checkout path uses local Git clone into `state/ephemeral/<job>/<workspace>`; source workspace is not mutated by checkout creation.
- temporary grant registry `sokna-workspace-grants-v1` with workspace/job binding, issuer/context, scopes/tools, expiry and fail-closed revoke.
- effective permissions are enforced as `Workspace Policy ∩ Active Job Grant`; base Deny/reparse/traversal boundaries always win and tool grants cannot expand base policy.
- grant context propagates through `job.submit` -> detached worker -> `plan.run` -> nested steps; legacy jobs without grant remain base-policy compatible pending R0/R1 review.
- Remote Workspace is metadata/policy only; Core has no SSH/WinRM/cloud protocol dependency.
- remote execution crosses only the external adapter boundary `runtime/adapters/<adapter>/adapter.exe` using `sokna-remote-workspace-request-v1`; endpoint/credential values remain opaque refs and credential-bearing refs are rejected.
- remote execution requires base `remote.exec` + grant `remote.exec` + allowed path in both policies; adapter path escape/reparse and remote traversal fail closed.
- advanced cleanup removes expired/revoked/orphan grants and expired/orphan ephemeral workspaces; cleanup may delete only managed ephemeral roots.
- registry/policy status now exposes workspace kinds, grant registry, ephemeral root and remote adapter boundary for future UI without changing security semantics.
- P4 manifest regression was corrected to treat checkpoint hashes as archival evidence while continuing semantic P4 checks against the evolving current tree.
- deterministic local Go/source tests pass; Windows P5 acceptance is authored but not claimed in this Linux environment.
- user PC untouched; no runtime activation and no GitHub push.

## P6 completion checkpoint — Advanced Automation / Component Lifecycle
- first-class component registry with identity/version/type/install owner/state/health/dependency/release-channel/LKG metadata.
- process ownership requires PID + process start time + executable + managed sidecar token; stale/foreign ownership fails closed.
- service ownership is correlated to the managed active release path; foreign service/process stop is forbidden.
- dependency acquisition crosses only Artifact Provider + verified ArtifactRoot; dependency acquisition never implies activation/auto-execute.
- release transaction is stage -> verify -> activate -> bounded health -> commit; failed health automatically restores prior active/LKG release where possible.
- component remove deletes only managed component roots and explicitly preserves workspace/user data.
- persistent interval/trigger automation has dedupe, missed-run policy, bounded concurrency, pending-claim recovery and audit.
- automation stores a non-escalating grant template only; each run creates a fresh job-bound P5 grant, then revokes it on completion.
- scheduler worker is parent-bound and uses PID/start-time/script-hash ownership evidence; submission failure restores the claim rather than consuming a retryable run.
- native lifecycle/policy tests + P6 source contract pass locally; Windows component/automation acceptance is authored but not claimed in this Linux environment.
- user PC untouched; no runtime activation and no GitHub push.

## R0 completion checkpoint — Whole-product Integration
- one-command local regression runs P0-C through P6 source contracts, transport/job tests, all five Go modules and `go vet`.
- runtime import/initialization dependency graph and installed Browser/Provider runner layout are cross-checked against the installer payload.
- Maintenance whole-product health now probes ArtifactRoot, Workspace registry, Browser runner, Artifact Provider runner and Component/Automation registry in addition to ping/capabilities/PID/version.
- support bundle now includes redacted known Workspace/Grant/Component/Automation state, component transactions and runtime audits plus ArtifactRoot audit, while excluding jobs, artifacts and component payloads.
- Windows installer acceptance requires the stronger whole-product health and verifies key state files are present in the redacted support bundle.
- P5 source regression was decoupled from an obsolete current-roadmap sentence; P5 security semantics remain tested.
- local R0 regression PASS; .NET publish/Inno/PowerShell Windows execution remain unclaimed until exact-RC Windows CI.
- user PC untouched; no runtime activation and no GitHub push.

## R1 completion checkpoint — Release Candidate Freeze
- deterministic source-RC builder reads tracked blobs directly from the exact Git commit; dirty source and non-HEAD candidate builds fail closed.
- ZIP entry order/timestamps/modes are canonicalized and every tracked file path/mode/blob/SHA-256 is embedded in the generated source manifest.
- pre-freeze determinism check produced byte-identical bundles twice; the same check must be repeated after the clean R1 commit and tag are created.
- installer build accepts `ExpectedSourceCommit` and refuses a different checkout.
- Windows full workflow requires `expected_commit`, verifies clean exact checkout, builds the deterministic source bundle, then builds/tests Setup from the same commit.
- post-acceptance evidence binds source bundle/manifest, Setup, installed payload manifest, Browser runner and Artifact Provider runner hashes to that commit; evidence is uploaded as one CI artifact.
- P5/R1 permission review resolved: direct jobs without a grant remain limited by explicit base Workspace Policy; automated/remote attenuated execution uses job-scoped grants, and grants never elevate base policy.
- accepted live baseline remains Agent 2.5.7 R4 + Extension 3.10.5; Agent 2.6.0 is only an RC candidate until CI PASS.
- no local .NET/Inno/Windows PowerShell PASS is claimed; user PC untouched and no GitHub push yet.

## 2026-09-24 pre-CI endpoint incident / correction
- Home Bridge baseline was manually aligned to accepted Agent 2.5.7 R4 + Extension 3.10.5 for access only.
- Canonical repo remained at `402eae1...`; an RC overlay was temporarily applied without commit/push.
- Windows revealed: (1) implicit Python `Path.read_text()` locale decoding broke UTF-8/Persian contract text; (2) Windows PowerShell 5.1 parser rejected a compact component expression.
- Two direct source edits were made on the endpoint before the process violation was recognized. This violated the existing workspace-first / acceptance-endpoint-no-dev-toolchain rule. No commit/push/runtime 2.6 activation occurred.
- Corrective rule: endpoint failures are evidence only; reproduce/fix/package in development workspace, then return to endpoint solely for integrity/publish/CI handoff/final acceptance.
- Carrier generation must use `tools/sokna_carrier_guard.py` with round-trip/budget validation; hand-built carriers are forbidden.
- KB updated: `KB-CTRL-003`, `KB-PC-002`, `KB-CI-003`, `KB-PS-003`.

## Remaining roadmap after R1
Two gates remain: `CI -> LIVE`.

## Exact Next Action — CI exact-RC Windows Gate
1. push only the clean RC2 checkpoint/tag as the meaningful validated candidate; RC1 is superseded and must not be pushed; no scratch pushes.
2. dispatch `windows-agent-validation.yml` with `profile=full`, a correlation `request_id`, and `expected_commit` equal to the frozen RC2 commit.
3. require all P0-C..P6/R0/R1 source contracts, Windows runtime acceptances, .NET/Inno build, whole-product install/repair/upgrade/rollback/uninstall, Browser/Provider/Workspace/Component/Automation gates to PASS.
4. collect the uploaded exact-RC evidence and verify its `source_commit` and hashes before any LIVE action.
5. only after CI PASS may the consolidated real-PC activation/acceptance gate begin; until then no Bridge/home-PC upgrade command is allowed.

## Bridge-session anti-regression checkpoint — 2026-09-24
- User explicitly required fewer Bridge round trips and no repeated reminders. This is now a canonical execution rule, not a conversational preference.
- Mandatory new document: `docs/BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md`. `00_READ_FIRST_NEW_CHAT.md` points to it.
- Correct interpretation: Result-First serializes **outer commands**; it does NOT require one deterministic step per chat turn. For 2+ bounded deterministic steps, default to one `job.batch` (Agent 2.5.7 supports up to 30 steps). Multi-step mutations default to `plan.run`/`job.submit`; bulk bytes use Artifact Plane; large outputs use `result.get`.
- Every executable carrier MUST be produced by `tools/sokna_carrier_guard.py` using the live Extension version. Manual Base64/carrier construction or editing is forbidden.
- New KB entries: `KB-CTRL-004` (batch-first vs Result-First) and `KB-HANDOFF-001` (mandatory per-session Bridge execution gate). R0 regression now includes `test_bridge_session_execution_gate.py`.
- Home Bridge baseline has been manually aligned and observed healthy: Agent 2.5.7 R4 + Extension 3.10.5.
- Endpoint history: temporary RC1 overlay/source fixes were removed from the active tracked tree and preserved in stash evidence; baseline re-check showed Extension 3.10.5, HEAD `402eae1`, tracked diff empty.
- Then `SOKNA-RC2-to-canonical-402e-bridge-artifact.zip` was inspected and `artifact.apply` returned `applied=true`. The user stopped immediately afterward; **no post-apply repo status, commit, push, CI dispatch, Agent 2.6 install or activation has occurred yet**. Unknown pre-existing untracked files remain intentionally preserved.
- Because this Bridge-session gate/KB hardening is being added after RC2, do not treat RC2 as the final publish candidate until the new development checkpoint is frozen and a complete replacement artifact is built off-PC. Do not patch the endpoint to add these docs.

## RC3 exact-RC Windows CI result / RC4 correction — 2026-09-24
- RC3 canonical commit `e394eda68eec13b4fdf07856c06a2c973b7f44b0` and tag `sokna-agent-2.6.0-rc3` were pushed. Windows CI run `35946302187` used that exact head SHA.
- Steps through Native Browser QA passed. The first and only failure was `Native artifact provider tests`; all later Windows acceptance/build steps were skipped by fail-fast.
- Failure evidence: ordinary Windows temp paths containing the valid 8.3 alias `RUNNER~1` were rejected as reparse/symlink. Root cause is textual comparison of `filepath.EvalSymlinks` output versus input path, not an actual reparse point.
- Fix is development-workspace-only: walk every existing ancestor with `os.Lstat` and reject actual symlink/irregular reparse metadata; do not use canonicalized path-string inequality as a security signal. Added ordinary-temp-path and symlink-parent tests.
- RC3 is superseded. RC4 is the next exact candidate. Home PC remains publish/access only; Agent 2.6.0 is not installed/activated there.
- Next action: freeze RC4 off-PC, build/simulate a canonical delta from pushed RC3 commit `e394eda...`, transfer as one artifact, then use batch-first publish + exact-commit Windows CI.
