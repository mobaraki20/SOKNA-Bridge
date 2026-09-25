# GitHub Fast Path v1

تاریخ: 2026-09-25

## هدف

تجربه GitHub در SOKNA Bridge باید از دید AI/User سطح‌بالا و کم‌رفت‌وبرگشت باشد. Chat/Extension نباید برای هر `status/fetch/diff/test/add/commit/push/CI poll` یک round-trip مستقل ایجاد کند.

## اصل معماری

- Chat/Extension = Control Plane
- Agent = orchestration/execution plane
- `job.batch` برای کارهای کوتاه/متوسط چندمرحله‌ای
- `plan.run` + `job.submit` برای کارهای طولانی، قابل resume و قابل مشاهده
- Result Plane فقط milestone/summary/failure evidence را برمی‌گرداند.
- Artifact Plane برای patch/build/log/screenshot و داده حجیم استفاده می‌شود.

## Fast Path اجباری

برای workflowهای GitHub با دو مرحله یا بیشتر، AI باید به‌جای فرمان‌های ریز مستقل، یک batch/job واحد بسازد؛ مگر اینکه مرحله قبلی واقعاً نیازمند تصمیم جدید کاربر باشد.

نمونه canonical:

1. `repo.sync.preflight`
2. `git.fetch`
3. `repo.sync.apply_ff`
4. عملیات file/artifact موردنیاز
5. تست با `process.run`
6. `git.diff`
7. `git.add.paths`
8. `git.commit`
9. `git.push`
10. بررسی GitHub Actions با `gh`/GitHub integration

این مراحل باید داخل یک `job.batch` یا plan/job محلی اجرا شوند و Agent فقط milestoneهای مهم را گزارش کند.

## Permission Boundary

Fast Path مجوزها را دور نمی‌زند:

- Workspace scopes همچنان Read/Write/Deny را enforce می‌کنند.
- `git` و `gh` باید در Tool Allowlist باشند.
- Temporary Grant به `workspace_id + job_id` محدود است.
- Push به branchهای محافظت‌شده طبق policy ممنوع می‌ماند.
- هر repo باید با origin مورد انتظار تطبیق داده شود.
- GitHub onboarding و credential bootstrap مجزا از execution workspace است؛ credential خام نباید وارد Chat یا plan شود.

## UX هدف

کاربر باید بتواند از UI:

- GitHub را Connect کند.
- repo را انتخاب کند.
- Read-only یا Read+Write را تعیین کند.
- عملیات سطح‌بالا بدهد: inspect/sync/change/test/push/watch CI.
- فقط در نقاط حساس یا نیازمند permission دوباره تأیید بدهد.

## Acceptance

1. workflow چندمرحله‌ای GitHub با یک command اصلی وارد Agent شود.
2. حداقل 5 مرحله Git/GitHub بدون round-trip مکالمه‌ای بین مراحل اجرا شود.
3. شکست هر مرحله step evidence مشخص بدهد.
4. Job قابل `job.get`/`job.events`/Activity Monitor باشد.
5. permission violation fail-closed باشد.
6. push روی branch محافظت‌شده blocked بماند.
7. credential/token در result/log/artifact leak نشود.
8. CI monitoring در Agent/Integration poll شود، نه با فرمان‌های تکراری Chat.

## عدم هدف

Fast Path جایگزین GitHub permission model یا Workspace Manager نیست؛ فقط orchestration را local و کم‌latency می‌کند.
