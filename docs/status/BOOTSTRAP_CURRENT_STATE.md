# SOKNA Bridge Bootstrap - Current State

Canonical source of truth for bootstrap work.

## Remote baseline
- Branch: `dev/bootstrap-v2.5`
- Current HEAD: resolve with `git rev-parse HEAD` (not hardcoded)
- Bootstrap workflow run `35609296174`: SUCCESS
- Artifact: `SOKNA-Bridge-Setup`

## Confirmed working
- Extension `3.9.4`
- Agent `2.5.3`
- Native Host bridge
- E2E on cafe PC: Extension -> Native Host -> Agent -> Workspace PASS
- `SOKNA-Bridge`: write enabled
- `SoknaCafe`: read-only

## Cafe-PC findings
1. `config.json` written by Windows PowerShell `Set-Content -Encoding UTF8` had BOM; Go Native Host rejected it.
   - Local fix applied in `installer/bootstrap/install.ps1`
   - Status: PUSHED @ c01399da1ba465628aa75930c4e5ca339704c5ab
2. Installer currently registers both workspaces even if folders do not exist; Agent validates all configured workspaces at startup and exits.
   - Status: FIXED AND PUSHED (see git history)
3. On cafe PC, long assistant carrier messages are less reliable than on home PC.
   - Short carrier commands work.
   - Status: PENDING EXTENSION RELIABILITY INVESTIGATION

## Rule
Before any bootstrap/extension fix, read this file and current git diff/status first. Do not redo fixes already marked completed or local-only; continue from the recorded state.
