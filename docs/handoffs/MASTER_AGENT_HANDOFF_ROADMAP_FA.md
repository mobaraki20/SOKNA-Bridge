# SOKNA Agent â€” Master Handoff, Architecture & Roadmap
## ط³ظ†ط¯ ط¬ط§ظ…ط¹ ط§ط¯ط§ظ…ظ‡ ظ¾ط±ظˆعکظ‡ ط¨ط¯ظˆظ† ظˆط§ط¨ط³طھع¯غŒ ط¨ظ‡ طھط§ط±غŒط®ع†ظ‡ ع†طھ

**طھط§ط±غŒط® ظ…ط±ط¬ط¹:** 2026-09-23
**ظˆط¶ط¹غŒطھ:** LIVE ACCEPTED â€” ط¨ط§غŒط¯ ظ¾ط³ ط§ط² Acceptance ظˆط§ظ‚ط¹غŒ Agent 2.5.7 ط¯ط± repository ط«ط¨طھ ط´ظˆط¯.
**ط¯ط§ظ…ظ†ظ‡:** SOKNA Agent / SOKNA-Bridge
**ط§طµظ„ ط¨ظ†غŒط§ط¯غŒظ†:** Universal / Project-Agnostic Core

---

# 0) ظ‡ط¯ظپ ط§غŒظ† ط³ظ†ط¯

ط§غŒظ† ط³ظ†ط¯ ط¨ط§غŒط¯ ط¨ظ‡â€Œطھظ†ظ‡ط§غŒغŒ ط¨ط±ط§غŒ ط´ط±ظˆط¹ غŒع© Chat/Agent ط¬ط¯غŒط¯ ع©ط§ظپغŒ ط¨ط§ط´ط¯.
Chat ط¬ط¯غŒط¯ ظ†ط¨ط§غŒط¯ ع©ط§ط±ط¨ط± ط±ط§ ظ…ط¬ط¨ظˆط± ع©ظ†ط¯ طھطµظ…غŒظ…ط§طھطŒ ظˆط¶ط¹غŒطھ ظ¾ط±ظˆعکظ‡ غŒط§ ظ†غŒط§ط²ظ‡ط§غŒ ط§ط³طھط®ط±ط§ط¬â€Œط´ط¯ظ‡ ط±ط§ ط¯ظˆط¨ط§ط±ظ‡ طھظˆط¶غŒط­ ط¯ظ‡ط¯.

طھط±طھغŒط¨ ظ…ط·ط§ظ„ط¹ظ‡ ط¯ط± Chat ط¬ط¯غŒط¯:
1. ط§غŒظ† Master Handoff.
2. `docs/contracts/AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md`
3. `docs/contracts/AGENT_CHANGE_EXECUTION_POLICY_V1.json`
4. `docs/handoffs/CURRENT_AGENT_HANDOFF_FA.md`
5. ط¢ط®ط±غŒظ† ط³ظ†ط¯ status/acceptance ظ†ط³ط®ظ‡ live.

ط§ع¯ط± ط¨غŒظ† ط­ط§ظپط¸ظ‡ ع†طھ ظˆ ط§ط³ظ†ط§ط¯ canonical طھط¹ط§ط±ط¶ ط¨ظˆط¯طŒ ط§ط³ظ†ط§ط¯ canonical ظˆ state ظˆط§ظ‚ط¹غŒ repo/runtime ظ…ظ‚ط¯ظ…â€Œط§ظ†ط¯.

---

# 1) ظ…ط±ط² ظ…ط­طµظˆظ„ ظˆ ط§طµظ„ ط§ط³طھظ‚ظ„ط§ظ„ ظ¾ط±ظˆعکظ‡â€Œظ‡ط§

SOKNA Agent غŒع© ظ…ط­طµظˆظ„ ظ…ط³طھظ‚ظ„ ظˆ ط¹ظ…ظˆظ…غŒ ط§ط³طھ.
ظ‡غŒع† ظ¾ط±ظˆعکظ‡â€Œط§غŒâ€”including SoknaCafeâ€”ظ†ط¨ط§غŒط¯ ط¨ظ‡ dependencyطŒ default workspaceطŒ installer targetطŒ permission assumptionطŒ Git provider assumption غŒط§ naming ط¯ط§ط®ظ„غŒ Core طھط¨ط¯غŒظ„ ط´ظˆط¯.

SoknaCafe ظپظ‚ط· **Reference Workload** ط§ط³طھ:
- ط¨ط±ط§غŒ ع©ط´ظپ ظ†غŒط§ط²ظ‡ط§غŒ ظˆط§ظ‚ط¹غŒ Agentط›
- ط¨ط±ط§غŒ stress-test ع©ط±ط¯ظ† ظ…ط¹ظ…ط§ط±غŒط›
- ط¨ط±ط§غŒ طھط¹ط±غŒظپ acceptance scenarioظ‡ط§غŒ ط¹ظ…ظˆظ…غŒط›
- ط¨ط¯ظˆظ† ظ‡غŒع† ظˆط§ط¨ط³طھع¯غŒ ط¯ظˆط·ط±ظپظ‡.

ط­ط°ظپ ع©ط§ظ…ظ„ Cafe ط§ط² ط¬ظ‡ط§ظ† Agent ظ†ط¨ط§غŒط¯ Core ط±ط§ ط¨ط´ع©ظ†ط¯.

---

# 2) ظˆط¶ط¹غŒطھ ظپط¹ظ„غŒ Repository ظˆ Runtime

Repository:
- `mobaraki20/SOKNA-Bridge`

Branch:
- `dev/bootstrap-v2.5`

Checkpointظ‡ط§غŒ ظ…ظ‡ظ…:
- `dee3554` â€” Extension 3.10.3 / Agent 2.5.5 acceptance docs
- `27b78f5` â€” Universal architecture + Fast Work Path pilot
- `06d901a` â€” Agent 2.5.6 source checkpoint

Runtime ظ¾ط°غŒط±ظپطھظ‡â€Œط´ط¯ظ‡ ظ‚ط¨ظ„ ط§ط² rollout ط¬ط¯غŒط¯:
- Agent live: **2.5.5**
- Extension live: **3.10.3**

Agent 2.5.6:
- source-only
- live acceptance ظ†ط´ط¯ظ‡
- ظ†ط¨ط§غŒط¯ activate ط´ظˆط¯
- ط¨ظ‡â€Œط¹ظ†ظˆط§ظ† checkpoint ط¨غŒظ† 2.5.5 ظˆ hardening ط¨ط¹ط¯غŒ ط¨ط§ظ‚غŒ ظ…غŒâ€Œظ…ط§ظ†ط¯.

Agent 2.5.7:
- release candidate ع©ط§ظ…ظ„
- local validation ع†ظ†ط¯ظ…ط±ط­ظ„ظ‡â€Œط§غŒ PASS
- ظ‡ظ†ظˆط² ط¨ط§غŒط¯ Windows preflight + activation + live acceptance ظˆط§ظ‚ط¹غŒ ط±ظˆغŒ ط³غŒط³طھظ… ع©ط§ط±ط¨ط± PASS ط´ظˆط¯.

ط¨ط³طھظ‡:
- `SOKNA-Agent-2.5.7-Release.zip`
- external SHA-256 ط§ط¹ظ„ط§ظ…â€Œط´ط¯ظ‡:
  `8248e9ce7795277984d38ab1de7c895474a19aec701c34cfce38940f2f62b620`

---

# 3) State ط§ظ…ظ† ط³غŒط³طھظ… ظ‚ط¨ظ„ ط§ط² 2.5.7

Runtime live طھط§ ظ‚ط¨ظ„ ط§ط² activation:
- 2.5.5

ظ…ط³غŒط± runtime ظ…ط´ط§ظ‡ط¯ظ‡â€Œط´ط¯ظ‡:
- `%LOCALAPPDATA%\SOKNA-Bridge-V2\agent.ps1`

ط¯ط± طھظ„ط§ط´ ظ‚ط¨ظ„غŒ:
- 2.5.6 `.next` files ط³ط§ط®طھظ‡ ط´ط¯ظ†ط¯ ظˆ hash match ط¯ط§ط´طھظ†ط¯.
- 2.5.6 activate ظ†ط´ط¯.
- backup 2.5.5 ط§غŒط¬ط§ط¯ ط´ط¯.
- helper ظ…ظˆظ‚طھ `a256.ps1` ط®ط±ط§ط¨ طھط´ط®غŒطµ ط¯ط§ط¯ظ‡ ط´ط¯ ظˆ **ظ†ط¨ط§غŒط¯ ط§ط¬ط±ط§ ط´ظˆط¯**.

2.5.7 completion ط¨ط§غŒط¯ ظپظ‚ط· tempظ‡ط§غŒ ط´ظ†ط§ط®طھظ‡â€Œط´ط¯ظ‡ ط®ظˆط¯ط´/طھظ„ط§ط´ 2.5.6 ط±ط§ ظ¾ط§ع© ع©ظ†ط¯ ظˆ unknown untrackedظ‡ط§ ط±ط§ ط­ظپط¸ ع©ظ†ط¯.

---

# 4) Unknown / Untracked Paths ع©ظ‡ ط¨ط§غŒط¯ ط­ظپط¸ ط´ظˆظ†ط¯

ط¨ط¯ظˆظ† provenance ط±ظˆط´ظ† ط­ط°ظپ ظ†ط´ظˆظ†ط¯:

- `extension/README_APPLY.txt`
- `extension/chrome/.guard-harness.html`
- `extension/chrome/Test/`
- `extension/docs/`
- `extension/tools/`
- `installer/bootstrap/.parts/`
- `installer/bootstrap/prereqs.ps1`
- `tools/plans/`

ط§طµظ„:
- ظ‡غŒع† cleanup ط³ط±ط§ط³ط±غŒ.
- ظ‡غŒع† `git clean -fd`.
- ظ‡غŒع† `git reset --hard` ط±ظˆغŒ workspace ط¢ظ„ظˆط¯ظ‡ ظ…ع¯ط± CR طµط±غŒط­ ظˆ backup/analysis ع©ط§ظ…ظ„.

---

# 5) ظ‚ط±ط§ط±ط¯ط§ط¯ ط¯ط§ط¦ظ…غŒ ط±ظˆط´ طھظˆط³ط¹ظ‡ â€” ط¹ظ„طھ ظˆ ط¯ط±ط³ ط­ط§ط¯ط«ظ‡ 2026-09-23

ظ…ط´ع©ظ„ ظ…ط´ط§ظ‡ط¯ظ‡â€Œط´ط¯ظ‡:
غŒع© طھط؛غŒغŒط± ع©ظˆع†ع©/ظ…طھظˆط³ط· ط¨ط§ طھط¹ط¯ط§ط¯ ط²غŒط§ط¯غŒ round-tripطŒ malformed carrierطŒ quoting failureطŒ alias failureطŒ budget overflow ظˆ activation discovery ط±ظˆغŒ ط³غŒط³طھظ… ع©ط§ط±ط¨ط± ط·ظˆظ„ط§ظ†غŒ ط´ط¯.

ط±غŒط´ظ‡:
- Chat/Extension ظ‡ظ… Control Plane ط¨ظˆط¯ ظ‡ظ… Data Plane.
- Artifact ظپظ‚ط· source patch ط¨ظˆط¯طŒ ظ†ظ‡ Complete Unit of Work.
- activation/rollback/helper ط¨ط¹ط¯ ط§ط² apply ظˆ ط±ظˆغŒ ط³غŒط³طھظ… ع©ط§ط±ط¨ط± ط·ط±ط§ط­غŒ ط´ط¯.
- full source ط¯ط± Workspace طھظˆط³ط¹ظ‡ ط¨ظ‡ ط§ظ†ط¯ط§ط²ظ‡ ع©ط§ظپغŒ ظ…ط­ظˆط± ع©ط§ط± ظ†ط¨ظˆط¯.
- commandظ‡ط§غŒ inline ط·ظˆظ„ط§ظ†غŒ ظˆ quoting ظ¾غŒع†غŒط¯ظ‡ ط§ط³طھظپط§ط¯ظ‡ ط´ط¯ظ†ط¯.

ظ‚ط§ظ†ظˆظ† ط«ط§ط¨طھ:

## 5.1 Full-Source Barrier
ط¨ط±ط§غŒ ظ‡ط± ع©ط§ط± non-trivial:
1. checkout/archive ع©ط§ظ…ظ„ canonical source ط¯ط± Workspace طھظˆط³ط¹ظ‡.
2. exact base commit ظ…ط¹ظ„ظˆظ….
3. طھظˆط³ط¹ظ‡طŒ dependency traceطŒ test ظˆ packaging ط®ط§ط±ط¬ ط§ط² ط³غŒط³طھظ… ع©ط§ط±ط¨ط±.
4. user PC ظپظ‚ط· Windows-specific acceptance.

## 5.2 Complete Artifact Rule
Artifact ط¨ط§غŒط¯ آ«ع©ظ„ ظˆط§ط­ط¯ ع©ط§ط±آ» ط¨ط§ط´ط¯:
- payload/sourceط›
- manifest/hashط›
- stageط›
- activateط›
- rollback/recoveryط›
- health/acceptanceط›
- repo overlay/exact file setط›
- handoffط›
- validation reportط›
- known limitationsط›
- exact next action.

## 5.3 Control Plane
Chat/Extension ظپظ‚ط· ظپط±ظ…ط§ظ† ع©ظˆطھط§ظ‡:
- path
- artifact ID
- expected hash
- action

Code/script/archive ظ†ط¨ط§غŒط¯ Base64 ط¯ط§ط®ظ„ carrier ط´ظˆط¯.

Target safe decoded command budget:
- <= 600 bytes ظ…ع¯ط± runtime budget ط¯غŒع¯ط±غŒ advertise ع©ظ†ط¯.

## 5.4 No Inline Lifecycle Engineering
ط¨ط±ط§غŒ mutation/lifecycle:
- PowerShell ع†ظ†ط¯ط®ط·غŒ inline ظ…ظ…ظ†ظˆط¹.
- nested quoting ظ…ظ…ظ†ظˆط¹.
- helper ط¯ط§ط®ظ„ ArtifactطŒ versioned ظˆ hashed.
- PowerShell alias ط¯ط± release script ظ…ظ…ظ†ظˆط¹.

## 5.5 Two-Strike Rule
ط¯ظˆ failure ظ…طھظˆط§ظ„غŒ ط§ط² غŒع© ط®ط§ظ†ظˆط§ط¯ظ‡:
- STOP ط±ظˆغŒ user PC
- ط«ط¨طھ state
- ط¨ط±ع¯ط´طھ ط¨ظ‡ development workspace
- root-cause fix
- rebuild artifact
- rerun local matrix

## 5.6 User PC = Acceptance Environment
ط±ظˆغŒ ط³غŒط³طھظ… ع©ط§ط±ط¨ط±:
- preflight
- platform-specific parser/test
- activation
- rollback test ط¯ط± طµظˆط±طھ ظ†غŒط§ط²
- live acceptance

ظ†ظ‡:
- ط·ط±ط§ط­غŒ script
- trial-and-error quoting
- source discovery ط·ظˆظ„ط§ظ†غŒ
- helper generation ط¯ط± carrier

---

# 6) ظ…ط¹ظ…ط§ط±غŒ ع©ظ„ط§ظ† SOKNA Agent

ظ„ط§غŒظ‡â€Œظ‡ط§:

1. **Core Runtime**
   - action dispatch
   - workspace resolution
   - permission enforcement
   - process execution
   - result references
   - jobs/batch
   - audit

2. **Workspace Layer**
   - Persistent Local
   - Ephemeral Checkout
   - Remote Workspace (roadmap)
   - register-in-place
   - scopes/permissions

3. **Artifact/Data Plane**
   - import/download
   - verify
   - stage
   - apply
   - retention/cleanup
   - audit
   - provider abstraction

4. **Browser/UI QA**
   - controlled browser
   - live-browser capture
   - screenshots
   - visual/DOM/network/console QA
   - regression artifacts

5. **Maintenance/Lifecycle**
   - installer
   - repair
   - update
   - rollback
   - diagnostics
   - support bundle

6. **Provider/Integration Layer**
   - Git/GitHub optional
   - cloud/object storage optional
   - browsers
   - external tools
   - future app connectors

ظ‡غŒع† provider غŒط§ sample project ط¬ط²ط، Core mandatory ظ†غŒط³طھ.

---

# 7) Workspace Model

Workspace â‰  Git repository.

ظ…ط¯ظ„â€Œظ‡ط§غŒ ظ‡ط¯ظپ:

## 7.1 Persistent Local
MVP ط§طµظ„غŒ:
- ظ¾ط±ظˆعکظ‡ ط¯ط± ظ…ط­ظ„ ظ…ظˆط¬ظˆط¯ ط«ط¨طھ ظ…غŒâ€Œط´ظˆط¯.
- default recommendation: **Register in place**
- Agent ظ¾ط±ظˆعکظ‡ ط±ط§ ط®ظˆط¯ع©ط§ط± move ظ†ظ…غŒâ€Œع©ظ†ط¯.

## 7.2 Managed Copy
ط§ع¯ط± assessment ظ†ط´ط§ظ† ط¯ظ‡ط¯ ظ…ط­ظ„ ظپط¹ظ„غŒ ظ…ظ†ط§ط³ط¨ ظ†غŒط³طھ:
- Copy
- Verify
- Test
- Explicit Switch
- source deletion ط¬ط¯ط§ع¯ط§ظ†ظ‡ ظˆ explicit

## 7.3 Ephemeral Checkout
ط¨ط±ط§غŒ jobظ‡ط§غŒ ظ…ظˆظ‚طھ:
- temp checkout
- isolated work
- artifact/result export
- cleanup policy
- ط¨ط¯ظˆظ† clone ط¯ط§ط¦ظ…غŒ

## 7.4 Remote Workspace
Roadmap:
- GitHub/remote operation ط¨ط¯ظˆظ† permanent clone
- ظ…ط­ط¯ظˆط¯ ظˆ policy-driven

---

# 8) Permission & Security Model

Per Workspace / Per Path:
- Read
- Write
- Deny

Tools/Apps:
- allowlist/selective

Roadmap:
- job-scoped grants
- temporary grants
- permission expiration
- permission audit

ط§طµظˆظ„:
- mutation attributable ط¨ط§ط´ط¯.
- default behavior ظ…ط­ط¯ظˆط¯ ظˆ ط´ظپط§ظپ.
- path escape fail-closed.
- destructive action ظ†غŒط§ط²ظ…ظ†ط¯ scope ظ…ط¹طھط¨ط±.
- secrets ط¯ط± log/support bundle redact ط´ظˆظ†ط¯.

---

# 9) ArtifactRoot / DownloadRoot â€” Requirement ظ‚ط·ط¹غŒ

Agent ط¨ط§غŒط¯ غŒع© root ظ…ط´ط®طµ ط¨ط±ط§غŒ ظپط§غŒظ„â€Œظ‡ط§غŒغŒ ع©ظ‡ ط®ظˆط¯ط´ ظ…ط¯غŒط±غŒطھ ظ…غŒâ€Œع©ظ†ط¯ ط¯ط§ط´طھظ‡ ط¨ط§ط´ط¯.

ط¯ط± Installer/Settings:
- ع©ط§ط±ط¨ط± ط¨طھظˆط§ظ†ط¯ path ط±ط§ ط§ظ†طھط®ط§ط¨ ع©ظ†ط¯.
- path canonical ظˆ ظ‚ط§ط¨ظ„ ظ…ط´ط§ظ‡ط¯ظ‡ ط¨ط§ط´ط¯.
- طھط؛غŒغŒط± path workflow ط§ظ…ظ† migration ط¯ط§ط´طھظ‡ ط¨ط§ط´ط¯.

ط³ط§ط®طھط§ط± ظ¾غŒط´ظ†ظ‡ط§ط¯غŒ:

```text
<ArtifactRoot>\
    incoming\
    staging\
    accepted\
    failed\
    cache\
    browser\
    logs\
```

ظ‡ط± import/download:
- artifact_id
- provider/source
- source reference/URL ط¯ط± طµظˆط±طھ ظ…ط¬ط§ط²
- local path
- size
- SHA-256
- content type
- created/download timestamps
- workspace/job
- validation result
- apply result
- retention policy
- cleanup state

ظ‚ظˆط§ط¹ط¯:
- auto-download ط®ط§ط±ط¬ ArtifactRoot ظ…ظ…ظ†ظˆط¹.
- delete ط®ط§ط±ط¬ ArtifactRoot ظ…ظ…ظ†ظˆط¹ ظ…ع¯ط± action ظ…ط³طھظ‚ظ„ ظˆ permission طµط±غŒط­.
- fallback ظ…ظˆظ‚طھ ط¨ط§غŒط¯ ط¯ط± UI/log ط´ظپط§ظپ ط¨ط§ط´ط¯.
- Downloads ط¹ظ…ظˆظ…غŒ ع©ط§ط±ط¨ط± ظ†ط¨ط§غŒط¯ ظ…ظ‚طµط¯ ظ¾غŒط´â€Œظپط±ط¶ ط¯ط§ط¦ظ…غŒ Agent ط¨ط§ط´ط¯.

---

# 10) Artifact Transport / Data Plane

Control Plane ظپط§غŒظ„ ط­ط¬غŒظ… ط­ظ…ظ„ ظ†ظ…غŒâ€Œع©ظ†ط¯.

Flow:
1. acquire/fetch
2. size check
3. hash check
4. signature/policy check ط¯ط± طµظˆط±طھ ظˆط¬ظˆط¯
5. stage isolated
6. inspect
7. apply
8. acceptance
9. audit
10. retention/cleanup

Provider abstraction:
- Local File
- Managed Folder / LAN
- Google Drive
- OneDrive
- S3/Object Storage
- GitHub Release Assets
- Dedicated SOKNA Artifact Service
- future providers

ظ‡غŒع† provider mandatory ظ†غŒط³طھ.

Auto-download ظپظ‚ط· ط¨ط¹ط¯ ط§ط²:
- ArtifactRoot
- audit
- lifecycle
- cleanup/retention
- security policy
ظ¾غŒط§ط¯ظ‡ ط´ظˆط¯.

---

# 11) Browser / Screenshot / UI QA â€” ظ†غŒط§ط² ع©ط§ظ…ظ„

ط§غŒظ† ظ‚ط§ط¨ظ„غŒطھ ظپط±ط§ظ…ظˆط´ ظ†ط´ط¯ظ‡ ظˆ Feature ط¬ط§ظ†ط¨غŒ ظ†غŒط³طھط› غŒع©غŒ ط§ط² capabilityظ‡ط§غŒ ط§طµظ„غŒ Agent ط§ط³طھ.

## P3-A Controlled Browser QA
طھط±ط¬غŒط­:
- Playwright + Chromium غŒط§ equivalent controlled browser

ظ‚ط§ط¨ظ„غŒطھâ€Œظ‡ط§:
- open URL
- wait conditions
- login/setup recipe
- navigation
- click/type/select
- viewport selection
- desktop/mobile/tablet
- screenshot
- full-page screenshot
- element screenshot
- page title/url/status
- controlled cookies/storage ط¯ط± scope ظ…ط´ط®طµ

## P3-B Screenshot Matrix
غŒع© page ظ…غŒâ€Œطھظˆط§ظ†ط¯ ط¯ط± ع†ظ†ط¯ viewport capture ط´ظˆط¯:
- mobile narrow
- mobile large
- tablet
- desktop
- wide desktop
- custom viewport

Artifact metadata:
- viewport
- DPR
- URL
- route
- timestamp
- commit/build
- workspace
- scenario

## P3-C Visual Regression
- before/after
- baseline/current
- pixel diff
- layout/geometry diff
- overflow/clipping detection
- alignment shifts
- spacing regression
- missing/duplicate elements
- image/text clipping

ع¯ط²ط§ط±ط´ ط¨ط§غŒط¯ severity ظˆ evidence ط¯ط§ط´طھظ‡ ط¨ط§ط´ط¯.

## P3-D DOM / Geometry Inspection
- DOM snapshot
- bounding boxes
- computed visibility
- scroll containers
- z-index/layer relation ط¯ط± ط­ط¯ ظ‚ط§ط¨ظ„ ط§طھع©ط§
- modal/sheet/popover/drawer geometry
- duplicate UI owner symptoms
- fixed/sticky behavior
- overflow
- accessibility tree/snapshot

## P3-E Console / Network QA
- JS errors
- unhandled rejections
- failed network requests
- status codes
- CORS errors
- blocked resources
- slow resource evidence
- console warning policy

Sensitive payloadظ‡ط§ ط¯ط± network log ط¨ط§غŒط¯ redact ط´ظˆظ†ط¯.

## P3-F Cross-Page Consistency
ط¨ط±ط§غŒ ظ¾ط±ظˆعکظ‡â€Œظ‡ط§غŒغŒ ط´ط¨غŒظ‡ Cafe:
- typography consistency
- spacing/density
- component reuse
- breakpoint behavior
- shared pattern compliance
- no duplicate UI ownership
- same component = same behavior
- responsive rules

## P3-G Live Browser Capture
ط¨ط±ط§غŒ tab/session ظˆط§ظ‚ط¹غŒ ع©ط§ط±ط¨ط±:
- permission طµط±غŒط­
- screenshot
- DOM/context
- console metadata
- current URL/title
- selected diagnostics

ظ…ظ…ظ†ظˆط¹:
- hidden capture
- background spying
- credential extraction
- unrestricted cookie/token export

## P3-H Browser Artifacts
ظ‡ظ…ظ‡ ط§غŒظ† ظ…ظˆط§ط±ط¯ ط¨ظ‡ ArtifactRoot:
- PNG/WebP screenshots
- DOM snapshots
- JSON reports
- network summaries
- console logs
- visual diff
- acceptance report

ظ†ط¨ط§غŒط¯ ط§ط² Chat carrier ط¹ط¨ظˆط± ع©ظ†ظ†ط¯.

## P3-I Acceptance Recipes
Recipe ظ‚ط§ط¨ظ„ طھع©ط±ط§ط±:
- scenario ID
- route
- prerequisites
- viewport matrix
- actions
- assertions
- captures
- cleanup

ظ†طھغŒط¬ظ‡:
- PASS / FAIL
- evidence artifact IDs
- exact failure reason

---

# 12) ظ†غŒط§ط²ظ‡ط§غŒغŒ ع©ظ‡ ط§ط² SoknaCafe ط¨ظ‡â€Œط¹ظ†ظˆط§ظ† Reference Workload ط§ط³طھط®ط±ط§ط¬ ط´ط¯ظ†ط¯

Cafe dependency ظ†غŒط³طھ. ظپظ‚ط· ط§غŒظ† ظ†غŒط§ط²ظ‡ط§غŒ ط¹ظ…ظˆظ…غŒ ط±ط§ ط¢ط´ع©ط§ط± ع©ط±ط¯:

## 12.1 Browser-Level UI
- geometry ظˆط§ظ‚ط¹غŒطŒ ظ†ظ‡ ظپظ‚ط· source inspection
- responsive behavior
- mobile/desktop differences
- modal/sheet/popover/drawer
- scroll behavior
- full-page capture
- cross-page consistency
- Design System contract
- duplicate owner detection

## 12.2 Offline/PWA
Agent ط¯ط± ط¢غŒظ†ط¯ظ‡ ط¨ط§غŒط¯ ط¨طھظˆط§ظ†ط¯:
- online/offline scenarios
- service worker/state evidence
- PWA cache behavior
- offline/online transition tests
ط±ط§ ط¨ظ‡â€Œط¹ظ†ظˆط§ظ† browser recipe ط§ط¬ط±ط§ ع©ظ†ط¯.

## 12.3 Local/Public Topology
ظ†غŒط§ط² ط¹ظ…ظˆظ…غŒ:
- localhost/local service health
- public endpoint health
- connectivity state
- local/public split
- network diagnostics

ط¨ط¯ظˆظ† hard-code Cafe routes.

## 12.4 Process/Service
ظ‚ط§ط¨ظ„غŒطھ ط¹ظ…ظˆظ…غŒ:
- process inspect
- service inspect/start/stop/restart ط¨ط§ permission
- health probe
- port listener check
- owned-process metadata

## 12.5 Update / Recovery
ط§ظ„ع¯ظˆغŒ ط¹ظ…ظˆظ…غŒ:
- stage side-by-side
- pre-update recovery point
- verify
- atomic/controlled switch
- health
- automatic rollback
- Last-Known-Good
- updater self-recovery

## 12.6 Backup / Restore
Agent Core ط§ظ„ط²ط§ظ…ط§ظ‹ backup product ظ†غŒط³طھطŒ ط§ظ…ط§ ط¨ط§غŒط¯ ط¨طھظˆط§ظ†ط¯ workflows ط¹ظ…ظˆظ…غŒ:
- file/archive verify
- SHA manifests
- fail-closed validation
- restore orchestration
- credential/environment preservation
ط±ط§ ظ¾ط´طھغŒط¨ط§ظ†غŒ ع©ظ†ط¯.

## 12.7 Printing / External Components
ط§ط² Print Agent ظ†طھغŒط¬ظ‡ ط¹ظ…ظˆظ…غŒ:
- component version discovery
- external binary acquisition
- checksum
- stable channel
- fallback/LKG
- component health
- independent lifecycle

ظ†ظ‡ hard-code printer/Cafe.

## 12.8 Diagnostics
ظ†غŒط§ط² ط¹ظ…ظˆظ…غŒ:
- health
- logs
- diagnostics
- support bundle
- versions
- service/process state
- network state
- artifact references
- secret redaction

---

# 13) Installer Architecture

PowerShell ظ…ط§ظ„ع© ظ†ظ‡ط§غŒغŒ Installer ظ†غŒط³طھ.

ط§ظ†طھط®ط§ط¨ طھط±ط¬غŒط­غŒ:

## 13.1 Inno Setup
ظ…ط§ظ„ع©:
- Setup.exe
- file installation
- registry
- Installed Apps
- Start Menu
- optional Desktop Shortcut
- uninstall
- basic elevation/lifecycle

## 13.2 Modern self-contained .NET Maintenance Host
ظ…ط§ظ„ع©:
- preflight
- health
- diagnostics
- Repair
- support bundle
- upgrade orchestration
- rollback
- ArtifactRoot configuration
- workspace bootstrap
- component management

.NET Framework ظ‚ط¯غŒظ…غŒ ظ‡ط¯ظپ طھط±ط¬غŒط­غŒ ظ†غŒط³طھط› modern self-contained .NET طھط±ط¬غŒط­ ط¯ط§ط±ط¯.

## 13.3 Installer UX
ط¯ط± ظ†طµط¨:
- install location
- ArtifactRoot
- Start Menu
- Desktop shortcut optional
- auto-start policy ط¯ط± طµظˆط±طھ ط·ط±ط§ط­غŒ/طھط§غŒغŒط¯
- diagnostics path
- permissions summary
- workspace setup: Now / Later

ظ†طµط¨ Core ظ†ط¨ط§غŒط¯ ظ†غŒط§ط²ظ…ظ†ط¯:
- Git
- GitHub
- Cafe
- PHP
- MySQL
- project-specific runtime
ط¨ط§ط´ط¯.

---

# 14) Repair / Upgrade / Recover

Repair â‰  Recover.

## Repair
- manifest/hash exact version
- detect missing/corrupt owned files
- restore same-version owned components
- restart/health
- preserve:
  - workspace data
  - credentials
  - user settings
  - ArtifactRoot content ط·ط¨ظ‚ policy

## Upgrade
- download/fetch
- verify
- stage
- recovery point
- switch
- health
- capability check
- acceptance
- rollback on failure

## Recover
ط¨ط±ط§غŒ restoring application/workspace dataط› workflow ط¬ط¯ط§ ط§ط² Repair.

---

# 15) Logs & Support Bundle

ظ‡ط± operation ظ…ظ‡ظ…:
- session_id
- job_id
- workspace_id
- artifact_id
- action
- stage
- timestamp
- duration
- result
- exit/error code
- next action

ط¯ظˆ ط³ط·ط­:
- Summary Log
- Technical/Event Log

Support Bundle ط­ط¯ط§ظ‚ظ„:
- summary.json
- events.jsonl
- installer/maintenance log
- agent log
- versions.json
- health.json
- relevant diagnostics

Redaction:
- password
- token
- private key
- `.env` secret values
- browser cookies/session tokens
- backup private content ظ…ع¯ط± explicit inclusion

---

# 16) Stable Runtime Ownership

ط¨ط§غŒط¯ state canonical ط¯ط§ط´طھظ‡ ط¨ط§ط´غŒظ…:
- install_root
- active_version
- previous_version
- launcher version
- agent_pid
- config_path
- ArtifactRoot
- activation_tx_id
- last_health
- last_rollback
- source/artifact hash

Runtime restart ظ†ط¨ط§غŒط¯ ظ‡ط± ط¨ط§ط± ط¨ط§ WMI discovery ط§ط² طµظپط± ط·ط±ط§ط­غŒ ط´ظˆط¯.

Stable launcher/maintenance ظ…ط§ظ„ع© lifecycle ظ…غŒâ€Œط´ظˆط¯.

---

# 17) Current 2.5.7 Candidate â€” ط§ظ„ط²ط§ظ…ط§طھ Acceptance

ظ‚ط¨ظ„ ط§ط² activation:
- external ZIP SHA match
- package manifest exact file set
- all file hashes
- Windows PowerShell parser all PS1
- no forbidden release aliases
- current 2.5.5 health
- current capabilities health
- runtime ownership/PID
- recovery/update path writable

ط§ع¯ط± preflight fail:
- STOP
- no interactive remote repair
- fix in development workspace
- rebuild package
- rerun local matrix

ظ¾ط³ ط§ط² activation:
- ping = 2.5.7
- capabilities = 2.5.7
- expected artifact actions present
- controlled artifact.inspect PASS
- controlled artifact.apply PASS
- reverse/cleanup PASS
- audit events present
- rollback path hash-verified
- repo finalization ظپظ‚ط· ط¨ط¹ط¯ ط§ط² acceptance

---

# 18) Roadmap ط±ط³ظ…غŒ

## P0 â€” Fast Work Path / Artifact Foundation
### P0-A Execution Contract
- Full-Source Barrier
- Complete Artifact
- Control/Data separation
- Two-Strike
- Handoff barrier
- metrics

### P0-B Artifact Runtime
- inspect
- apply
- hashes
- branch/base
- file list
- audit
- ZIP safety

### P0-C ArtifactRoot
- selectable root
- directory structure
- retention
- cleanup
- storage quota/visibility
- import/download audit

**Current focus:** 2.5.7 acceptance ط³ظ¾ط³ P0-C.

---

## P1 â€” Universal Installer & Maintenance
- Inno Setup
- .NET Maintenance
- Installed Apps
- Start Menu
- Desktop optional
- install logs
- diagnostics
- support bundle
- Repair
- Upgrade
- rollback
- stable launcher
- ArtifactRoot picker
- Core install without project/Git

---

## P2 â€” Workspace & Permission Manager
- add/register-in-place
- inspect
- remove/unregister
- Read/Write/Deny paths
- tool allowlist
- project assessment
- local-only support
- Git optional
- GitHub optional
- audit
- safe managed copy flow

---

## P3 â€” Browser / Screenshot / Visual QA
- Controlled Browser
- viewport matrix
- screenshot/full-page/element
- Visual Regression
- DOM/Geometry
- Accessibility
- Console/Network
- Cross-page consistency
- Live Browser Capture with consent
- Artifact-backed evidence
- repeatable QA recipes

**ط§غŒظ† ظپط§ط² غŒع©غŒ ط§ط² ط§ظ‡ط¯ط§ظپ ط§طµظ„غŒ Agent ط§ط³طھ ظˆ ط­ط°ظپ/ظپط±ط§ظ…ظˆط´ ظ†ط´ط¯ظ‡.**

---

## P4 â€” Artifact Providers / Auto-download
ظ¾ط³ ط§ط² ArtifactRoot:
- local import
- LAN/shared folder
- provider abstraction
- Google Drive adapter
- OneDrive adapter
- S3/object storage
- GitHub Release Assets
- dedicated service ط¯ط± طµظˆط±طھ ظ†غŒط§ط²
- resume/retry
- checksum/signature
- retention

---

## P5 â€” Advanced Workspaces / Permissions
- Ephemeral Checkout
- Remote Workspace
- job-scoped permissions
- temporary grants
- richer policy UI
- remote execution adapters ط·ط¨ظ‚ security model

---

## P6 â€” Advanced Automation / Component Lifecycle
ط¯ط± طµظˆط±طھ ظ†غŒط§ط²:
- component registry
- service/process orchestration
- dependency acquisition
- plugin/component health
- release channels
- LKG per component
- richer scheduled/triggered jobs

---

# 19) Definition of Done ط¨ط±ط§غŒ ظ‡ط± Capability

غŒع© feature طھظ…ط§ظ…â€Œط´ط¯ظ‡ ظ†غŒط³طھ ظ…ع¯ط±:
1. source committed
2. docs updated
3. capability advertised
4. unit/static tests PASS
5. integration tests PASS
6. target-platform acceptance PASS
7. failure/rollback tested
8. logs/audit available
9. handoff updated
10. exact next action recorded

Source-only â‰  live accepted.

---

# 20) QA Philosophy

طھط±طھغŒط¨:
1. Source/static QA
2. deterministic local tests
3. package verification
4. target-platform preflight
5. target-platform activation
6. live integration
7. failure/rollback
8. final repo/handoff

ظ‡غŒع† PASS ط¨ط± ط§ط³ط§ط³ ظپط§غŒظ„ ط±ظˆغŒ disk ط¨ظ‡â€Œط¬ط§غŒ runtime activation ط§ط¯ط¹ط§ ظ†ظ…غŒâ€Œط´ظˆط¯.

---

# 21) Metrics

ط¨ط±ط§غŒ ظ‡ط± rollout:
- start/end timestamp
- elapsed time
- round trips
- failures
- retries
- carrier bytes
- artifact bytes
- manual user actions
- rollback count

Fast Work Path target:
- 1 artifact acquisition/download
- <= 1 primary stage/apply/activate interaction
- <= 1 primary acceptance/result interaction
- development/debug on user machine = 0

---

# 22) Change Control

ظ‡ط± طھط؛غŒغŒط± ط¨ظ‡ MUSTظ‡ط§غŒ canonical:
- Change Request
- reason
- risk
- alternative
- rollback
- acceptance criteria

ط¨ط¯ظˆظ† CR:
- fail-closed

---

# 23) Exact Next Action ط§ط² ط§غŒظ† checkpoint

1. ط±ظˆغŒ ط³غŒط³طھظ… Windows ع©ط§ط±ط¨ط± ZIP 2.5.7 ط¯ط§ظ†ظ„ظˆط¯ط´ط¯ظ‡ ط±ط§ ط¨ط§ external SHA verify ع©ظ†.
2. ظپظ‚ط· `Preflight-AgentRuntime257.ps1` ط±ط§ ط§ط¬ط±ط§ ع©ظ†ط› ط§غŒظ† ظ…ط±ط­ظ„ظ‡ ظ†ط¨ط§غŒط¯ runtime ط±ط§ switch ع©ظ†ط¯.
3. ط§ع¯ط± Preflight PASS:
   - Stage/Activate ط·ط¨ظ‚ package tested flow.
4. ظ…ظ†طھط¸ط± live 2.5.7 response.
5. Complete/Acceptance ط±ط§ ط§ط¬ط±ط§ ع©ظ†.
6. ظپظ‚ط· ط¨ط¹ط¯ ط§ط² PASS:
   - repo overlay 2.5.7 ط±ط§ exact-stage/commit/push ع©ظ†.
   - ط§غŒظ† Master Handoff ط±ط§ ط¨ظ‡ repo canonical ط§ط¶ط§ظپظ‡ ع©ظ†.
   - `00_READ_FIRST_NEW_CHAT.md` ط±ط§ ط¨ظ‡ Master + Contract + Current Handoff ظ„غŒظ†ع© ع©ظ†.
7. ط³ظ¾ط³ P0-C: ArtifactRoot/retention/audit UI/config.
8. ط¨ط¹ط¯ P1 Installer Foundation.
9. ط¨ط¹ط¯ P2 Workspace Manager.
10. ط³ظ¾ط³ ط³ط±غŒط¹ ظˆط§ط±ط¯ P3 Browser/Screenshot QA ط´ظˆط› ط§غŒظ† ظپط§ط² ظ†ط¨ط§غŒط¯ ط¨غŒâ€Œط¯ظ„غŒظ„ ط¹ظ‚ط¨ ط¨غŒظپطھط¯.

---

# 24) ع†غŒط²غŒ ع©ظ‡ Chat/Agent ط¨ط¹ط¯غŒ ظ†ط¨ط§غŒط¯ ط§ط² ع©ط§ط±ط¨ط± ط¯ظˆط¨ط§ط±ظ‡ ط¨ظ¾ط±ط³ط¯

طھط§ ط²ظ…ط§ظ†غŒ ع©ظ‡ ط§غŒظ† ط³ظ†ط¯ ظ…ط¹طھط¨ط± ظˆ state repo/runtime طھط؛غŒغŒط± ظ†ع©ط±ط¯ظ‡:
- Agent ظ…ط³طھظ‚ظ„ ط§ط² Cafe ط§ط³طھ.
- Cafe ظپظ‚ط· reference workload ط§ط³طھ.
- Inno + modern .NET Maintenance ظ…ط¹ظ…ط§ط±غŒ طھط±ط¬غŒط­غŒ Installer ط§ط³طھ.
- ArtifactRoot ط¨ط§غŒط¯ selectable ظˆ audited ط¨ط§ط´ط¯.
- Git/GitHub optional ظ‡ط³طھظ†ط¯.
- Register-in-place default recommendation ط§ط³طھ.
- Browser/Screenshot QA requirement ط§طµظ„غŒ ط§ط³طھ.
- user PC development environment ظ†غŒط³طھ.
- full source + complete artifact workflow ط§ط¬ط¨ط§ط±غŒ ط§ط³طھ.
- handoff ط¯ط± ظ‡ط± checkpoint ط§ط¬ط¨ط§ط±غŒ ط§ط³طھ.
- 2.5.6 ظ†ط¨ط§غŒط¯ live ط´ظˆط¯.
- candidate ط¨ط¹ط¯غŒ 2.5.7 ط§ط³طھ.
- unknown untracked paths ط¨ط§غŒط¯ ط­ظپط¸ ط´ظˆظ†ط¯.
- P0â†’P1â†’P2â†’P3â†’P4â†’P5 roadmap ظ¾ط§غŒظ‡ ط§ط³طھ ظ…ع¯ط± CR طµط±غŒط­.

---

# 25) ط§طµظ„ ط¢ط®ط±

ظ‡ط¯ظپ SOKNA Agent ظپظ‚ط· آ«ط§ط¬ط±ط§غŒ command ط§ط² Chatآ» ظ†غŒط³طھ.

ظ‡ط¯ظپ ظ†ظ‡ط§غŒغŒ:
غŒع© Agent ط¹ظ…ظˆظ…غŒطŒ ظ‚ط§ط¨ظ„ ط§ط¹طھظ…ط§ط¯طŒ ظ‚ط§ط¨ظ„ audit ظˆ ظ‚ط§ط¨ظ„ ط§ط¯ط§ظ…ظ‡ ط¯ط± ظ¾ط±ظˆعکظ‡â€Œظ‡ط§غŒ ط·ظˆظ„ط§ظ†غŒ ط¨ط§ط´ط¯ ع©ظ‡ ط¨طھظˆط§ظ†ط¯:
- source/workspace ط±ط§ ط§ظ…ظ† ظ…ط¯غŒط±غŒطھ ع©ظ†ط¯ط›
- artifactظ‡ط§ ط±ط§ ط¬ط§ط¨ظ‡â€Œط¬ط§ ظˆ verify ع©ظ†ط¯ط›
- طھط؛غŒغŒط± ع©ط§ظ…ظ„ ط±ط§ stage/apply/test ع©ظ†ط¯ط›
- UI ظˆط§ظ‚ط¹غŒ ط±ط§ ط¨ط¨غŒظ†ط¯ ظˆ screenshot/DOM/network/console ط±ط§ QA ع©ظ†ط¯ط›
- lifecycle Windows ط±ط§ ط¨ط§ installer/repair/update/rollback ظ…ط¯غŒط±غŒطھ ع©ظ†ط¯ط›
- ظ¾ط±ظˆعکظ‡â€Œظ‡ط§غŒ ظ…ط®طھظ„ظپ ط±ط§ ط¨ط¯ظˆظ† hard-code ط´ط¯ظ† ط¨ظ‡ ظ‡غŒع† ظ¾ط±ظˆعکظ‡â€Œط§غŒ ظ¾ط´طھغŒط¨ط§ظ†غŒ ع©ظ†ط¯ط›
- ظˆ ظ¾ط³ ط§ط² ظ‚ط·ط¹ ChatطŒ ط§ط² Handoff canonical ط¨ط¯ظˆظ† ط¨ط§ط²ع¯ط´طھ ط¨ظ‡ طµظپط± ط§ط¯ط§ظ…ظ‡ ط¯ظ‡ط¯.


---

# 26) R2 correction â€” Windows preflight self-call deadlock

ط§ظˆظ„غŒظ† Windows preflight ط¨ط³طھظ‡ 2.5.7 ط§ظˆظ„غŒظ‡ ط¯ط± ظ…ط±ط­ظ„ظ‡ `PREFLIGHT_CURRENT_HEALTH` timeout ط´ط¯ ظˆ ط·ط¨ظ‚ fail-closed ظ‡غŒع† activation/restart/mutation runtime ط§ظ†ط¬ط§ظ… ظ†ط´ط¯.

Root cause:
- Preflight ط§ط² ط¯ط§ط®ظ„ Agent 2.5.5 ط¨ط§ `process.run` ط§ط¬ط±ط§ ط´ط¯ظ‡ ط¨ظˆط¯.
- Agent طھط§ ظ¾ط§غŒط§ظ† child process ظ…ظ†طھط¸ط± ط¨ظˆط¯.
- ظ‡ظ…ط§ظ† child ط¯ظˆط¨ط§ط±ظ‡ synchronous ط¨ظ‡ HTTP API ظ‡ظ…ط§ظ† Agent `ping/capabilities` ظ…غŒâ€Œط²ط¯.
- ط¯ط± ظ†طھغŒط¬ظ‡ dependency cycle ط§غŒط¬ط§ط¯ ط´ط¯: Agent -> child -> ظ‡ظ…ط§ظ† Agent.

ط§غŒظ† ط®ط·ط§ ط¨ظ‡ ظ‚ط±ط§ط±ط¯ط§ط¯ ط¯ط§ط¦ظ…غŒ طھط¨ط¯غŒظ„ ط´ط¯:
- Agent-mediated child ط­ظ‚ synchronous self-call ط¨ظ‡ Agent owner ط±ط§ ظ†ط¯ط§ط±ط¯.
- Preflight ط¯ظˆ mode ط¯ط§ط±ط¯: `AgentMediated` ظˆ `External`.
- Stage ظ‡ظ…غŒط´ظ‡ `AgentMediated` ط±ط§ ط§ظ†طھط®ط§ط¨ ظ…غŒâ€Œع©ظ†ط¯.
- AgentMediated evidence: control-plane invocation + live PID ownership + runtime/capability version on disk + config/recovery checks.
- External mode ط¨ط±ط§غŒ Maintenance Host ظ…ط³طھظ‚ظ„ ظ…غŒâ€Œطھظˆط§ظ†ط¯ HTTP ping/capabilities ط§ظ†ط¬ط§ظ… ط¯ظ‡ط¯.
- ط¨ط¹ط¯ ط§ط² restartطŒ detached activation helper ط¨ط§غŒط¯ health ظˆط§ظ‚ط¹غŒ target ط±ط§ HTTP-check ع©ظ†ط¯.
- dependency-cycle/re-entrancy review ط¨ط±ط§غŒ lifecycle workflow ط§ط¬ط¨ط§ط±غŒ ط§ط³طھ.

ط¨ط³طھظ‡ ط§ظˆظ„غŒظ‡ 2.5.7 superseded ط§ط³طھ ظˆ ظ†ط¨ط§غŒط¯ ط¯ظˆط¨ط§ط±ظ‡ ط§ط¬ط±ط§ ط´ظˆط¯.
غŒط§ط¯ط¯ط§ط´طھ طھط§ط±غŒط®غŒ: ط¨ط³طھظ‡ ط§ظˆظ„غŒظ‡طŒ R2 ظˆ R3 ظ‡ظ…ع¯غŒ superseded ظ‡ط³طھظ†ط¯ط› طھظ†ظ‡ط§ R4 ع©ط§ظ†ط¯غŒط¯ ظ…ط¬ط§ط² ط¨ط¹ط¯غŒ ط§ط³طھ.


## Windows R2/R3 activation evidence / R4 state-schema fix
- R2 preflight AgentMediated: PASS.
- transaction `rt257-1790141694403-2e4f9b9b` target health failed before acceptance.
- automatic rollback: PASSط› active runtime returned safely to 2.5.5.
- R3 barrier ط­ظپط¸ ظ…غŒâ€Œط´ظˆط¯: target `-StartupProbe` ط¨ط§غŒط¯ ظ‚ط¨ظ„ ط§ط² live stop/switch PASS ط´ظˆط¯ ظˆ launcher ط¨ط§غŒط¯ stdout/stderr/exit evidence ط±ط§ ط«ط¨طھ ع©ظ†ط¯.
- R2 is superseded for further activation attempts.


# 27) Current authorized rollout candidate â€” R4

- ط¨ط³طھظ‡ ظ…ط¬ط§ط² ظپط¹ظ„غŒ: **SOKNA-Agent-2.5.7-R4-Release.zip**.
- Original/R1 ظˆ R2 ط¨ط±ط§غŒ activation ظ…ظ…ظ†ظˆط¹â€Œط§ظ†ط¯.
- R4 ظ‚ط¨ظ„ ط§ط² mutation غŒع© Windows `-StartupProbe` ظˆط§ظ‚ط¹غŒ ط±ظˆغŒ payload ط§ط¬ط±ط§ ظ…غŒâ€Œع©ظ†ط¯ط› ط³ظ¾ط³ ظپظ‚ط· ط¯ط± طµظˆط±طھ PASS ط§ط¬ط§ط²ظ‡ stop/switch ط¯ط§ط±ط¯.
- Launcher R4 ظ‡ظ…ط§ظ† stdout/stderr/exit-code logging R3 ط±ط§ ط­ظپط¸ ظ…غŒâ€Œع©ظ†ط¯ط› طھط؛غŒغŒط± R4 ظپظ‚ط· schema state ط§ط³طھ.
- R2 transaction `rt257-1790141694403-2e4f9b9b` health fail ط´ط¯ ط§ظ…ط§ rollback ط®ظˆط¯ع©ط§ط± PASS ظˆ 2.5.5 restore ط´ط¯.

- R4 validation evidence: release verifier PASSط› contract/model 40/40 PASSط› negative mutation 5/5 PASSط› Windows R4 acceptance ظ‡ظ†ظˆط² pending ط§ط³طھ.


## R4 state-schema regression fix
R3 Windows activation root cause was reproduced exactly: Agent-Launcher attempted to assign `active_version` and `recovered_at` onto a PSCustomObject that did not contain those properties, causing `ExceptionWhenSetting` before the target runtime was launched. A second same-family latent issue was found in acceptance for `accepted_at`. R4 changes only the lifecycle state schema: mutable lifecycle fields are predeclared before launcher/acceptance mutation. No new runtime feature or extra activation layer was added.

## R4 mandatory Windows regression gate
Before Stage/Activate, run `State-Schema-Regression257.ps1` from the shipped package on the target Windows host. It uses an isolated `%TEMP%` root and the shipped launcher with a dummy agent. PASS is mandatory before any live stop/switch. This is a direct regression for the R3 `ExceptionWhenSetting` failure and does not mutate the installed runtime.

## R4 final validation evidence
- Release verifier: PASS
- Contract/model suite: 48/48 PASS
- Targeted negative state-schema mutations: 3/3 correctly rejected (`active_version`, `recovered_at`, `accepted_at`)
- R3 Windows root cause reproduced exactly as PowerShell `ExceptionWhenSetting` on missing `active_version`.
- R4 fix scope is intentionally minimal: lifecycle state-schema fields only; no new runtime feature, timeout, helper layer, or activation architecture was added.
- Mandatory next Windows gate before live activation: `State-Schema-Regression257.ps1` must PASS in isolated `%TEMP%`.
