SOKNA Bridge V2.5

Multi-Workspace foundation:
- C:\SOKNA\SoknaCafe      -> read-only by default
- C:\SOKNA\SOKNA-Bridge   -> write-enabled and default workspace
- Manual Enable on this tab remains mandatory.
- GitHub remote sync guard remains mandatory before mutations.
- Direct push to main/master/production remains blocked.
- New workspace-aware commands accept params.workspace.
- github.repo.create is restricted to allowed GitHub owners.

Important:
SoknaCafe is intentionally protected from file/git mutations in this version.
Its working tree and branch are not changed by Setup V2.5.
