using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Sokna.Agent.Maintenance;

internal static class HealthDiagnostics
{
    internal static async Task<HealthResult> HealthAsync(string installRoot, string? expectedVersion, CancellationToken ct)
    {
        try
        {
            var cfg = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(installRoot, "config.json"), ct))?.AsObject()
                ?? throw new InvalidDataException("config.json invalid");
            var port = cfg["port"]?.GetValue<int>() ?? throw new InvalidDataException("config port missing");
            var token = cfg["token"]?.GetValue<string>() ?? throw new InvalidDataException("config token missing");
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            http.DefaultRequestHeaders.Add("X-Sokna-Token", token);
            var ping = await Post(http, port, "ping", ct);
            var caps = await Post(http, port, "agent.capabilities", ct);
            var artifactRoot = await Post(http, port, "artifact.root.status", ct);
            var workspace = await Post(http, port, "workspace.registry.status", ct);
            var browser = await Post(http, port, "browser.qa.status", ct);
            var provider = await Post(http, port, "artifact.provider.status", ct);
            var components = await Post(http, port, "component.registry.status", ct);
            var pingOk = ping?["ok"]?.GetValue<bool>() == true;
            var capsOk = caps?["ok"]?.GetValue<bool>() == true;
            var subsystemChecks = new Dictionary<string, bool>(StringComparer.Ordinal)
            {
                ["artifact_root"] = artifactRoot?["ok"]?.GetValue<bool>() == true && artifactRoot?["schema"]?.GetValue<string>() == "sokna-artifact-root-status-v1",
                ["workspace_registry"] = workspace?["ok"]?.GetValue<bool>() == true && workspace?["schema"]?.GetValue<string>() == "sokna-workspace-registry-v1",
                ["browser_runner"] = browser?["ok"]?.GetValue<bool>() == true && browser?["runner_available"]?.GetValue<bool>() == true,
                ["artifact_provider_runner"] = provider?["ok"]?.GetValue<bool>() == true && provider?["runner_available"]?.GetValue<bool>() == true,
                ["component_automation_registry"] = components?["ok"]?.GetValue<bool>() == true && components?["schema"]?.GetValue<string>() == "sokna-component-manager-status-v1"
            };
            var wholeProductOk = subsystemChecks.Values.All(v => v);
            var version = caps?["version"]?.GetValue<string>() ?? ping?["version"]?.GetValue<string>() ?? "";
            var pidOwned = AgentProcessOwnership.TryGetOwnedPid(installRoot, out _, out var ownershipError);
            var versionOk = string.IsNullOrWhiteSpace(expectedVersion) || string.Equals(version, expectedVersion, StringComparison.Ordinal);
            var failedSubsystems = string.Join(",", subsystemChecks.Where(kv => !kv.Value).Select(kv => kv.Key));
            var error = !versionOk ? $"Expected {expectedVersion}, got {version}"
                : !wholeProductOk ? $"Whole-product subsystem health failed: {failedSubsystems}"
                : ownershipError;
            return new HealthResult(pingOk && capsOk && pidOwned && versionOk && wholeProductOk, version, pingOk, capsOk, pidOwned, error, subsystemChecks);
        }
        catch (Exception ex) { return new HealthResult(false, "", false, false, false, ex.Message, new Dictionary<string, bool>()); }
    }

    private static async Task<JsonObject?> Post(HttpClient http, int port, string action, CancellationToken ct)
    {
        var body = new { id = "maintenance-" + Guid.NewGuid().ToString("N"), action, @params = new { } };
        using var response = await http.PostAsJsonAsync($"http://127.0.0.1:{port}/api", body, ct);
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))?.AsObject();
    }

    internal static async Task<JsonObject> DiagnosticsAsync(string installRoot, CancellationToken ct)
    {
        var ownershipPath = Path.Combine(installRoot, "state", "runtime-ownership.json");
        RuntimeOwnershipState? ownership = File.Exists(ownershipPath) ? JsonFiles.Read<RuntimeOwnershipState>(ownershipPath) : null;
        var health = await HealthAsync(installRoot, ownership?.ActiveVersion, ct);
        return new JsonObject
        {
            ["generated_at"] = DateTimeOffset.UtcNow.ToString("O"),
            ["os"] = Environment.OSVersion.ToString(),
            ["machine"] = Environment.MachineName,
            ["process_arch"] = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
            ["install_root"] = installRoot,
            ["config_exists"] = File.Exists(Path.Combine(installRoot, "config.json")),
            ["manifest_exists"] = File.Exists(Path.Combine(installRoot, "manifests", "installed-manifest.json")),
            ["ownership_exists"] = ownership is not null,
            ["artifact_root"] = ownership?.ArtifactRoot,
            ["active_version"] = ownership?.ActiveVersion,
            ["health"] = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(health, JsonFiles.Options))
        };
    }
}

internal static class AgentProcessOwnership
{
    internal static bool TryGetOwnedPid(string installRoot, out int pid, out string? error, bool requireCurrentHash = true)
    {
        pid = 0; error = null;
        try
        {
            var pidPath = Path.Combine(installRoot, "runtime", "agent.pid");
            var launcherStatePath = Path.Combine(installRoot, "state", "launcher-state.json");
            if (!File.Exists(pidPath) || !int.TryParse(File.ReadAllText(pidPath).Trim(), out var filePid)) { error = "agent.pid missing/invalid"; return false; }
            if (!File.Exists(launcherStatePath)) { error = "launcher-state missing"; return false; }
            var state = JsonNode.Parse(File.ReadAllText(launcherStatePath))?.AsObject() ?? throw new InvalidDataException("launcher-state invalid");
            var statePid = state["agent_pid"]?.GetValue<int>() ?? 0;
            var agentPath = state["agent_path"]?.GetValue<string>() ?? "";
            var expectedPath = Path.GetFullPath(Path.Combine(installRoot, "runtime", "agent.ps1"));
            if (statePid != filePid || !string.Equals(Path.GetFullPath(agentPath), expectedPath, StringComparison.OrdinalIgnoreCase)) { error = "PID/path ownership mismatch"; return false; }
            var expectedHash = state["agent_sha256"]?.GetValue<string>() ?? "";
            if (string.IsNullOrWhiteSpace(expectedHash)) { error = "agent launch hash missing"; return false; }
            if (requireCurrentHash && (!File.Exists(expectedPath) || !string.Equals(Hashing.Sha256(expectedPath), expectedHash, StringComparison.OrdinalIgnoreCase))) { error = "agent hash ownership mismatch"; return false; }
            var recordedStart = state["agent_process_start_utc"]?.GetValue<string>() ?? "";
            using var process = Process.GetProcessById(filePid);
            if (process.HasExited) { error = "agent process exited"; return false; }
            var actualStart = new DateTimeOffset(process.StartTime.ToUniversalTime());
            if (string.IsNullOrWhiteSpace(recordedStart) || !DateTimeOffset.TryParse(recordedStart, out var expectedStart) ||
                Math.Abs((expectedStart.ToUniversalTime() - actualStart).TotalSeconds) > 1)
            { error = "agent process start-time ownership mismatch"; return false; }
            pid = filePid; return true;
        }
        catch (Exception ex) { error = ex.Message; return false; }
    }
}
