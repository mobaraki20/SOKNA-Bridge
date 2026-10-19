# راهنمای آزمون مستقل SOKNA Bridge — GitHub W11

بریج یک ابزار مستقل برای تعامل و آزمون نرم‌افزارهاست. نه نصب آن و نه ساخت آن نباید به سامانه کافه، دامنه، پورت یا مخزن خاصی وابسته باشد. نمونه کافه صرفاً در `examples/sokna-cafe` قرار دارد و خودکار فعال نمی‌شود.

## وضعیت واقعی و مرز گواهی

- آزمون‌های سورس، Go، .NET، PowerShell و Bootstrap روی GitHub Actions اجرا می‌شوند. PASS آن‌ها به‌تنهایی نصب عملیاتی را اثبات نمی‌کند.
- تست واقعی ساخت و نصب، نصب مجدد و حذف Inno در Windows Runner سابقه PASS دارد؛ نسخه جاری و سناریوهای **Repair، Rollback و ارتقای نسخه قدیمی** باید جداگانه شواهد موفق داشته باشند.
- تست قاب‌بندی پیام Native Host روی ویندوز (ping و رد پیام نامعتبر) اجرا شده؛ **این تست برابر با اتصال افزونه داخل Chrome یا Edge نیست**.
- تا وقتی نتیجه سناریو و فایل مدرک وجود ندارد، وضعیت باید `NOT_RUN` یا `BLOCKED` بماند؛ نباید PASS فرض شود.

## مراحل اپراتوری بدون سورس

۱. روی حساب Windows آزمایشی و مجزا، از سورس مشخص و با هش قابل‌تأیید Setup بسازید؛ هیچ مرحله‌ای را روی سیستم کافه یا سیستم خانه انجام ندهید مگر با اجازه مجزا.

۲. پیش از نصب/ارتقا، موجودی فقط‌خواندنی را جمع‌آوری کنید:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/qa/Collect-SoknaWindowsReadOnly.ps1 -OutputPath "$env:TEMP\bridge-inventory.json"
```

این ابزار فایل گزارش موجود را بازنویسی نمی‌کند و داده کاربر، فرمان‌های پردازش یا توکن جمع نمی‌کند. این خروجی به معنی موفقیت نصب نیست.

۳. برای سنجش هویت سورس از `tools/qa/source_snapshot.py` با Manifest خارج از پوشه سورس استفاده کنید:

```bash
python tools/qa/source_snapshot.py --create --root SOURCE_ROOT --manifest CHECKPOINT.json
python tools/qa/source_snapshot.py --verify --root SOURCE_ROOT --manifest CHECKPOINT.json
```

۴. برای نقشه Capture هر سایت مجاز، آدرس پایه را هنگام استقرار تعیین کنید؛ هیچ URL خاصی در کد بریج فرض نشود:

```bash
python tools/qa/compile_capture_recipe.py --recipe examples/generic-web/read-only-recipe-v1.json --base-url https://example.org/test/ --output map.json
```

فقط از دامنه‌های دارای مجوز استفاده کنید. Capture خواندنی نباید به‌صورت ضمنی مجوز کلیک یا تغییر داده ایجاد کند.

۵. گزارش شواهد صرفاً وضعیت همان آزمون‌های **واقعاً اجراشده** را خلاصه می‌کند:

```bash
python tools/qa/operator_evidence_report.py --matrix PATH_TO_75_SCENARIO_MATRIX.json --blackbox PATH_TO_BLACKBOX.json --output NEW_SUMMARY.json
```

ورودی `failures:null` تنها با `failed_count=0` قابل قبول است. خروجی جایگزین آزمون نصب یا مرورگر واقعی نیست.

## دروازه‌های انتشار

یک نسخه زمانی برای انتشار قابل‌بررسی است که نصب تازه، ارتقا از نسخه واقعی قبلی، حفظ تنظیمات، Repair، Rollback در خرابی کنترل‌شده، ارتباط Chrome/Edge، دسترسی‌ها و حریم خصوصی را با مدرک واقعی پشت سر گذاشته باشد. سپس کد، هش، لاگ پالایش‌شده، یادداشت نسخه و تأیید صریح مالک پروژه لازم است.

این سند صرفاً راهنمای QA است و به GitHub Actions اجازه Merge، Tag، Release یا Deploy نمی‌دهد.
