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
- Status: **STABLE / DO NOT RECHECK**
- Primary carrier: `SOKNA3CMD:<base64url>:SOKNA3END`
- Short V3 carrier: PASS
- Long fragmented V3 carrier: PASS
- Candidate dedupe: PASS
- Stream diagnostic dedupe: PASS
- Delivery: PASS (`pendingPostCount=0`, state `Ready`)
- Official V3.9.5 self-test: **8/8 PASS**
- Root cause resolved: `content.js` stream/candidate paths were still parsing legacy command markers while `dom_core.js` used the real V3 carrier.
- Live cafe Agent remains 2.5.3; packaged Agent remains 2.5.4.
- Home PC must catch up from GitHub + latest Bootstrap artifact; do not repeat this transport diagnosis.
