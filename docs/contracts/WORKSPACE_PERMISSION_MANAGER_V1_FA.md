# Workspace & Permission Manager Contract v1 — SOKNA Agent

تاریخ: 2026-09-24
وضعیت: P2 development contract

## 1) هویت Workspace
Workspace در Core مترادف Git repository نیست. نوع MVP برابر `persistent_local` است و یک پوشه موجود را به‌صورت register-in-place ثبت می‌کند؛ ثبت، update permissions و unregister نباید محتوای منبع را حذف یا جابه‌جا کنند.

Registry پایدار با schema `sokna-workspace-registry-v1` حداقل `id`, `display_name`, `kind`, `root`, `scopes`, `tools`, timestamps و `default_workspace` را نگه می‌دارد.

## 2) Path scopes
هر workspace باید scope صریح داشته باشد. access فقط یکی از `read`, `write`, `deny` است.

- `deny` همیشه بر read/write مقدم است.
- write شامل read همان scope است، اما read هرگز write نمی‌دهد.
- read و write روی همان normalized path به‌صورت هم‌زمان مبهم است و reject می‌شود.
- pathها relative و root-contained هستند.
- traversal، rooted relative input و reparse/junction/symlink path fail-closed هستند.
- registry persist‌شده هنگام inspect دوباره validate می‌شود؛ دستکاری registry نباید policy را دور بزند.

## 3) Broad execution boundary
File API می‌تواند با scope جزئی کار کند. اما external process و Git نمی‌توانند به‌طور قابل اتکا به subpath sandbox شوند؛ بنابراین broad execution فقط وقتی مجاز است که:

1. workspace برای access لازم full-root scope داشته باشد؛
2. هیچ deny scope وجود نداشته باشد؛
3. executable در tool allowlist همان workspace باشد.

این قاعده fail-closed است.

## 4) Tool allowlist
Tool permissions per-workspace و explicit هستند. نام executable normalize می‌شود (`git.exe` → `git`). هیچ migration یا registration نباید Git/GitHub را خودکار مجاز کند.

Git و GitHub adapterهای اختیاری‌اند. Core local file operations، registration، assessment و permission management بدون Git/GitHub معتبرند.

## 5) عملیات MVP
- `workspace.registry.status`
- `workspace.list`
- `workspace.inspect`
- `workspace.register`
- `workspace.permissions.update`
- `workspace.unregister`
- `workspace.assess`
- `workspace.managed_copy.plan`

`workspace.unregister` فقط registry را تغییر می‌دهد و `source_deleted=false` ثبت می‌کند.

## 6) Existing folder assessment
Assessment باید بدون Git requirement حداقل وجود پوشه، file count، total bytes و وجود `.git` را گزارش کند. هر reparse در tree fail-closed است؛ scan نباید آن را follow کند.

## 7) Managed-copy plan
P2 فقط plan غیرمخرب می‌سازد:

`copy -> verify -> test -> switch`

source و destination باید absolute، غیرهم‌پوشان و reparse-safe باشند. اجرای خودکار copy و حذف source خارج MVP است. source deletion یک action مستقل آینده است.

## 8) Legacy migration
در first initialization، `config.workspaces` قدیمی می‌تواند به registry جدید migrate شود بدون تغییر source config:

- path همان root باقی می‌ماند.
- `write_enabled=false` → root `read`.
- `write_enabled=true` → root `write`.
- `expected_repo` فقط compatibility metadata است، نه prerequisite.
- tool allowlist خالی می‌ماند و نیازمند review صریح است.
- legacy workspace name نامعتبر به ID deterministic تبدیل می‌شود و display name حفظ می‌شود.

## 9) Audit
Mutationهای registry و managed-copy planning در JSONL با schema `sokna-workspace-audit-v1` ثبت می‌شوند. Audit نباید secretهای config را dump کند.

## 10) Runtime integration
`file.list`, `file.search`, `file.read`, `file.write`, `file.replace` باید از policy resolver استفاده کنند. Deny path نباید با enumeration دور زده شود.

`process.run`, Git/GitHub و هر broad tool execution تابع full-access + tool allowlist هستند.

local-only write نباید صرفاً به‌علت نبود Git freshness guard بلوکه شود. اگر Git guard مجاز/قابل اعمال نیست، نتیجه باید به‌صراحت non-enforced reason برگرداند، نه اینکه Git را prerequisite Core کند.

## 11) Windows acceptance
Windows matrix حداقل باید این موارد را پوشش دهد:
- clean registry with zero workspaces؛
- register-in-place non-Git folder؛
- read/write/deny precedence؛
- traversal rejection؛
- junction/reparse rejection؛
- tool allowlist؛
- unregister source preservation؛
- legacy migration semantics؛
- managed-copy overlap/reparse rejection.

تا اجرای Windows gate، فقط source/local development PASS قابل ادعا است.

## 12) Activation boundary
P2 development روی PC کاربر activate نمی‌شود. Agent 2.5.7 R4 + Extension 3.10.5 baseline پذیرفته‌شده باقی می‌مانند تا whole-product RC و gate مستقل Windows/live.
