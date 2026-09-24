# P6 Component / Automation Development Validation — 2026-09-24

State: development Complete Unit candidate. No user-PC activation is claimed.

Implemented:
- first-class component registry for process/service/plugin;
- managed component roots and ownership-safe remove;
- process ownership proof using PID + start-time + executable + managed sidecar;
- service binary ownership boundary;
- dependency evidence and provider-only acquisition path;
- verified ArtifactRoot release install with zip traversal/symlink/reparse blocking;
- release transaction stage -> verify -> activate -> health -> commit;
- automatic rollback and per-component LKG;
- release channels stable/beta/dev/pinned;
- persistent interval/trigger automations;
- missed-run skip/run_once, idempotent run keys/event IDs, pending-claim race protection and bounded concurrency;
- per-run deterministic job/grant IDs and non-escalating grant templates;
- scheduler child bound to parent Agent;
- component/automation audit streams.

Local deterministic validation:
- Go component transaction/ownership/automation policy tests are executable in this development environment.
- Existing P0-P5 regression remains mandatory before checkpoint.
- Windows P6 acceptance is authored in `tools/runtime/releases/2.6.0/Test-ComponentAutomation260.ps1` but Windows execution is not claimed from this Linux workspace.

Security boundaries:
- no direct component download;
- no acquire-and-execute shortcut;
- no foreign PID/service stop;
- no Workspace/Grant escalation through scheduler;
- no user/workspace data deletion on component remove.

Exact next after P6: R0 whole-product integration/regression, then R1 reproducible RC freeze.
