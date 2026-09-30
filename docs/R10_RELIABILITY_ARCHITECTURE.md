# SOKNA Bridge r10 Reliability Architecture

Status: architecture freeze for r10  
Baseline: r9 commit `6e1c829543244d83ed71b97411f812441e3aa841`

## Product invariant

SOKNA Bridge is a ChatGPT-interface bridge, not a URL-specific automation.

A user must be able to continue using Bridge when the ChatGPT conversation is exposed through different approved HTTPS origins or different ChatGPT route shapes. A URL/path change may require the Chat Adapter to rediscover DOM selectors, but it must not invalidate authoritative command state, artifacts, permissions, or job state.

The core must never depend on one hard-coded ChatGPT path such as `/c/<id>`.

## Architecture

```text
ChatGPT-compatible page
        |
   Chat Adapter (MV3)
        |
 Native Messaging boundary
        |
  SOKNA Broker / durable ledger
        |
  +-----+---------+---------+-----------+
  |               |         |           |
Tool registry   Artifacts  Browser    Workspace/Jobs
  |                         |
MCP-shaped contracts   Playwright-shaped primitives
```

### Chat Adapter

Responsibilities:
- discover assistant/user/composer surfaces;
- extract semantic commands from authenticated assistant message shells;
- present STATUS/RESULT/artifacts to the active conversation;
- maintain explicit user-approved HTTPS origin registration;
- report presentation telemetry.

It is **not** the source of truth for command execution, dedupe, results, jobs, or artifacts.

Conversation identity must be route-tolerant. When a stable `/c/<conversation-id>` segment exists anywhere in the path, that token is used independent of surrounding Project/GPT path segments. When ChatGPT changes route format, only this adapter identity resolver changes.

### Durable broker/command ledger

The native side becomes authoritative for:
- command idempotency;
- lifecycle `accepted -> running -> succeeded|failed`;
- terminal result/error;
- sequence/cursor for reconnect;
- recovery after Chat tab, service-worker, Extension, or browser restart.

Extension storage is a cache/projection only.

A Chat presentation ACK is not an execution ACK. Missing DOM visibility may mark presentation as `unknown`, but it must never rewrite or poison the completed command state.

### Tool registry

r10 will expose one machine-readable registry for Agent and Extension actions.

Each action must provide:
- name and description;
- JSON input schema;
- JSON output schema;
- owner (`broker|agent|chat-adapter`);
- read-only/mutating classification;
- idempotency semantics;
- required capabilities/permissions;
- structured error codes.

The AI must be able to use the product without reading repository source.

### Browser

The custom recipe format may remain as an internal compatibility layer, but it is no longer the primary AI contract.

The public Browser contract will follow proven Playwright/MCP patterns:
- session/tab discovery;
- navigation;
- accessibility/DOM snapshot with stable refs;
- click/fill/select/wait;
- screenshot as evidence, not as the control model;
- explicit credential refs;
- bounded origins;
- structured errors.

Implementation may reuse or adapt Playwright MCP/browser-bridge/open-browser-use patterns where licensing and Windows deployment permit.

### Artifacts

Every output is a durable artifact record. `info/get/attach/publish` operate on the same artifact identity and are recoverable across Extension/Chat restart. Chat attachment is a delivery projection; an Assistant-busy composer must queue/defer rather than destroy the transfer.

### Permissions and credentials

Capabilities are explicit and least-privilege. Broad shell access is not a substitute for a missing semantic action.

Credentials are referenced by opaque credential IDs. AI-facing actions may create/list/delete refs but never read secrets back.

## Component decision matrix

| Component | r10 decision | Notes |
| --- | --- | --- |
| Chrome MV3 shell/popup | KEEP | Useful UX and approved-origin flow already exist |
| Dynamic HTTPS origin approval | KEEP + REFACTOR | Keep optional host permission; make adapter/identity route-tolerant |
| Semantic message intake/provenance | KEEP + HARDEN | Continue explicit assistant-role proof; isolate DOM selectors |
| Extension `seen` command store | REPLACE AS AUTHORITY | Retain only as cache; native broker owns ledger |
| DOM visibility ACK | REPLACE AS EXECUTION TRUTH | Keep only presentation telemetry |
| Native Messaging | KEEP | Good local trust boundary |
| Workspace registry/grants | KEEP + FIX | Preserve policy model; remove empty-tools bug and broad-shell escapes |
| ArtifactRoot/provider | KEEP + UNIFY | One artifact namespace and recovery contract |
| Browser recipe runner | COMPATIBILITY ONLY | Move public contract toward Playwright/MCP-style primitives |
| Credential DPAPI store | KEEP + EXPOSE SAFELY | Add semantic create/list/delete ref actions |
| Tool capability list | REPLACE | Full schemas, not names/hints |
| Jobs/session continuity | KEEP + MOVE UNDER BROKER | Durable cursor/replay model |
| Instagram adapter | KEEP AFTER CORE | Migrate only after broker/tool contracts stabilize |

## r10 gates

No release candidate is qualified until all of these pass from a fresh Chat:

1. approve/connect on builtin ChatGPT origin;
2. connect on a user-approved alternate HTTPS ChatGPT-compatible origin;
3. preserve identity across a nested Project/GPT route containing the same `/c/<id>`;
4. discover full tool schemas without repository access;
5. execute a read-only file action and a mutating file action with explicit capability grants;
6. perform browser desktop + mobile navigation and screenshot;
7. login through a credential ref without secret exposure;
8. attach a generated screenshot back into Chat without Assistant-busy failure;
9. refresh ChatGPT and recover the completed command/result without re-execution;
10. restart Extension and recover by broker sequence/cursor;
11. restore an empty tool permission set safely;
12. prove stale presentation records cannot poison current execution state.

## Immediate r10 implementation order

1. Route-tolerant conversation identity and multi-origin adapter tests.
2. Confirmed reliability defects: empty tools, browser capture geometry, artifact schema handling, Assistant-busy attachment.
3. Native durable command ledger + reconnect cursor.
4. Unified JSON-schema tool registry.
5. Presentation delivery refactor; DOM ACK becomes telemetry.
6. Unified artifact recovery.
7. Credential semantic actions.
8. Browser public API migration to snapshot/ref primitives.
9. Deterministic UAT and packaging.

This document is the architecture contract for r10. Changes that reintroduce URL-specific core state, DOM-visible execution truth, or undocumented AI actions should be rejected.
