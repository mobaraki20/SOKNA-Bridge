# قرارداد AI Session Bootstrap & Continuity v1

تاریخ: 2026-09-25
وضعیت: R2-E architecture contract
پروژه: SOKNA Bridge

## 1) مسئله
ChatGPT chat یک محیط موقت با context محدود است. پایان یک chat نباید باعث از دست رفتن وضعیت پروژه، job جاری، روش صحیح فرمان‌دادن، route انتخابی، قواعد انتقال فایل یا نحوه استفاده از GitHub شود.

Chat مالک state نیست. Chat فقط یک client موقت برای SOKNA Bridge است.

## 2) اصل معماری
دو نوع continuity مستقل و اجباری هستند:

1. **Work Continuity**: پروژه/job/plan/evidence و نقطه ادامه باید در Agent/Bridge پایدار بماند.
2. **Operating Knowledge Continuity**: AI جدید باید بدون حافظه chat قبلی، از خود Bridge روش صحیح کار را machine-readable یاد بگیرد.

Handoff متنی و حافظه مدل فقط fallback هستند؛ source of truth نباید conversation history باشد.

## 3) Persistent Work Session
Agent باید مفهوم first-class `work_session` داشته باشد.

حداقل داده پیشنهادی:
- `session_id`
- `workspace_id`
- `created_at`
- `updated_at`
- `status`
- `goal_summary`
- `active_job_ids[]`
- `active_plan_id?`
- `last_completed_step`
- `current_step`
- `pending_next_action`
- `last_failure?`
- `result_refs[]`
- `artifact_refs[]`
- `decision_refs[]`
- `source_branch?`
- `source_head?`
- `ci_refs[]`

Session state باید crash/restart-safe و مستقل از Extension popup یا Chat DOM باشد.

## 4) Self-Describing Bootstrap
در شروع هر AI session، Bridge باید یک bootstrap machine-readable برگرداند. نام نهایی API می‌تواند در implementation تثبیت شود؛ semantic contract پیشنهادی:

- `bridge.bootstrap`
- `session.list`
- `session.get`
- `session.resume`
- `session.checkpoint`

`bridge.bootstrap` باید حداقل این اطلاعات را بدهد:
- Agent version
- Extension/protocol compatibility info
- supported protocol version/schema
- capabilities + action schemas/reference
- semantic command compiler availability
- route policy version
- result/artifact limits
- inbound/outbound Artifact Plane capabilities
- Git/GitHub capabilities و authentication status reference
- workspace model/policy requirements
- current/recent resumable sessions
- required non-negotiable safety/ownership barriers

AI نباید V3/V4، carrier markers، Base64URL، payload budget یا command correlation را از حافظه خود حدس بزند.

## 5) Route Policy باید ماشین‌خوان باشد
انتخاب مسیر نباید سؤال حفظی برای AI باشد. Bridge/compiler باید deterministic route انتخاب کند.

Semantic intentهای سطح بالا نمونه:
- `exec`: عملیات کوتاه و bounded
- `batch`: چند step deterministic و bounded
- `job`: کار طولانی/async-like local execution با status durable
- `artifact`: داده حجیم/ZIP/screenshot/log bundle
- `browser_audit`: بازرسی Browser/Visual QA
- `repo_change`: تغییر source با workspace/Git policy
- `github`: عملیات remote GitHub وقتی capability/auth موجود است

AI هدف و پارامترهای معنایی را می‌دهد؛ compiler مسیر transport را می‌سازد و validate می‌کند.

## 6) انتقال فایل
AI جدید نباید مجبور باشد به خاطر بیاورد فایل حجیم را چطور بفرستد.

Bootstrap/route policy باید صریح بگوید:
- control payload کوچک از Control Plane؛
- bytes حجیم هرگز carrier/base64 عادی نیستند؛
- فایل/ZIP/screenshot/log از Artifact Plane با hash/size/ref؛
- inbound و outbound routeهای پشتیبانی‌شده؛
- سقف‌ها و providerهای فعال؛
- روش verify/apply/read evidence.

اگر route لازم موجود نیست، failure باید machine-readable باشد؛ نه اینکه AI با carrier دستی workaround بسازد.

## 7) Git و GitHub
AI جدید نباید GitHub access را حدس بزند.

Bootstrap باید وضعیت واقعی را expose کند:
- workspace Git capability
- GitHub capability
- auth status reference
- allowed repository/workspace scope
- branch/current HEAD در صورت session-bound بودن
- policy اینکه GitHub milestone/CI boundary است یا execution route جاری

هیچ credential خام در bootstrap یا logs برنمی‌گردد.

## 8) Resume Flow در chat جدید
جریان هدف:

1. AI جدید به Bridge وصل می‌شود.
2. `bridge.bootstrap` را می‌خواند.
3. sessionهای resumable را می‌بیند.
4. session مرتبط را با `session.resume` می‌گیرد.
5. Agent snapshot کوچک و machine-readable برمی‌گرداند: goal، state، last completed step، active job، pending action، refs، branch/head/CI evidence.
6. AI با `job.get/job.events` یا معادل canonical وضعیت زنده را sync می‌کند.
7. فقط از نقطه unresolved ادامه می‌دهد.
8. commandهای قبلی را duplicate نمی‌کند.
9. کاربر مجبور نیست معماری/route/فایل/GitHub را دوباره توضیح دهد.

## 9) Checkpoint خودکار
Checkpoint نباید فقط پایان chat انجام شود چون مدل زمان پایان context را دقیق نمی‌داند.

Agent باید در eventهای معنادار checkpoint کند:
- job accepted/started
- step completed/failed
- mutation committed
- artifact produced/applied
- Git commit/push
- CI run/result
- user decision affecting plan
- session pause/handoff request

Checkpoint summary کوتاه باشد و به evidence/event journal refs اشاره کند؛ داده تکراری بزرگ داخل آن ذخیره نشود.

## 10) Operating Knowledge vs Project Knowledge
Operating Knowledge عمومی Bridge است:
- چطور command بدهد
- چطور route انتخاب شود
- batch/job/artifact چه زمانی است
- file transfer چگونه است
- Git/GitHub capability چگونه probe می‌شود
- ACK/NACK/result semantics

Project Knowledge session/workspace-specific است:
- هدف فعلی
- branch/head
- فایل‌های تغییرکرده
- blockerها
- تست‌ها/CI
- next action

این دو نباید در یک handoff دستی مخلوط و وابسته به حافظه Chat شوند.

## 11) خطا و Recovery
اگر session قبلی running بوده ولی process/job دیگر وجود ندارد، resume باید state را reconcile کند و صریحاً `interrupted/stale/recovery_required` بدهد.

اگر AI جدید protocol ناسازگار داشته باشد، Bridge باید bootstrap compatibility error بدهد و route سازگار/upgrade requirement را اعلام کند.

اگر command قبلی terminal شده، retry کور ممنوع است؛ correlation/idempotency باید از duplicate mutation جلوگیری کند.

## 12) Security
- secret/token/password/cookie خام در bootstrap/session snapshot ممنوع.
- فقط secret reference و redacted status.
- session resume نباید permission جدید بدهد.
- effective permissions = policy/grant موجود؛ continuity privilege escalation ایجاد نمی‌کند.
- session متعلق به workspace/job/identity context مشخص باشد.

## 13) Acceptance Tests اجباری
R2-E فقط وقتی PASS است که حداقل این سناریوها تست شوند:

1. AI یک multi-step job شروع کند، chat عوض شود، AI جدید bootstrap+resume کند و از step درست ادامه دهد.
2. AI جدید بدون هیچ متن دستی تشخیص دهد فایل حجیم باید Artifact Plane برود و carrier دستی نسازد.
3. AI جدید GitHub capability/auth/route را probe کند و از روش صحیح استفاده کند.
4. AI جدید برای 2+ step bounded route `batch` را طبق policy بگیرد، نه commandهای تکی متعدد.
5. command malformed یک NACK machine-readable بدهد و session state مبهم نشود.
6. job terminal قبل از chat switch باشد؛ AI جدید آن را دوباره اجرا نکند و result موجود را بخواند.
7. browser audit evidence بعد از chat switch قابل resume/read باشد.
8. Agent/Extension restart رخ دهد؛ persisted session و event journal امکان recovery بدهند.
9. permission/grant منقضی شده باشد؛ resume fail-closed کند و privilege را بازسازی نکند.
10. هیچ تستی برای موفقیت به توضیح دوباره کاربر درباره carrier/file/GitHub وابسته نباشد.

## 14) ارتباط با R2
این قرارداد بخش اصلی `R2-E — New Chat Continuity / Autonomy` است و به R2-A/B/C وابستگی دارد:
- R2-A: semantic compiler + unified protocol
- R2-B: durable event journal/job observability
- R2-C: two-way Artifact Plane
- R2-E: bootstrap + persistent work session + deterministic resume

## 15) نتیجه مطلوب
بعد از این فاز، تعویض ChatGPT chat باید مثل عوض‌شدن یک terminal/client باشد، نه مثل از دست‌رفتن حافظه سیستم.

AI جدید باید از خود Bridge بفهمد:
- من چه قابلیت‌هایی دارم؟
- روش صحیح فرمان دادن چیست؟
- فایل را از چه مسیری منتقل کنم؟
- Git/GitHub را چطور و آیا می‌توانم استفاده کنم؟
- پروژه کجاست؟
- چه کاری در حال اجرا/تمام/خراب است؟
- قدم بعدی دقیق چیست؟

و سپس بدون بازسازی دستی context توسط کاربر ادامه دهد.
