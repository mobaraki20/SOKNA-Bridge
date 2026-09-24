# R1 Release Candidate Freeze

R1 freezes an **exact source candidate**. It is not a Windows PASS and does not authorize LIVE activation.

## Candidate identity
- candidate runtime: Agent `2.6.0` development RC source;
- accepted baseline remains Agent `2.5.7 R4` + Extension `3.10.5`; Extension `3.10.6` is currently loaded only as an unaccepted candidate runtime for watcher diagnostics;
- candidate ref: `sokna-agent-2.6.0-rc7`, created locally only after the clean R1 commit exists;
- canonical source identity is the exact Git commit/tree recorded by the generated RC manifest, not a mutable branch name.


## RC1 supersession before CI
`rc1` was never pushed or live-activated. A read-only/pre-CI probe on the home Windows endpoint exposed two source portability gaps: platform-default Python text decoding in source-contract tests and a Windows PowerShell 5.1 parser incompatibility in `Sokna.Component.psm1`. The endpoint was incorrectly used for two direct source edits before this was stopped. Those endpoint edits are not the development source of record. RC2 is rebuilt from the development workspace with the findings reproduced/fixed there, KB evidence recorded, and the endpoint returned to evidence/publish-only duties.


## RC2 supersession before push
`rc2` was inspected/applied as an uncommitted overlay on the publish endpoint but was not committed, pushed, CI-dispatched, installed or activated. During that session the user correctly identified repeated control-plane round trips and manual-carrier regressions. The existing contracts already required batch-first routing and programmatic carrier generation, but those rules were not enforced as a mandatory per-session gate. RC3 adds only operational anti-regression hardening: `BRIDGE_SESSION_EXECUTION_GATE_V1_FA.md`, canonical KB entries, READ-FIRST linkage, and regression/CI coverage. No additional runtime authority is introduced. The endpoint must not be patched to add these files; publish uses one complete RC3 artifact generated off-PC.


## RC3 supersession after exact-RC Windows CI
`rc3` was canonicalized and pushed as commit `e394eda68eec13b4fdf07856c06a2c973b7f44b0`; exact-RC Windows CI run `35946302187` passed source guards, Extension/transport/repository contracts, P0-C..P6/R0/R1 contracts, native Agent tests and Browser tests, then failed only at Native Artifact Provider tests. The failure was a Windows path-security false positive: `filepath.EvalSymlinks` expanded the runner's valid 8.3 alias (`RUNNER~1`) to a long path, and textual inequality was incorrectly treated as a reparse point. RC4 replaces textual canonicalization equality with ancestor filesystem-metadata checks, retains real symlink/junction fail-closed behavior, adds regression coverage, and records the CI evidence in KB. No Agent 2.6.0 install/activation occurred on the home PC.


## RC4 supersession after broader exact-RC Windows CI
`rc4` was canonicalized and pushed as commit `86014574dcbb11fc662b79068ffdaee93f064062`; exact-RC Windows CI run `35947423759` proved the RC4 Provider correction by passing Native Artifact Provider tests, then continued through Native Host and ArtifactRoot Windows tests before failing at `Workspace 2.6.0 Windows permission matrix`. The concrete failure was Windows PowerShell 5.1 StrictMode cardinality semantics on `$lw.tools.Count`, not a demonstrated Workspace permission bypass. Because later independent Windows steps were then skipped, RC5 is intentionally **not** a one-line patch: it sweeps sibling PowerShell collection/native-output hazards, adds a 2.6.0 PowerShell/runtime compatibility preflight, converts independent Windows diagnostics to continue-and-aggregate with one final gate, and promotes the already-existing `job.submit` GitHub CI plan to the mandatory no-manual-polling path. This is designed to surface the remaining Windows failure set in one CI run instead of one RC per first failure. No Agent 2.6.0 install/activation occurred on the home PC.

## RC5 supersession after aggregated exact-RC Windows CI
`rc5` was canonicalized and pushed as commit `cdedc0b5b558a2f01098d577214222ed175ad1fa`; exact-RC Windows CI run `35948850265` successfully proved the new continue-and-aggregate diagnostic design. Instead of stopping at the first failure, the run exposed the full independent Windows failure set in one pass: `WINDOWS_COMPAT`, `WIN_ADVANCED_WORKSPACE`, `WIN_ARTIFACT_PROVIDER`, `WIN_BROWSER`, and `WIN_COMPONENT`. Source contracts, native Agent/Browser/Provider/Host tests, ArtifactRoot and base Workspace matrices passed. Code review mapped the five failures to two PowerShell 5.1 compatibility families: compact `return[ordered]@{...}` runtime syntax in Agent/Provider/Browser/Component, and dynamic property assignment on an `OrderedDictionary` in ephemeral Workspace view construction. RC6 fixes both families across the runtime, adds static anti-regression coverage, and additionally hardens Extension job watching so successful nested `job.submit` results inside `plan.run`/`job.batch` are discoverable. Candidate Extension becomes `3.10.6`; accepted live baseline remains `3.10.5` until exact-RC CI passes and the Code-Activation Barrier (reload + re-arm) is explicitly completed.


## RC6 supersession after exact-RC quick Windows CI + live watcher test
`rc6` was canonicalized and pushed as commit `fe3180bfe5a9aa1e252338ec6fb37ded5c020ebe`. Quick exact-RC Windows CI run `35951176227` narrowed the remaining Windows failures to `WINDOWS_COMPAT`, `WIN_ADVANCED_WORKSPACE`, and `WIN_ARTIFACT_PROVIDER`. The first and third share a broader PowerShell 5.1 lexical family than RC6 covered: compact `return$...` / `return(...)` forms can execute as command tokens. Advanced Workspace exposed a different pipeline-shape bug: `Assert-SoknaWorkspaceFullAccess` emits `$true`, so `ConvertTo-SoknaWorkspaceCompat` returned both that value and the dictionary, producing an `Object[]`. RC7 globally normalizes release-runtime `return` spacing and suppresses assertion output.

Extension `3.10.6` was explicitly reloaded/re-armed and live health proved watch registration (`jobWatchCount=1`) for top-level job `rc6-watch-3106`, but no terminal RESULT auto-posted after the job finished. RC7 Extension `3.10.7` therefore queues terminal events before removing watches, limits Result-First blocking to the actual parent command, performs an immediate retry, and exposes watch/poll/terminal-delivery diagnostics in Health. Extension `3.10.6` is not promoted as accepted solely by this diagnostic activation.

## Reproducible source bundle
`tools/release/Build-R1SourceRC.py` reads blobs directly from the exact Git commit, rejects dirty source and non-HEAD commits, uses fixed ZIP metadata/order, and embeds `__SOKNA_RC__/SOURCE_MANIFEST.json` with every tracked path/mode/blob/hash. Two builds from the same commit/tool implementation must be byte-identical.

## R0/R1 permission decision
P5's compatibility question is resolved explicitly: **a direct/interactively submitted job without a grant continues to operate only under its base Workspace Policy**. A grant is an attenuation layer, never an elevation layer. Automated scheduled/triggered runs create a fresh job-scoped grant every run; Remote Workspace execution requires its explicit job grant. R1 does not silently make grants mandatory for every legacy direct job because that would be a compatibility break without adding authority beyond the already explicit base Workspace policy.

## Exact-RC Windows CI
Full workflow dispatch must provide `expected_commit`. CI rejects a mismatch, generates the deterministic source RC from that checkout, builds the installer with the same expected source commit, runs the full Windows acceptance matrix, and then writes/upload exact-RC evidence containing source/setup/payload/runner hashes. A source-equivalent but different commit is not accepted as the same RC.

## Boundary
No .NET/Inno/PowerShell Windows execution is claimed by R1 locally. After the R1 freeze, only `CI -> LIVE` remain. After the 2026-09-24 pre-CI incident, no further source development/repair is permitted on the home PC before CI; it may be used only as the authenticated publish/access plane, and no Agent 2.6.0 install/activation is permitted before exact-RC CI passes.
