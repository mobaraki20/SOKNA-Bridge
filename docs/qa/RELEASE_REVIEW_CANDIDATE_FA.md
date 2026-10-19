# SOKNA Bridge — کاندید بازبینی نهایی، نه Release
تاریخ: 2026-10-19

این بسته در GitHub Actions روی Windows Server 2025 ساخته می‌شود و فقط برای بررسی مهندسی است. ساخت روی GitHub به‌معنی نصب در کامپیوتر کاربر یا اجازهٔ استقرار نیست.

## قبل از هر تصمیم انتشار
۱. فایل `REVIEW_PROVENANCE.json` را بخوانید: `source_commit` باید با Checkout اصلی GitHub CI و `installer_sha256` با هش محاسبه‌شده از Setup برابر باشد.
۲. `SHA256SUMS.txt` را روی همهٔ فایل‌ها کنترل کنید. این هش‌ها **تمامیت بسته** را مشخص می‌کنند، نه هویت/اعتبار ناشر. GitHub Actions artifact به‌تنهایی یک انتشار امضاشده نیست.
۳. `binaries_authenticode_status` را بررسی کنید؛ اگر موردی `Valid` نیست، انتشار نهایی را تأیید نکنید. اگر همه `Valid` باشند هم هنوز سیاست امضا/زنجیرهٔ اعتماد باید بررسی شود.
۴. نصب افزونهٔ Google Chrome از محیط گرافیکی و پایدار ماندن آن باید مستقل تأیید یا به‌عنوان محدودیت پذیرفته شود. تست Chrome CI تنها DevTools-based است.
۵. دربارهٔ مجوزهای `debugger` و `optional_host_permissions`، نحوهٔ داده‌برداری/انتقال و رضایت کاربر ممیزی تکمیلی و تصمیم روشن داشته باشید.
۶. پس از شواهد و اجازهٔ صریح مالک، فرآیند Merge، Tag و GitHub Release باید جداگانه انجام شوند.

## وضعیت شناخته‌شده
- Windows Server 2025، Chrome Stable و E2E Native Host: Engineering PASS در CI
- نصب و ارتقای Inno، Repair، Rollback و بازیابی Agent: Engineering PASS در CI
- UI installation persistence و امضای رسمی: **NOT_VERIFIED / NOT_RUN**
- `release_ready=false` و PR باید Draft بماند، مگر تصمیم جدید مبتنی بر شواهد.

هیچ‌کدام از فایل‌های این بسته برای نصب در سیستم کافه نیستند. محصول بریج کاملاً مستقل از سامانهٔ کافه است.
