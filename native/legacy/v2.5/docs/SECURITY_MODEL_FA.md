# Security Model
- Browser control is manual per tab.
- Agent listens on loopback only and requires a random token.
- Workspaces are explicit and path-sandboxed.
- SoknaCafe is read-only in V2.5.
- Mutations require a fresh remote-sync guard.
- Divergence blocks automatic mutation.
- Direct push to main/master/production is blocked.
- GitHub repo creation is restricted to configured owners.
- Secrets must not be stored in Git.
