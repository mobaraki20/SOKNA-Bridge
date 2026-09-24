#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
required = [
    'installer/windows/SOKNA.Agent.iss',
    'tools/installer/Build-P1Installer.ps1',
    'tools/installer/Test-P1Windows.ps1',
    'maintenance/Sokna.Agent.Maintenance/Sokna.Agent.Maintenance.csproj',
    'maintenance/Sokna.Agent.Maintenance/Program.cs',
    'maintenance/Sokna.Agent.Maintenance/Lifecycle.cs',
    'maintenance/Sokna.Agent.Maintenance/SupportBundle.cs',
    'maintenance/Sokna.Agent.Launcher/Sokna.Agent.Launcher.csproj',
    'maintenance/Sokna.Agent.Launcher/Program.cs',
    'native/host/main.go',
    'native/host/main_test.go',
]
for rel in required:
    assert (ROOT / rel).is_file(), f'missing {rel}'

iss = (ROOT / 'installer/windows/SOKNA.Agent.iss').read_text(encoding='utf-8')
for marker in [
    'PrivilegesRequired=lowest', 'SetupLogging=yes', 'UninstallLogging=yes',
    'CreateInputDirPage', 'ArtifactRoot', 'desktopicon', 'autostart',
    'NativeMessagingHosts\\com.sokna.bridge.v3', 'uninstall-prep',
    "RunRequired('initialize'", "RunRequired('start'", 'PathIsRooted',
    '{param:ArtifactRoot|',
]:
    assert marker in iss, f'Inno contract missing {marker}'
assert '{localappdata}\\SOKNA\\Bridge\\artifacts' in iss
assert 'foldershortcut' not in iss, 'Inno 6.7.3 removed foldershortcut; folder shortcuts must use Filename directly'
assert 'SoknaCafe' not in iss and 'mobaraki20' not in iss

for project in [
    ROOT / 'maintenance/Sokna.Agent.Maintenance/Sokna.Agent.Maintenance.csproj',
    ROOT / 'maintenance/Sokna.Agent.Launcher/Sokna.Agent.Launcher.csproj',
]:
    text = project.read_text(encoding='utf-8')
    for marker in ['<TargetFramework>net8.0</TargetFramework>', '<SelfContained>true</SelfContained>', '<PublishSingleFile>true</PublishSingleFile>']:
        assert marker in text, f'{project.name} missing {marker}'

program = (ROOT / 'maintenance/Sokna.Agent.Maintenance/Program.cs').read_text(encoding='utf-8')
for action in ['initialize', 'preflight', 'status', 'health', 'start', 'stop', 'uninstall-prep', 'diagnostics', 'support-bundle', 'repair', 'upgrade', 'rollback']:
    assert f'"{action}"' in program, f'maintenance action missing {action}'

lifecycle = (ROOT / 'maintenance/Sokna.Agent.Maintenance/Lifecycle.cs').read_text(encoding='utf-8')
for marker in ['LoadAndVerifyManifest', 'AtomicCopyVerified', 'automatic rollback', 'RollbackTxAsync', 'AgentProcessOwnership.TryGetOwnedPid', 'f.Owner == "maintenance"', 'removedFiles', 'previous-ownership.json', 'StartAndWaitForHealth', 'CURRENT_RUNTIME_NOT_LKG_REPAIR_FIRST']:
    assert marker in lifecycle, f'lifecycle marker missing {marker}'
models = (ROOT / 'maintenance/Sokna.Agent.Maintenance/Models.cs').read_text(encoding='utf-8')
assert 'owner' in models.lower(), 'file ownership must be explicit'

bundle = (ROOT / 'maintenance/Sokna.Agent.Maintenance/SupportBundle.cs').read_text(encoding='utf-8')
for name in ['summary.json', 'events.jsonl', 'versions.json', 'health.json', 'config.redacted.json']:
    assert name in bundle, f'support bundle missing {name}'
core = (ROOT / 'maintenance/Sokna.Agent.Maintenance/Core.cs').read_text(encoding='utf-8')
for key in ['token', 'password', 'private_key', 'cookie', '[REDACTED]', 'Root reparse point rejected']:
    assert key in core, f'redaction marker missing {key}'

launcher = (ROOT / 'maintenance/Sokna.Agent.Launcher/Program.cs').read_text(encoding='utf-8')
for marker in ['ArgumentList.Add', 'agent_sha256', 'agent_process_start_utc', 'launcher-state.json', 'powershell.exe', 'OwnedAgentAlive']:
    assert marker in launcher, f'launcher marker missing {marker}'
assert 'SoknaCafe' not in launcher

host = (ROOT / 'native/host/main.go').read_text(encoding='utf-8')
for marker in ['SOKNA_AGENT_CONFIG_PATH', 'install-locator.json', 'SOKNA-Bridge-V2']:
    assert marker in host, f'native host migration marker missing {marker}'

build = (ROOT / 'tools/installer/Build-P1Installer.ps1').read_text(encoding='utf-8')
for marker in ['dotnet publish', 'go build', 'installed-manifest.json', "product_version='2.6.0'", "owner=$owner", 'ISCC.exe', 'DIRTY_SOURCE_NOT_REPRODUCIBLE']:
    assert marker in build, f'build marker missing {marker}'
assert not re.search(r'(?im)(^|[;\s])(gci|gc|cp|mv|rm|kill|sleep|gfh)(?=\s|;|$)', build), 'forbidden PowerShell alias in release build script'

workflow=(ROOT/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
assert '$buildOutput=@(' in workflow and 'Select-Object -Last 1' in workflow
assert 'timeout-minutes: 30' in workflow

windows_acceptance = (ROOT / 'tools/installer/Test-P1Windows.ps1').read_text(encoding='utf-8')
for marker in ['SUPPORT_BUNDLE_SECRET_LEAK', 'REPAIR_DID_NOT_RESTORE_RUNTIME', 'UPGRADE_REMOVED_FILE_STALE', 'ROLLBACK_DID_NOT_RESTORE_REMOVED_FILE', 'UNINSTALL_REMOVED_ARTIFACT_ROOT', 'BrokenRuntime']:
    assert marker in windows_acceptance, f'Windows lifecycle acceptance missing {marker}'
assert not re.search(r'(?im)(^|[;\s])(gci|gc|cp|mv|rm|kill|sleep|gfh)(?=\s|;|$)', windows_acceptance), 'forbidden PowerShell alias in Windows acceptance script'

# P1 Core must remain project-agnostic. Repo module identity is allowed only in go.mod.
for root in [ROOT / 'maintenance', ROOT / 'installer/windows', ROOT / 'tools/installer']:
    for p in root.rglob('*'):
        if p.is_file() and p.suffix.lower() in {'.cs', '.csproj', '.ps1', '.iss'}:
            text = p.read_text(encoding='utf-8', errors='replace')
            assert 'SoknaCafe' not in text, f'project-specific dependency in {p.relative_to(ROOT)}'
            assert 'mobaraki20' not in text, f'owner-specific dependency in {p.relative_to(ROOT)}'

print('P1_INSTALLER_MAINTENANCE_CONTRACTS_PASS')
