# SOKNA Bridge — بررسی امنیت افزونهٔ Chrome و آمادگی انتشار
تاریخ: ۱۹ اکتبر ۲۰۲۶ (۱۴۰۵/۰۷/۲۷)
وضعیت: **گزارش Engineering / نه مجوز Release**

## محدوده آزمون مورد قبول مالک
- سیستم عامل مرجع آزمون: GitHub Actions روی **Windows Server 2025**؛ اجرای جداگانه روی Windows 10 یا 11 شرط پذیرش نیست.
- فقط **Google Chrome Stable** برای مرورگر؛ Edge خارج از محدودهٔ تست است.
- محصول **SOKNA Bridge** مستقل از SoknaCafeV3 است. در این مرحله هیچ تغییر، Merge، Tag، Release، استقرار یا نصب روی رایانهٔ کاربر مجاز نشده است.

## شواهد عملیاتی روی GitHub
- `Chrome Stable 155 + Inno-installed Native Host`: [39261382650](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39261382650) PASS؛ ping/pong، فرمان نامعتبر، قطع ایمن، اتصال مجدد، حفظ `chrome.storage.local` بعد از بازگشایی و **بارگذاری دوباره افزونه با DevTools** تأیید شد.
- `Chrome for Testing + installed Native Host`: [39261382562](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39261382562) PASS.
- `Inno 2.7.0 -> 2.7.1`: [39261382613](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39261382613) PASS.
- `Maintenance delta / add-remove / rollback`: [39261382565](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39261382565) PASS.
- `forced Agent termination + recovery`: [39261382616](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39261382616) PASS.
- سایر آزمون‌های این Commit نیز باید در GitHub برای SHA مربوطه بررسی شوند، نه از وضعیت Commit قبلی استنباط.

## بررسی و اصلاح امنیتی

### ۱. حفاظت از شناسهٔ تب و عملیات کاربر — اصلاح شده، نیازمند CI
در کد سابق مسیر `background.js` مقدار `m.tabId ?? sender.tab?.id` را می‌پذیرفت؛ یعنی در یک پیام از Content Script امکان معرفی شناسهٔ تب دیگر وجود داشت. با `message_sender_boundary_core.js` و محافظ ابتدای `background_bootstrap.js`:
- `tabId` برای Content Script باید دقیقاً با `sender.tab.id` واقعی مطابقت داشته باشد؛ شناسهٔ ساختگی و ناهماهنگ رد می‌شود.
- `REGISTER_CHAT_ORIGIN`، `REGISTER_BROWSER_ORIGIN`، `CONNECT_CHAT`، `ARM` و `DISARM` از Content Script رد می‌شوند و فقط زمینهٔ Extension UI می‌تواند آن‌ها را آغاز کند.
- پیام‌های مجاز در تب خودشان (از جمله `CONTENT_READY` و `COMMAND`) همچنان پذیرفته می‌شوند.
- تست مثبت/منفی: `tools/tests/test_message_sender_boundary.mjs`. تا موفقیت CI روی SHA جدید، این اصلاح **تأیید اجرایی** تلقی نمی‌شود.

### ۲. مجوزها و حریم خصوصی — بررسی شده، ریسک باقیمانده
- Manifest V3 از `nativeMessaging`، `activeTab`، `storage`، `scripting`، `webNavigation`، `downloads`، `alarms` و `debugger` استفاده می‌کند. `debugger` یک مجوز حساس است و کاربر باید دلیل و دامنهٔ آن را بداند؛ برای عکس تمام‌صفحه/CDP در Browser Helper استفاده می‌شود.
- Host permissions از قبل شامل ChatGPT، دامنهٔ مجاز دیگر، Instagram و CDNهای رسانه‌ای تعریف‌شده‌اند؛ مجوزهای *اختیاری* `https://*/*` و `http://*/*` پهناورند، اما درخواست و ثبت دسترسی در popup باید به origin مشخص و رضایت کاربر محدود بماند. این **ریسک طراحی** است، نه ادعای کشف نشت داده.
- Content Scriptها در دنیای `ISOLATED` اجرا می‌شوند، اما `all_frames` و `match_origin_as_fallback` سطح اجرای گسترده‌تری در قاب‌های صفحات مجاز ایجاد می‌کنند؛ برای انتشار عمومی ممیزی حریم خصوصی مبتنی بر سناریو هنوز لازم است.
- `externally_connectable` تعریف نشده و Native Host در آزمون Chrome با `allowed_origins` فقط برای شناسهٔ افزونهٔ مجاز بررسی شده است. بررسی منشأ از Native Messaging سطح مرورگر است؛ این به‌تنهایی تضمین امنیت همهٔ عملیات عامل نیست.
- مسیر Support Bundle پیش‌تر با تست نشت توکن و پشتیبانی از خروجی ناقص آزموده شده است؛ ممیزی مستقل کامل داده‌های واقعی کاربران انجام نشده است.

### ۳. نصب پایدار Chrome — تفکیک دقیق نتیجه
- **PASS:** `chrome.storage.local` بعد از بسته و باز شدن Chrome پایدار ماند؛ پس از بارگذاری دوبارهٔ افزونه با DevTools، Native Host دوباره پاسخ داد.
- **NOT_VERIFIED:** خود افزونهٔ **CDP-loaded** بعد از restart خودکار در لیست افزونه‌های فعال باقی نماند. ابزار تست آن را دوباره بارگذاری کرد.
- **NOT_RUN:** مسیر گرافیکی `chrome://extensions > Load unpacked` و ماندگاری همان نصب پس از بستن Chrome؛ CI مبتنی بر CDP جایگزین این سناریو نیست.
- **تصمیم فنی:** روی فایل Preferences یا Registry Chrome برای اجبار ماندگاری تغییر مستقیم ندهیم؛ این روش نه قرارداد نصب Chromium است و نه برای محصول قابل اتکاست. در صورت تصمیم آینده درباره انتشار عمومی، باید مسیر توزیع و امضای افزونه جدا تعیین شود.

## جدول دروازه انتشار

| موضوع | وضعیت |
|---|---|
| آزمون‌های اصلی Windows Server 2025 | PASS در شواهد لینک‌شده |
| Native Host و Chrome Stable | PASS برای بارگذاری افزونه از CDP |
| مرز پیام Content Script | اصلاح سورس؛ تأیید با Workflow امنیتی روی SHA جدید |
| ذخیره دادهٔ افزونه پس از restart | PASS |
| ماندگاری نصب افزونه از رابط Chrome | NOT_RUN |
| قطع واقعی برق / Crash سیستم عامل | NOT_RUN (توقف اجباری فرایند Agent PASS) |
| امضای اجرایی‌ها و provenance انتشار | NOT_VERIFIED |
| ممیزی کامل حریم خصوصی و مجوزهای حساس | REVIEW_REQUIRED |
| مجوز صریح مالک برای Merge و Release | NOT_GRANTED |

**نتیجه:** کاندید مهندسی قابل‌آزمایش است، اما هنوز نباید برچسب «Release Ready» یا «Production Ready» بخورد. تصمیم نهایی برای امضا، شیوه توزیع افزونه، و پذیرش ریسک‌های باقی‌مانده نیازمند تأیید جداگانه است.
