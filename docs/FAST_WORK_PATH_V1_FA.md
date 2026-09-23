# Fast Work Path v1 — Artifact Pilot

تاریخ: 2026-09-23
هدف: حذف انتقال حجیم و ویرایش ریز از Chat/Extension و تبدیل Chat به Control Plane.

## Artifact Pilot 001

این Pilot عمداً بدون ساخت subsystem بزرگ شروع می‌شود.

Package:
- artifact.json
- change.patch
- HANDOFF_COMPLETE_FA.md

جریان:
1. Assistant کل تغییر را خارج از Bridge آماده و QA اولیه می‌کند.
2. یک ZIP واحد به کاربر تحویل می‌شود.
3. کاربر ZIP را دانلود می‌کند؛ هیچ paste/base64 حجیمی در Chat انجام نمی‌شود.
4. Agent مسیر محلی فایل را می‌گیرد.
5. SHA-256 کل ZIP با مقدار اعلام‌شده تطبیق داده می‌شود.
6. ZIP در staging موقت extract می‌شود.
7. artifact.json بررسی می‌شود: base branch/head و نوع payload.
8. `git apply --check change.patch` باید PASS شود.
9. فقط در صورت PASS، patch apply می‌شود.
10. QA repo اجرا می‌شود، سپس exact staging / commit / push.
11. زمان، round-trip و failure count ثبت می‌شود.
12. پس از اثبات Pilot، این جریان به actionهای first-class مثل artifact.inspect/import/apply ارتقا می‌یابد و providerهای remote اضافه می‌شوند.

## Safety

- Artifact هرگز مستقیم execute نمی‌شود.
- base commit mismatch باید fail-closed باشد.
- apply بدون `git apply --check` ممنوع.
- untracked ناشناخته دست‌نخورده می‌ماند.
- SoknaCafe یا هر reference project خارج از target workspace است.
- rollback قبل از commit با `git apply -R` یا reset محدود به فایل‌های Pilot قابل انجام است؛ reset سراسری روی workspace آلوده ممنوع.

## Success Criteria

Pilot موفق است اگر انتقال و apply این بسته با یک دانلود کاربر و حداکثر دو تعامل اصلی Bridge انجام شود، بدون file-by-file carrier، و صحت hash/base/apply/QA اثبات شود.

اگر موفق شد، Artifact Transport به‌عنوان مسیر استاندارد تغییرات متوسط/حجیم canonical می‌شود.
