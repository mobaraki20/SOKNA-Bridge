# Artifact Provider Contract v1 — P4

هدف: Artifact Plane باید بتواند فایل را از چند منبع مختلف دریافت کند بدون اینکه Core به GitHub، S3، Drive یا هر provider واحد وابسته شود. lifecycle مشترک همه providerها:

`probe/resolve → acquire/import → verify → register/audit → retention`

## قواعد قطعی
- تمام بایت‌های acquire شده فقط زیر `ArtifactRoot/staging` نوشته می‌شوند و finalize فقط با rename/move اتمیک به `ArtifactRoot/incoming` انجام می‌شود.
- هیچ provider حق destination دلخواه خارج ArtifactRoot ندارد.
- هر artifact قبل از register شدن SHA-256 می‌شود؛ providerهای remote برای `acquire` به `expected_sha256` معتبر نیاز دارند.
- Local/Managed Folder نیز SHA-256 واقعی را قبل از قبول ثبت می‌کنند؛ expected hash در این دو provider اختیاری است ولی اگر داده شود mismatch باید fail-closed باشد.
- signature اختیاری است. اگر `required=true` باشد، نبودن/نامعتبر بودن signature باعث reject می‌شود. v1 الگوریتم `ed25519-sha256` را پشتیبانی می‌کند (امضا روی digest خام SHA-256).
- auto-import هرگز auto-execute/apply نیست. metadata باید `auto_execute=false` و state اولیه `incoming` داشته باشد.
- همه transitionهای اصلی provider audit می‌شوند: started / probe-completed / verified / registered / failed.
- Workspace و Job correlation در metadata/audit نگه داشته می‌شود.
- partialهای transport در `staging` با retention موجود ArtifactRoot پاک می‌شوند. interruption transport می‌تواند partial را برای resume نگه دارد؛ hash/signature failure partial مسموم را حذف می‌کند.
- quota قبل از acquire با remaining ArtifactRoot محدود می‌شود و بعد از verify دوباره کنترل می‌شود.

## Providerها
### Core providers
- `local_file`: import فایل regular و non-symlink از مسیر local.
- امنیت path باید بر metadata واقعی filesystem تکیه کند، نه بر برابری متنی path پس از canonicalization؛ Windows 8.3/long-name alias به‌تنهایی reparse نیست. هر symlink/junction/reparse واقعی در خود path یا ancestor همچنان fail-closed است.
- `managed_folder`: مسیر relative داخل root از قبل configured؛ مناسب LAN/share. traversal/reparse/symlink fail-closed.
- `https`: direct HTTPS download.
- `github_release_asset`: resolve عمومی Release Asset با `repository/tag/asset` یا direct HTTPS؛ token اختیاری فقط با `credential_env`.
- `object_storage`: public/direct یا signed HTTPS URL؛ signed/credential-bearing URL خام ممنوع و باید از `url_env` وارد شود.

### Credential/plugin boundary
- `google_drive` و `onedrive`: Core مستقیماً OAuth/token lifecycle را مالک نمی‌شود. v1 فقط URL موقت/پیش‌امضا شده را از `url_env` که توسط boundary خارجی/Plugin فراهم شده می‌پذیرد.
- provider-specific credentials هرگز داخل metadata، audit، CLI args یا source_ref ذخیره نمی‌شوند.

### خارج از P4 runtime
- `chat_attachment`: همچنان feasibility-only. منبع `sandbox:`/DOM hidden-click انتقال بایت نیست و نباید اضافه شود مگر evidence و قرارداد جداگانه وجود داشته باشد.
- `github_actions_artifact`: فقط evidence اختیاری CI است و Result Plane روی آن ساخته نمی‌شود.

## Network / credential policy
- remote scheme در runtime فقط HTTPS است؛ downgrade به HTTP ممنوع.
- URL دارای userinfo ممنوع است.
- query credential/signature خام (`token`, `access_token`, `x-amz-signature`, `sig`, …) ممنوع است؛ signed URL فقط از `url_env` وارد می‌شود و query در `source_ref/resolved_ref` حذف می‌شود.
- bearer/token فقط با نام environment variable (`credential_env`) وارد می‌شود؛ value نه در JSON metadata و نه audit ذخیره می‌شود.
- redirect حداکثر 5 hop است؛ origin جدید فقط same-origin، allowlist صریح، یا hostهای موردنیاز GitHub asset است. Authorization روی cross-origin redirect حذف می‌شود.
- network/body headers در audit ذخیره نمی‌شوند.
- error text قبل از خروجی runner URL/query و Bearer secret را redact می‌کند.

## Download reliability
- retry محدود (v1 حداکثر 5) با bounded backoff.
- timeout bounded (v1 حداکثر 900s).
- stable partial per artifact + sidecar fingerprint؛ resume با HTTP Range.
- اگر server Range را نپذیرد و `200` بدهد، دانلود از صفر truncate/restart می‌شود.
- source identity برای resume بر provider + redacted source_ref + expected SHA bind می‌شود؛ signed URL refresh با همان path/hash می‌تواند resume شود.
- size از `max_artifact_bytes` و remaining quota بیشتر نمی‌شود.

## Result / metadata minimum
هر artifact پذیرفته‌شده حداقل این فیلدها را دارد:
`provider`, `source_ref`, `resolved_ref?`, `artifact_id`, `local_path`, `size`, `sha256`, `content_type`, `created_at`, `workspace`, `job_id`, `provider_boundary`, `download_attempts`, `resumed_bytes`, `signature`, `signature_ok`, `auto_execute=false`.

Result Plane مستقل از provider است.
