# R12 Local Browser Task Engine — Adopt/Adapt Review

Date: 2026-10-03
Base: r11.1 attachment hotfix candidate `891b9f849fe33821ff73bd95ad9cb67df060a3c5`
Branch: `refactor/r12-local-browser-task-engine`

## Problem proven by UAT

A simple goal — log into the already-claimed SOKNA Local tab, discover the first three visible links, visit them and capture three screenshots — required many Chat ↔ Bridge command round-trips before login was even complete. That is not acceptable for a product that must work under message limits, latency and transient disconnects.

The public browser primitives remain useful for diagnostics and recovery, but they must not be the normal execution unit for multi-step work.

## Re-review of comparable projects

### Browser Use — MIT

Adopt/adapt:
- bounded multi-action execution inside one agent step;
- persistent browser/session state;
- page-change guards so queued actions do not continue against stale DOM;
- retry/failure ceilings and loop/stall detection.

Do not adopt:
- an embedded second LLM/API dependency inside SOKNA merely to orchestrate deterministic local actions.

### Stagehand / Stagehand Agent — MIT

Adopt/adapt:
- one top-level task with an internal bounded step loop (`maxSteps`);
- separation between high-level trajectory and low-level browser actuator;
- structured final result instead of exposing every actuator operation to the caller.

Do not adopt:
- Browserbase/cloud dependency as a requirement for the local Windows product.

### Skyvern — AGPL-3.0

Concepts only; no source is copied into SOKNA:
- task/workflow abstraction;
- max-step and retry limits;
- local/server-side perception/action loop;
- stored credential references and one final task result.

### Microsoft Playwright MCP — Apache-2.0

Adopt/adapt:
- stable refs / structured snapshots;
- batch form filling (`browser_fill_form` concept);
- re-snapshot after navigation and fail on stale refs;
- screenshots as evidence rather than the primary control plane.

Keep SOKNA-specific:
- exact claimed real-Chrome tab;
- per-origin approval;
- Windows DPAPI credential references;
- durable command broker and ArtifactRoot;
- ChatGPT presentation/attachment adapter.

## Decision

R12 adds `browser.task.run` as the normal multi-step browser execution boundary.

The Assistant compiles the user goal into one bounded declarative task plan. The Extension executes the plan locally in the exact claimed tab. Substeps do not become Chat messages. The plan is deterministic and does not execute arbitrary JavaScript from the model.

Existing `browser.page.*` tools remain available for diagnostics, one-off interactions and recovery.

## Initial task DSL

Supported local operations:

- `fill_many`: fill 1..20 fields locally; each field may use a literal value or an opaque `credential_ref` + `credential_field`.
- `click`: exact ref/selector click. Treated as non-blind-replay-safe.
- `wait`: selector, text, or DOM-settled wait.
- `snapshot`: structured current-page snapshot.
- `navigate`: same claimed origin only.
- `find_links`: discover the first bounded set of visible links in DOM order and save them as a task variable.
- `capture`: screenshot to ArtifactRoot.
- `foreach_capture`: visit a bounded saved link list and capture each destination with per-item checkpoints.

Limits:
- 1..50 plan steps;
- 1..100 local operations (`max_steps`);
- 0..3 retries per replay-safe step;
- 1..20 discovered/iterated links;
- same claimed browser origin only in R12 v1;
- no model-provided `eval`, script body, cookie mutation or storage mutation.

## Reliability model

- `task_id` + normalized plan SHA-256 is the idempotency key.
- Reusing a task id with a different plan fails closed (`BROWSER_TASK_PLAN_MISMATCH`).
- Progress is checkpointed to extension local storage.
- Completed replay-safe steps are skipped on resume.
- Interrupted replay-safe steps may be retried locally.
- An interrupted `click` returns `BROWSER_TASK_STEP_OUTCOME_UNKNOWN`; Bridge does not blindly replay a potentially consequential click.
- `foreach_capture` checkpoints each destination independently.
- Final captures are returned as ArtifactRoot refs plus one collection manifest.

## Acceptance gate

From an already claimed Local Web login tab, one Chat command must be sufficient to:

1. fill username and password using `sokna-local-admin` locally;
2. submit login;
3. wait for the post-login page;
4. discover the first three visible same-origin links;
5. visit each saved destination;
6. take one screenshot per destination;
7. return one final `RESULT` with three artifact refs and one collection ref.

Normal success may produce one accepted STATUS and one terminal RESULT. It must not expose one Chat command per browser substep.

## Integration strategy

R12 intentionally layers over the proven r11.1 runtime rather than rewriting it:

- `background_r12.js` preloads narrow capability/target shims, then imports the unchanged r11.1 bootstrap.
- `browser_task_runtime.js` installs `browser.task.run` after the proven background is loaded, adds it to the extension-owned durable ledger, and wraps the existing browser semantic dispatcher.
- `browser_task_core.js` contains pure plan validation, replay classification and link filtering so these rules can be tested outside Chrome.
- the Extension manifest points at the R12 wrapper service worker.

This keeps the attachment hotfix and r11 reliability work intact while making the new orchestration layer independently removable/testable.

## Licensing guard

No Skyvern source is copied. Browser Use, Stagehand and Playwright ideas are adapted at the architecture/contract level. Any future direct source import must record upstream commit/version, license and notices, and must receive a SOKNA policy-bypass integration test before distribution.
