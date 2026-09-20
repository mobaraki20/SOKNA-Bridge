# SOKNA Bridge Roadmap

## Current: 2.5 Multi-Workspace Foundation
- Manual active-tab control
- Multi-repo workspace registry
- SoknaCafe read-only protection
- SOKNA-Bridge default writable workspace
- GitHub remote sync guards
- GitHub repo-create capability restricted to allowed owners

## Next
1. Native Windows Agent Host/service instead of hidden PowerShell host
2. Tray application:
   - Running/stopped/healthy indicator
   - Start / Stop / Restart
   - Startup on/off
   - Active browser controller
   - Workspace status
   - GitHub auth status
   - Logs / diagnostics / version / update
3. Browser E2E subsystem with Playwright
   - Login/navigation/forms
   - Console/network errors
   - responsive screenshots
   - visual regression
   - video/HAR artifacts
4. Artifact transport back to chat
5. Test-host deployment adapters with backup/health/rollback
6. Windows installer/service/registry/certificate actions
7. VM clean-install/repair/upgrade/uninstall test harness
8. Secure credential references via Windows Credential Manager/DPAPI
9. Signed installer + self-update channel
