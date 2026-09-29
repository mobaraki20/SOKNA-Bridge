# Reliability Kernel Acceptance — r9 candidate

Baseline: `sokna-agent-2.7.1-r8` / `2d2ca6e91be76297f8a3aed2d5910b627230880c`.

Candidate:
- Agent: 2.7.1 (core preserved)
- Extension: 3.12.7
- Semantic adapter: 2.1.1
- Working branch: `refactor/reliability-kernel-r9`
- Planned immutable tag after promotion: `sokna-agent-2.7.1-r9`

## Automated reliability gates

The candidate implements the report's R0-R6 reliability freeze/refactor. Automated gates cover:
- terminal rejection -> correlated visible NACK contract;
- semantic `rejected` vs `dispatched`;
- conversation-scoped idempotency;
- execution/delivery state separation;
- Delivery ACK v3 including large/virtualized results;
- body fallback diagnostic-only (never positive ACK);
- service-worker-safe bootstrap gate state;
- provisional URL -> concrete conversation identity migration;
- explicit HTTPS origin approval and dynamic ChatGPT Adapter registration;
- deterministic stress/fault-injection loops;
- existing R2 semantic/session continuity contracts.

Promotion remains blocked until all final-head automated workflows are green and Live Connected Chat UAT covers the browser-only acceptance cases without fail-silent, duplicate delivery, cross-conversation leakage, or false green.

## Live UAT required before merge/release

At minimum verify:
1. pre-bootstrap non-recovery command produces a visible correlated NACK and no execution;
2. bootstrap + session happy path, then a normal command;
3. duplicate command IDs remain idempotent and visible;
4. RESULT delivery and ACK for a large result;
5. composer draft is never treated as delivery and is never overwritten;
6. `delivery_uncertain` re-check remains visibility-only and never re-submits;
7. reload/service-worker restart preserves bootstrap/proof behavior for the same conversation;
8. a newer executing command is not replaced/cleared by an older pending delivery;
9. navigation to another conversation does not inherit execution authority;
10. built-in ChatGPT origins continue working;
11. an explicitly approved custom HTTPS ChatGPT origin can register the Adapter;
12. an unapproved custom origin stays fail-closed.

No Agent Core rewrite is part of r9.
