# SOKNA Autonomy Bootstrap v1 — Simplified

این bootstrap فقط قابلیت‌های اثبات‌پذیر و لازم را وارد می‌کند:
1. Environment Selector machine-readable + executable helper.
2. GitHub Windows CI داخل `job.submit` worker موجود Agent 2.5.5؛ wait/collect هرگز request loop اصلی را block نمی‌کند.
3. Extension 3.10.4 فقط terminal `job.get` را در background دنبال می‌کند و summary را بعد از Result اولیه به Chat می‌فرستد. Result-First Barrier برای event با `parent_result_pending` حفظ می‌شود.
4. Operational Knowledge Base contract + seed lessons.
5. Artifact Provider contract/policy؛ بدون پیاده‌سازی Chat byte ingest تا زمانی که source واقعی fetchable اثبات شود.

حذف‌های آگاهانه نسبت به WIP قبلی: تغییر Native Host، chunked chat artifact ingest، artifact DOM scan و activation installer جدید حذف شدند؛ چون `sandbox:` fail-closed است و این scope برای bootstrap لازم نیست.

Runtime 2.5.6 همچنان blocked است. Runtime live این bootstrap را روی 2.5.5 نگه می‌دارد؛ R4 2.5.7 فقط بعد از GitHub Windows PASS وارد real-PC acceptance می‌شود.

> Current extension candidate note (2026-09-23): 3.10.5 preserves the 3.10.4 job/result behavior and adds correlated malformed-carrier NACK hardening. See `docs/status/TRANSPORT_V3105_CANDIDATE.md`.
