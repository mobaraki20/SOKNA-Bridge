# SOKNA Bridge — تصمیم فنی توزیع و نصب افزونهٔ Chrome
تاریخ: 2026-10-19 | محدوده: فقط Google Chrome، ویندوز GitHub Runner 2025

## انتخاب فعلی
بستهٔ آزمایشی مستقل و قابل بازبینی شامل نصب‌کنندهٔ Windows، پوشهٔ کامل و hash-verified افزونه، SHA256SUMS و سند منشأ است. نصب Agent با Inno انجام می‌شود؛ اما فعال‌سازی افزونهٔ Unpacked به‌صورت آگاهانه و جدا از نصب ویندوزی است.

در Google Chrome Stable روش پشتیبانی‌شدهٔ محلی عبارت است از بازکردن `chrome://extensions`، فعال‌کردن Developer Mode و انتخاب **Load unpacked** از پوشهٔ `extension` نسخهٔ مورد تأیید. در زمان نصب، دامنه‌ها/مجوزها را بررسی کنید. بخش‌های `debugger`، `nativeMessaging` و `optional_host_permissions` به‌دلیل قابلیت‌های حساس بریج مهم‌اند. از فعال‌سازی متمرکز مجوزهای HTTP/HTTPS برای همهٔ سایت‌ها خودداری شود؛ فقط Origin مشخص و با رضایت کاربر.

**محدودیت تست:** تست اتوماتیک Google Chrome Stable در GitHub با DevTools (`Extensions.loadUnpacked`) موفق بوده؛ ولی این روش در Chrome 155 الزاماً افزونه را پس از بسته و بازکردن مرورگر به‌صورت خودکار نگه نمی‌دارد. در CI افزونه بعد از restart با DevTools دوباره بارگذاری شده است؛ `chrome.storage.local` پایدار بوده. از این نتیجه **نه شکست و نه موفقیت** نصب از مسیر گرافیکی استنتاج نکنید.

## نصب بدون دخالت کاربر یا توزیع عمومی
مسیر فنی انتشار مصرف‌کننده روی Chrome Stable در ویندوز، بسته/شناسهٔ افزونه در Chrome Web Store و سیاست‌های مربوط به آن است. نصب خودکار از رجیستری با اشاره به CRX محلی در Chrome Stable ویندوز، مسیر قابل اتکای توزیع نیست. سیاست‌های سازمانی فقط برای محیط مدیریتی مجاز و با منشأ بسته/به‌روزرسانی معتبر و مدیریت‌شده بررسی شوند؛ این کاندید آن‌ها را اعمال نمی‌کند.

**بنابراین:** انتشار عمومی بدون داشتن مسیر معتبر انتشار/به‌روزرسانی افزونه **باز است**؛ این بسته فقط برای کاندید بازبینی مهندسی است. هیچ CRX خودساخته‌ای با ادعای امضای رسمی ساخته نشده و هیچ تنظیم `Policies`، رجیستری یا Chrome Preferences کاربر دست‌کاری نمی‌شود.

## قرارداد بسته و امضا
- `SOKNA-Bridge-Setup-2.7.1-x64.exe` از exact GitHub checkout همان Build
- `extension/` از همان Installer Payload و سازگار با extension ID مبتنی بر public key manifest
- `installed-manifest.json` با source SHA و هش اجزای نصب
- `SHA256SUMS.txt` هش فایل‌های خروجی
- `REVIEW_PROVENANCE.json` شامل نسخه، commit، extension ID، SHA256 نصب‌کننده و وضعیت واقعی Authenticode
- هیچ certificate، secret، token، key خصوصی، دادهٔ کاربر یا مخزن کافه در بسته قرار نگیرد.

## مانع‌های باقیمانده
- UI-only نصب گرافیکی افزونه و ماندگاری آن در Chrome Stable: `NOT_RUN`
- امضای Authenticode از گواهی معتبر منتشرکننده: تا مشاهدهٔ `Valid` برای باینری‌های لازم، `NOT_VERIFIED`.
- ممیزی کامل مستقل حریم خصوصی و رضایت برای مجوزها: `REVIEW_REQUIRED`.
- تأیید Release/Publish توسط مالک: هنوز انجام نشده.

**منابع فنی:** Chrome for Developers — [Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) و Chrome/Chromium — [External extensions](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions-admindocs).
