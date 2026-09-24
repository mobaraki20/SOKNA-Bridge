# قرارداد Browser / Screenshot / Visual QA v1

تاریخ: 2026-09-24
وضعیت: P3 development contract

## 1) هدف
Browser QA یک capability درجه‌یک و project-agnostic Agent است. مسیر Controlled Browser از یک Chromium/Chrome/Edge جداگانه با پروفایل موقت و DevTools Protocol استفاده می‌کند. هیچ session/profile شخصی کاربر به‌صورت پیش‌فرض باز یا خوانده نمی‌شود.

## 2) Permission boundary
- اجرای recipe فقط از یک Workspace ثبت‌شده و مسیر Read مجاز انجام می‌شود.
- Workspace باید tool permission صریح `browser` داشته باشد.
- Browser output فقط زیر `ArtifactRoot/browser` نوشته می‌شود.
- هر run و baseline به Workspace مالک bind می‌شود؛ promote یا مصرف baseline متعلق به Workspace دیگر fail-closed است.
- Live Browser Capture در P3 اجرا نمی‌شود؛ فقط policy آن expose می‌شود و برای نسخه آینده consent صریح per-session الزامی است.
- hidden capture، background spying، credential extraction و unrestricted cookie/token export ممنوع‌اند.

## 3) Controlled Browser isolation
- browser با user-data-dir موقت و isolated اجرا می‌شود.
- URLهای `file:`, `data:`, `chrome:`, `javascript:` و URL دارای userinfo ممنوع‌اند؛ فقط HTTP/HTTPS.
- top-level navigation فقط داخل `allowed_origins` recipe مجاز است. origin اولیه به‌صورت خودکار allow می‌شود.
- cookie/localStorage setup فقط از environment secret reference (`value_env`) مجاز است؛ secret خام در report/log/artifact ثبت نمی‌شود.

## 4) Recipe schema
Schema: `sokna-browser-recipe-v1`.

فیلدهای اصلی:
- `scenario_id`
- `url`
- `allowed_origins[]`
- `viewports[]` با `id,width,height,dpr`
- `actions[]`: `goto`, `wait`, `click`, `type`, `select`
- `assertions[]`: selector visible/hidden، no horizontal overflow، console/network budget، visual changed ratio
- `captures`: viewport/full-page/element screenshots، DOM، geometry، accessibility، console، network و `slow_resource_ms`
- `setup.cookies[]` و `setup.local_storage[]` فقط با `value_env`
- `visual.enabled` و `visual.max_changed_ratio`

نتیجه هر viewport و کل recipe باید `PASS` یا `FAIL` و evidence artifact IDs داشته باشد.

## 5) Viewport matrix
حداقل matrix پیشنهادی:
- mobile narrow: 360×800
- mobile large: 430×932
- tablet: 768×1024
- desktop: 1366×768
- wide desktop: 1920×1080
- custom viewport در محدوده safe recipe

DPR در metadata ثبت می‌شود.

## 6) Evidence artifacts
Browser runner می‌تواند تولید کند:
- `viewport.png`
- `full-page.png`
- `element-*.png`
- `dom.html`
- `geometry.json`
- `accessibility.json`
- `console.json`
- `network.json`
- `visual-diff.png`
- `page.json`
- `report.json`

Artifact metadata شامل sha256، bytes، content type، viewport، run ID، workspace/job و recipe hash است. خروجی حجیم از carrier عبور نمی‌کند.
هر finding خطادار باید تا حد امکان `evidence_artifact_id` داشته باشد؛ page metadata به‌عنوان fallback evidence همیشه تولید می‌شود.

## 7) Geometry/layout checks
Geometry snapshot باید حداقل viewport، document scroll/client dimensions، horizontal overflow، bounding boxes، visibility، clipping، position، z-index و overflow/scroll dimensions را ثبت کند. full-page/element capture دارای dimension safety limit است.

## 8) Console/network privacy
- request/response body جمع‌آوری نمی‌شود.
- headers حساس جمع‌آوری نمی‌شوند.
- network evidence شامل status/failure، blocked reason، CORS error در صورت گزارش مرورگر، duration و slow-resource flag است.
- query keys حساس (`token`, `secret`, `password`, `auth`, `cookie`, `session`, `api-key`, ... ) redact می‌شوند.
- console/exception text برای bearer/basic و key/value secrets redact می‌شود.
- مقادیر secret که از `value_env` وارد recipe می‌شوند پیش از نوشتن DOM/a11y/console/network/page metadata نیز با `[REDACTED]` جایگزین می‌شوند.

## 9) Visual regression
Baseline با action جداگانه و immutable ایجاد می‌شود:
1. run current
2. `browser.baseline.promote` ابتدا dry-run و سپس `execute=true`
3. run بعدی با `baseline_id`
4. pixel diff، dimension mismatch و changed ratio تولید می‌شود.

Baseline promotion منبع run را حذف/تغییر نمی‌دهد و baseline موجود overwrite نمی‌شود.
Baseline فقط توسط همان Workspace مالک run قابل promote است و فقط همان Workspace می‌تواند آن را در run بعدی مصرف کند.

## 10) ArtifactRoot/quota/reparse
- run/baseline فقط زیر `ArtifactRoot/browser`.
- symlink/reparse در output/baseline fail-closed.
- per-run byte limit و ArtifactRoot quota بعد از capture enforce می‌شوند؛ run oversize حذف می‌شود.
- cleanup/retention از policy موجود `browser_days` استفاده می‌کند.

## 11) Live Browser Capture boundary
P3 فقط policy را expose می‌کند. implementation آینده باید:
- consent صریح برای session/tab جاری؛
- UI-visible capture state؛
- scope محدود به tab انتخاب‌شده؛
- screenshot/DOM/current URL/title/console metadata/selected diagnostics؛
- بدون credential extraction یا export unrestricted cookies/tokens.

## 12) Acceptance
P3 فقط زمانی development-complete است که:
- native Go tests PASS؛
- source contract PASS؛
- Windows clean environment با Chromium/Chrome/Edge: navigation/actions/captures/redaction/baseline/diff/PASS+FAIL evidence را اجرا کند؛
- Agent action permission barrier `browser` برقرار باشد؛
- P0/P1/P2 و transport/autonomy regression شکسته نشوند.

Home PC/live activation تا whole-product RC ممنوع است.
