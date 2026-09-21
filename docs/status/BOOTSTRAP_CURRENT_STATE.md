# SOKNA Bridge Bootstrap - Current State

Canonical source of truth for bootstrap work.

## Remote baseline
- Branch: `dev/bootstrap-v2.5`
- Current HEAD: resolve with `git rev-parse HEAD` (not hardcoded)
- Bootstrap workflow run `35631265931`: SUCCESS @ `1c98720be252973e663cdcda375cacc7bd854074`
- Artifact: `SOKNA-Bridge-Setup` (ID `10653504099`, SHA256 `e5055abde35044ee22ecf343857f78d0f413ad53ccf8a9cee7e6dfa97a00c86b`)

## Confirmed working
- Extension `3.9.4`
- Live cafe Agent: `2.5.3`
- New bootstrap runtime: `2.5.4` (empty-workspace E2E PASS)
- Native Host bridge
- E2E on cafe PC: Extension -> Native Host -> Agent -> Workspace PASS
- `SOKNA-Bridge`: write enabled
- `SoknaCafe`: read-only

## Cafe-PC findings
1. `config.json` written by Windows PowerShell `Set-Content -Encoding UTF8` had BOM; Go Native Host rejected it.
   - Local fix applied in `installer/bootstrap/install.ps1`
   - Status: PUSHED @ c01399da1ba465628aa75930c4e5ca339704c5ab
2. Bootstrap now registers only workspace folders that exist; Agent `2.5.4` allows an empty workspace map on new PCs.
   - Temp-port E2E on cafe PC: PASS (`ping`, version `2.5.4`, `workspaces={}`)
   - Status: FIXED, TESTED, PUSHED; package workflow `35631265931` VERIFIED AND UPLOADED
3. On cafe PC, long assistant carrier messages are less reliable than on home PC.
   - Short carrier commands work.
   - Status: PENDING EXTENSION RELIABILITY INVESTIGATION

## Home PC catch-up
- Home PC was off during these changes; GitHub `dev/bootstrap-v2.5` is canonical.
- First: `git fetch --prune origin` and inspect `local` vs `origin/dev/bootstrap-v2.5`.
- If clean and only behind: fast-forward only; do not hard reset local work.
- If dirty, ahead, or diverged: reconcile before sync.
- Repo sync alone does NOT update the installed LocalAppData runtime. After sync, update Bridge from artifact `10653504099` to Agent `2.5.4`, then verify E2E.
- After home sync/install, continue from this file; do not repeat completed bootstrap work.

## Rule
Before any bootstrap/extension fix, read this file and current git diff/status first. Do not redo fixes already marked completed or local-only; continue from the recorded state.

## SOKNA Bridge V3.9.5 stable transport â€” 2026-09-21
- Status: **DOM REASSEMBLY STABLE / VERY-LONG ASSISTANT CARRIER DELIVERY OPEN**
- Primary carrier: `SOKNA3CMD:<base64url>:SOKNA3END`
- Short V3 carrier: PASS
- Long fragmented V3 carrier after complete DOM render: PASS
- Candidate dedupe: PASS
- Stream diagnostic dedupe: PASS
- Delivery: PASS (`pendingPostCount=0`, state `Ready`)
- Official V3.9.5 self-test: **8/8 PASS**
- Root cause resolved: `content.js` stream/candidate paths were still parsing legacy command markers while `dom_core.js` used the real V3 carrier.
- Remaining OPEN issue: very large assistant carriers may fail before a complete envelope reaches the DOM; use short commands/indirection until this upstream delivery path is resolved.
- Live cafe Agent remains 2.5.3; packaged Agent remains 2.5.4.
- Home PC must catch up from GitHub + latest Bootstrap artifact; do not repeat the resolved DOM reassembly diagnosis; keep very-long assistant-carrier delivery OPEN.

### V3.9.5 Bootstrap artifact
- Bootstrap workflow: `35641811226` â€” SUCCESS
- Workflow head SHA: `c4d5236e38c3618a919f188efbfd12b63395e0c1`
- Artifact: `SOKNA-Bridge-Setup`
- Artifact ID: `10657943197`
- Artifact SHA256: `81fed5fc456b3110d6888acc1583fdea327b3cc48079c039259ed2a42b26426e`
- Artifact created: `2026-09-21T18:59:29Z`
- Artifact expires: `2026-12-20T18:58:06Z`
- Home PC catch-up: sync/reconcile `dev/bootstrap-v2.5`, then install artifact `10657943197`; do not repeat resolved DOM reassembly diagnosis.
- OPEN: very-large assistant carrier delivery before complete DOM render is not guaranteed. Use short commands/indirection for large jobs until that upstream path is is resolved.

### V3.9.5 artifact final
- Bootstrap workflow: 35641811226 SUCCESS
- Head SHA: c4d5236e38c3618a919f188efbfd12b63395e0c1
- Artifact: SOKNA-Bridge-Setup
- Artifact ID: 10657943197
- SHA256: 81fed5fc456b3110d6888acc1583fdea327b3cc48079c039259ed2a42b26426e
- Expires: 2026-12-20T18:58:06Z
- Home PC: sync dev/bootstrap-v2.5, then install artifact 10657943197.
- OPEN: very-large assistant carriers can fail before full DOM render; use short commands/indirection.
