# Installer & Maintenance Contract v1 — SOKNA Agent

تاریخ: 2026-09-24
وضعیت: P1 development contract

## 1) اصل مالکیت
Windows lifecycle نهایی PowerShell-owned نیست.

- **Inno Setup** مالک Setup.exe، Installed Apps، install/uninstall، registry، Start Menu، optional Desktop shortcut و فایل‌های lifecycle ثابت است.
- **Sokna.Agent.Maintenance (.NET 8 self-contained/single-file)** مالک preflight، health، diagnostics، support bundle، config migration، Repair، runtime Upgrade orchestration و rollback است.
- **Sokna.Agent.Launcher (.NET 8 self-contained/single-file)** مالک start/supervision runtime است و launch evidence شامل PID/path/hash می‌نویسد.
- runtime Agent فعلی زیر `runtime/` باقی می‌ماند و در P1 تنها componentی است که `owner=maintenance` دارد. Maintenance/Launcher/Extension/Native Host در manifest، `owner=installer` هستند تا هیچ executable در حال اجرا یا component دارای activation semantics مبهم توسط Maintenance overwrite نشود.

## 2) Project-agnostic Core
Setup/Core نباید prerequisite یا assumption درباره Git، GitHub، PHP، MySQL، Cafe یا هر workspace مشخص داشته باشد. Workspace onboarding یک مرحله مستقل پس از نصب Core است و در P2 مالکیت می‌شود.

## 3) InstallRoot و ArtifactRoot
- InstallRoot توسط Inno قابل انتخاب است؛ default: `%LOCALAPPDATA%\Programs\SOKNA Agent`.
- ArtifactRoot در wizard یک انتخاب first-class است؛ default: `%LOCALAPPDATA%\SOKNA\Bridge\artifacts`.
- InstallRoot و ArtifactRoot نباید داخل یکدیگر باشند.
- ArtifactRoot موجود از نظر reparse/junction fail-closed بررسی می‌شود و write probe دارد.
- ساختار managed P0-C (`incoming/staging/accepted/failed/cache/browser/logs`) توسط initialize تضمین می‌شود.
- uninstall نباید ArtifactRoot را حذف کند.

## 4) Config migration و locator
config canonical نصب در `<InstallRoot>\config.json` است.

اگر config مقصد وجود نداشته باشد و legacy `%LOCALAPPDATA%\SOKNA-Bridge-V2\config.json` وجود داشته باشد:
- content generic موجود migrate/copy می‌شود؛
- source حذف یا overwrite نمی‌شود؛
- ArtifactRoot جدید روی config canonical ثبت می‌شود؛
- migration evidence بدون secret در `state/config-migration.json` ثبت می‌شود.

Native Host برای custom InstallRoot از `%LOCALAPPDATA%\SOKNA\Agent\install-locator.json` استفاده می‌کند و فقط برای compatibility به path legacy fallback دارد.

## 5) Stable ownership state
`state/runtime-ownership.json` حداقل این موارد را نگه می‌دارد:
- install_root
- active_version / previous_version
- launcher_version
- agent_pid
- config_path
- artifact_root
- activation_tx_id
- last_health / last_rollback
- source_artifact_hash
- updated_at

`state/launcher-state.json` نیز agent PID، exact agent path و SHA-256 زمان launch را ثبت می‌کند. Health/Stop فقط PIDای را owned می‌دانند که pid-file و launcher-state path/hash با هم correlate شوند.

## 6) Manifest و ownership
Schema: `sokna-agent-install-manifest-v1`.

هر file entry:
- path
- sha256
- bytes
- owner = `installer` یا `maintenance`

تمام pathها باید root-contained باشند؛ traversal/reparse fail-closed. تمام source files قبل از lifecycle mutation hash/size verify می‌شوند.

## 7) Repair
Repair reinstall کور نیست:
1. exact manifest + payload verify؛
2. installer-owned file integrity verify؛ اگر mismatch باشد `INSTALLER_OWNED_REPAIR_REQUIRES_EXACT_SETUP`؛
3. فقط maintenance-owned runtime files missing/corrupt شناسایی می‌شوند؛
4. Agent owned process stop؛
5. restore با temp + hash + atomic replace؛
6. stable launcher start؛
7. expected-version health؛
8. audit.

Workspace data، credentials، user config و ArtifactRoot content حذف نمی‌شوند.

## 8) Upgrade / rollback
Maintenance Upgrade در v1 فقط maintenance-owned runtime payload را mutate می‌کند. اگر manifest تغییر installer-owned component بخواهد، Setup upgrade لازم است.

Flow:
- verify exact manifest/payload؛
- stage side-by-side؛
- backup live runtime؛
- record newly-added files؛
- preserve previous installed manifest؛
- ownership state = activating/pending؛
- stop owned Agent؛
- switch verified files؛
- write installed manifest؛
- launcher start؛
- ping + capabilities + PID/path/hash health؛
- commit ownership state.

Failure پس از mutation => rollback خودکار:
- stop owned target؛
- restore backup by hash؛
- delete only recorded files that did not exist before؛
- restore previous installed manifest؛
- restore previous version state؛
- start + rollback health؛
- audit result.

Same-version Upgrade به verify/Repair idempotent تبدیل می‌شود، نه no-op کور.

## 9) Logs, diagnostics, support bundle
Maintenance sessionها session_id/action/stage/result/error/next_action دارند.

Support bundle حداقل تولید می‌کند:
- `summary.json`
- `events.jsonl`
- `versions.json`
- `health.json`
- `config.redacted.json`
- selected installer/maintenance/runtime logs

Redaction شامل JSON secret keys، token/password/secret/API key، Authorization/Bearer، cookie/session token، `.env` secret-like keys و private-key blocks است. Workspace/artifact/private backup content به صورت پیش‌فرض داخل bundle نمی‌رود.

## 10) Installer UX و uninstall
Inno:
- Installed Apps registration؛
- Start Menu؛
- Desktop shortcut اختیاری؛
- autostart task؛
- ArtifactRoot picker؛
- Setup log؛
- Native Messaging registry؛
- post-install `initialize` سپس `start + expected-version health`؛
- uninstall-prep ابتدا Agent owned process را متوقف و locator را فقط اگر متعلق به همان InstallRoot باشد حذف می‌کند؛ ArtifactRoot preserved است.

## 11) Browser/Extension activation boundary
Setup extension files را install می‌کند، اما P1 ادعای reload/activation مرورگر نمی‌کند. هر تغییر future در Extension همچنان تابع Code-Activation Barrier است و component lifecycle آن در فاز مربوطه تکمیل می‌شود.

## 12) Acceptance barrier
P1 source فقط وقتی Windows-valid محسوب می‌شود که full Windows CI:
- .NET 8 publish maintenance/launcher PASS؛
- native host Go tests/build PASS؛
- pinned Inno compiler compile PASS؛
- Setup clean-install/upgrade/uninstall tests PASS؛
- runtime 2.6.0 PowerShell ArtifactRoot tests PASS؛
- Repair/Upgrade/rollback failure simulation PASS؛
- support-bundle secret leakage negative tests PASS.

تا آن زمان هیچ Windows/live PASS یا activation claim وجود ندارد.

## 13) Hardening addendum
- lifecycle path safety باید خود owned root را نیز از نظر reparse/junction reject کند.
- cross-version Upgrade فقط از current runtime مطابق installed manifest به‌عنوان LKG شروع می‌شود؛ same-version Upgrade برای repair corruption مجاز است.
- فایل‌های maintenance-owned حذف‌شده در نسخه جدید باید هنگام switch حذف و در rollback از previous manifest/backup بازیابی شوند.
- transaction stage evidence و previous ownership state باید durable باشد.
- PID ownership شامل PID + exact path + launch hash + process start-time correlation است؛ stop برای repair می‌تواند current-disk hash را relaxed کند، اما health integrity باید strict باقی بماند.
- start/repair/upgrade/rollback health باید bounded retry داشته باشد تا startup race باعث rollback کاذب نشود.
- build release به‌صورت پیش‌فرض روی dirty tree fail می‌شود.
- Windows full-profile acceptance باید lifecycle واقعی Setup را اجرا کند، نه صرفاً compile.


## 14) Legacy/current running runtime migration hardening (2.6.1)
- Setup activation must account for an already-running SOKNA runtime, including legacy `%LOCALAPPDATA%\SOKNA-Bridge-V2` and an active current InstallRoot runtime.
- A legacy process may be stopped only after ownership is correlated. PID presence alone is insufficient; process type/start-time must correlate with the legacy PID file and the configured endpoint must answer an authenticated SOKNA identity probe.
- If a SOKNA legacy endpoint is alive but process ownership cannot be proven, Setup must fail closed and must not kill an uncorrelated process.
- Legacy config/source files are preserved. Legacy autostart may be removed only when its value points to the canonical legacy runtime.
- A currently managed Agent may be stopped for Setup reinstall/upgrade using persisted PID/path/start-time ownership with relaxed current-disk hash, because Inno may already have replaced the runtime file before post-install initialization.
- After runtime preparation, the configured HTTP endpoint must be proven bindable before the new launcher is started.
- Preparation evidence must be persisted without secrets.
- Full Windows acceptance must include a live legacy-running-Agent -> Setup migration and an active-current-Agent -> Setup reinstall scenario.
