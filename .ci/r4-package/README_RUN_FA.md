# SOKNA Agent 2.5.7 R4 Release Candidate

این بسته واحد کامل rollout است؛ فقط source patch نیست.

ترتیب اجرا:
1. ZIP خارجی با SHA-256 اعلام‌شده verify می‌شود.
2. بسته به managed incoming staging استخراج می‌شود.
3. `Stage-AgentRuntime257.ps1` خودش `Preflight-AgentRuntime257.ps1` را اجرا می‌کند.
4. اگر هر hash/parser/current-health/PID/recovery check fail شود، activation انجام نمی‌شود.
5. پس از PASS، runtime 2.5.7 با stable launcher فعال می‌شود؛ health failure موجب rollback خودکار به 2.5.5 می‌شود.
6. بعد از پاسخ 2.5.7، `Complete-AgentRuntime257.ps1` acceptance probe واقعی را اجرا می‌کند و فقط بعد از PASS، source/docs را exact-stage/commit/push می‌کند.

هرگونه debug تعاملی روی سیستم کاربر بعد از دو failure ممنوع است؛ بسته باید در Workspace توسعه اصلاح و دوباره منتشر شود.

R4 note: Windows preflight is invocation-mode aware. Agent-mediated preflight MUST NOT HTTP self-call the blocked live Agent; Stage passes `-InvocationMode AgentMediated`. External maintenance may use HTTP health.

R4: Stage قبل از activation، Startup-Probe Windows واقعی را اجرا می‌کند و launcher stdout/stderr را ثبت می‌کند.

Current authorized package: `SOKNA-Agent-2.5.7-R4-Release.zip` only. R1/original, R2 and R3 are superseded.
