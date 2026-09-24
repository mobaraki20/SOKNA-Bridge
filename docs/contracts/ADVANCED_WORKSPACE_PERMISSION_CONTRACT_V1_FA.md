# Advanced Workspace / Permission Contract v1 — P5

## هدف
P5 روی Workspace Manager v1 ساخته می‌شود و سه قابلیت را first-class می‌کند: Ephemeral Checkout، Remote Workspace abstraction و job-scoped temporary grants. این فاز هیچ مجوزی برای تماس/upgrade PC کاربر ایجاد نمی‌کند.

## Temporary Grant
- schema پایدار: `sokna-workspace-grants-v1`.
- هر grant به `workspace_id + job_id` bind است و `issuer/context/scopes/tools/created_at/expires_at/revoked_at` دارد.
- effective permission همیشه intersection امن `Workspace Policy ∩ Active Job Grant` است.
- grant حق توسعه‌ی Deny، تبدیل Read به Write، افزودن tool خارج از base policy، cross-job reuse یا استفاده بعد از expiry/revoke را ندارد.
- action دارای `job_id` اگر grant context داشته باشد از effective view استفاده می‌کند؛ revoke/expiry fail-closed است.
- restart/crash cleanup grantهای expired/revoked/orphan را حذف می‌کند و audit ثبت می‌شود.

## Ephemeral Checkout
- kind=`ephemeral_checkout` و حتماً به owner job bind است.
- root فقط زیر managed state `state/ephemeral/<job>/<workspace>` مجاز است؛ cleanup خارج از این root ممنوع است.
- source workspace دست‌نخورده می‌ماند؛ runtime checkout با local Git clone به managed root ساخته می‌شود و ref به detached state checkout می‌شود.
- expiry یا orphan job باعث cleanup قطعی checkout می‌شود؛ path reparse/traversal fail-closed است.

## Remote Workspace
- kind=`remote` فقط metadata/policy نگه می‌دارد؛ Core به SSH/WinRM/SFTP/Cloud SDK dependency مستقیم ندارد.
- adapter یک external boundary زیر `runtime/adapters/<adapter>/adapter.exe` است و request استاندارد `sokna-remote-workspace-request-v1` را از stdin می‌گیرد.
- `endpoint_ref` و `credential_ref` opaque reference هستند؛ URL/userinfo/query/credential value در Core ممنوع است.
- remote execution فقط با base `remote.exec` tool permission + active job grant شامل `remote.exec` + path مجاز در هر دو policy انجام می‌شود.
- adapter path از runtime boundary خارج نمی‌شود و reparse path رد می‌شود؛ transport invocation audit می‌شود.

## Compatibility
Persistent Local و jobهای legacy بدون grant همچنان base Workspace Policy را مصرف می‌کنند. هر execution که `job_id/grant_id` دارد وارد strict intersection می‌شود. این compatibility در R0/R1 دوباره ارزیابی می‌شود؛ تغییر به grant-required-for-all-jobs نیازمند CR صریح است.

## Acceptance
- grant escalation / base Deny bypass / tool expansion: reject.
- stale/expired/revoked/cross-job grant: reject.
- job-scoped file/process/git: effective intersection.
- Ephemeral root escape/reparse/orphan: reject or cleanup safely.
- Remote path escape/credential-bearing ref/missing adapter/tool/grant: reject.
- restart cleanup + audit evidence.
