# قرارداد اجرایی تغییرات SOKNA Agent — v1

تاریخ: 2026-09-23
وضعیت: Canonical / Mandatory
دامنه: SOKNA Agent / SOKNA-Bridge

این سند توصیه نیست. برای هر تغییر متوسط یا بزرگ، هر Agent/Chat/Automation بعدی باید این قرارداد را اجرا کند. خروج از آن فقط با Change Request صریح و ثبت دلیل مجاز است.

## 1) اصل پایه: سیستم کاربر محیط توسعه نیست

ماشین کاربر فقط برای Windows-specific acceptance و activation نهایی استفاده می‌شود. discovery، طراحی راه‌حل، ساخت helper، آزمون quoting، ساخت Base64، پیدا کردن مسیرهای runtime و آزمون‌وخطای script نباید روی سیستم کاربر انجام شود مگر چیزی ذاتاً فقط روی همان سیستم قابل مشاهده باشد.

پیش از هر mutation واقعی روی سیستم کاربر:
1. سورس canonical کامل در Workspace توسعه Agent موجود باشد.
2. commit/base دقیق معلوم باشد.
3. تغییر کامل، dependency trace، deploy، rollback و acceptance بیرون از Control Plane ساخته شده باشد.
4. بسته نهایی چندبار در lab تست شده باشد.
5. فقط پس از PASS شدن gates، بسته به سیستم کاربر منتقل شود.

## 2) Source Acquisition Barrier

برای کار غیر trivial، کار بدون full source ممنوع است.

اولویت دریافت سورس:
1. checkout دقیق commit canonical در Workspace توسعه؛
2. archive کامل همان commit؛
3. repository mirror/remote معتبر؛
4. فقط اگر هیچ‌کدام ممکن نبود، read هدفمند از Agent.

فایل‌خوانی تکه‌ای از Bridge نباید جایگزین داشتن full source شود. اگر سورس کامل از قبل در اختیار است، Agent نباید دوباره با چند round-trip فایل‌ها را جمع‌آوری کند.

## 3) Complete Unit of Work Rule

مرز Artifact باید «کل واحد کار» باشد، نه فقط patch کد.

برای تغییر runtime یا installer، Artifact نهایی باید در صورت نیاز شامل این موارد باشد:
- source/payload نهایی؛
- manifest + SHA-256؛
- deploy/stage script؛
- activation script؛
- rollback/recovery script؛
- health/acceptance script؛
- repo patch یا exact file set؛
- Handoff کامل؛
- test report؛
- known limitations؛
- exact next action.

اگر activation یا rollback هنوز در چت طراحی می‌شود، Artifact «کامل» نیست و نباید روی سیستم کاربر اعمال شود.

## 4) Control Plane Budget Contract

Chat/Extension/Carrier فقط Control Plane است؛ code/file/data حجیم از carrier عبور نمی‌کند.

قواعد:
- decoded command JSON باید به طور پیش‌فرض <= 600 bytes بماند مگر runtime به صورت صریح budget بزرگ‌تر را advertise کند.
- script، helper، patch، certificate، archive و payload نباید داخل command args/Base64 قرار گیرد.
- command باید فقط یک reference/path/id/hash کوتاه را حمل کند.
- اگر command از budget ایمن عبور می‌کند، محتوا باید Artifact شود.
- `contract_budget_exceeded` یک failure طراحی محسوب می‌شود، نه دلیل برای خردکردن بی‌نهایت command.

## 5) No Inline Shell Engineering

برای عملیات mutating یا lifecycle:
- PowerShell چندخطی داخل `process.run -Command` ممنوع است.
- nested quoting طولانی ممنوع است.
- helper باید فایل versioned و hashed داخل Artifact باشد.
- aliasهای PowerShell مانند `gci`, `gc`, `cp`, `rm`, `kill`, `sleep`, `gfh` در scriptهای release ممنوع هستند؛ فقط نام کامل cmdletها.
- helper قبل از اجرا باید static-parse شود و hash آن با manifest تطبیق داده شود.

فرمان inline فقط برای read-only probe کوچک و deterministic مجاز است.

## 6) Two-Strike Remote Rule

در هر stage، پس از دو failure متوالی از یک خانواده، ادامه trial-and-error روی سیستم کاربر ممنوع است.

نمونه خانواده failure:
- carrier/json/quoting؛
- activation helper؛
- path/permission؛
- package validation؛
- process restart.

پس از strike دوم:
1. mutation متوقف شود؛
2. state امن ثبت شود؛
3. به Workspace توسعه بازگردیم؛
4. root cause رفع و artifact جدید ساخته شود؛
5. دوباره از gateهای local عبور کند.

## 7) Artifact Trust Contract

برای `artifact.apply`:
- expected SHA-256 اجباری است؛
- ArtifactRoot مشخص و محدود است؛
- target workspace/branch/base commit اجباری است؛
- manifest و payload hash اجباری‌اند؛
- handoff hash اجباری است؛
- patch file list باید دقیقاً با manifest تطبیق کند؛
- path traversal، reparse point، oversized entry و suspicious compression ratio fail-closed است؛
- `git apply --check` قبل از apply اجباری است؛
- tracked worktree باید clean باشد؛
- unknown untracked files نباید حذف شوند؛
- mutation بدون audit قابل قبول نیست.

Artifact v1 rename در patch را پشتیبانی نمی‌کند. rename باید در نسخه بعدی schema صریحاً طراحی شود.

## 8) ArtifactRoot / DownloadRoot Contract

ArtifactRoot یک تنظیم first-class است و در Installer/Settings قابل انتخاب خواهد بود.

الزامات نهایی:
- تمام فایل‌هایی که Agent خودش دانلود می‌کند فقط داخل ArtifactRoot قرار می‌گیرند؛
- path انتخابی در UI شفاف است؛
- فایل‌های Agent با فایل‌های شخصی کاربر مخلوط نمی‌شوند مگر کاربر همان مسیر را انتخاب کند؛
- هر download/import دارای audit event است: artifact_id، provider/source، local path، size، SHA-256، timestamp، workspace/job، validation result، retention/cleanup state؛
- cleanup policy قابل مشاهده/تنظیم است؛
- delete خودکار خارج از ArtifactRoot ممنوع است.

تا آماده‌شدن Installer، fallback موقت باید صریحاً گزارش شود؛ fallback مخفی مجاز نیست.

## 9) Activation Barrier

کپی فایل روی disk به معنی activation نیست.

برای runtime update:
1. current runtime/version/path/PID از state معتبر معلوم باشد؛
2. payload جدید side-by-side stage شود؛
3. hashes دوباره verify شوند؛
4. backup/recovery point ساخته شود؛
5. activation plan قبل از stop کردن runtime نوشته شود؛
6. helper از Artifact اجرا شود، نه command inline؛
7. runtime جدید restart شود؛
8. health check نسخه جدید PASS شود؛
9. capability check PASS شود؛
10. acceptance workload PASS شود؛
11. فقط سپس activation موفق ثبت شود.

اگر health شکست خورد:
- runtime جدید stop؛
- فایل قبلی restore؛
- runtime قبلی restart؛
- rollback health check؛
- event و support evidence ثبت شود.

## 10) Runtime Ownership Metadata

activation نباید تازه هنگام release با WMI/PID discovery طراحی شود.

زیرساخت باید state مشخص داشته باشد، حداقل:
- install_root؛
- active_version؛
- previous_version؛
- agent_pid؛
- config_path؛
- activation_tx_id؛
- last_health؛
- last_rollback؛
- artifact/source hash.

تا زمانی که Installer/Maintenance این state را مالک نشده، updater script باید آن را ایجاد/به‌روز کند.

## 11) Audit Is Part of Correctness

برای mutation مهم، log صرفاً best-effort نیست.

حداقل eventها:
- prepared؛
- validation_pass/validation_failed؛
- mutation_started؛
- mutation_applied؛
- activation_started؛
- health_pass/health_failed؛
- rollback_started/rollback_pass/rollback_failed؛
- cleanup.

اگر final audit برای یک apply نتواند ثبت شود، implementation باید در صورت امکان mutation را rollback کند و failure صریح برگرداند.

## 12) Repository Safety

- exact staging paths؛ `git add -A` برای release workflow ممنوع مگر contract صریحاً اجازه دهد.
- `git diff --check` و `git diff --cached --check` اجباری.
- unknown untracked files حفظ شوند.
- branch/head/upstream قبل از mutation بررسی شود.
- direct push به protected branches ممنوع.
- commit/push قبل از test PASS ممنوع.

## 13) Handoff Barrier

پروژه طولانی است و chat exhaustion طبیعی است. هر checkpoint معنادار باید Handoff کامل داشته باشد.

Handoff حداقل شامل:
- repo/branch/full HEAD؛
- runtime/extension versions؛
- live vs source-only state؛
- تصمیمات canonical؛
- فایل‌های تغییرکرده؛
- تست‌های PASS/FAIL؛
- known limitations؛
- untracked/unknown files که باید حفظ شوند؛
- artifact hashes؛
- current safe state؛
- exact next action؛
- rollback path.

هیچ chat جدیدی نباید discovery را از صفر تکرار کند؛ ابتدا Handoff و Read-First خوانده می‌شود.

## 14) Required Local Test Matrix

قبل از سیستم کاربر، حداقل این سناریوها باید تست شوند:
1. Happy path package validation.
2. Wrong package SHA.
3. Wrong payload SHA.
4. Wrong branch/base/workspace.
5. Dirty tracked worktree.
6. Unknown untracked preservation.
7. Manifest file-list mismatch.
8. ZIP traversal (`../`, rooted/colon path).
9. Oversized/too-many-entry/suspicious-ratio ZIP.
10. Missing/invalid handoff.
11. Missing expected SHA on apply.
12. Helper corruption detection.
13. Control command budget lint.
14. PowerShell release-script alias lint.
15. Rollback simulation after activation health failure.
16. Re-running same artifact/idempotency behavior.
17. Interrupted activation/recovery state.

اگر هرکدام fail شود، سیستم کاربر نباید برای debug استفاده شود.

## 15) Windows Preflight Gate

بعد از PASS محلی و قبل از mutation واقعی روی Windows:
- PowerShell Parser روی تمام release `.ps1`ها؛
- manifest JSON parse؛
- SHA verification؛
- path/permission preflight؛
- current runtime health؛
- recovery point writable؛
- activation helper dry/preflight mode.

این مرحله روی سیستم کاربر read-only یا staging-only است و هنوز activation انجام نمی‌دهد.

## 16) Acceptance Gate

Release فقط وقتی accepted است که:
- `ping` نسخه جدید را نشان دهد؛
- `agent.capabilities` نسخه/Actions جدید را نشان دهد؛
- artifact.inspect PASS؛
- artifact.apply روی probe کنترل‌شده PASS و سپس cleanup/reverse PASS؛
- audit eventهای لازم وجود داشته باشند؛
- tracked repo دوباره clean باشد؛
- rollback path موجود و hash-verified باشد؛
- current handoff به‌روز شود.

Source committed ولی runtime قدیمی = NOT ACCEPTED.

## 17) Efficiency Metrics

برای هر rollout ثبت شود:
- elapsed time؛
- تعداد round-trip؛
- failure count؛
- carrier bytes؛
- user manual actions؛
- rollback count.

هدف Fast Work Path:
- یک download یا provider fetch؛
- حداکثر 1 command برای stage/apply/activate؛
- حداکثر 1 command برای acceptance/result؛
- debug/development روی ماشین کاربر = صفر.

## 18) Lessons from 2026-09-23 Incident

مواردی که نباید تکرار شوند:
- package کوچک که فقط source patch داشت ولی activation/rollback را نداشت؛
- استفاده از carrier بزرگ و برخورد با 800-byte budget؛
- alias نامعتبر `gfh`؛
- malformed JSON/carrier؛
- nested quoting خراب در `cmd.exe`/PowerShell؛
- helper تولیدشده داخل carrier که محتوایش خراب شد؛
- شروع process/parent discovery بعد از apply؛
- چندین remote retry به جای برگشت به local workspace؛
- تلاش برای فعال‌سازی 2.5.6 قبل از طراحی کامل lifecycle.

تصمیم اصلاحی: 2.5.6 source checkpoint است؛ runtime بعدی باید پس از hardening و local validation در نسخه بعدی فعال شود.

## 19) Change Request

شکستن هر MUST این سند نیازمند CR صریح با:
- دلیل؛
- risk؛
- جایگزین؛
- rollback؛
- acceptance criteria.

بدون CR، Agent باید fail-closed کند.


## 19) Self-Call / Re-entrancy Deadlock Contract

رخداد واقعی 2026-09-23 نشان داد اجرای `Preflight-AgentRuntime257.ps1` از داخل action فعلی Agent و سپس فراخوانی synchronous همان Agent API باعث timeout می‌شود: Agent منتظر child process است و child منتظر پاسخ همان Agent.

قواعد اجباری:

1. هر process/job که توسط Agent فعلی اجرا می‌شود **حق ندارد synchronous به همان Agent endpoint self-call کند**.
2. health probe باید mode-aware باشد:
   - `AgentMediated`: شاهد سلامت جاری = موفقیت control-plane request + PID ownership + on-disk runtime/capability version/hash checks. HTTP self-probe ممنوع.
   - `External`: Maintenance Host یا process مستقل می‌تواند ping/capabilities HTTP را اجرا کند.
3. health نسخه target پس از restart باید از detached activation/maintenance process انجام شود، نه از processی که Agent زنده منتظر آن است.
4. هر preflight/acceptance جدید باید re-entrancy dependency graph را بررسی کند: اگر A منتظر B است، B نباید برای تکمیل به A synchronous وابسته باشد.
5. timeout ناشی از self-call نباید به‌عنوان خرابی runtime تفسیر شود؛ failure code باید invocation mode را مشخص کند.
6. این rule شامل HTTP، named pipe، localhost RPC یا هر IPC synchronous دیگری است که owner همان blocked process باشد.
7. تست static/release باید وجود explicit `AgentMediated` mode و عدم HTTP self-probe در آن mode را enforce کند.


## Windows Target Startup-Probe Barrier

قبل از توقف runtime فعال یا هر activation روی Windows، target runtime باید با همان Windows PowerShell واقعی در `-StartupProbe` و در یک root موقت اجرا شود. این probe باید config، workspace initialization، capability manifest و initializationهای startup را بدون bind کردن endpoint live بررسی کند. اگر probe fail شود، activation ممنوع است.

Launcher production باید stdout/stderr/exit-code هر runtime را در lifecycle logs نگه دارد. عبارت کلی `health_failed` بدون startup evidence برای release جدید کافی نیست.

Shadow test نباید به port تصادفی HttpListener متکی باشد، چون URL ACL می‌تواند false failure بسازد. HTTP health نهایی فقط پس از switch روی endpoint واقعی انجام می‌شود.

## Windows Lifecycle State-Schema Regression Gate
Before a live runtime activation package is permitted to stop the current Agent, the package-specific state-schema regression test MUST PASS on the target Windows host. The test must run the shipped launcher against an isolated temporary root and an `activating` state using the exact lifecycle fields that the launcher mutates. A failure such as PowerShell `ExceptionWhenSetting` is a hard stop. This gate was added after R3 reproduced a missing-property failure for `active_version`; the same audit also covers `recovered_at` and acceptance field `accepted_at`.
