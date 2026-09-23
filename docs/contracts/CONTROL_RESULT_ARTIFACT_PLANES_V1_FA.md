# Control / Result / Artifact Planes v1

- **Control Plane:** Chat ↔ Extension ↔ Agent؛ فقط command/ref/path/hash و پارامتر کوچک.
- **Result Plane:** job status + compact summary + failed-step evidence؛ مستقل از دانلود build artifact.
- **Artifact Plane:** بایت‌های حجیم، ZIP/build/screenshot/log bundle؛ provider-pluggable و hash/size/audit محور.

اصل: شکست Artifact Plane نباید Result Plane را کور کند.
