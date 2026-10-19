"""Guard the noninteractive Runtime startup hash against PowerShell module autoload regressions."""
from pathlib import Path
src=(Path(__file__).resolve().parents[2]/"native/runtime/v2.7.1/agent.ps1").read_text(encoding="utf-8")
start=src.index("function Sha256File(")
end=src.index("\nfunction ", start+10)
fn=src[start:end]
assert "Get-FileHash" not in fn.split("#",1)[0], "Sha256File should not require Get-FileHash cmdlet"
assert "Security.Cryptography.SHA256" in fn and ".ComputeHash($stream)" in fn
assert "$stream.Dispose()" in fn and "$sha.Dispose()" in fn
assert "return ([BitConverter]::ToString($hash)).Replace" in fn
assert "StartAutomationSchedulerWorker" in src and "Sha256File $PSCommandPath" in src
print("BRIDGE_RUNTIME_RESTART_SHA256_DOTNET_CONTRACT_PASS; WINDOWS_REPAIR_UAT_REQUIRED")
