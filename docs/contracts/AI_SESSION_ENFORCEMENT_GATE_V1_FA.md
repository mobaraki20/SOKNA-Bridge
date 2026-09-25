# قرارداد AI Session Enforcement Gate v1

تاریخ: 2026-09-25
وضعیت: R2-E mandatory enforcement contract
پروژه: SOKNA Bridge

## 1) اصل
این سند راهنما نیست؛ هدف آن تعریف یک gate اجرایی fail-closed است.

هیچ AI chat/session نباید بتواند command اجرایی را مستقیم به Native Host / Windows Agent forward کند مگر اینکه bootstrap و session handshake معتبر داشته باشد.

حافظه ChatGPT، handoff متنی، prompt و رعایت داوطلبانه AI هیچ‌کدام security/reliability boundary نیستند.

## 2) وضعیت session اجباری
Extension/Bridge باید برای هر AI client یک session context معتبر نگه دارد. حداقل state پیشنهادی:
- `client_session_id`
- `bootstrap_version`
- `protocol_version`
- `route_policy_version`
- `capabilities_etag` یا snapshot id
- `work_session_id?`
- `workspace_id?`
- `handshake_state`
- `issued_at`
- `expires_at`

`handshake_state` فقط در صورت bootstrap موفق، compatibility PASS و policy load موفق می‌تواند `ready` شود.

## 3) Allowed-before-ready
قبل از `ready` فقط actionهای discovery/recovery مجازند، مانند:
- `bridge.bootstrap`
- `ping`
- `agent.capabilities`
- `session.list`
- `session.get`
- `session.resume`
- health/compatibility diagnostics محدود

هر action اجرایی/تغییردهنده قبل از ready باید fail-closed شود.

## 4) Mandatory command path
مسیر عادی باید فقط این باشد:
`AI semantic intent -> semantic compiler -> schema/policy validation -> route selection -> session gate -> Extension -> Native Host -> Agent`

AI نباید مسیر مستقیمی برای ساخت/ارسال carrier executable داشته باشد.

در دوره migration که V3/V4 هنوز وجود دارد، carrier تنها خروجی compiler/guard معتبر است؛ carrier دست‌ساز یا hand-edited باید reject شود.

## 5) Route enforcement
Route انتخابی باید از policy/size/capability به دست آید، نه preference حافظه AI.

نمونه قواعد:
- payload کوچک کنترلی -> Control Plane
- 2+ step deterministic bounded -> batch/plan طبق policy
- long-running -> durable job
- ZIP/screenshot/log/binary بزرگ -> Artifact Plane
- browser inspection -> browser audit route
- Git/GitHub -> فقط وقتی capability/auth/scope معتبر است

اگر AI route ناسازگار بخواهد، compiler/gate باید `ROUTE_POLICY_VIOLATION` برگرداند و route canonical را در metadata اعلام کند؛ نباید همان درخواست را permissive اجرا کند.

## 6) Contract/schema enforcement
قبل از forward:
- protocol/schema version validate شود؛
- action باید advertised capability باشد؛
- params schema validate شود؛
- IDs/correlation توسط سیستم ساخته/تایید شود؛
- payload budget و round-trip validation اجرا شود؛
- workspace permission/grant بررسی شود؛
- duplicate/idempotency barrier بررسی شود.

هر failure باید NACK machine-readable با `executed=false` بدهد.

## 7) File/artifact enforcement
AI نباید بتواند فایل حجیم را با carrier عادی دور بزند.

اگر payload از threshold یا نوع binary/artifact باشد:
- Control Plane باید reject کند؛
- Artifact Plane canonical route برگردانده شود؛
- hash/size/ref validation اجباری باشد.

## 8) Git/GitHub enforcement
قبل از عملیات Git/GitHub:
- workspace/repository scope validate شود؛
- auth/capability probe معتبر باشد؛
- branch/head/session context مشخص باشد؛
- mutation خارج scope fail-closed شود.

AI نباید از credential حدس‌زده، URL دست‌ساز یا مسیر خارج از policy برای bypass استفاده کند.

## 9) Resume enforcement
بعد از ChatGPT chat switch، AI جدید نباید مستقیماً command mutation بفرستد.

ابتدا باید:
1. bootstrap معتبر بگیرد؛
2. resumable work session را resolve کند؛
3. snapshot و event/job state را sync کند؛
4. terminal/active/pending state را reconcile کند؛
5. فقط unresolved next action را ادامه دهد.

اگر session مبهم باشد، mutation blocked و `SESSION_RESUME_REQUIRED` یا `SESSION_AMBIGUOUS` برگردد.

## 10) Expiry / invalidation
Gate باید با تغییرات زیر session را دوباره bootstrap-required کند:
- Agent/Extension/protocol version change
- route policy version change
- capability set change ناسازگار
- workspace/grant change مهم
- session expiry
- Agent restart وقتی persisted compatibility قابل اثبات نیست

## 11) Error taxonomy حداقلی
- `BOOTSTRAP_REQUIRED`
- `BOOTSTRAP_INCOMPATIBLE`
- `SESSION_RESUME_REQUIRED`
- `SESSION_AMBIGUOUS`
- `CAPABILITY_NOT_ADVERTISED`
- `SCHEMA_INVALID`
- `ROUTE_POLICY_VIOLATION`
- `ARTIFACT_ROUTE_REQUIRED`
- `WORKSPACE_SCOPE_DENIED`
- `GITHUB_CAPABILITY_UNAVAILABLE`
- `DUPLICATE_OR_TERMINAL_COMMAND`
- `CORRELATION_INVALID`

همه باید machine-readable، correlated در صورت امکان و `executed=false` قبل از forward باشند.

## 12) Activity Monitor
Gate state باید در Activity Monitor قابل مشاهده باشد:
- Bootstrap: required/ready/expired/incompatible
- Work session: attached/resume-required
- Protocol/policy versions
- last rejected command + error code
- last accepted command/job

جزئیات secret/auth value نمایش داده نشود.

## 13) Acceptance tests اجباری
R2-E بدون این تست‌ها PASS نیست:
1. AI بدون bootstrap mutation بفرستد -> `BOOTSTRAP_REQUIRED`, اجرا صفر.
2. AI route غلط برای فایل بزرگ بخواهد -> reject + Artifact route canonical.
3. AI action غیرadvertised بسازد -> reject قبل از Native Host.
4. AI schema غلط بفرستد -> correlated NACK, اجرا صفر.
5. chat switch شود و AI جدید mutation بفرستد بدون resume -> blocked.
6. AI جدید bootstrap+resume کند -> فقط next unresolved step مجاز شود.
7. command terminal قبلی دوباره ارسال شود -> duplicate barrier.
8. capability/policy version عوض شود -> bootstrap قدیمی invalid شود.
9. expired grant -> resume privilege را احیا نکند.
10. hand-built carrier attempt -> normal flow reject شود.

## 14) معیار تضمین
«AI دستورالعمل را خوانده» معیار قبولی نیست.

معیار قبولی این است که در تست adversarial، AI عمداً یا سهواً:
- قرارداد را نخواند،
- route اشتباه بگیرد،
- فایل را از مسیر غلط بفرستد،
- action/schema اشتباه بسازد،
- یا بعد از chat switch context نداشته باشد،

و با این حال سیستم اجازه mutation/forward اشتباه ندهد و خطای واضح + مسیر canonical برگرداند.

این gate لایه تضمین محصول است؛ اسناد و prompt فقط به usability کمک می‌کنند.