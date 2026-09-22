# Reliable Browser Transport Reliability Test Requirements v1

## Promotion gate
The new transport must not replace V3.9.5 until all required tests pass with no regression in existing V3.9.5 behavior.

## Inbound command reliability
- 100 short commands in one conversation: zero missed detections.
- Command visible in final assistant DOM but missed by MutationObserver must be recovered by reconciliation/rescan.
- Command arriving during streaming must be detected once after finalization.
- Fragmented carrier must reassemble correctly.
- Incomplete carrier must never execute.
- Duplicate observation paths must execute a command at most once.
- Page reload and content-script re-arm must not lose a valid final command.
- Large work must use reference/indirection rather than large chat carriers.

## Outbound result reliability
- State flow: queued -> sending -> submitted -> observed_in_conversation -> delivered.
- delivered is monotonic and cannot return to pending.
- Concurrent retry triggers for the same RESULT ID must collapse to one single-flight attempt.
- Before retry, conversation must be scanned for the RESULT ID.
- If the RESULT bubble already exists, mark delivered without another submit.
- Composer-empty alone must not mark delivered.
- Final ACK requires observing a real user-message bubble containing the RESULT ID.
- Zero duplicate visible RESULTs across the stress suite.

## Submit adapter
- Fill composer without overwriting a user draft.
- Dispatch required input/change events.
- Wait for UI render and enabled Send control before submit.
- Distinguish draft_present, attachment_pending, assistant_generating, page_unavailable, submit_blocked, and conversation_changed.
- A failed submit must remain queued and recoverable.
- Pending RESULT must survive page reload.
- Pending RESULT must survive extension/service-worker restart.
- RESULT must recover after Send control appears only after composer input/render settles.

## Recovery and restart
- Startup recovery with queued RESULT.
- Extension/service-worker restart during sending.
- Agent restart during/after command execution.
- Crash/restart recovery without duplicate visible RESULT.
- Conversation re-arm after reload.
- Stale RESULT from another conversation must never post.

## User safety
- Existing user draft must never be overwritten or auto-submitted.
- User attachment/upload state must block result auto-submit until safe.
- Assistant-generation state must queue delivery instead of racing the page.

## Agent Job Engine
- Small read/inspect work completes in one interaction.
- Patch + validation/test can execute as one bounded job.
- Commit + push can execute as one bounded job.
- Jobs remain deterministic; no free-form autonomous reasoning in Agent.
- Large outputs use file_ref, diff_ref, result_ref or artifact references.
- Job state and result retrieval survive Agent restart where supported.
- Shell/process failures must propagate as job failure even when a wrapper process exits zero after non-terminating errors.

## Workspace and permission tests
- Persistent Local workspace.
- Temporary/Ephemeral Checkout workspace.
- GitHub Remote without permanent clone.
- Read / Write / Deny path scope enforcement.
- Tool/app allowlist enforcement.
- Job-scoped temporary permission expiry.
- Audit log records mutations.
- SoknaCafe remains strict read-only.

## Performance acceptance
- ping / git status / small read: a few seconds in normal conditions.
- Small read + inspect: one round-trip.
- Small patch + test: one job/interaction where practical.
- Commit + push: one job/interaction.
- Transport retries must not create user-visible duplicate work.

## Regression baseline
- Native Host + Windows Agent
- V3 Base64URL parser
- legacy marker compatibility
- ephemeral addedNode capture
- progressive characterData fragmentation
- long fragmented envelope after complete DOM render
- native round-trip
- RESULT envelope compatibility
