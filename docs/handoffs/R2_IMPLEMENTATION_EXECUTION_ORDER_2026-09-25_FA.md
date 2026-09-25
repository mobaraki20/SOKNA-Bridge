# SOKNA Bridge — R2 Implementation Execution Order

Date: 2026-09-25
Status: CANONICAL EXECUTION ORDER
Repository: `mobaraki20/SOKNA-Bridge`
Working branch: `r2/contract-reliability`

## هدف
این سند ترتیب اجرایی قطعی تا رسیدن به فایل نصبی قابل تست را مشخص می‌کند. فایل نصبی خروجی نهاییِ توسعه و اعتبارسنجی است، نه قدم بعدی.

## قانون اصلی
تا وقتی تمام فازهای R2 و سپس P1-FIX و R3 طبق acceptanceهای خود PASS نشده‌اند، `Setup.exe` به عنوان خروجی تست کاربر تولید/تحویل نهایی نمی‌شود.

## ترتیب قطعی

### 1) R2-A — Contract Reliability
- unified versioned envelope/schema
- semantic command compiler به عنوان مسیر canonical
- AI بدون ساخت دستی Base64/V3/V4/carrier
- route/schema/capability validation قبل از forwarding
- correlated machine-readable NACK با `executed=false`
- حذف fail-silent
- جایگزینی کامل قابلیت‌های legacy قبل از حذف فیزیکی آن‌ها
- سپس retirement/delete واقعی V2/B64/SOKNA3CMD/SOKNA4CMD/carrier-guard runtime paths
- acceptance: exec/batch/job/artifact + malformed/oversize/wrong-route scenarios end-to-end PASS

### 2) R2-B — Execution Observability
- Agent durable event journal
- `job.list`
- `job.events` / `job.activity`
- explicit accepted/started ACK chain
- owned-process visibility فقط برای processهای ایجادشده توسط Agent
- Extension Activity Monitor
- terminal result/failure delivery قابل correlation
- acceptance: queued/accepted/running/waiting/completed|failed|cancelled state transitions + reconnect/reload PASS

### 3) R2-C — Artifact Round Trip
- inbound Artifact Plane فعلی حفظ شود
- Outbound Artifact Router/Gateway برای PC -> AI/User
- file/ZIP/build/screenshot/log/report با ref/hash/metadata
- local path هرگز به عنوان delivery نهایی جا زده نشود
- public HTTPS link فقط sanitized و بدون secret
- signed/credential-bearing URL فقط protected ref
- delivery failure باید result summary را حفظ کند
- acceptance: small file, large ZIP, screenshot, log bundle, large JSON/result.get PASS

### 4) R2-D — Browser Inspection / AI QA Loop
- high-level `browser.audit.run` یا معادل آن
- multi-page bounded inspection
- isolated browser/session bootstrap با secret refs
- screenshot + DOM + geometry + accessibility + console/network evidence
- evidence selection و outbound artifact delivery
- AI consume -> fix -> rerun same audit -> before/after comparison
- acceptance: user بدون جابه‌جایی دستی screenshot بتواند چرخه را کامل کند

### 5) R2-E — New Chat Continuity / Autonomy
- machine-readable bootstrap/capability manifest
- persistent work-session state خارج از Chat
- resume active jobs/artifacts/results از chat جدید
- fail-closed execution gate تا bootstrap/session compatibility آماده نباشد
- route/file/GitHub/batch/job rules از Bridge/compiler، نه حافظه مدل
- anti-regression برای اشتباه‌های تاریخی ثبت‌شده
- acceptance: chat جدید بدون آموزش دوباره کاربر، state و rules را بازیابی و ادامه دهد

### 6) P1-FIX — Installer Lifecycle Blocker
فقط بعد از تکمیل R2:
- رفع synthetic manifest/path-generation blocker
- install/health/support/repair/upgrade/remove/rollback
- broken-upgrade automatic rollback
- uninstall + locator/ArtifactRoot ownership acceptance
- exact Windows lifecycle PASS

### 7) R3 — Whole-product Windows Gate
- exact-commit full Windows validation
- P0-C..P6 + R0/R1/R2 integration
- regression + adversarial acceptance
- source commit / hashes / evidence immutable

### 8) User Test Installer
فقط پس از R3 PASS:
- ساخت `Setup.exe` از همان exact commit تاییدشده
- انتشار artifact همان CI run
- SHA256 و evidence همراه آن
- سپس تحویل فایل نصبی به کاربر برای تست واقعی

## قاعده حذف legacy
هیچ قابلیت legacy صرفاً حذف نمی‌شود. برای هر capability ابتدا replacement canonical + automated acceptance لازم است؛ سپس کد قدیمی از runtime و تست‌های فعال حذف می‌شود. archive تاریخی در صورت نیاز فقط خارج از runtime/build graph باقی می‌ماند.

## Do not
- به `SoknaCafe` دست نزن مگر task جدا و صریح کاربر.
- برای زودتر رسیدن به Setup، فاز R2 را دور نزن.
- development checkpoint را معادل LIVE/Windows acceptance اعلام نکن.
- فایل نصبی از commitی غیر از commit تاییدشده R3 تحویل نده.

## Definition of Done قبل از Setup
همه موارد زیر باید PASS باشند:
1. R2-A contract/semantic/legacy retirement
2. R2-B observability/activity
3. R2-C outbound artifact round-trip
4. R2-D browser inspection round-trip
5. R2-E new-chat bootstrap/resume hard gate
6. P1 full installer lifecycle
7. R3 exact-commit whole-product Windows gate

اگر هرکدام FAIL یا UNKNOWN باشد، فایل نصبی هنوز خروجی قابل تحویل نیست.
