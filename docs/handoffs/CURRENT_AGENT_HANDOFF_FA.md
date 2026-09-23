# HANDOFF COMPLETE — Universal Agent / Fast Work Path

Timestamp checkpoint: 2026-09-23 07:34 +03:30
Purpose: ادامه بدون بازسازی ذهنی در چت جدید.

## 1. Scope

این handoff فقط مربوط به SOKNA Agent / SOKNA-Bridge است.
SoknaCafe یک پروژه کاملاً مستقل است و فقط به‌عنوان Reference Workload به صورت read-only بررسی شد. هیچ dependency یا hard-code از Cafe نباید وارد Agent شود.

## 2. Canonical Repository State Before This Pilot

Repository: mobaraki20/SOKNA-Bridge
Branch: dev/bootstrap-v2.5
Last verified HEAD/origin before Pilot package: dee3554fb0fe069ae842d71c6def8bdfa3f6fec0

Important commits:
- 5234c3f — bridge: speed up guarded agent workflows
- dee3554 — docs: record bridge 3.10.3 and agent 2.5.5 acceptance

Live runtime accepted:
- Agent: 2.5.5
- Extension: 3.10.3
- `ping` advertises `capabilities_action=agent.capabilities`
- `agent.capabilities` live PASS
- `git.add.paths` live-used and PASS
- V4 valid path live PASS
- malformed correlated V4 `p3103-badspace-1` returned same-id NACK, `carrier_parse_failed`, `executed=false`, `retryable=true`
- real `process.run -> git show` Persian stdout PASS
- Unicode process arguments were not independently accepted as a capability.

Source installer/package limitations previously observed:
- Go absent on test PC, so full native-host package rebuild was not executed there.
- Node absent, so independent `node --check` was not executed there.
- PowerShell parsing / JSON / git diff-check / live runtime acceptance passed for the changed Bridge source.

## 3. Existing Untracked Files — Preserve Unless Proven

Previously observed untracked paths include:
- extension/README_APPLY.txt
- extension/chrome/.guard-harness.html
- extension/chrome/Test/
- extension/docs/
- extension/tools/
- installer/bootstrap/.parts/
- installer/bootstrap/prereqs.ps1
- tools/plans/

Recent failed documentation-transfer experiments also created temp files such as:
- .agentdoc.p1
- .uap.1
- .uap-spec.q1
- .uap.q1

These temp dot-files are NOT canonical. Clean only exact temp files after confirming they still exist. Do not delete the older unknown untracked paths above.

## 4. Decisions Locked

1. Project-Agnostic Core: Agent is universal and independent from every sample project.
2. Workspace is not Git. Git/GitHub are optional adapters.
3. Primary MVP workspace model: Persistent Local / register-in-place.
4. Roadmap: Ephemeral Checkout and Remote Workspace.
5. Project move is never automatic default; assess -> recommend -> explicit approval. Safe move = copy -> verify -> test -> switch.
6. Chat/Extension is Control Plane; Artifact Transport is Data Plane.
7. Large files/screenshots/patches should move by artifact reference/file, not base64 carriers.
8. Browser/Screenshot QA is a core capability.
9. Final Windows installer owner is not PowerShell.
10. Preferred product architecture: Inno Setup packaging + self-contained modern .NET Maintenance executable.
11. Cafe remains independent; it was used only to reveal generic needs such as browser QA, Windows lifecycle, diagnostics, services, backup/recovery, updater and artifact handling.
12. Every meaningful checkpoint must publish a complete handoff suitable for a new chat.

## 5. Why P0 Changed

A simple documentation/spec registration consumed roughly 15+ minutes and several Bridge round-trips. That is unacceptable for the long project.

Root issue: even with Agent 2.5.5 fast actions, moving prepared work from the assistant environment to the local workspace still relies too much on Chat/Extension carriers.

Therefore P0 is Fast Work Path / Artifact Transport before building the installer.

## 6. Pilot 001

This ZIP itself is Pilot 001.

Contents:
- artifact.json
- change.patch
- HANDOFF_COMPLETE_FA.md

`change.patch` adds:
- docs/UNIVERSAL_AGENT_PLATFORM_V1_FA.md
- docs/FAST_WORK_PATH_V1_FA.md
- docs/handoffs/CURRENT_AGENT_HANDOFF_FA.md

The handoff file added to repo is the same substantive handoff as this package.

Expected target:
- branch `dev/bootstrap-v2.5`
- base HEAD `dee3554fb0fe069ae842d71c6def8bdfa3f6fec0`

Exact next action in a new chat:
1. Read this HANDOFF.
2. Verify current SOKNA-Bridge branch/head.
3. Ask for or use the local path of the downloaded Pilot ZIP.
4. Verify ZIP SHA256 against the value supplied by the assistant.
5. Extract to temporary staging.
6. Read artifact.json.
7. Run `git apply --check change.patch`.
8. If PASS, apply patch.
9. Remove only known temp dot-files from failed doc-transfer attempts if still present.
10. QA exact changed files, stage exact paths, commit, push, verify origin.
11. Record elapsed time/round-trips/failures from user download through push.
12. If Pilot is materially faster, implement first-class artifact actions/provider abstraction next.

## 7. Installer Direction After P0

Do NOT continue the old project-specific PowerShell bootstrap as the product installer.

Next major phase after P0:
- Universal Setup.exe via Inno Setup.
- Self-contained modern .NET Maintenance executable.
- Installed Apps registration.
- optional Desktop shortcut.
- Start Menu.
- clear summary + technical logs.
- support bundle with secret redaction.
- real Repair.
- staged Upgrade + health + rollback.
- Core install independent from workspace configuration.
- Git/GitHub optional only when selected by a workspace flow.

## 8. No Cafe Mutation

During the architecture audit, SoknaCafe was inspected read-only. Its local checkout was observed behind origin and write_enabled=false. No mutation/checkout/commit/push to Cafe is permitted as part of Agent work.

## 9. Handoff Discipline Going Forward

Every distributed artifact or release candidate must contain:
- HANDOFF_COMPLETE_FA.md
- artifact/version manifest
- source commit/base
- exact next action
- known limitations
- acceptance evidence

The repo must also maintain a current handoff so chat exhaustion is an expected workflow, not an emergency.
