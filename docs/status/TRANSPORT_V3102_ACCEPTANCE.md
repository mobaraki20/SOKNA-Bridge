# SOKNA Bridge Transport 3.10.2 Acceptance

Date: 2026-09-23

PASS:
- Runtime 3.10.2 activated via extension reload + page reload/re-arm.
- Malformed identifiable V4 p3102-badfmt-1 returned automatic correlated transport-nack: reason=invalid_json, executed=false, retryable=true.
- Valid preflighted V4 p3102-v4-ping-1 executed and returned RESULT without Health/Status/Retry/Reload.
- SoknaCafe remained write_enabled=false.

NOT YET CLAIMED:
- Exhaustive historical/prose false-positive suppression across arbitrary long chats.

Evidence: p3102-badfmt-1, p3102-v4-ping-1.
