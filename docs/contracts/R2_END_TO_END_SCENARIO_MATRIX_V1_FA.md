# R2 End-to-End Scenario Matrix v1

تاریخ: 2026-09-25
وضعیت: معیار اجباری طراحی/پیاده‌سازی R2

هدف: هیچ قابلیت مفید قدیمی صرفاً با حذف transport/contract قدیمی از بین نرود. هر تغییر Contract/Compiler/Extension/Agent باید کل مسیر `AI -> Extension -> Native Host -> Agent -> Result/Artifact -> AI/User` را بررسی کند.

## اصل معماری
- AI فقط semantic intent و هدف را بیان می‌کند؛ جزئیات carrier/encoding/version/size budget نباید مسئولیت reasoning مدل باشد.
- Semantic Compiler/Router مسیر canonical را انتخاب می‌کند.
- Control Plane فقط metadata کوچک/ref/path/hash/intent را حمل می‌کند.
- Result Plane نتیجه و failure summary فشرده را برمی‌گرداند.
- Artifact Plane بایت‌های حجیم مثل ZIP/build/screenshot/log bundle را منتقل می‌کند.
- حذف legacy فقط وقتی مجاز است که سناریوی متناظر روی مسیر جدید PASS شده باشد.
- هر failure باید machine-readable، correlated و `executed=false` یا terminal state روشن داشته باشد؛ fail-silent ممنوع.

## ماتریس ورودی AI -> Windows Agent

| سناریو | مسیر canonical جدید | انتظار |
|---|---|---|
| فرمان کوتاه | semantic `exec` -> control | validate + execute |
| چند کار bounded | semantic `batch` -> `job.batch` | ترتیب deterministic + stop_on_error |
| کار طولانی/recoverable | semantic `job` -> `job.submit` | durable job + watch/events |
| payload کنترل بزرگ | router -> Artifact/Plan Ref | carrier حجیم ممنوع |
| فایل پیوست Chat | Artifact Source Router -> `chat_attachment` | exact filename + expected SHA256 + fail-closed ambiguity |
| فایل local | Artifact Source Router -> `local_file` | import under ArtifactRoot + hash |
| managed folder/LAN | Artifact Source Router -> `managed_folder` | configured root only |
| URL مستقیم | Artifact Source Router -> `https` | HTTPS only + expected SHA256 + bounded redirects |
| GitHub release asset | Artifact Source Router -> `github_release_asset` | release/asset resolve + verify |
| object storage/signed URL | Artifact Source Router -> `object_storage` | credential-bearing URL only through protected env boundary |
| Google Drive/OneDrive | plugin/presigned boundary -> provider | OAuth not owned by core |
| Git/GitHub operation | semantic route -> Agent git/gh action | workspace/tool permission + exact scope |
| Browser/UI inspection | semantic browser audit/session job | evidence captured as artifacts |

## ماتریس خروجی Windows Agent -> AI/User

| خروجی | مسیر canonical موردنیاز | وضعیت R2 |
|---|---|---|
| نتیجه کوچک JSON/text | Result Plane inline | موجود |
| نتیجه JSON بزرگ | `result_ref` + `result.get` paging | موجود |
| status/ACK/job terminal | Result Plane correlated event | موجود جزئی؛ R2 observability تکمیل شود |
| خطا | machine-readable NACK/error + failed step | موجود جزئی؛ fail-silent ممنوع |
| فایل کوچک قابل ارائه | Outbound Artifact Router | باید first-class شود |
| فایل بزرگ/ZIP/build | Outbound Artifact Router + durable artifact ref | GAP: باید پیاده شود |
| screenshot/UI evidence | Artifact Plane + preview/ref قابل مصرف AI | GAP: برگشت PC -> AI باید first-class شود |
| log bundle | Artifact Plane + compact summary | GAP/تکمیل لازم |
| لینک HTTP(S) عمومی امن | result metadata با URL sanitized/clickable presentation | contract لازم |
| URL حساس/signed/credential-bearing | raw URL نباید در Chat/Result leak شود | باید protected ref/expiry/redaction داشته باشد |
| GitHub commit/PR/release | canonical GitHub URL + id/ref در result | contract presentation لازم |
| فایل روی PC بدون upload | local path صرفاً برای Agent؛ نباید به‌عنوان «قابل دریافت توسط AI» جا زده شود | ممنوع به‌عنوان delivery نهایی |

## قواعد انتخاب فایل/لینک خروجی
1. Agent نباید خودش حدس بزند که local path برای AI قابل دسترسی است.
2. اگر خروجی فقط metadata کوچک است، Result Plane کافی است.
3. اگر خروجی بایت دارد و AI/User باید آن را ببیند/بگیرد، Outbound Artifact Router باید آن را publish/attach یا به provider امن منتقل کند و یک ref قابل مصرف برگرداند.
4. لینک عمومی فقط در صورت HTTPS، sanitize و عدم وجود credential secret قابل ارائه است.
5. signed URL/credential-bearing URL هرگز raw در audit/result/chat persist نشود؛ از protected reference استفاده شود.
6. برای screenshot و visual evidence، AI باید بتواند خود artifact را دریافت/مشاهده کند؛ فقط مسیر فایل ویندوز کافی نیست.
7. delivery failure نباید result summary را کور کند: نتیجه باید بگوید artifact آماده شده ولی delivery شکست خورده و چرا.

## سناریوهای continuity/new chat
- chat جدید باید bootstrap contract، capability manifest و active work session را از Bridge بگیرد.
- route/file/GitHub rules نباید به حافظه مدل وابسته باشند.
- mutation بدون bootstrap/session compatibility معتبر fail-closed است.
- job/artifact/result refs باید مستقل از chat context قابل resume باشند.

## معیار حذف Legacy
`V2/B64/SOKNA3CMD/SOKNA4CMD/carrier guard` فقط زمانی از runtime حذف نهایی می‌شوند که:
1. semantic exec/batch/job PASS؛
2. Artifact Source Router برای chat/local/https/GitHub/large payload PASS؛
3. malformed semantic request NACK correlated PASS؛
4. Result/Status delivery PASS؛
5. large result/result.get PASS؛
6. outbound artifact contract برای file/screenshot/log تعریف و حداقل مسیر canonical آن پیاده و تست شده باشد؛
7. browser evidence round-trip acceptance PASS؛
8. new-chat bootstrap/resume acceptance PASS.

## روش کار اجباری
قبل از اعلام «حل شد»، برای هر تغییر باید سه سؤال جواب داده شود:
- آیا مسیر ورودی جایگزین کامل دارد؟
- آیا اجرای Windows و failure state قابل مشاهده است؟
- آیا خروجی، فایل، لینک یا evidence واقعاً به AI/User برمی‌گردد و قابل مصرف است؟

اگر پاسخ هرکدام «نه» باشد، فاز کامل نشده است.