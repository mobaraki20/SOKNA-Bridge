# r10 Build-vs-Adopt Audit

Date: 2026-09-30  
Branch: `refactor/reliability-kernel-r10`

## Rule

Every subsystem is evaluated with this order:

1. Adopt a proven component directly when it matches the product boundary, Windows deployment, security model, and license.
2. Adapt a proven protocol/design when direct adoption would introduce a worse dependency or trust boundary.
3. Build custom code only for SOKNA-specific behavior that existing projects do not provide.

No subsystem is protected from replacement merely because SOKNA already has working code for it.

## Product invariant

The user-facing product remains:

```text
ChatGPT UI on an approved HTTPS origin / route
        |
SOKNA Chat Adapter
        |
durable local Broker
        |
tools / files / git / browser / artifacts / jobs
```

The core must not depend on one ChatGPT hostname or one route shape.

## Reference projects reviewed

### browser-bridge — Apache-2.0

Strongest direct reference for real-browser control on Windows.

Useful properties:
- Windows x64 prebuilt support.
- Chrome MV3 + Native Messaging.
- separate broker between MCP client and Chrome native host.
- real logged-in Chrome rather than a second headless profile.
- stable element refs from `page_snapshot`.
- `page_click`, `page_fill`, `page_wait_for`, `page_screenshot`.
- tool catalog generated from one contract source.
- protocol/DOM/smoke/real integration tests.
- explicit versioned internal protocol and MCP protocol boundary.

Important mismatch:
- broad browser host access and no per-site approval by default.
- Browser Bridge is an MCP/browser product, not a ChatGPT conversation adapter.

Decision: **ADOPT/ADAPT for Browser backend; do not copy its broad trust policy.**

### open-browser-use — MIT

Strong reference for session broker, capability-gated IPC, common browser protocol across extension and CDP backends, and generated wire contracts.

Important mismatch:
- public preview currently targets macOS/Linux rather than Windows.

Decision: **ADAPT architecture/protocol ideas; do not make it the Windows runtime dependency now.**

### Microsoft Playwright MCP — Apache-2.0

Strong reference for model-facing browser semantics:
- JSON-schema-described tools;
- accessibility snapshots;
- stable refs;
- navigate -> snapshot -> interact -> re-snapshot workflow;
- screenshot as evidence rather than the control plane.

Important mismatch:
- by itself it does not solve SOKNA's already-open real Chrome + ChatGPT adapter + durable local broker.

Decision: **ADOPT tool semantics/contracts; use implementation where compatible, not as the whole Bridge.**

### Interpreter Workstation — Apache-2.0

Strong reference for:
- one model-facing ToolManager;
- one permission/approval queue;
- extension as implementation boundary, not model-facing boundary;
- target-bound permissions that cannot be bypassed by changing transport;
- local/remote host separation.

Decision: **ADAPT permission/tool-manager principles.**

### MCP specification

Strong reference for:
- `tools/list`-shaped descriptors;
- JSON Schema 2020-12 input/output contracts;
- standard annotations such as read-only/destructive/idempotent/open-world hints.

Decision: **ADOPT contract shape directly.**

---

## Component-by-component decision

| SOKNA subsystem | Previous r10 direction | New audit decision | Reason |
| --- | --- | --- | --- |
| ChatGPT page adapter | Custom | **KEEP CUSTOM / HARDEN** | This is the product-specific differentiator. External projects do not provide this exact ChatGPT DOM/semantic bridge. |
| Approved Chat origins | Custom | **KEEP CUSTOM** | Needed for SOKNA's explicit user-approved ChatGPT-compatible origins. |
| Conversation identity | Custom | **KEEP CUSTOM, ROUTE/ORIGIN-INDEPENDENT** | Must survive Project/GPT route and approved-origin changes. |
| Native Messaging boundary | Custom | **KEEP, THIN IT** | Good Chrome trust boundary; follow browser-bridge thin-host pattern. |
| Durable command broker | New r10 custom ledger | **KEEP CUSTOM CORE, ADAPT broker patterns** | Chat/extension/agent-wide recovery is SOKNA-specific. Avoid adding Rust solely to replace a now-tested Go ledger. |
| Broker wire protocol | Custom envelopes | **REFACTOR TOWARD JSON-RPC/MCP-LIKE ENVELOPES** | Reduce bespoke protocol surface and future adapters. |
| Tool registry | Custom `sokna-action-contract-v1` | **REPLACE WITH MCP TOOL DESCRIPTORS** | No reason to invent another schema. |
| Browser recipe runner | Custom Go/CDP | **DEPRECATE AS PRIMARY** | Keep for QA compatibility only. |
| Real browser control | Partial/custom | **ADOPT browser-bridge-style backend** | Already solves Windows real Chrome, stable refs, broker/native-host lifecycle. |
| Browser model-facing API | Custom recipe | **ADOPT Playwright/browser-bridge snapshot-ref semantics** | More deterministic and documented. |
| Artifact store | Custom | **KEEP CUSTOM / UNIFY** | Chat attachment and cross-tool artifact lifecycle are SOKNA-specific. |
| Chat artifact attachment | Custom | **KEEP CUSTOM** | External browser/MCP projects do not solve attachment back into this Chat UI. |
| Workspace registry | Custom | **KEEP** | Fits local repo/file boundary well. |
| Workspace permissions | Custom | **KEEP + ADAPT Interpreter principles** | Preserve explicit scopes; target denial must apply across all transports. |
| Broad shell permission | Existing fallback | **REDUCE / REMOVE AS NORMAL PATH** | Missing semantic actions must not be solved by granting a broad shell. |
| Credential storage | DPAPI custom | **KEEP STORAGE, ADD SEMANTIC CONTROL PLANE** | Windows-native secret protection is appropriate; AI must only see refs. |
| Jobs / long-running execution | Custom | **KEEP, ALIGN WITH BROKER LEDGER** | Needed beyond Browser; terminal state must be durable. |
| Delivery ACK from Chat DOM | Custom | **DEMOTE TO PRESENTATION TELEMETRY** | DOM visibility is not execution truth. |
| Extension command state | Extension storage | **CACHE ONLY** | Native broker is authoritative. |
| Result recovery | Split Agent/Extension | **UNIFY UNDER BROKER LEDGER** | One recovery path regardless of action owner. |
| Diagnostics | Custom | **KEEP, ADD doctor-style layers** | Adopt browser-bridge/open-browser-use operational diagnostics patterns. |
| Tests | Mixed | **EXPAND TO CONTRACT/DOM/E2E/FAULT-INJECTION GATES** | Mirror proven split between protocol, DOM and real integration tests. |

## Re-review of work already completed in r10

### Route/origin-independent conversation identity
**Keep.** This directly serves the product invariant and has regression coverage.

### Empty `tools:[]` workspace fix
**Keep.** This is a SOKNA policy correctness fix, not something an external dependency should own.

### Explicit viewport screenshot fix
**Keep only for compatibility runner.** It is still a valid defect fix, but it is not the future Browser control architecture.

### Browser artifact summary validation
**Keep.** Useful while the compatibility runner exists and improves structured failure.

### Assistant-busy attachment deferral
**Keep.** Chat attachment is SOKNA-specific and external Browser projects do not solve it.

### Native durable command ledger
**Keep, but continue protocol alignment.** The responsibility belongs in SOKNA because it spans Agent actions, Extension actions and Chat delivery. Continue to borrow broker/reconnect patterns rather than replace the implementation merely for technology fashion.

### Custom action contract registry
**Change.** Preserve the implementation work, but convert the descriptors to MCP-compatible Tool objects and JSON Schema 2020-12. Keep SOKNA metadata only under `_meta`.

### Delivery state separation
**Keep.** Execution truth must stay separate from presentation ACK.

## Browser target architecture

The preferred end state is:

```text
ChatGPT Assistant
   |
SOKNA Tool Registry (MCP-shaped)
   |
SOKNA Broker / policy
   |
Browser Backend Adapter
   |
   +-- real Chrome backend (browser-bridge-derived/adapted)
   +-- QA/headless compatibility backend (existing SOKNA runner, temporary)
```

Public AI tools should be small and deterministic:

- `browser.tabs.list`
- `browser.tab.open`
- `browser.tab.focus`
- `browser.page.snapshot`
- `browser.page.click`
- `browser.page.fill`
- `browser.page.wait`
- `browser.page.screenshot`

The AI should not need to author recipe JSON for ordinary browsing.

## Permission rules carried forward

1. Chat origin approval controls where SOKNA Chat Adapter may run.
2. Browser target permissions are separate from Chat-origin permissions.
3. A denied target remains denied regardless of backend (extension/CDP/headless).
4. Credentials are opaque refs; secrets are never returned to the model.
5. Broad script/eval capabilities are off by default.
6. Browser reads and mutations have separate policy classifications.
7. Shell access is never an implicit escape hatch.

## Adoption guard

Before importing third-party code into the distributed product:
- record upstream project/version/commit;
- verify license compatibility;
- retain required notices;
- pin the dependency/revision;
- add an SBOM entry;
- wrap it behind a SOKNA-owned interface;
- add an integration test proving SOKNA policy cannot be bypassed through the adopted component.

## Updated implementation order

1. Convert SOKNA tool descriptors to MCP-compatible Tool objects.
2. Finish one broker recovery path for Agent + Extension-owned actions.
3. Add a Browser backend interface.
4. Prototype browser-bridge-backed Windows real-Chrome adapter behind that interface.
5. Implement snapshot/ref browser tools.
6. Keep the existing browser recipe runner only as QA/compatibility backend.
7. Add credential-ref semantic actions.
8. Enforce cross-transport permission parity.
9. Add protocol/DOM/browser real-E2E gates.
10. Package one r10 candidate and run the short deterministic UAT.

This audit supersedes any earlier r10 decision that treated custom implementation as preferred merely because it already existed.
