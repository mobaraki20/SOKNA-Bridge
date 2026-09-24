# Bridge Session Execution Gate v1

Status: **MANDATORY / CANONICAL**

هدف: هر ایجنت جدید باید بدون یادآوری کاربر، SOKNA Bridge را با کمترین رفت‌وبرگشت و بدون تبدیل PC کاربر به محیط توسعه استفاده کند.

## 1) قبل از اولین فرمان Bridge در هر session

ایجنت MUST این اسناد را بخواند:
1. `00_READ_FIRST_NEW_CHAT.md`
2. `docs/AI_AGENT_OPERATING_CONTRACT_V2.md`
3. `docs/AI_AGENT_COMMAND_PREFLIGHT_V1.md`
4. `docs/FAST_WORK_PATH_V1_FA.md`
5. این سند
6. KB مرتبط از `docs/knowledge/agent-lessons.jsonl`

سپس نسخه live Extension/Agent و `agent.capabilities` را مبنا قرار دهد. action/schema حدس زده نشود.

## 2) Route Selection — قبل از ساخت هر carrier

### A. یک probe ساده و مستقل
یک action کوتاه read-only مجاز است.

### B. دو یا چند مرحله bounded/deterministic
**پیش‌فرض = یک `job.batch`**، نه چند فرمان chat-by-chat.
- Runtime 2.5.7: حداکثر 30 step.
- `workspace` را در سطح batch بده؛ فقط overrideهای لازم داخل step.
- `stop_on_error=true` برای dependency chain؛ برای probeهای مستقل `false`.
- مثال مناسب: `git.status + repo.inspect + gh.auth.status` در یک batch.

### C. mutation چندمرحله‌ای / workflow قابل‌تکرار
**پیش‌فرض = plan/job**.
- plan را در workspace/artifact plane نگه دار.
- `plan.run` برای bounded synchronous workflow.
- `job.submit` برای کار طولانی/async/recoverable.
- Chat فقط path/hash/id را حمل کند.

### D. فایل/patch/build/log بزرگ
**Artifact Plane**؛ هرگز inline carrier.
- یک ZIP/artifact کامل بهتر از file-by-file transfer است.
- `artifact.inspect` قبل از `artifact.apply`.
- large result => `result.get`، نه carrier بزرگ.

## 3) Result-First درست یعنی چه؟

Result-First بین **outer commandها** اجباری است:
- تا RESULT/NACK فرمان فعلی resolve نشده، outer command بعدی ممنوع.
- اما stepهای داخل یک `job.batch` یا `plan.run` یک outer command واحد هستند و باید برای کاهش round-trip تجمیع شوند.

پس Result-First هرگز توجیهی برای خردکردن یک probe سه‌مرحله‌ای به سه پیام جدا نیست.

## 4) Carrier Generation Gate

قبل از هر carrier:
- فقط `tools/sokna_carrier_guard.py`.
- `--extension-version <live-version>` اجباری.
- serialize/parse + Base64URL round-trip + outer/inner id + budget verification.
- manual Base64/carrier یا hand-edit خروجی ممنوع.
- اگر guard/preflight قابل اجرا نیست: **فرمان ارسال نشود**.

Budget فعلی:
- raw UTF-8 JSON <= 800 bytes
- final carrier <= 1200 chars

اگر batch از budget عبور کرد:
1. params را کوچک کن / path-ref استفاده کن؛
2. plan/job ref بساز؛
3. batch را فقط در مرز dependency منطقی تقسیم کن، نه step-by-step.

## 5) PC Role Gate

PC کاربر = Access / Publish / Activation / Acceptance endpoint.

روی PC:
- source development و patch-on-patch ممنوع؛
- نصب toolchain توسعه برای عبور از تست ممنوع؛
- failure = evidence؛ fix در development workspace؛
- integrity/publish checks مجاز؛
- unknown untracked files حفظ شوند.

## 6) GitHub / CI Gate

- GitHub scratchpad نیست.
- یک candidate کامل و validated => یک milestone commit/push.
- exact commit => CI.
- Windows-only build/runtime validation در clean Windows CI، نه با تجهیز PC کاربر به Node/Go/SDK/Inno.
- اگر `job.submit` و `tools/plans/github-windows-ci-full.json` موجود است، **polling دستی chat-by-chat با `gh run view` ممنوع است**. یک durable job باید dispatch + wait + collect را انجام دهد و Extension فقط RESULT اولیه و terminal summary را به Chat برگرداند.
- manual CI status probe فقط fallback است: وقتی durable job واقعاً unavailable/failed باشد و علت ثبت شود.
- independent Windows diagnostics باید در یک CI run تا حد ممکن همگی اجرا شوند و در انتها یک diagnostic gate نتیجه‌ها را aggregate کند؛ fail-fast روی اولین تست مستقل ممنوع است.
- بعد از یک Windows-only failure، قبل از ساخت RC بعدی باید کل failure-family و stepهای بعدی که قبلاً skip شده‌اند audit شوند؛ patch-one-line => RC-new به‌صورت پیش‌فرض ممنوع است.
- اگر candidate یک publish plan معتبر در `tools/plans/` دارد، بعد از `artifact.inspect/apply` باید همان plan اجرا شود؛ commit/tag/push/CI نباید دوباره chat-by-chat بازسازی شوند.

## 7) Preferred command patterns

ترتیب ترجیح:
1. `job.batch` برای 2+ probe/action کوتاه.
2. `plan.run` برای bounded multi-step mutation.
3. `job.submit` برای async/long-running/recoverable work.
4. `artifact.inspect/apply` برای change-set حجیم.
5. `result.get` برای خروجی حجیم.
6. single action فقط برای یک کار واقعاً مستقل.

## 8) Session efficiency rule

قبل از هر outer command ایجنت باید از خود بپرسد:
- آیا مرحلهٔ بعدیِ قابل‌پیش‌بینی را می‌توان همین الآن در همان batch/plan گنجاند؟
- آیا خروجی این probe برای 2-3 تصمیم بعدی کافی است؟
- آیا من دارم چیزی را که Agent خودش در یک batch می‌تواند انجام دهد به چند رفت‌وبرگشت تبدیل می‌کنم؟

اگر پاسخ مثبت است، split کردن فرمان ممنوع است مگر safety/result dependency واقعی وجود داشته باشد.

## 9) Current accepted baseline

- Extension: 3.10.5
- Agent: 2.5.7 R4
- current capabilities include `job.batch`, `plan.run`, `job.submit`, `artifact.inspect/apply`, `result.get`.

## 10) Handoff requirement

ایجنت نباید منتظر یادآوری کاربر درباره batch/artifact/result-first/carrier guard بماند. این سند بخشی از READ-FIRST است و omission آن regression محسوب می‌شود.

## Nested durable-job watch compatibility
- Extension 3.10.5 only auto-registers a durable watch when `job.submit` is the top-level command.
- Extension 3.10.6 was live-tested after reload/re-arm: recursive watch registration works (`jobWatchCount=1`), but terminal auto-delivery did not complete reliably. Do not treat registration alone as autonomy PASS.
- Candidate Extension 3.10.7 queues terminal events before removing watch state, scopes Result-First blocking to the parent command result, retries delivery immediately, and reports watch/poll/terminal diagnostics in Health.
- Extension 3.10.8 gives every queued STATUS a unique `eventId`; existing-bubble detection MUST prefer `eventId` over the parent `commandId`. This path is live-proven: job `rc8-ci-91ad9b3` posted its terminal STATUS automatically. This proves terminal delivery only; it does not imply Agent 2.6.0 Windows acceptance.
- Extension source changes are not runtime-active until reload + page reload/re-arm; never claim candidate watcher behavior from disk files alone.
- Candidate Extension 3.10.9 adds `artifact.chat.apply`: attachment acquisition is allowed only by exact unique filename + expected SHA-256 in the Armed conversation. The Extension clicks only the uniquely matched visible attachment, persists transfer state, and the Agent must hash/inspect before apply. Ambiguous/missing attachment, hash mismatch, path escape, or reparse must fail closed. Inline/Base64 artifact payloads remain forbidden.
- Auto-Pull acceptance requires a one-time Code-Activation reload from 3.10.8 to 3.10.9, then one live `attachment -> download -> verify -> apply -> terminal STATUS` test. After that, routine artifact delivery must not require the user to click/download or report "downloaded".

## 11) Windows Adversarial Release Gate — MANDATORY

از این پس **Local PASS مساوی RC-ready نیست**. Local regression فقط اجازه می‌دهد یک **candidate checkpoint** ساخته شود.

ترتیب اجباری release:
1. `Local regression` و static producer/consumer contracts در development workspace؛
2. push یک **untagged candidate checkpoint** از همان exact tree؛
3. `Windows Adversarial Preflight` به‌عنوان gate واقعی Windows PowerShell روی همان exact commit؛
4. ادامه‌ی همان `exact-commit Windows full CI` با aggregate diagnostics تا همه failure-familyهای مستقل در همان run دیده شوند؛
5. فقط پس از PASS کامل مرحله 4، ساخت/push کردن **RC tag** و ادعای acceptance.

قواعد Windows Adversarial Preflight:
- تمام `ps1/psm1`ها با parser همان Windows PowerShell parse شوند؛
- lexical hazards شناخته‌شده (`return$...`, `return(...)`, `throw"..."` و هم‌خانواده‌ها) fail-closed باشند؛
- قرارداد producer/consumer برای JSON خارجی بررسی شود؛ به‌خصوص fieldهای `omitempty` نباید تحت StrictMode مستقیم خوانده شوند؛
- ماتریس‌های خالص Windows برای ArtifactRoot/Workspace/Advanced Workspace قبل از full CI اجرا شوند؛
- fixture مرورگر باید implicit resourceها را deterministic کند، server readiness را اثبات کند، و اولین failure شامل URL/status/console diagnostic محدود باشد؛
- هر failure جدید Windows قبل از candidate بعدی باید به regression دائمی + KB rule تبدیل شود.

**RC tag قبل از exact-commit Windows full PASS ممنوع است.** Candidate commit/tag acceptance از هم جدا هستند.

- تست منفی native روی Windows PowerShell 5.1 باید stderr و exit code را با ErrorActionPreference موقتاً Continue ایزوله کند؛ expected stderr زیر Stop نباید به عنوان failure خود test harness تفسیر شود. این الگو باید با probe واقعی Windows در Windows Adversarial Preflight محافظت شود.
