# ArtifactRoot Contract v1

تاریخ: 2026-09-24
وضعیت: P0-C development contract

## هدف
ArtifactRoot مرز مدیریت‌شده‌ی Artifact Plane است. Agent فقط داخل این root حق نوشتن/پاک‌سازی خودکار artifact را دارد. فایل بیرون root فقط با action صریح import خوانده و پس از verify به root وارد می‌شود.

## ساختار اجباری
- `incoming/`
- `staging/`
- `accepted/`
- `failed/`
- `cache/`
- `browser/`
- `logs/`
- metadata artifactها زیر `logs/artifact-metadata/`
- audit append-only زیر `logs/artifact-events.jsonl`

## انتخاب root و migration
1. اگر `config.artifact_root` مقدار دارد همان root canonical است.
2. در نبود تنظیم، managed default برابر `%LOCALAPPDATA%\SOKNA\Bridge\artifacts` است؛ fallback runtime-local فقط وقتی LOCALAPPDATA در دسترس نیست.
3. fallback تاریخی 2.5.7 یعنی `%USERPROFILE%\Downloads` دیگر managed root پیش‌فرض نیست؛ فقط به‌عنوان `legacy_root` گزارش می‌شود.
4. هیچ auto-move/auto-delete از legacy root انجام نمی‌شود. ورود فایل legacy/outside-root فقط با `artifact.import.local` انجام می‌شود.

## سیاست storage
پیش‌فرض development:
- root quota: 10 GiB.
- single artifact: 512 MiB.
- retention: incoming 7d، staging 24h، accepted 30d، failed 14d، cache 7d، browser 30d.
- همه قابل تنظیم از `config.artifact_policy` هستند.
- `artifact.root.status` usage هر managed directory، quota remaining و drive free/total را برمی‌گرداند.

## import transition
`artifact.import.local`:
1. source باید regular file و non-reparse باشد.
2. size/quota preflight.
3. copy به `staging/.partial-*`.
4. size/hash verify.
5. atomic move به `incoming/`.
6. metadata write.
7. quota post-check.
8. required audit event.

Hash mismatch، metadata/audit failure یا quota failure باید temp/final را rollback کند و نباید artifact ناقص به incoming نهایی تبدیل شود.

## cleanup
- `artifact.cleanup` به‌صورت پیش‌فرض dry-run است.
- حذف واقعی فقط با `execute=true`.
- cleanup فقط managed directories شناخته‌شده را لمس می‌کند؛ `logs/` در retention delete v1 نیست.
- traversal و reparse/symlink fail-closed هستند.
- stale `staging/.partial-*` و tx directories طبق retention staging قابل بازیابی/cleanup هستند.
- delete بیرون ArtifactRoot ممنوع است.

## integration با artifact.inspect/apply
Runtime 2.6.0 همان validation 2.5.7 برای ZIP/manifest/git patch را نگه می‌دارد، اما staging را داخل ArtifactRoot انجام می‌دهد و metadata state را پس از inspect/apply به `validated`/`applied` ارتقا می‌دهد.

## عدم auto-execute
import/download فقط acquisition است. ورود artifact هرگز به‌صورت implicit `artifact.apply` یا process execution را trigger نمی‌کند.

## gateها
- native Go negative/unit matrix در development workspace.
- source contract test cross-platform.
- Windows reparse/junction/runtime module matrix در CI.
- live runtime activation فقط در Phase LIVE نهایی، نه P0-C development.
