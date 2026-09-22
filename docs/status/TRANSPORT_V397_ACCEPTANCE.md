# SOKNA Bridge Transport 3.9.7 Acceptance

Date: 2026-09-22

PASS:
- Compact protocol aliases reached Agent.
- Raw UTF-8 payload budget: 800 bytes.
- Oversize raw command returned retryable transport-nack with executed=false and actual/max bytes; no silent wait.
- NACK delivery does not count as command completion.
- Measured raw 760-byte compact command expanded to 806 bytes and executed successfully via 4096-byte internal bound.
- SoknaCafe remained write_enabled=false.

Evidence IDs: nacktest1, expandtest2.
