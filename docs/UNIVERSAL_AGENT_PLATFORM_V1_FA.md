# مشخصات معماری Universal Agent Platform v1

تاریخ ثبت: 2026-09-23
وضعیت: Canonical architecture baseline / implementation roadmap
پروژه: SOKNA Agent / SOKNA Bridge
اصل بنیادین: Project-Agnostic Core

## 1. مرز پروژه‌ها

SOKNA Agent یک پروژه مستقل و Universal است. هیچ پروژه نمونه‌ای، از جمله SoknaCafe، نباید dependency، default workspace، installer target یا assumption هسته Agent باشد.

پروژه‌های واقعی فقط Reference Workload هستند تا نیازهای عمومی Agent کشف و acceptance شود. حذف کامل هر Reference Project نباید معماری Agent را بشکند.

## 2. مدل Workspace

Workspace مساوی Git repository نیست و Git/GitHub prerequisite هسته نیست.

مدل‌های هدف:
- Persistent Local: پوشه موجود روی سیستم؛ حالت اصلی MVP.
- Temporary / Ephemeral Checkout: checkout موقت job-scoped.
- Remote Workspace: عملیات remote-only بدون clone دائمی؛ roadmap.

پیش‌فرض onboarding برای پروژه موجود Register-in-place است. Move خودکار پروژه ممنوع است مگر پس از assessment شفاف و تایید صریح کاربر. انتقال امن در صورت نیاز باید Copy -> Verify -> Test -> Switch باشد و حذف source عملیات جداگانه باشد.

## 3. Permission Model

هسته باید project-agnostic و scope-based باشد:
- مسیر/پوشه: Read / Write / Deny.
- ابزار/اپلیکیشن: allowlist/selective.
- scope موقت یا job-scoped در roadmap.
- audit برای mutationها.
- هیچ permission نباید از نام پروژه hard-code شود.

## 4. Control Plane و Data Plane

Chat/Extension فقط Control Plane است. انتقال فایل حجیم از carrier/base64 مسیر عادی نیست.

Data Plane مستقل با Artifact Transport:
- artifact_id
- size
- sha256
- created_at / expires_at
- content_type
- source/provider
- job_id
- optional signature/encryption

Agent باید Download/Import -> Size Check -> Hash Check -> Policy/Signature Check -> Stage -> Inspect -> Apply را اجرا کند.

Providerها pluggable هستند: local file/downloads، shared folder/LAN، Google Drive، OneDrive، S3، GitHub Release یا provider اختصاصی. هیچ provider واحدی dependency هسته نیست.

## 5. Browser / UI Development

Browser QA قابلیت درجه‌یک Agent است، نه افزونه جانبی.

دو مسیر:
- Controlled Browser QA: Playwright/Chromium، viewport matrix، screenshot/full-page، console، network، DOM/accessibility snapshot.
- Live Browser Capture: با permission صریح کاربر از tab جاری، screenshot/DOM/console/page metadata تولید شود.

خروجی‌های حجیم Browser باید Artifact باشند نه carrier.

## 6. Installer Architecture

PowerShell مالک lifecycle محصول نهایی نیست.

انتخاب معماری:
- Inno Setup: مالک Windows packaging/lifecycle عمومی شامل Setup.exe، files، registry، Installed Apps، Start Menu، optional Desktop shortcut و uninstall.
- Self-contained modern .NET Maintenance executable: مالک preflight، diagnostics، support bundle، health، repair، upgrade orchestration، rollback و future workspace/bootstrap logic.
- .NET Framework قدیمی هدف نیست؛ در صورت استفاده از .NET، runtime جدید به صورت self-contained/single-file ترجیح دارد.
- Installer هیچ اطلاعی از Cafe/PHP/MySQL/GitHub یا پروژه خاص ندارد.

Installation و Workspace Configuration دو مرحله مستقل هستند. بعد از نصب Core، کاربر می‌تواند Workspace اضافه کند یا Later را انتخاب کند.

## 7. Lifecycle و Diagnostics

هر session مهم:
- Session ID
- Job ID
- Workspace ID در صورت وجود
- Stage
- timestamp/duration
- result
- error/exit code
- next action

دو لایه log: Summary + Technical.
Support Bundle باید حداقل summary.json، events.jsonl، version/health و logهای مرتبط را با redaction secrets تولید کند.

Repair با reinstall کور فرق دارد: exact-version manifest/hash -> restore affected components -> health. Workspace/user data/credentials نباید با Repair حذف شوند.

Upgrade: download/verify -> stage -> switch -> health -> rollback on failure.

## 8. Fast Work Path — اولویت P0

قبل از فازهای بزرگ، مسیر توسعه خود Agent باید سریع شود.

قاعده:
Inspect/prepare complete change outside control plane -> package artifact -> transfer by reference/file -> verify -> bounded apply -> QA -> commit/push -> live acceptance.

برای تغییرات deterministic دو مرحله‌ای و بیشتر، job.batch/plan ترجیح دارد. discovery تکراری ممنوع؛ agent.capabilities منبع action/schema runtime است.

هدف Pilot: یک patch/مجموعه فایل متوسط با حداکثر 1 تا 2 round-trip اصلی از Artifact تا apply منتقل شود. معیارها:
- elapsed time
- Bridge round-trip count
- command failures
- bytes carried through Chat

## 9. ترتیب فعلی Roadmap

P0: Fast Work Path / Artifact Transport pilot
P1: همین Architecture Contract + handoff discipline
P2: Universal Installer Foundation (Inno + .NET Maintenance)
P3: Workspace Manager v1 (Persistent Local، optional Local Git/GitHub)
P4: Browser/Screenshot QA v1
P5: richer providers، Ephemeral، Remote Workspace و advanced permission UI

## 10. قانون Handoff

پروژه طولانی است و chatها به محدودیت طول می‌رسند. هر checkpoint معنادار باید Handoff کامل و قابل ادامه داشته باشد.

هر Artifact انتقالی مهم باید یک HANDOFF کامل همراه خود داشته باشد؛ handoff باید حداقل شامل branch/head، runtime versions، تصمیمات canonical، تغییرات انجام‌شده، تست‌ها، محدودیت‌ها، فایل‌های باز/ناشناخته، کارهای باقی‌مانده و Exact Next Action باشد.

چت جدید نباید discovery را از صفر تکرار کند؛ ابتدا handoff و 00_READ_FIRST را می‌خواند.
