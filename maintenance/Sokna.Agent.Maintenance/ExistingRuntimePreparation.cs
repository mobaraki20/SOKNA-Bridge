using Microsoft.Win32;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Sokna.Agent.Maintenance;

internal sealed record ExistingRuntimePreparationResult(
    bool CurrentRuntimeStopped,
    int? CurrentRuntimePid,
    bool LegacyRuntimeDetected,
    bool LegacyRuntimeStopped,
    int? LegacyRuntimePid,
    int? LegacyPort,
    bool LegacyAutostartRemoved,
    string? LegacyConfigPath,
    bool RecoveredUntrackedRuntimeStopped,
    int? RecoveredUntrackedRuntimePid,
    int? RecoveredUntrackedRuntimePort,
    string? RecoveredUntrackedRuntimeSource);

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

        var recoveredStopped = false;
        int? recoveredPid = null;
        int? recoveredPort = null;
        string? recoveredSource = null;
        var endpointCandidates = new List<(string Source, string Path)>();
        var currentConfig = Path.Combine(installRoot, "config.json");
        if (File.Exists(currentConfig)) endpointCandidates.Add(("current-config", currentConfig));
        if (File.Exists(legacyConfig)) endpointCandidates.Add(("legacy-config", legacyConfig));

        foreach (var candidate in endpointCandidates)
        {
            var endpoint = TryReadEndpointConfig(candidate.Path);
            if (endpoint is null) continue;
            if (!await ProbeLegacyIdentityAsync(endpoint.Value.Port, endpoint.Value.Token, ct)) continue;
            var stoppedPid = await StopIdentifiedSoknaEndpointAsync(endpoint.Value.Port, endpoint.Value.Token, ct);
            if (stoppedPid is null) continue;

            recoveredStopped = true;
            recoveredPid = stoppedPid;
            recoveredPort = endpoint.Value.Port;
            recoveredSource = candidate.Source;
            if (candidate.Source == "legacy-config")
            {
                legacyStopped = true;
                legacyPid = stoppedPid;
                TryDelete(legacyPidPath);
            }
            break;
        }

        if (legacyIdentityAlive && !legacyStopped && legacyPort is > 0 && !string.IsNullOrWhiteSpace(token)
            && await ProbeLegacyIdentityAsync(legacyPort.Value, token!, ct))
            throw new InvalidOperationException("LEGACY_RUNTIME_ACTIVE_WITHOUT_SAFE_OWNERSHIP: identified SOKNA endpoint is still active");

        if (recoveredStopped && recoveredPort is > 0)
            await WaitForEndpointAvailableAsync(recoveredPort.Value, ct);
        else if (legacyStopped && legacyPort is > 0)
            await WaitForEndpointAvailableAsync(legacyPort.Value, ct);

        var autostartRemoved = RemoveLegacyAutostart(legacyRoot, legacyAgent);
        return new ExistingRuntimePreparationResult(
            currentStopped, currentPid, legacyDetected, legacyStopped, legacyPid, legacyPort,
            autostartRemoved, File.Exists(legacyConfig) ? legacyConfig : null,
            recoveredStopped, recoveredPid, recoveredPort, recoveredSource);
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

    private static (int Port, string Token)? TryReadEndpointConfig(string path)
    {
        try
        {
            var cfg = JsonNode.Parse(File.ReadAllText(path))?.AsObject();
            var port = cfg?["port"]?.GetValue<int>() ?? 0;
            var token = cfg?["token"]?.GetValue<string>() ?? "";
            if (port is < 1 or > 65535 || string.IsNullOrWhiteSpace(token)) return null;
            return (port, token);
        }
        catch
        {
            return null;
        }
    }

    private sealed record AgentProcessCandidate(int Pid, string CommandLine, string ConfigPath);

    private static async Task<int?> StopIdentifiedSoknaEndpointAsync(int port, string token, CancellationToken ct)
    {
        if (!await ProbeLegacyIdentityAsync(port, token, ct)) return null;
        var candidates = await FindMatchingAgentProcessesAsync(port, token, ct);
        if (candidates.Count == 0)
            throw new InvalidOperationException($"SOKNA_RUNTIME_PROCESS_UNRESOLVED: port={port}; authenticated endpoint has no matching agent.ps1 process");
        if (candidates.Count > 1)
            throw new InvalidOperationException($"SOKNA_RUNTIME_PROCESS_AMBIGUOUS: port={port}; pids={string.Join(",", candidates.Select(x => x.Pid))}");

        var candidate = candidates[0];
        using var process = Process.GetProcessById(candidate.Pid);
        var name = process.ProcessName;
        if (!name.Equals("powershell", StringComparison.OrdinalIgnoreCase) &&
            !name.Equals("pwsh", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"SOKNA_RUNTIME_PROCESS_UNEXPECTED: port={port}; pid={candidate.Pid}; process={name}");
        await KillAndWaitAsync(candidate.Pid, ct);
        return candidate.Pid;
    }

    private static async Task<List<AgentProcessCandidate>> FindMatchingAgentProcessesAsync(int port, string token, CancellationToken ct)
    {
        var psi = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-Command");
        psi.ArgumentList.Add("$items=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { ($_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe') -and $_.CommandLine -match '(?i)agent\\.ps1' } | Select-Object ProcessId,Name,CommandLine); ConvertTo-Json -InputObject $items -Compress");

        using var query = Process.Start(psi) ?? throw new InvalidOperationException("Unable to inspect running PowerShell agent processes");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        var outputTask = query.StandardOutput.ReadToEndAsync();
        var errorTask = query.StandardError.ReadToEndAsync();
        await query.WaitForExitAsync(timeout.Token);
        var output = (await outputTask).Trim();
        var error = (await errorTask).Trim();
        if (query.ExitCode != 0)
            throw new InvalidOperationException($"SOKNA_RUNTIME_PROCESS_LOOKUP_FAILED: {error}");
        if (string.IsNullOrWhiteSpace(output)) return new List<AgentProcessCandidate>();

        JsonNode? parsed;
        try { parsed = JsonNode.Parse(output); }
        catch (Exception ex) { throw new InvalidOperationException("SOKNA_RUNTIME_PROCESS_LOOKUP_JSON_INVALID: " + ex.Message); }

        var rows = parsed is JsonArray arr ? arr : new JsonArray(parsed);
        var matches = new List<AgentProcessCandidate>();
        foreach (var row in rows.OfType<JsonObject>())
        {
            var pid = row["ProcessId"]?.GetValue<int>() ?? 0;
            var commandLine = row["CommandLine"]?.GetValue<string>() ?? "";
            if (pid <= 0 || string.IsNullOrWhiteSpace(commandLine)) continue;
            if (Regex.IsMatch(commandLine, @"(?i)(?:^|\s)-(?:RunScheduler|RunJobId|StartupProbe)(?:\s|$|=)")) continue;

            var scriptPath = ExtractCommandArgument(commandLine, "File");
            if (string.IsNullOrWhiteSpace(scriptPath) ||
                !Path.GetFileName(scriptPath).Equals("agent.ps1", StringComparison.OrdinalIgnoreCase)) continue;
            var configPath = ExtractCommandArgument(commandLine, "ConfigPath");
            if (string.IsNullOrWhiteSpace(configPath))
                configPath = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(scriptPath))!, "config.json");

            var endpoint = TryReadEndpointConfig(configPath);
            if (endpoint is null || endpoint.Value.Port != port ||
                !string.Equals(endpoint.Value.Token, token, StringComparison.Ordinal)) continue;

            matches.Add(new AgentProcessCandidate(pid, commandLine, Path.GetFullPath(configPath)));
        }
        return matches;
    }

    private static string? ExtractCommandArgument(string commandLine, string name)
    {
        var match = Regex.Match(commandLine,
            @"(?i)(?:^|\s)-" + Regex.Escape(name) + @"(?:\s+|=)(?:""(?<dq>[^""]+)""|'(?<sq>[^']+)'|(?<raw>\S+))");
        if (!match.Success) return null;
        foreach (var group in new[] { "dq", "sq", "raw" })
            if (match.Groups[group].Success) return match.Groups[group].Value.Trim();
        return null;
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
