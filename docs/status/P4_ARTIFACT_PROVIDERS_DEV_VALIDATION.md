# P4 Artifact Providers / Auto-download — Development Validation

Date: 2026-09-24
Status: **Development source implementation complete; Windows provider acceptance authored but not locally claimed. Whole-product RC/Windows/live remain deferred.**

## Implemented
- first-class provider lifecycle over ArtifactRoot: `probe/resolve → acquire/import → verify → register/audit → retention`;
- native dependency-light Go provider runner (`native/provider`) with no provider SDK dependency;
- providers: local file, managed folder/LAN, HTTPS direct, GitHub Release Asset, object-storage HTTPS;
- Google Drive/OneDrive explicit external plugin/presigned URL boundary via `url_env`; OAuth/token lifecycle is intentionally not implemented in Core;
- `artifact.import.local` migrated to the same provider interface for compatibility;
- remote acquire requires expected SHA-256; all accepted artifacts are re-hashed before registration;
- optional `ed25519-sha256` signature policy, fail-closed whenever `required=true`;
- stable partial + sidecar fingerprint, HTTP Range resume, bounded retry/backoff and timeout;
- size limit constrained by both ArtifactRoot per-artifact policy and current remaining root quota, with existing resumable partial credited back;
- transport interruption preserves partial for resume; completed hash/signature failure removes poisoned partial/sidecar;
- HTTPS-only runtime network policy, redirect hop/origin constraints and cross-origin Authorization stripping;
- raw credential-bearing URL query/userinfo rejection; signed URLs accepted only through environment reference and persisted source refs strip query/fragment;
- bearer credential accepted only by environment-variable name; credential value never enters command arguments, metadata or audit;
- runner error redaction for URL query, sensitive key-value and Bearer secrets;
- atomic staging→incoming finalize under ArtifactRoot;
- provider metadata includes source ref, workspace/job correlation, attempts/resumed bytes, signature state and `auto_execute=false`;
- provider partials/staging participate in existing ArtifactRoot retention/cleanup;
- Agent 2.6.0 capability actions + ping status integration;
- installer payload builds `provider/sokna-artifact-provider.exe`;
- Windows provider acceptance script + Windows CI steps authored.

## Deterministic local evidence executed
PASS:
- `go test ./...` under `native/provider`;
- `go vet ./...` under `native/provider`;
- real local provider CLI probe invocation;
- retry test: first HTTP 503 then successful retry;
- Range resume from an existing partial;
- hash mismatch rejection + poisoned partial removal;
- raw credential-bearing URL rejection + env URL source-ref redaction;
- Ed25519 required-signature success/failure;
- managed-folder traversal/symlink rejection;
- cloud boundary rejection without `url_env`;
- `python tools/tests/test_p4_artifact_providers.py` => `P4_ARTIFACT_PROVIDER_CONTRACTS_PASS`.

## Windows gate authored, not locally claimed
`tools/runtime/releases/2.6.0/Test-ArtifactProviders260.ps1` builds the native provider on Windows and exercises runtime module integration for:
- local provider acquire/register;
- managed-folder acquire with source preservation;
- managed ArtifactRoot verify;
- hash mismatch fail-closed + partial cleanup;
- raw secret-bearing URL rejection and audit non-leakage;
- Google Drive boundary enforcement;
- required-signature fail-closed behavior.

The Windows workflow also runs native provider Go tests, which include deterministic HTTP retry/resume behavior using an in-process test server.

## Explicit non-claims / boundaries
- no home-PC/Bridge command or activation;
- no GitHub push;
- no Google Drive/OneDrive OAuth implementation in Core;
- no `chat_attachment`/`sandbox:` byte transfer or hidden DOM-click fallback;
- no auto-execution after acquisition;
- no whole-product Windows acceptance yet.

## Exact next phase
P5 — Advanced Workspaces / Permissions: Ephemeral Checkout, Remote Workspace, job-scoped permissions, temporary grants, richer policy model/UI boundary, and remote execution adapters according to the security model. PC remains untouched until whole-product RC.

## Final hardening

- Destination collisions are fail-closed: an acquire with an already-registered `artifact_id` cannot delete or mutate the existing accepted artifact during cleanup. Cleanup is ownership-tracked (`finalOwned` / `metaOwned`) and only removes files created by the failing operation.
- Explicit verify operations now emit `started`, `completed`, and `failed` audit phases.
- Windows acceptance includes a collision-preservation negative test in addition to hash/signature/credential-boundary failures.
