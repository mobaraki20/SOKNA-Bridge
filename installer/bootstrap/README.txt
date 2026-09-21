SOKNA Bridge Bootstrap Setup

For a new Windows PC:

1. Extract SOKNA-Bridge-Setup.zip to a normal folder.
2. Double-click INSTALL.cmd.
3. Wait for: SOKNA Bridge bootstrap installed successfully.
4. In Chrome open chrome://extensions
5. Enable Developer mode.
6. Click Load unpacked.
7. Select:
   %LOCALAPPDATA%\SOKNA-Bridge-V3\extension
8. Open ChatGPT and enable SOKNA Bridge on that tab.
9. Run HEALTH.cmd if you want to verify the Agent.

Installed components:
- Agent 2.5.3: %LOCALAPPDATA%\SOKNA-Bridge-V2
- Extension 3.9.4 + Native Host: %LOCALAPPDATA%\SOKNA-Bridge-V3
- Native Messaging host: com.sokna.bridge.v3
- Startup: HKCU Run / SOKNA Bridge Agent

Safety:
- SOKNA-Bridge workspace: write enabled
- SoknaCafe workspace: read-only
- UNINSTALL.cmd removes registry/startup entries only and does not modify workspaces.
