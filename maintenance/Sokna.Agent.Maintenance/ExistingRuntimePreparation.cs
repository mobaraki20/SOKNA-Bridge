using Microsoft.Win32;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Sokna.Agent.Maintenance;

internal sealed record ExistingRuntimePreparationResult(
    bool CurrentRuntimeStopped,
    int? CurrentRuntimePid,
    bool LegacyRuntimeDetected,
    bool LegacyRuntimeStopped,
    int? LegacyRuntimePid,
    int? LegacyPort,
    bool LegacyAutostartRemoved,
    string? LegacyConfigPath);

internal static class ExistingRuntimePreparation
{
    private const string LegacyRunValue = "SOKNA Bridge Agent";

    internal static async Task<ExistingRuntimePreparationResult> PrepareAsync(string installRoot, CancellationToken ct)
    {
        var currentStopped = false;
        int? currentPid = null;
        if (AgentProcessOwnership.TryGetOwnedPid(installRoot, out var ownedPid, out _, requireCurrentHash: false))
        {
            currentPid = ownedPid;
            await KillAndWaitAsync(ownedPid, ct);
            TryDelete(Path.Combine(installRoot, "runtime", "agent.pid"));
            currentStopped = true;
        }

        var legacyRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SOKNA-Bridge-V2");
        var legacyConfig = Path.Combine(legacyRoot, "config.json");
        var legacyAgent = Path.Combine(legacyRoot, "agent.ps1");
        var legacyPidPath = Path.Combine(legacyRoot, "agent.pid");
        var legacyDetected = Directory.Exists(legacyRoot) && (File.Exists(legacyConfig) || File.Exists(legacyAgent) || File.Exists(legacyPidPath));
        var legacyStopped = false;
        int? legacyPid = null;
        int? legacyPort = null;

        string? token = null;
        if (File.Exists(legacyConfig))
        {
            try
            {
                var cfg = JsonNode.Parse(await File.ReadAllTextAsync(legacyConfig, ct))?.AsObject();
                legacyPort = cfg?["port"]?.GetValue<int>();
                token = cfg?["token"]?.GetValue<string>();
            }
            catch
            {
                // Config migration will report malformed JSON separately. Do not kill anything
                // unless legacy process ownership can be proven.
            }
        }

        var legacyIdentityAlive = legacyPort is > 0 && !string.IsNullOrWhiteSpace(token)
            && await ProbeLegacyIdentityAsync(legacyPort.Value, token!, ct);

        if (File.Exists(legacyPidPath) && int.TryParse((await File.ReadAllTextAsync(legacyPidPath, ct)).Trim(), out var pid))
        {
            legacyPid = pid;
            if (legacyIdentityAlive)
            {
                if (!LegacyPidOwnershipIsPlausible(pid, legacyPidPath, out var ownershipError))
                    throw new InvalidOperationException("LEGACY_RUNTIME_OWNERSHIP_UNPROVEN: " + ownershipError);
                await KillAndWaitAsync(pid, ct);
                TryDelete(legacyPidPath);
                legacyStopped = true;
            }
        }
        else if (legacyIdentityAlive)
        {
            throw new InvalidOperationException("LEGACY_RUNTIME_ACTIVE_WITHOUT_PID: refusing to stop an uncorrelated process");
        }

        if (legacyStopped && legacyPort is > 0)
            await WaitForEndpointAvailableAsync(legacyPort.Value, ct);

        var autostartRemoved = RemoveLegacyAutostart(legacyRoot, legacyAgent);
        return new ExistingRuntimePreparationResult(
            currentStopped, currentPid, legacyDetected, legacyStopped, legacyPid, legacyPort,
            autostartRemoved, File.Exists(legacyConfig) ? legacyConfig : null);
    }

    internal static async Task WaitForEndpointAvailableAsync(int port, CancellationToken ct)
    {
        Exception? last = null;
        for (var i = 0; i < 20; i++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var listener = new System.Net.HttpListener();
                listener.Prefixes.Add($"http://127.0.0.1:{port}/");
                listener.Start();
                listener.Stop();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                await Task.Delay(250, ct);
            }
        }
        throw new InvalidOperationException($"AGENT_ENDPOINT_UNAVAILABLE_AFTER_PREP: port={port}; {last?.Message}");
    }

    private static bool LegacyPidOwnershipIsPlausible(int pid, string pidPath, out string error)
    {
        error = "";
        try
        {
            using var process = Process.GetProcessById(pid);
            if (process.HasExited) { error = "process already exited"; return false; }
            var name = process.ProcessName;
            if (!name.Equals("powershell", StringComparison.OrdinalIgnoreCase) &&
                !name.Equals("pwsh", StringComparison.OrdinalIgnoreCase))
            {
                error = "PID is not a PowerShell runtime";
                return false;
            }
            var pidFileWritten = File.GetLastWriteTimeUtc(pidPath);
            var processStarted = process.StartTime.ToUniversalTime();
            if (Math.Abs((pidFileWritten - processStarted).TotalSeconds) > 120)
            {
                error = "PID file/process start-time correlation failed";
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private static async Task<bool> ProbeLegacyIdentityAsync(int port, string token, CancellationToken ct)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            http.DefaultRequestHeaders.Add("X-Sokna-Token", token);
            var body = new { id = "migration-probe-" + Guid.NewGuid().ToString("N"), action = "ping", @params = new { } };
            using var response = await http.PostAsJsonAsync($"http://127.0.0.1:{port}/api", body, ct);
            if (!response.IsSuccessStatusCode) return false;
            var json = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))?.AsObject();
            if (json?["ok"]?.GetValue<bool>() != true) return false;
            var agent = json["agent"]?.GetValue<string>() ?? "";
            var version = json["version"]?.GetValue<string>() ?? "";
            return agent.StartsWith("sokna-bridge-", StringComparison.OrdinalIgnoreCase)
                && version.StartsWith("2.", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private static async Task KillAndWaitAsync(int pid, CancellationToken ct)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            if (process.HasExited) return;
            process.Kill(true);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (ArgumentException)
        {
            // Process exited between ownership proof and stop.
        }
    }

    private static bool RemoveLegacyAutostart(string legacyRoot, string legacyAgent)
    {
        var removed = false;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
            var value = key?.GetValue(LegacyRunValue)?.ToString();
            if (!string.IsNullOrWhiteSpace(value) &&
                (value.Contains(legacyRoot, StringComparison.OrdinalIgnoreCase) ||
                 value.Contains(legacyAgent, StringComparison.OrdinalIgnoreCase)))
            {
                key!.DeleteValue(LegacyRunValue, throwOnMissingValue: false);
                removed = true;
            }
        }
        catch { }

        try
        {
            var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            var vbs = Path.Combine(startup, "SOKNA-Bridge-Agent.vbs");
            if (File.Exists(vbs))
            {
                var text = File.ReadAllText(vbs);
                if (text.Contains(legacyRoot, StringComparison.OrdinalIgnoreCase) ||
                    text.Contains("SOKNA-Bridge-V2", StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(vbs);
                    removed = true;
                }
            }
        }
        catch { }
        return removed;
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
