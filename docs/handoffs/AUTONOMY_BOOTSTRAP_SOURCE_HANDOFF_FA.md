# Autonomy Bootstrap v1 — Source Handoff

Base: `06d901a7b0334f43c9d4f2a06137df560b273f85` on `dev/bootstrap-v2.5`. Runtime baseline remains Agent 2.5.5 / Extension 3.10.3 until activation.

## Exact next action after source artifact apply
1. Commit/push only the artifact exact file set to `dev/bootstrap-v2.5`.
2. Submit `tools/plans/github-windows-ci-full.json` with `job.submit`. The detached 2.5.5 worker performs dispatch/wait/collect; it never blocks the main request loop.
3. For this **first bootstrap only**, Extension 3.10.3 cannot auto-watch the job. Read terminal state once with `job.get`; no repeated polling by the user.
4. On full CI PASS, run `tools/plans/activate-autonomy-bootstrap.json`. It only replaces the installed Extension files and records rollback state; Agent runtime and Native Host are untouched.
5. Reload the unpacked Extension once, reload/re-arm this chat, verify STATUS reports 3.10.4, and run the existing Extension self-test. This is the Code-Activation Barrier.
6. After 3.10.4 live acceptance, future `job.submit` terminal results are automatically returned to Chat as STATUS events while respecting Result-First ordering.
7. Then run R4 2.5.7 through the GitHub Windows gate and only after PASS use it as the first real-PC Agent acceptance candidate.

No Chat Artifact byte ingest is activated in v1. `sandbox:` remains unsupported until a safe fetch path is proven.
