# SOKNA AI Agent Operating Contract v1

This file is mandatory read-first context for any AI agent operating SOKNA Bridge.

## Transport
- Chat carriers are control envelopes only.
- Never inline long scripts, file bodies, large patches, or multi-step jobs in chat.
- Large or multi-step work must be staged as a local plan/job and referenced by id/path.
- Large outputs must use result_ref/file_ref and be read in bounded chunks.

## Execution discipline
- Observe -> prove current state -> make the smallest safe change -> verify.
- Never claim execution, success, commit, push, or test pass without observed RESULT evidence.
- If an exact replacement/match fails, stop guessing; read back the current source first.
- Prefer atomic or independently verifiable changes. Avoid fragile multi-file carrier patches.
- Keep command ordering deterministic; do not bypass the per-tab queue.

## Safety
- SoknaCafe remains read-only until the user explicitly enables write.
- Do not delete/commit unknown artifacts such as extension/chrome/Test/ without provenance.
- Do not weaken freshness, permission, audit, or rollback protections silently.

## Continuity
- Phase plans, checkpoints, acceptance evidence, and handoff state must be committed/pushed to SOKNA-Bridge.
- Future chats must read this contract and current status docs before mutating code.
- If chat transport becomes unreliable, stop sending larger carriers; fall back to short control commands plus local plan/job refs.
