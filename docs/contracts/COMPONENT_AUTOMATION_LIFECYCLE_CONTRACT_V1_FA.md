# قرارداد P6 — Component Lifecycle / Advanced Automation v1

این سند رفتار canonical فاز P6 را قفل می‌کند. P6 توسعه‌ای است؛ تا قبل از exact-RC Windows CI و LIVE هیچ ادعای activation روی PC کاربر وجود ندارد.

## Component Registry
هر component یک identity پایدار، `type=process|service|plugin`، owner نصب `sokna-agent`، managed root، release channel، dependency evidence، active version، LKG، state و health دارد. root نصب فقط زیر ComponentRoot مدیریت‌شده ساخته/حذف می‌شود؛ workspace و user data خارج از آن هرگز حذف نمی‌شوند.

## Ownership
برای process، stop/restart فقط وقتی مجاز است که PID + process start time + executable path + managed ownership sidecar همگی با registry تطبیق داشته باشند. PID stale/reused یا process خارجی fail-closed است. برای service، executable واقعی Windows Service باید داخل release root فعال component باشد؛ در غیر این صورت start/stop ممنوع است.

## Artifact / Dependency Boundary
Core یا Component Manager دانلود مستقیم ندارد. dependency acquisition فقط از Artifact Provider انجام می‌شود و release install فقط artifact داخل ArtifactRoot را می‌پذیرد. `component.release.apply` قبل از staging از `artifact.provider.verify` عبور می‌کند. Artifact هرگز صرف acquire به‌طور خودکار execute نمی‌شود.

## Release Transaction / LKG
مسیر activation:
`stage -> verify -> activate -> bounded health -> commit`.
هر failure پس از activate باید rollback خودکار به release قبلی معتبر داشته باشد. LKG per component نگهداری می‌شود. rollback دستی فقط release نصب‌شده و owned را فعال می‌کند. Archive traversal، symlink/reparse و extraction خارج از managed root ممنوع است.

## Health
health retry bounded است. process باید owned و alive باشد؛ service باید owned و Running باشد؛ plugin می‌تواند health path داخل release root داشته باشد. health failure evidence در transaction/audit ثبت می‌شود.

## Automation
Automation persistent است و دو نوع دارد: `interval` و `trigger`. interval حداقل 60 ثانیه است. missed-run policy فقط `skip` یا `run_once` است. concurrency بین 1..8 bounded می‌شود. run-key و event-id dedupe/idempotency را تأمین می‌کنند.

هر automation یک **grant template** صریح دارد. template در زمان register با base Workspace Policy intersect/validate می‌شود و حق توسعه scope/tool ندارد. برای هر run، Job ID و Grant ID deterministic ساخته می‌شود و یک grant جدیدِ job-scoped ساخته می‌شود. grant مشترک بین runها reuse نمی‌شود؛ پس trigger/scheduler حق دورزدن P5 را ندارد. پس از پایان job، grant revoke و pending claim آزاد می‌شود.

## Scheduler ownership / recovery
Scheduler child با parent Agent bind است و بعد از مرگ parent خارج می‌شود. scheduler sidecar شامل PID/start-time/script hash است؛ stale process فقط با ownership evidence مدیریت می‌شود. pending claimها برای جلوگیری از race/concurrency حفظ می‌شوند و claim orphan فقط پس از grace period قابل recovery است.

## Audit
component register/start/stop/health/release/rollback/remove و automation register/claim/submit/complete/missed/recovery باید audit داشته باشند.

## Acceptance
P6 source/unit tests باید ownership mismatch، transaction rollback، LKG، schedule dedupe، missed-run و concurrency را پوشش دهند. Windows acceptance باید حداقل process lifecycle، foreign/stale ownership rejection، bad release health rollback، automation grant escalation rejection و trigger/interval dedupe را اجرا کند.
