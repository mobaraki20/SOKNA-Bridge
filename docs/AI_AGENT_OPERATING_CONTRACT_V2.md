# SOKNA AI Agent Operating Contract v2

Status: MANDATORY / EXECUTABLE.

## Transport budget (provisional, enforced)
- MAX_CHAT_CARRIER_CHARS: 1200.
- MAX_INLINE_PAYLOAD_CHARS: 600.
- Chat is control-plane only: ids, paths, refs, tiny parameters.
- Never carry scripts, patches, file bodies, or bulk Base64 in chat.
- Larger work MUST use local plan/job/ref or bounded file chunks.

## Result-first barrier
- If pendingPostCount > 0 or state is Posting/Waiting for a queued RESULT, send NO new command.
- Never retry the same mutation when delivery is uncertain; reconcile/ACK the queued RESULT first.

## Execution gate
- Observe -> prove state -> smallest safe mutation -> verify RESULT.
- No success/commit/push/test claim without observed RESULT evidence.
- Failed exact match => read back; no blind retry.
- Unknown artifacts stay untouched until provenance is known.

## Calibration & versioning
- 1200/600 are provisional safe limits, not guesses to expand casually.
- Change budgets only after repeatable threshold tests and record evidence.
- Each budget change requires a versioned contract update and test evidence in repo.
