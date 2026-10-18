"""Fail-closed, application-neutral bootstrap and workspace contract.

Static source checks are not a replacement for Windows installer/UAT. The
browser capture-map migration is tracked separately until W11 imports complete.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
install = (root / "installer/bootstrap/install.ps1").read_text(encoding="utf-8")
build = (root / "installer/bootstrap/build-package.ps1").read_text(encoding="utf-8")
workspace = (root / "tools/github-workspace.ps1").read_text(encoding="utf-8")

for forbidden in ("$cafePath", "mobaraki20/SoknaCafe", "default_github_owner='mobaraki20'", "Stop-Process -Id $oldPid -Force"):
    assert forbidden not in install, "app-specific or destructive bootstrap default: " + forbidden
for expected in (
    "default_github_owner=''",
    "allowed_github_owners=@()",
    "protected_repositories=@()",
    "workspaces=[ordered]@{}",
    "BRIDGE_CONFIG_INVALID_REFUSING_OVERWRITE",
    "config.json.pre-bootstrap-",
    "BRIDGE_BOOTSTRAP_AGENT_PID_PRESENT_USE_MAINTENANCE",
    "Get-ExtensionIdFromKey",
    "config.json.new-",
):
    assert expected in install, "missing Bootstrap gate: " + expected

assert 'go build -trimpath -o $hostOut .' in build
assert "BRIDGE_BOOTSTRAP_AGENT_VERSION_MISMATCH" in build
assert 'mobaraki20/soknacafe' not in workspace.lower()
assert 'PROTECTED_REPOSITORY' in workspace
assert 'GITHUB_OWNER_NOT_CONFIGURED' in workspace

print("BRIDGE_BOOTSTRAP_APP_NEUTRAL_GATES_PASS; WINDOWS_INSTALLED_UAT_NOT_RUN")
