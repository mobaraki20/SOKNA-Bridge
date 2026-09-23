# قرارداد انتخاب محیط اجرا و تست v1

وضعیت: Canonical / Agent-consumable

اصل: کم‌هزینه‌ترین محیطی انتخاب شود که ریسک مادی همان Job را معتبر آزمایش می‌کند. GitHub Actions فقط یک adapter اختیاری است.

ترتیب: session/hardware/LAN واقعی → Real Windows PC؛ ریسک Windows قابل بازتولید → GitHub Windows Clean؛ Browser بدون session شخصی → Controlled Browser؛ در غیر این صورت → Local Development.

برای Windows runtime/installer release candidate، GitHub Windows Clean قبل از Real-PC Acceptance یک gate اجباری است. استثناء فقط با evidence و CR ثبت‌شده.

Helper اجرایی: `tools/ci/Select-ExecutionEnvironment.ps1` همین policy را deterministic مصرف می‌کند.

## Fast Work Route
برای انتخاب مسیر acquisition/development/push از `tools/ci/Select-FastWorkRoute.ps1` استفاده شود. اصل دائمی: full source یک‌بار، development در workspace، push فقط در checkpoint معتبر، و PC واقعی فقط access/activation/acceptance. جزئیات در `docs/handoffs/FAST_WORK_ROUTE_AND_EXT3105_HANDOFF_FA.md`.
