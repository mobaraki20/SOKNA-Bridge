# SOKNA AI Agent Operating Contract v2

Status: MANDATORY / EXECUTABLE.

## Transport budget (provisional, enforced)
- MAX_CHAT_CARRIER_CHARS: 1200.
- MAX_INLINE_PAYLOAD_BYTES: 800.
- Chat is control-plane only: ids, paths, refs, tiny parameters.
- Never carry scripts, patches, file bodies, or bulk Base64 in chat.
- Larger work MUST use local plan/job/ref or bounded file chunks.
- 2+ bounded deterministic steps SHOULD use one `job.batch` when safe; multi-step mutations SHOULD use one bounded plan/job instead of chat-by-chat orchestration; `large_result` SHOULD go directly to `result.get`.
- Budget rejections MUST be recorded locally, MUST NOT execute the command, and MUST emit a small retryable transport NACK to the AI. NACK delivery MUST NOT advance lastCompletedCommandId.

## Command preflight barrier
- `docs/AI_AGENT_COMMAND_PREFLIGHT_V1.md` is mandatory for every Bridge-emitting agent.
- Prefer V4 and validate serialize/parse, Base64URL round-trip, outer/inner command-id match, required structure, and 800-byte/1200-char budgets before emission.
- If preflight cannot be completed, emit NO Bridge command.

## Result-first barrier
- If pendingPostCount > 0 or state is Posting/Waiting for a queued RESULT, send NO new command.
- Never retry the same mutation when delivery is uncertain; reconcile/ACK the queued RESULT first.
- lastCompletedCommandId advances only after valid RESULT delivery/ACK, never merely after local execution.

## Execution gate
- Observe -> prove state -> smallest safe mutation -> verify RESULT.
- No success/commit/push/test claim without observed RESULT evidence.
- Failed exact match => read back; no blind retry.
- plan.stage success proves storage only; validate staged JSON/SHA before plan.run.
- Unknown artifacts stay untouched until provenance is known.

## Code-activation barrier
- Changes under extension/chrome/* are NOT runtime-active until unpacked Extension reload + target page reload/re-arm + runtime verification.

## Calibration & versioning
- 1200/800 are provisional safe limits, not guesses to expand casually.
- Change budgets only after repeatable threshold tests and record evidence.
- Each budget change requires a versioned contract update and test evidence in repo.

## Fast execution routing barrier
- SOKNA Bridge is the Chat agent access plane to authenticated GitHub and the user PC; do not assume direct access and do not ask the user to re-explain this in a new chat.
- Non-trivial work requires one full-source acquisition into the development workspace. Repeated Bridge file reads are not a development strategy.
- Development is workspace-first/batch-first. GitHub is used at meaningful validated checkpoints and for independent CI, never as a per-edit scratchpad.
- Real PCs are access/activation/acceptance endpoints. A PC may run an older Agent/Extension; probe first and use the version-matched contract.
- Route selection should minimize round trips while preserving the Full-Source, Result-First, and Code-Activation barriers.
