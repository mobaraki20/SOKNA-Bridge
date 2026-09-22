# SOKNA Bridge Clean-System Installer

Status: ACTIVE
Branch: dev/bootstrap-v2.5

## Goal
Deliver one installer for a fresh Windows PD with no prior SOKNA Bridge, Git or GitHub setup.
Before returning to SoknaCafe, the installer must detect missing prerequisites, download install required tools, configure Bridge/Agent/Native Host/Extension, guide GitHub authentication, and prepare workspaces.

## Non-negotiable
- One installer entry point.
- Prerequisite detection before installation.
- Automatic download/install for missing Git and GitHub CLI and other runtime requirements.
- Download progress must show percent, bytes, elapsed, speed and ETA when known.
- Agent, Native Host, Extension and startup must be configured and health-checked.
- GitHub auth must use official gh login flow and verify `gh auth status`.
- Workspaces must be created/cloned safely. SoknaCafe remains read-only until explicit approval.
- Installation must be resumable/idempotent and produce an install report.
- All phase status, test evidence and continuation notes must be committed/pushed so a new chat can resume from GitHub.

## Phases
- F1: Persistent contract and handoff.
- F2: Prerequisite engine with progress + ETA.
- F3: Bridge/Agent/Host/Extension install + GitHub auth.
- F4: Workspace creation/clone/verification.
- F5: Final package build + clean-system acceptance.

## Safety
- Do not mutate SoknaCafe during installer work.
- Do not commit unknown `extension/chrome/Test/` content.
- Do not claim a phase passed until its observed test output is recorded.
