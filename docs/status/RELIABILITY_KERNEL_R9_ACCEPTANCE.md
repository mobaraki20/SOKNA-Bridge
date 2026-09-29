# Reliability Kernel Acceptance — r9 working branch

Baseline: `sokna-agent-2.7.1-r8` / `2d2ca6e91be76297f8a3aed2d5910b627230880c`.

This branch implements the report's R0-R6 reliability freeze/refactor. Automated gates cover terminal rejection/NACK semantics, semantic rejected-vs-dispatched, conversation-scoped idempotency, execution/delivery state separation, ACK v3 including long/virtualized results, service-worker-safe bootstrap gate state, explicit HTTPS origin approval, and deterministic stress loops.

Promotion remains blocked until:
- GitHub Actions Reliability Kernel Validation is green.
- Existing Native Agent CI is green.
- Live Connected Chat verification covers the browser-only acceptance cases (composer draft, attachments, streaming, SPA navigation, origin approval, reload/service-worker restart) without fail-silent or duplicate delivery.

No Agent Core rewrite is part of this branch.
