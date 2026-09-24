# R1 Release Candidate Freeze

R1 freezes an **exact source candidate**. It is not a Windows PASS and does not authorize LIVE activation.

## Candidate identity
- candidate runtime: Agent `2.6.0` development RC source;
- accepted live baseline remains Agent `2.5.7 R4` + Extension `3.10.5` until CI passes;
- candidate ref: `sokna-agent-2.6.0-rc5`, created locally only after the clean R1 commit exists;
- canonical source identity is the exact Git commit/tree recorded by the generated RC manifest, not a mutable branch name.


## RC1 supersession before CI
`rc1` was never pushed or live-activated. A read-only/pre-CI probe on the home Windows endpoint exposed two source portability gaps: platform-default Python text decoding in source-contract tests and a Windows PowerShell 5.1 parser incompatibility in `Sokna.Component.psm1`. The endpoint was incorrectly used for two direct source edits before this was stopped. Those endpoint edits are not the development source of record. RC2 is rebuilt from the development workspace with the findings reproduced/fixed there, KB evidence recorded, and the endpoint returned to evidence/publish-only duties.


## RC2 supersession before push
`rc2` was inspected/applied as an uncommitted overlay on the publish endpoint but was not committed, pushed, CI-dispatched, installed or activated. During that session the user correctly identified repeated control-plane round trips and manual-carrier regressions. The existing contracts already required batch-first routing and programmatic carrier generation, but those rules were not enforced as a mandatory per-session gate. RC3 adds only operational anti-regression hardening: `BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md`, canonical KB entries, READ-FIRST linkage, and regression/CI coverage. No additional runtime authority is introduced. The endpoint must not be patched to add these files; publish uses one complete RC3 artifact generated off-PC.


## RC3 supersession after exact-RC Windows CI
`rc3` was canonicalized and pushed as commit `e394eda68eec13b4fdf07856c06a2c973b7f44b0`; exact-RC Windows CI run `35946302187` passed source guards, Extension/transport/repository contracts, P0-C..P6/R0/R1 contracts, native Agent tests and Browser tests, then failed only at Native Artifact Provider tests. The failure was a Windows path-security false positive: `filepath.EvalSymlinks` expanded the runner's valid 8.3 alias (`RUNNER~1`) to a long path, and textual inequality was incorrectly treated as a reparse point. RC4 replaces textual canonicalization equality with ancestor filesystem-metadata checks, retains real symlink/junction fail-closed behavior, adds regression coverage, and records the CI evidence in KB. No Agent 2.6.0 install/activation occurred on the home PC.


## RC4 supersession after broader exact-RC Windows CI
`rc4` was canonicalized and pushed as commit `86014574dcbb11fc662b79068ffdaee93f064062`; exact-RC Windows CI run `35947423759` proved the RC4 Provider correction by passing Native Artifact Provider tests, then continued through Native Host and ArtifactRoot Windows tests before failing at `Workspace 2.6.0 Windows permission matrix`. The concrete failure was Windows PowerShell 5.1 StrictMode cardinality semantics on `$lw.tools.Count`, not a demonstrated Workspace permission bypass. Because later independent Windows steps were then skipped, RC5 is intentionally **not** a one-line patch: it sweeps sibling PowerShell collection/native-output hazards, adds a 2.6.0 PowerShell/runtime compatibility preflight, converts independent Windows diagnostics to continue-and-aggregate with one final gate, and promotes the already-existing `job.submit` GitHub CI plan to the mandatory no-manual-polling path. This is designed to surface the remaining Windows failure set in one CI run instead of one RC per first failure. No Agent 2.6.0 install/activation occurred on the home PC.

## Reproducible source bundle
`tools/release/Build-R1SourceRC.py` reads blobs directly from the exact Git commit, rejects dirty source and non-HEAD commits, uses fixed ZIP metadata/order, and embeds `__SOKNA_RC__/SOURCE_MANIFEST.json` with every tracked path/mode/blob/hash. Two builds from the same commit/tool implementation must be byte-identical.

## R0/R1 permission decision
P5's compatibility question is resolved explicitly: **a direct/interactively submitted job without a grant continues to operate only under its base Workspace Policy**. A grant is an attenuation layer, never an elevation layer. Automated scheduled/triggered runs create a fresh job-scoped grant every run; Remote Workspace execution requires its explicit job grant. R1 does not silently make grants mandatory for every legacy direct job because that would be a compatibility break without adding authority beyond the already explicit base Workspace policy.

## Exact-RC Windows CI
Full workflow dispatch must provide `expected_commit`. CI rejects a mismatch, generates the deterministic source RC from that checkout, builds the installer with the same expected source commit, runs the full Windows acceptance matrix, and then writes/upload exact-RC evidence containing source/setup/payload/runner hashes. A source-equivalent but different commit is not accepted as the same RC.

## Boundary
No .NET/Inno/PowerShell Windows execution is claimed by R1 locally. After the R1 freeze, only `CI -> LIVE` remain. After the 2026-09-24 pre-CI incident, no further source development/repair is permitted on the home PC before CI; it may be used only as the authenticated publish/access plane, and no Agent 2.6.0 install/activation is permitted before exact-RC CI passes.
