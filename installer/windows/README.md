# SOKNA Agent Windows Installer (P1)

This is the project-agnostic Windows installer source. Inno Setup owns Setup/Installed Apps/registry/shortcuts/uninstall. The self-contained .NET Maintenance executable owns initialization, health, diagnostics, support bundle, repair, upgrade orchestration and rollback. The stable .NET launcher owns starting the PowerShell Agent runtime.

Build with `tools/installer/Build-P1Installer.ps1`. Core installation has no Git/GitHub/PHP/MySQL/project prerequisite. `ArtifactRoot` is selected during Setup and defaults to `%LOCALAPPDATA%\SOKNA\Bridge\artifacts`.

The extension is installed as files only; browser loading/policy remains a separate browser integration concern. No project workspace is created or moved by Setup.
