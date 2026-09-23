# SOKNA Agent — Master Handoff, Architecture & Roadmap
## سند جامع ادامه پروژه بدون وابستگی به تاریخچه چت

**تاریخ مرجع:** 2026-09-23  
**وضعیت:** Canonical Candidate — باید پس از Acceptance واقعی Agent 2.5.7 در repository ثبت شود.  
**دامنه:** SOKNA Agent / SOKNA-Bridge  
**اصل بنیادین:** Universal / Project-Agnostic Core

---

# 0) هدف این سند

این سند باید به‌تنهایی برای شروع یک Chat/Agent جدید کافی باشد.  
Chat جدید نباید کاربر را مجبور کند تصمیمات، وضعیت پروژه یا نیازهای استخراج‌شده را دوباره توضیح دهد.

ترتیب مطالعه در Chat جدید:
1. این Master Handoff.
2. `docs/contracts/AGENT_CHANGE_EXECUTION_CONTRACT_V1_FA.md`
3. `docs/contracts/AGENT_CHANGE_EXECUTION_POLICY_V1.json`
4. `docs/handoffs/CURRENT_AGENT_HANDOFF_FA.md`
5. آخرین سند status/acceptance نسخه live.

اگر بین حافظه چت و اسناد canonical تعارض بود، اسناد canonical و state واقعی repo/runtime مقدم‌اند.

---

# 1) مرز محصول و اصل استقلال پروژه‌ها

SOKNA Agent یک محصول مستقل و عمومی است.  
هیچ پروژه‌ای—including SoknaCafe—نباید به dependency، default workspace، installer target، permission assumption، Git provider assumption یا naming داخلی Core تبدیل شود.

SoknaCafe فقط **Reference Workload** است:
- برای کشف نیازهای واقعی Agent؛
- برای stress-test کردن معماری؛
- برای تعریف acceptance scenarioهای عمومی؛
- بدون هیچ وابستگی دوطرفه.

حذف کامل Cafe از جهان Agent نباید Core را بشکند.

---

# 2) وضعیت فعلی Repository و Runtime

Repository:
- `mobaraki20/SOKNA-Bridge`

Branch:
- `dev/bootstrap-v2.5`

Checkpointهای مهم:
- `dee3554` — Extension 3.10.3 / Agent 2.5.5 acceptance docs
- `27b78f5` — Universal architecture + Fast Work Path pilot
- `06d901a` — Agent 2.5.6 source checkpoint

Runtime پذیرفته‌شده قبل از rollout جدید:
- Agent live: **2.5.5**
- Extension live: **3.10.3**

Agent 2.5.6:
- source-only
- live acceptance نشده
- نباید activate شود
- به‌عنوان checkpoint بین 2.5.5 و hardening بعدی باقی می‌ماند.

Agent 2.5.7:
- release candidate کامل
- local validation چندمرحله‌ای PASS
- هنوز باید Windows preflight + activation + live acceptance واقعی روی سیستم کاربر PASS شود.

بسته:
- `SOKNA-Agent-2.5.7-Release.zip`
- external SHA-256 اعلام‌شده:
  `8248e9ce7795277984d38ab1de7c895474a19aec701c34cfce38940f2f62b620`

---

# 3) State امن سیستم قبل از 2.5.7

Runtime live تا قبل از activation:
- 2.5.5

مسیر runtime مشاهده‌شده:
- `%LOCALAPPDATA%\SOKNA-Bridge-V2\agent.ps1`

در تلاش قبلی:
- 2.5.6 `.next` files ساخته شدند و hash match داشتند.
- 2.5.6 activate نشد.
- backup 2.5.5 ایجاد شد.
- helper موقت `a256.ps1` خراب تشخیص داده شد و **نباید اجرا شود**.

2.5.7 completion باید فقط tempهای شناخته‌شده خودش/تلاش 2.5.6 را پاک کند و unknown untrackedها را حفظ کند.

---

# 4) Unknown / Untracked Paths که باید حفظ شوند

بدون provenance روشن حذف نشوند:

- `extension/README_APPLY.txt`
- `extension/chrome/.guard-harness.html`
- `extension/chrome/Test/`
- `extension/docs/`
- `extension/tools/`
- `installer/bootstrap/.parts/`
- `installer/bootstrap/prereqs.ps1`
- `tools/plans/`

اصل:
- هیچ cleanup سراسری.
- هیچ `git clean -fd`.
- هیچ `git reset --hard` روی workspace آلوده مگر CR صریح و backup/analysis کامل.

---

# 5) قرارداد دائمی روش توسعه — علت و درس حادثه 2026-09-23

مشکل مشاهده‌شده:
یک تغییر کوچک/متوسط با تعداد زیادی round-trip، malformed carrier، quoting failure، alias failure، budget overflow و activation discovery روی سیستم کاربر طولانی شد.

ریشه:
- Chat/Extension هم Control Plane بود هم Data Plane.
- Artifact فقط source patch بود، نه Complete Unit of Work.
- activation/rollback/helper بعد از apply و روی سیستم کاربر طراحی شد.
- full source در Workspace توسعه به اندازه کافی محور کار نبود.
- commandهای inline طولانی و quoting پیچیده استفاده شدند.

قانون ثابت:

## 5.1 Full-Source Barrier
برای هر کار non-trivial:
1. checkout/archive کامل canonical source در Workspace توسعه.
2. exact base commit معلوم.
3. توسعه، dependency trace، test و packaging خارج از سیستم کاربر.
4. user PC فقط Windows-specific acceptance.

## 5.2 Complete Artifact Rule
Artifact باید «کل واحد کار» باشد:
- payload/source؛
- manifest/hash؛
- stage؛
- activate؛
- rollback/recovery؛
- health/acceptance؛
- repo overlay/exact file set؛
- handoff؛
- validation report؛
- known limitations؛
- exact next action.

## 5.3 Control Plane
Chat/Extension فقط فرمان کوتاه:
- path
- artifact ID
- expected hash
- action

Code/script/archive نباید Base64 داخل carrier شود.

Target safe decoded command budget:
- <= 600 bytes مگر runtime budget دیگری advertise کند.

## 5.4 No Inline Lifecycle Engineering
برای mutation/lifecycle:
- PowerShell چندخطی inline ممنوع.
- nested quoting ممنوع.
- helper داخل Artifact، versioned و hashed.
- PowerShell alias در release script ممنوع.

## 5.5 Two-Strike Rule
دو failure متوالی از یک خانواده:
- STOP روی user PC
- ثبت state
- برگشت به development workspace
- root-cause fix
- rebuild artifact
- rerun local matrix

## 5.6 User PC = Acceptance Environment
روی سیستم کاربر:
- preflight
- platform-specific parser/test
- activation
- rollback test در صورت نیاز
- live acceptance

نه:
- طراحی script
- trial-and-error quoting
- source discovery طولانی
- helper generation در carrier

---

# 6) معماری کلان SOKNA Agent

لایه‌ها:

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

هیچ provider یا sample project جزء Core mandatory نیست.

---

# 7) Workspace Model

Workspace ≠ Git repository.

مدل‌های هدف:

## 7.1 Persistent Local
MVP اصلی:
- پروژه در محل موجود ثبت می‌شود.
- default recommendation: **Register in place**
- Agent پروژه را خودکار move نمی‌کند.

## 7.2 Managed Copy
اگر assessment نشان دهد محل فعلی مناسب نیست:
- Copy
- Verify
- Test
- Explicit Switch
- source deletion جداگانه و explicit

## 7.3 Ephemeral Checkout
برای jobهای موقت:
- temp checkout
- isolated work
- artifact/result export
- cleanup policy
- بدون clone دائمی

## 7.4 Remote Workspace
Roadmap:
- GitHub/remote operation بدون permanent clone
- محدود و policy-driven

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

اصول:
- mutation attributable باشد.
- default behavior محدود و شفاف.
- path escape fail-closed.
- destructive action نیازمند scope معتبر.
- secrets در log/support bundle redact شوند.

---

# 9) ArtifactRoot / DownloadRoot — Requirement قطعی

Agent باید یک root مشخص برای فایل‌هایی که خودش مدیریت می‌کند داشته باشد.

در Installer/Settings:
- کاربر بتواند path را انتخاب کند.
- path canonical و قابل مشاهده باشد.
- تغییر path workflow امن migration داشته باشد.

ساختار پیشنهادی:

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

هر import/download:
- artifact_id
- provider/source
- source reference/URL در صورت مجاز
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

قواعد:
- auto-download خارج ArtifactRoot ممنوع.
- delete خارج ArtifactRoot ممنوع مگر action مستقل و permission صریح.
- fallback موقت باید در UI/log شفاف باشد.
- Downloads عمومی کاربر نباید مقصد پیش‌فرض دائمی Agent باشد.

---

# 10) Artifact Transport / Data Plane

Control Plane فایل حجیم حمل نمی‌کند.

Flow:
1. acquire/fetch
2. size check
3. hash check
4. signature/policy check در صورت وجود
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

هیچ provider mandatory نیست.

Auto-download فقط بعد از:
- ArtifactRoot
- audit
- lifecycle
- cleanup/retention
- security policy
پیاده شود.

---

# 11) Browser / Screenshot / UI QA — نیاز کامل

این قابلیت فراموش نشده و Feature جانبی نیست؛ یکی از capabilityهای اصلی Agent است.

## P3-A Controlled Browser QA
ترجیح:
- Playwright + Chromium یا equivalent controlled browser

قابلیت‌ها:
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
- controlled cookies/storage در scope مشخص

## P3-B Screenshot Matrix
یک page می‌تواند در چند viewport capture شود:
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

گزارش باید severity و evidence داشته باشد.

## P3-D DOM / Geometry Inspection
- DOM snapshot
- bounding boxes
- computed visibility
- scroll containers
- z-index/layer relation در حد قابل اتکا
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

Sensitive payloadها در network log باید redact شوند.

## P3-F Cross-Page Consistency
برای پروژه‌هایی شبیه Cafe:
- typography consistency
- spacing/density
- component reuse
- breakpoint behavior
- shared pattern compliance
- no duplicate UI ownership
- same component = same behavior
- responsive rules

## P3-G Live Browser Capture
برای tab/session واقعی کاربر:
- permission صریح
- screenshot
- DOM/context
- console metadata
- current URL/title
- selected diagnostics

ممنوع:
- hidden capture
- background spying
- credential extraction
- unrestricted cookie/token export

## P3-H Browser Artifacts
همه این موارد به ArtifactRoot:
- PNG/WebP screenshots
- DOM snapshots
- JSON reports
- network summaries
- console logs
- visual diff
- acceptance report

نباید از Chat carrier عبور کنند.

## P3-I Acceptance Recipes
Recipe قابل تکرار:
- scenario ID
- route
- prerequisites
- viewport matrix
- actions
- assertions
- captures
- cleanup

نتیجه:
- PASS / FAIL
- evidence artifact IDs
- exact failure reason

---

# 12) نیازهایی که از SoknaCafe به‌عنوان Reference Workload استخراج شدند

Cafe dependency نیست. فقط این نیازهای عمومی را آشکار کرد:

## 12.1 Browser-Level UI
- geometry واقعی، نه فقط source inspection
- responsive behavior
- mobile/desktop differences
- modal/sheet/popover/drawer
- scroll behavior
- full-page capture
- cross-page consistency
- Design System contract
- duplicate owner detection

## 12.2 Offline/PWA
Agent در آینده باید بتواند:
- online/offline scenarios
- service worker/state evidence
- PWA cache behavior
- offline/online transition tests
را به‌عنوان browser recipe اجرا کند.

## 12.3 Local/Public Topology
نیاز عمومی:
- localhost/local service health
- public endpoint health
- connectivity state
- local/public split
- network diagnostics

بدون hard-code Cafe routes.

## 12.4 Process/Service
قابلیت عمومی:
- process inspect
- service inspect/start/stop/restart با permission
- health probe
- port listener check
- owned-process metadata

## 12.5 Update / Recovery
الگوی عمومی:
- stage side-by-side
- pre-update recovery point
- verify
- atomic/controlled switch
- health
- automatic rollback
- Last-Known-Good
- updater self-recovery

## 12.6 Backup / Restore
Agent Core الزاماً backup product نیست، اما باید بتواند workflows عمومی:
- file/archive verify
- SHA manifests
- fail-closed validation
- restore orchestration
- credential/environment preservation
را پشتیبانی کند.

## 12.7 Printing / External Components
از Print Agent نتیجه عمومی:
- component version discovery
- external binary acquisition
- checksum
- stable channel
- fallback/LKG
- component health
- independent lifecycle

نه hard-code printer/Cafe.

## 12.8 Diagnostics
نیاز عمومی:
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

PowerShell مالک نهایی Installer نیست.

انتخاب ترجیحی:

## 13.1 Inno Setup
مالک:
- Setup.exe
- file installation
- registry
- Installed Apps
- Start Menu
- optional Desktop Shortcut
- uninstall
- basic elevation/lifecycle

## 13.2 Modern self-contained .NET Maintenance Host
مالک:
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

.NET Framework قدیمی هدف ترجیحی نیست؛ modern self-contained .NET ترجیح دارد.

## 13.3 Installer UX
در نصب:
- install location
- ArtifactRoot
- Start Menu
- Desktop shortcut optional
- auto-start policy در صورت طراحی/تایید
- diagnostics path
- permissions summary
- workspace setup: Now / Later

نصب Core نباید نیازمند:
- Git
- GitHub
- Cafe
- PHP
- MySQL
- project-specific runtime
باشد.

---

# 14) Repair / Upgrade / Recover

Repair ≠ Recover.

## Repair
- manifest/hash exact version
- detect missing/corrupt owned files
- restore same-version owned components
- restart/health
- preserve:
  - workspace data
  - credentials
  - user settings
  - ArtifactRoot content طبق policy

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
برای restoring application/workspace data؛ workflow جدا از Repair.

---

# 15) Logs & Support Bundle

هر operation مهم:
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

دو سطح:
- Summary Log
- Technical/Event Log

Support Bundle حداقل:
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
- backup private content مگر explicit inclusion

---

# 16) Stable Runtime Ownership

باید state canonical داشته باشیم:
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

Runtime restart نباید هر بار با WMI discovery از صفر طراحی شود.

Stable launcher/maintenance مالک lifecycle می‌شود.

---

# 17) Current 2.5.7 Candidate — الزامات Acceptance

قبل از activation:
- external ZIP SHA match
- package manifest exact file set
- all file hashes
- Windows PowerShell parser all PS1
- no forbidden release aliases
- current 2.5.5 health
- current capabilities health
- runtime ownership/PID
- recovery/update path writable

اگر preflight fail:
- STOP
- no interactive remote repair
- fix in development workspace
- rebuild package
- rerun local matrix

پس از activation:
- ping = 2.5.7
- capabilities = 2.5.7
- expected artifact actions present
- controlled artifact.inspect PASS
- controlled artifact.apply PASS
- reverse/cleanup PASS
- audit events present
- rollback path hash-verified
- repo finalization فقط بعد از acceptance

---

# 18) Roadmap رسمی

## P0 — Fast Work Path / Artifact Foundation
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

**Current focus:** 2.5.7 acceptance سپس P0-C.

---

## P1 — Universal Installer & Maintenance
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

## P2 — Workspace & Permission Manager
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

## P3 — Browser / Screenshot / Visual QA
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

**این فاز یکی از اهداف اصلی Agent است و حذف/فراموش نشده.**

---

## P4 — Artifact Providers / Auto-download
پس از ArtifactRoot:
- local import
- LAN/shared folder
- provider abstraction
- Google Drive adapter
- OneDrive adapter
- S3/object storage
- GitHub Release Assets
- dedicated service در صورت نیاز
- resume/retry
- checksum/signature
- retention

---

## P5 — Advanced Workspaces / Permissions
- Ephemeral Checkout
- Remote Workspace
- job-scoped permissions
- temporary grants
- richer policy UI
- remote execution adapters طبق security model

---

## P6 — Advanced Automation / Component Lifecycle
در صورت نیاز:
- component registry
- service/process orchestration
- dependency acquisition
- plugin/component health
- release channels
- LKG per component
- richer scheduled/triggered jobs

---

# 19) Definition of Done برای هر Capability

یک feature تمام‌شده نیست مگر:
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

Source-only ≠ live accepted.

---

# 20) QA Philosophy

ترتیب:
1. Source/static QA
2. deterministic local tests
3. package verification
4. target-platform preflight
5. target-platform activation
6. live integration
7. failure/rollback
8. final repo/handoff

هیچ PASS بر اساس فایل روی disk به‌جای runtime activation ادعا نمی‌شود.

---

# 21) Metrics

برای هر rollout:
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

هر تغییر به MUSTهای canonical:
- Change Request
- reason
- risk
- alternative
- rollback
- acceptance criteria

بدون CR:
- fail-closed

---

# 23) Exact Next Action از این checkpoint

1. روی سیستم Windows کاربر ZIP 2.5.7 دانلودشده را با external SHA verify کن.
2. فقط `Preflight-AgentRuntime257.ps1` را اجرا کن؛ این مرحله نباید runtime را switch کند.
3. اگر Preflight PASS:
   - Stage/Activate طبق package tested flow.
4. منتظر live 2.5.7 response.
5. Complete/Acceptance را اجرا کن.
6. فقط بعد از PASS:
   - repo overlay 2.5.7 را exact-stage/commit/push کن.
   - این Master Handoff را به repo canonical اضافه کن.
   - `00_READ_FIRST_NEW_CHAT.md` را به Master + Contract + Current Handoff لینک کن.
7. سپس P0-C: ArtifactRoot/retention/audit UI/config.
8. بعد P1 Installer Foundation.
9. بعد P2 Workspace Manager.
10. سپس سریع وارد P3 Browser/Screenshot QA شو؛ این فاز نباید بی‌دلیل عقب بیفتد.

---

# 24) چیزی که Chat/Agent بعدی نباید از کاربر دوباره بپرسد

تا زمانی که این سند معتبر و state repo/runtime تغییر نکرده:
- Agent مستقل از Cafe است.
- Cafe فقط reference workload است.
- Inno + modern .NET Maintenance معماری ترجیحی Installer است.
- ArtifactRoot باید selectable و audited باشد.
- Git/GitHub optional هستند.
- Register-in-place default recommendation است.
- Browser/Screenshot QA requirement اصلی است.
- user PC development environment نیست.
- full source + complete artifact workflow اجباری است.
- handoff در هر checkpoint اجباری است.
- 2.5.6 نباید live شود.
- candidate بعدی 2.5.7 است.
- unknown untracked paths باید حفظ شوند.
- P0→P1→P2→P3→P4→P5 roadmap پایه است مگر CR صریح.

---

# 25) اصل آخر

هدف SOKNA Agent فقط «اجرای command از Chat» نیست.

هدف نهایی:
یک Agent عمومی، قابل اعتماد، قابل audit و قابل ادامه در پروژه‌های طولانی باشد که بتواند:
- source/workspace را امن مدیریت کند؛
- artifactها را جابه‌جا و verify کند؛
- تغییر کامل را stage/apply/test کند؛
- UI واقعی را ببیند و screenshot/DOM/network/console را QA کند؛
- lifecycle Windows را با installer/repair/update/rollback مدیریت کند؛
- پروژه‌های مختلف را بدون hard-code شدن به هیچ پروژه‌ای پشتیبانی کند؛
- و پس از قطع Chat، از Handoff canonical بدون بازگشت به صفر ادامه دهد.


---

# 26) R2 correction — Windows preflight self-call deadlock

اولین Windows preflight بسته 2.5.7 اولیه در مرحله `PREFLIGHT_CURRENT_HEALTH` timeout شد و طبق fail-closed هیچ activation/restart/mutation runtime انجام نشد.

Root cause:
- Preflight از داخل Agent 2.5.5 با `process.run` اجرا شده بود.
- Agent تا پایان child process منتظر بود.
- همان child دوباره synchronous به HTTP API همان Agent `ping/capabilities` می‌زد.
- در نتیجه dependency cycle ایجاد شد: Agent -> child -> همان Agent.

این خطا به قرارداد دائمی تبدیل شد:
- Agent-mediated child حق synchronous self-call به Agent owner را ندارد.
- Preflight دو mode دارد: `AgentMediated` و `External`.
- Stage همیشه `AgentMediated` را انتخاب می‌کند.
- AgentMediated evidence: control-plane invocation + live PID ownership + runtime/capability version on disk + config/recovery checks.
- External mode برای Maintenance Host مستقل می‌تواند HTTP ping/capabilities انجام دهد.
- بعد از restart، detached activation helper باید health واقعی target را HTTP-check کند.
- dependency-cycle/re-entrancy review برای lifecycle workflow اجباری است.

بسته اولیه 2.5.7 superseded است و نباید دوباره اجرا شود.
یادداشت تاریخی: بسته اولیه، R2 و R3 همگی superseded هستند؛ تنها R4 کاندید مجاز بعدی است.


## Windows R2/R3 activation evidence / R4 state-schema fix
- R2 preflight AgentMediated: PASS.
- transaction `rt257-1790141694403-2e4f9b9b` target health failed before acceptance.
- automatic rollback: PASS؛ active runtime returned safely to 2.5.5.
- R3 barrier حفظ می‌شود: target `-StartupProbe` باید قبل از live stop/switch PASS شود و launcher باید stdout/stderr/exit evidence را ثبت کند.
- R2 is superseded for further activation attempts.


# 27) Current authorized rollout candidate — R4

- بسته مجاز فعلی: **SOKNA-Agent-2.5.7-R4-Release.zip**.
- Original/R1 و R2 برای activation ممنوع‌اند.
- R4 قبل از mutation یک Windows `-StartupProbe` واقعی روی payload اجرا می‌کند؛ سپس فقط در صورت PASS اجازه stop/switch دارد.
- Launcher R4 همان stdout/stderr/exit-code logging R3 را حفظ می‌کند؛ تغییر R4 فقط schema state است.
- R2 transaction `rt257-1790141694403-2e4f9b9b` health fail شد اما rollback خودکار PASS و 2.5.5 restore شد.

- R4 validation evidence: release verifier PASS؛ contract/model 40/40 PASS؛ negative mutation 5/5 PASS؛ Windows R4 acceptance هنوز pending است.


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
