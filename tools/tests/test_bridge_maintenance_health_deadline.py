"""Prevent unbounded Maintenance health loops from blocking silent setup or rollback."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/"maintenance/Sokna.Agent.Maintenance/Lifecycle.cs").read_text(encoding="utf-8")
health=(root/"maintenance/Sokna.Agent.Maintenance/HealthDiagnostics.cs").read_text(encoding="utf-8")
method=source.split("private async Task<HealthResult> StartAndWaitForHealth",1)[1].split("\n    private async Task EnsureLauncherStarted",1)[0]
assert "CancellationTokenSource(TimeSpan.FromSeconds(90))" in method
assert "CancellationTokenSource.CreateLinkedTokenSource(ct, deadline.Token)" in method
assert "await EnsureLauncherStarted(linked.Token)" in method
assert "HealthDiagnostics.HealthAsync(_installRoot, expectedVersion, linked.Token)" in method
assert "AGENT_START_HEALTH_TIMEOUT" in method
assert "catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }" in health
print("BRIDGE_MAINTENANCE_HEALTH_DEADLINE_CONTRACT_PASS; WINDOWS_ROLLBACK_UAT_REQUIRED")
