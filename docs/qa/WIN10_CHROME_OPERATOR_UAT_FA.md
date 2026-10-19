# SOKNA Bridge — راهنمای آزمون واقعی Windows 10 + Google Chrome

**مبنای پذیرش اپراتوری: Windows 10 x64 (نسخه واقعی کاربر)، Chrome معمولی و Native Host.** این پروژه مستقل از کافه است. Edge از محدوده آزمون خارج است.

## تفاوت شواهد

- GitHub Actions روی Windows Server 2025 اجرا می‌شود، نه Windows 10. PASS آن را نباید Windows 10 PASS نوشت.
- آزمون موفق Chrome for Testing همراه افزونه و Native Host نصب‌شده: [39209943777](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39209943777).
- ارتقای واقعی Setup رسمی 2.7.0 به کاندید 2.7.1 و حفظ تنظیمات: [39209943840](https://github.com/mobaraki20/SOKNA-Bridge/actions/runs/39209943840).
- گواهی Windows 10 + Chrome Stable اپراتور تا دریافت شواهد، **NOT_RUN** است؛ همچنین ۷۵ سناریوی آزمایشی سابق از W11 به‌صورت خودکار تأییدشده یا قابل انتقال به Win10 نیستند.

## بسته آزمایشی بدون انتشار رسمی

در اجرای جدید workflow `.github/workflows/bridge-chrome-native-installed.yml`، بعد از PASS کامل Chrome for Testing، یک GitHub Actions artifact با عنوان `bridge-win10-chrome-operator-candidate` منتشر می‌شود که شامل نصب‌کنندهٔ واقعی، `candidate-provenance.json` و همین راهنما و اسکریپت `Invoke-Win10ChromeOperatorCheck.ps1` است. این **Release، Pre-release، Merge یا مجوز استقرار عملیاتی نیست**. فایل فقط برای آزمون، بدون امضای انتشار است. اعتبار artifact هفت روز است.

## روش تست روی Windows 10

1. فقط روی کامپیوتر آزمایشی Windows 10 x64 و در یک حساب/پروفایل جداگانه Chrome؛ بدون داده شخصی و بدون وابستگی به کافه. اگر Bridge از قبل نصب است، پیش از نصب مجدد از داده‌ها و تنظیمات نسخه موجود نسخه پشتیبان بگیرید. نصب آزمون روی همان پوشهٔ نسخه عملیاتی ممنوع است.
2. از صفحهٔ Actions مربوط به Commit موردنظر، artifact بالا را دانلود و از حالت ZIP خارج کنید. با باز شدن فایل‌ها باید Setup، راهنما، اسکریپت و JSON منشأ در **یک پوشه** باشند.
3. در PowerShell همان پوشه ابتدا فقط **Preflight خواندنی** را اجرا کنید:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Invoke-Win10ChromeOperatorCheck.ps1 -Phase Preflight -CandidateDirectory .
   ```

   خروجی `WIN10_CHROME_OPERATOR_PREFLIGHT_PASS` نشان می‌دهد محیط Windows 10 x64، Chrome Stable و SHA256 بسته بررسی شده‌اند؛ این خروجی **به معنی تست اتصال مرورگر نیست**. با هر خطا نصب را متوقف کنید و کد خطا را گزارش دهید.

4. پس از PASS بودن Preflight، نصب‌کنندهٔ `SOKNA-Bridge-Setup-2.7.1-x64.exe` همان بسته را **دستی** اجرا کنید؛ در جریان نصب ArtifactRoot مجزا انتخاب کنید. لازم نیست Chrome یا رجیستری را دستی تغییر دهید. چون نسخه آزمایشی به‌عنوان انتشار رسمی امضا نشده، درباره منبع فایل دقت کنید و هش مرحله قبل را شرط نصب قرار دهید.
5. آزمون فقط‌خواندنی پس از نصب:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Invoke-Win10ChromeOperatorCheck.ps1 -Phase Installed -CandidateDirectory . -OutputPath "$env:TEMP\bridge-win10-check.json"
   ```

   این مرحله صرفاً رجیستری Native Messaging، محل Host، هش فایل‌های نصب‌شده، نسخه افزونه و شناسه مجاز آن را بررسی می‌کند. محتوا و توکن‌های کاربر خوانده یا گزارش نمی‌شوند. گزارش موجود بازنویسی نمی‌شود.

6. **Google Chrome معمولی** را باز کنید. از `chrome://extensions`، Developer mode و Load unpacked، پوشهٔ `extension` **از همان محل نصب** را انتخاب کنید. شناسه و نسخه افزونه باید با خروجی مرحلهٔ قبل مطابقت داشته باشند. مجوزهای نمایش‌داده‌شده را بررسی کنید؛ دامنه‌های اختیاری بدون قصد و رضایت فعال نشوند.
7. لینکی که اسکریپت در `SELFTEST_URL` چاپ می‌کند را در Chrome باز کنید. در Self Test باید بررسی‌های Native Host و Agent (به‌ویژه 3/8، 4/8، 5/8 و 6/8) واقعاً PASS شوند. اگر صفحه ChatGPT مجاز باز نیست، دو آزمایش صفحه‌ای ممکن است SKIP شوند؛ **SKIP را PASS ثبت نکنید**.
8. Chrome را ببندید، دوباره باز کنید و Self Test را تکرار کنید؛ مجوزهای افزونه را چک کنید. شواهد موردنیاز: عکس وضعیت افزونه در `chrome://extensions`، وضعیت Self Test، نتیجهٔ مرحلهٔ ۵، نسخه Windows 10 و Chrome. از انتشار توکن، URLهای خصوصی، متن مکالمات، تنظیمات حساب و مسیرهای خصوصی خودداری کنید. هر سناریو جداگانه PASS/FAIL/SKIP/NOT_RUN ثبت شود.

**مهم:** ابزار PowerShell نه افزونه را در Chrome باز یا نصب می‌کند، نه Ping مرورگر را جای اپراتور اجرا می‌کند، نه رجیستری یا داده‌ای را تغییر می‌دهد. `MANUAL_CHROME_NATIVE_PROOF_NOT_RUN` عمداً در خروجی باقی می‌ماند.

## دروازه انتشار

اجرای موفق خودکار Windows Server 2025 + Chrome for Testing، تحویل بستهٔ Win10، یا PASS مرحلهٔ Preflight نمی‌توانند جایگزین آزمون واقعی Windows 10 + Chrome Stable شوند. بعد از شواهد دستی، ممیزی حریم خصوصی، تست‌های باقی‌مانده، امضای انتشار و اجازهٔ صریح مالک لازم است. PR تا آن زمان Draft باقی می‌ماند.
