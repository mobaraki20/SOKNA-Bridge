# P3 Browser / Screenshot / Visual QA — Development Validation

Date: 2026-09-24
Status: **Source implementation complete for development checkpoint; Windows controlled-browser execution deferred and unclaimed until Windows gate.**

## Implemented
- dependency-light native Go controlled browser runner using Chromium DevTools Protocol (CDP);
- Chromium/Chrome/Edge discovery plus explicit browser override and isolated temporary user-data-dir;
- repeatable `sokna-browser-recipe-v1` schema with explicit viewport matrix;
- controlled actions: navigation/goto, wait, click, type, select;
- HTTP/HTTPS-only navigation, userinfo rejection, top-level origin allowlist and safety limits;
- screenshot, full-page screenshot and element screenshot capture;
- DOM, geometry/layout, accessibility tree, console and network summaries;
- geometry evidence for bounding boxes, visibility, clipping, fixed/sticky position, z-index, scroll dimensions and horizontal overflow;
- PASS/FAIL assertion engine with evidence artifact IDs and page-metadata fallback evidence;
- pixel visual regression with immutable baseline, current image, diff image, changed-pixel ratio and dimension mismatch;
- secret redaction for sensitive URL query keys, bearer/basic/key-value console patterns, and all values injected through `value_env` before DOM/a11y/console/network/page metadata are persisted;
- direct ArtifactRoot-backed output, hash/size verification, artifact metadata registration, audit and quota/per-run size enforcement;
- run and baseline ownership bound to Workspace; cross-workspace promote/consume is fail-closed;
- live browser capture intentionally disabled; policy exposes per-session explicit-consent requirement and forbids hidden capture, background spying, credential extraction and unrestricted cookie/token export;
- Agent 2.6.0 actions and capability manifest integration;
- installer payload build for `browser/sokna-browser-qa.exe`;
- Windows clean-environment acceptance authored for PASS/FAIL evidence, redaction, immutable baseline, cross-workspace ownership, visual change detection and unsafe URL rejection.

## Safety semantics
- recipe path must be readable inside a registered Workspace and that Workspace must explicitly allow tool `browser`;
- browser runner cannot write outside ArtifactRoot;
- output/baseline reparse or symlink escape fails closed;
- baseline ownership is checked before a run directory is created, preventing orphan runs on cross-workspace rejection;
- cookies/localStorage controlled setup use environment references rather than raw secret values in recipe setup;
- network bodies and request/response headers are not collected;
- oversized full-page/element captures and oversized runs are rejected;
- browser artifacts use deterministic bounded IDs compatible with P0-C metadata limits.

## Local evidence executed
PASS:
- `go test ./...` under `native/browser`;
- Windows cross-build: `GOOS=windows GOARCH=amd64 go build` produced a PE32+ x86-64 executable;
- `python tools/tests/test_p3_browser_visual_qa.py` => `P3_BROWSER_VISUAL_QA_CONTRACTS_PASS`;
- `python tools/tests/test_artifact_root_contract.py` => `ARTIFACT_ROOT_P0C_CONTRACTS_PASS`;
- `python tools/tests/test_p1_installer_contract.py` => `P1_INSTALLER_MAINTENANCE_CONTRACTS_PASS`;
- `python tools/tests/test_p2_workspace_permissions.py` => `P2_WORKSPACE_PERMISSION_CONTRACTS_PASS`;
- `python tools/tests/test_autonomy_bootstrap.py` => `AUTONOMY_BOOTSTRAP_CONTRACTS_PASS`;
- `node tools/tests/test_agent_job_core.mjs` => 6 tests PASS;
- `node tools/tests/test_transport_v3105.mjs` => `TRANSPORT_V3105_REGRESSION_PASS`;
- `go test ./...` in `native/agent`, `native/host`, `native/legacy/v2.5`, and `native/browser` => PASS;
- Windows workflow YAML + native-agent workflow YAML parse and `git diff --check` => PASS.

## Local controlled-browser limitation
The Linux development container has `/usr/bin/chromium`, but its headless process did not successfully load even the local HTTP fixture and direct `--dump-dom` testing did not reach the local server. Therefore **no Linux live-browser acceptance PASS is claimed**. This does not substitute for the authored Windows clean-environment gate.

## Windows gate authored, not locally claimed
`tools/runtime/releases/2.6.0/Test-BrowserQA260.ps1` is wired into the full Windows validation profile and exercises:
- real browser launch/navigation/actions across mobile + desktop viewports;
- screenshot/full-page/DOM/geometry/a11y/console/network evidence;
- secret redaction including `value_env` secret values;
- baseline dry-run/promotion/immutability;
- cross-workspace baseline rejection with no orphan run;
- identical visual PASS and intentional visual change FAIL + diff evidence;
- failure evidence artifact IDs;
- unsafe `file://` recipe rejection;
- live-capture policy boundary.

Current Linux development container has no Windows PowerShell/.NET/Inno toolchain, so Windows execution remains deferred and unclaimed.

## Activation status
- home PC untouched;
- no Bridge command and no runtime activation;
- no GitHub push;
- accepted Agent 2.5.7 R4 + Extension 3.10.5 remain baseline;
- Agent 2.6.0/P3 remain development source only.

## Exact next phase after checkpoint
P4 — Artifact Providers / Auto-download: provider abstraction over ArtifactRoot, managed-folder/LAN and remote provider adapters, probe/acquire/verify lifecycle, resume/retry and checksum/signature policy. No PC/live activation yet.
