# SOKNA Bridge — Architecture / Reliability Roadmap

Date: 2026-09-25
Status: CURRENT ARCHITECTURE ROADMAP
Repository: `mobaraki20/SOKNA-Bridge`
Canonical development branch: `dev/bootstrap-v2.5`

## Purpose
این سند مرجع ادامه‌ی معماری و توسعه بعد از گفتگوهای 2026-09-25 است. هدف این است که با اتمام یک ChatGPT chat، ایجنت بعدی مجبور نباشد تصمیم‌های معماری، خطاهای قبلی یا مسیر درست اجرای Bridge را دوباره کشف کند.

این سند تاریخچه‌ی handoffهای قبلی را حذف نمی‌کند؛ برای history به `CURRENT_DEVELOPMENT_HANDOFF_FA.md` و knowledge base مراجعه شود. این فایل مرجع «وضعیت فعلی + تصمیم‌های جدید + فازبندی بعدی» است.

## 1. وضعیت واقعی پروژه

### پیاده‌سازی‌های توسعه‌ای موجود
- D0 و P0-C ArtifactRoot: implemented as development checkpoint.
- P1 Universal Installer / Maintenance: implementation exists; exact Windows lifecycle acceptance هنوز کامل PASS نشده.
- P2 Workspace / Permission Manager: implemented as development checkpoint.
- P3 Browser / Screenshot / Visual QA: Controlled Browser QA implemented; Live Browser Capture policy-only.
- P4 Artifact Providers: implemented as development checkpoint.
- P5 Advanced Workspaces / job-scoped grants / remote adapter boundary: implemented as development checkpoint.
- P6 Component lifecycle / automation: implemented as development checkpoint.
- R0 Whole-product integration: implemented as development checkpoint.
- R1 deterministic source freeze / exact-commit release evidence: implemented as development checkpoint.

اصل مهم: این موارد development-complete بودن بخش‌ها را نشان می‌دهند، نه LIVE acceptance کل محصول.

## 2. وضعیت Installer / P1 blocker در 2026-09-25

روی branch اصلی فیکس `test: harden P1 synthetic payload copy` ثبت شد. Quick Windows CI و Native CI روی آن PASS شدند.

برای اثبات P1 واقعی، branch موقت CI ساخته شد و Setup.exe با موفقیت ساخته شد:
- Setup build: PASS
- clean install: PASS
- health: PASS
- support bundle: PASS
- repair: PASS
- lifecycle acceptance: FAIL قبل از شروع upgrade واقعی

خطای دقیق جدید:
`SYNTHETIC_PAYLOAD_OWNED_PATH_MISSING: 6.1/runtime/agent.ps1`

معنا: فیکس diagnostic موفق شد مسیر خراب را آشکار کند. blocker فعلی داخل `New-SyntheticPayload` / manifest-path generation است؛ نه در install/health/repair و نه هنوز در خود upgrade runtime.

تا رفع این blocker و PASS شدن P1 full Windows acceptance، Setup.exe نباید به عنوان installer نهایی / release-ready معرفی شود.

## 3. تصمیم معماری: Transport فعلی بماند، Contract ساده و enforce شود

Native Messaging / Native Host / localhost Agent فعلاً از ریشه جایگزین نشود. مشکل‌های واقعی ثبت‌شده بیشتر مربوط به state/correlation/contract enforcement بوده‌اند، نه ذات transport.

Native Host باید thin proxy باقی بماند و business/runtime logic را duplicate نکند.

### پروتکل واحد آینده
تمام پیام‌های control/result باید envelope استاندارد و versioned داشته باشند:
- `protocolVersion`
- `messageId`
- `correlationId`
- `parentId`
- `kind`
- `action`
- `schemaVersion`
- `timestamp`

`kind` باید محدود و صریح باشد:
- `command`
- `ack`
- `event`
- `result`
- `nack`

هر event شناسه مستقل دارد؛ commandId فقط correlation metadata است و برای duplicate detection terminal event استفاده نمی‌شود.

## 4. Semantic Command Compiler — AI نباید carrier بسازد

AI نباید Base64URL، V3/V4 selection، payload budget، carrier marker، round-trip validation یا correlation plumbing را به‌صورت ذهنی مدیریت کند.

AI فقط intent/semantic command می‌دهد، مثلاً:
- `exec`
- `batch`
- `job`
- `artifact`

و یک deterministic compiler باید:
1. capability/version را بخواند؛
2. route را بر اساس policy انتخاب کند؛
3. schema validation انجام دهد؛
4. IDs/correlation را بسازد؛
5. carrier مناسب را تولید کند؛
6. budget و round-trip را validate کند؛
7. فقط در صورت PASS فرمان را به Extension تحویل دهد.

هدف: reasoning اصلی AI صرف مسئله‌ی کاربر شود، نه جزئیات transport.

## 5. Fail-silent ممنوع / NACK قطعی

هر carrier یا command خراب که correlation قابل بازیابی دارد باید NACK machine-readable برگرداند.

Legacy parsing paths که `catch {}` یا diagnostic بدون commandId/final تولید می‌کنند باید اصلاح یا retirement شوند.

AI نباید برای فهمیدن اینکه فرمان اصلاً به Extension/Bridge رسیده، به Health دستی کاربر وابسته باشد.

## 6. ACK و Activity Monitor

Chat نباید مرحله‌به‌مرحله شلوغ شود.

در Chat فقط:
- یک تایید کوتاه وقتی Windows Agent واقعاً کار را accepted/started کرد؛
- نتیجه نهایی یا failure نهایی.

جزئیات در Activity Monitor Extension نمایش داده شود.

### Agent = Source of Truth
برای هر job حداقل:
- jobId / commandId
- action
- state
- currentStep
- progress
- startedAt / updatedAt / completedAt
- error
- resultRef

State model پیشنهادی:
`queued -> accepted -> running -> waiting -> completed|failed|cancelled`

### Event Journal
Agent باید durable event journal داشته باشد، مثلاً:
- `command.accepted`
- `job.created`
- `step.started`
- `process.started`
- `step.completed`
- `step.failed`
- `job.completed`
- `job.failed`

Activity Monitor و AI هر دو باید از همین data model استفاده کنند.

### APIs مورد نیاز
- `job.list`
- `job.events` یا `job.activity`
- extension transport status برای current command / pending result / delivery diagnostics

### Process monitoring
فقط processهایی نمایش داده شوند که Agent خودش ایجاد کرده و ownership آنها را تایید می‌کند؛ نه تمام processهای ویندوز.

## 7. Browser Inspection / UI QA — فاز رسمی جدید

### هدف
کاربر بتواند بگوید:
«برو بخش سفارش، انبار و صندوق پنل را بررسی کن»
و نیاز نباشد دستی از صفحه‌ها screenshot بگیرد و به AI بفرستد.

این قابلیت Live Screen Sharing نیست. این یک Controlled Browser Inspection Job است.

### زیرساخت موجود
Controlled Browser QA فعلی می‌تواند با مرورگر ایزوله:
- goto
- wait
- click
- type
- select
- screenshot viewport/full-page/element
- DOM
- geometry/layout
- accessibility
- console
- network
- visual baseline/diff
را تولید کند و evidence حجیم را در ArtifactRoot نگه دارد.

### gapهای فعلی
1. `browser.recipe.run` بیشتر deterministic recipe است؛ AI هنوز یک session سطح‌بالا ندارد که با هدف کلی، صفحه را inspect کند و بر اساس evidence مرحله بعد را انتخاب کند.
2. outbound evidence path برای PC -> Chat/AI به صورت first-class کامل نیست؛ Chat->PC artifact import وجود دارد، اما screenshot/report باید بدون واسطه کاربر به AI قابل مصرف شود.

### قابلیت‌های مورد نیاز
- `browser.audit.run` یا equivalent high-level inspection job
- stateful/iterative inspection session در صورت نیاز، بدون وابستگی به live user tab
- route/page discovery bounded by allowed origins and permissions
- step timeline + evidence refs
- Outbound Artifact Gateway برای selected screenshot/report/DOM evidence
- before/after rerun با همان scenario برای تایید اصلاح UI

### جریان هدف
`User Goal -> AI semantic inspection intent -> Browser Inspection Job -> Evidence Artifacts -> AI analysis -> code fix -> same inspection rerun -> before/after result`

### Acceptance scenario مرجع
SoknaCafe فقط Reference Workload است و Core نباید project-specific شود.

Acceptance نمونه:
1. workspace مجاز register شده باشد.
2. AI بگوید چند بخش پنل مشخص بررسی شوند.
3. Agent مرورگر isolated را باز کند و login/session را از secret refs ایمن bootstrap کند.
4. navigation/actions انجام شوند.
5. screenshot + DOM + geometry + console/network evidence ساخته شود.
6. summary کوچک از Result Plane برگردد.
7. evidence انتخابی از Artifact Plane برای AI قابل دسترس شود.
8. AI مشکل را شناسایی و code change را آماده کند.
9. همان audit دوباره اجرا شود و regression/visual result مقایسه شود.
10. user نباید وسط این چرخه دستی screenshot منتقل کند.

## 8. Chat exhaustion / New Chat continuity

محدودیت طول ChatGPT یک شرایط عادی پروژه در نظر گرفته شود، نه exception.

Handoff متنی به‌تنهایی کافی نیست اگر rules فقط توصیه باشند. New-chat recovery باید deterministic باشد.

### New-chat execution gate
ایجنت جدید قبل از هر command باید:
1. `00_READ_FIRST_NEW_CHAT.md` را بخواند.
2. همین roadmap را بخواند.
3. `CURRENT_DEVELOPMENT_HANDOFF_FA.md` را برای history/status بخواند.
4. knowledge base canonical entries را بخواند.
5. live `ping` + `agent.capabilities` را probe کند؛ version را حدس نزند.
6. route selection را به compiler/policy بسپارد؛ از کاربر نپرسد batch/artifact/carrier را چطور انجام دهد مگر تصمیم انسانی واقعاً لازم باشد.

هدف: ایجنت جدید اشتباه‌های ثبت‌شده را تکرار نکند.

## 9. فازبندی از این نقطه

### R2-A — Contract Reliability
- unified envelope/schema
- deterministic semantic command compiler
- legacy fail-silent closure
- correlated NACK tests end-to-end
- no hand-built carrier path in normal AI flow

### R2-B — Execution Observability
- Agent event journal
- `job.list`
- `job.events/activity`
- explicit ACK chain internally
- Extension Activity Monitor
- owned-process visibility
- machine-readable failures for AI

### R2-C — Artifact Round Trip
- preserve current inbound Artifact Plane
- implement outbound Artifact evidence path PC -> AI
- screenshots/log bundles/reports transferable by ref/hash
- no large binary/control-plane mixing

### R2-D — Browser Inspection / AI QA Loop
- high-level browser audit job
- multi-page inspection
- evidence selection
- AI consume/fix/retest loop
- SoknaCafe UI QA as project-agnostic reference acceptance

### R2-E — New Chat Continuity / Autonomy
- read-first + roadmap + KB hard gate
- deterministic route policy
- resume from current job/state without user re-explaining architecture
- anti-regression tests for known historical mistakes

### P1-FIX — Installer blocker
- fix synthetic manifest path generation causing `6.1/runtime/agent.ps1`
- rerun exact P1 full Windows validation
- require install/health/support/repair/upgrade/remove/rollback/broken-upgrade rollback/uninstall PASS

### R3 — Whole-product Windows Gate
پس از R2 و P1-FIX:
- exact-commit Windows full validation
- P0-C..P6 + R0/R1/R2 integration
- validated Setup.exe + evidence artifact

### LIVE
فقط بعد از R3 PASS:
- final Windows install on user PC
- runtime/extension activation
- end-to-end acceptance
- Browser Inspection reference workflow
- Activity Monitor/ACK/NACK acceptance

## 10. چیزهایی که از اول بازنویسی نمی‌شوند
- ArtifactRoot architecture
- Workspace/permission model
- Browser controlled runner foundation
- Artifact provider model
- Component/automation lifecycle
- Inno + self-contained .NET maintenance ownership model
- Native Host thin-proxy principle

این‌ها توسعه داده/تکمیل می‌شوند، نه اینکه بدون دلیل replace شوند.

## 11. Exact Next Action
1. رفع blocker `SYNTHETIC_PAYLOAD_OWNED_PATH_MISSING: 6.1/runtime/agent.ps1` در P1 test harness/path generation.
2. اجرای مجدد P1 full و اثبات lifecycle.
3. سپس شروع R2-A با تست contract/compiler قبل از UI Activity Monitor.
4. R2-B و R2-C.
5. R2-D Browser Inspection.
6. R2-E continuity hardening.
7. whole-product Windows gate و سپس LIVE.

## Non-negotiable
- SoknaCafe در توسعه SOKNA Bridge READ-ONLY reference workload باقی بماند مگر کاربر صریحاً یک task جدا برای SoknaCafe بدهد.
- user PC acceptance endpoint است، نه scratch development workspace.
- GitHub milestone/CI boundary است، نه scratchpad.
- no release/live claim without exact Windows evidence.
