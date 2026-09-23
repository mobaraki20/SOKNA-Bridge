# Artifact Provider Contract v1

هدف: Artifact Plane بدون وابستگی هسته به GitHub/Drive/Chat. هر provider فقط `probe → acquire → verify` را پیاده می‌کند و خروجی پذیرفته‌شده را زیر ArtifactRoot می‌گذارد.

قواعد: path خارج ArtifactRoot ممنوع؛ SHA-256 و size قبل از accepted؛ auto-import هرگز auto-execute نیست؛ همه transitionها audit می‌شوند. Result Plane از provider جداست.

`chat_attachment` فعلاً **feasibility-only** است. چون منبع `sandbox:` در مرورگر fetchable اثبات نشده، v1 هیچ تغییر Native Host/DOM برای انتقال بایت Chat اعمال نمی‌کند و hidden-click fallback ممنوع است.
