using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

if (args.Length == 0 || args[0] is "--help" or "-h")
{
    Console.WriteLine("Usage: Sokna.Agent.Launcher start|run --install-root <path>"); return 0;
}
var action = args[0].ToLowerInvariant();
string? installRoot = null;
for (var i = 1; i < args.Length - 1; i++) if (args[i] == "--install-root") installRoot = args[++i];
installRoot = Path.GetFullPath(installRoot ?? AppContext.BaseDirectory);
var runtime = Path.Combine(installRoot, "runtime");
var pidPath = Path.Combine(runtime, "agent.pid");
var stateDir = Path.Combine(installRoot, "state");
var launcherStatePath = Path.Combine(stateDir, "launcher-state.json");

static string Sha256(string path)
{
    using var stream = File.OpenRead(path);
    return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
}

static bool OwnedAgentAlive(string installRoot, string pidPath, string launcherStatePath)
{
    try
    {
        if (!File.Exists(pidPath) || !int.TryParse(File.ReadAllText(pidPath).Trim(), out var pid)) return false;
        if (!File.Exists(launcherStatePath)) return false;
        var state = JsonNode.Parse(File.ReadAllText(launcherStatePath))?.AsObject();
        if (state is null || state["agent_pid"]?.GetValue<int>() != pid) return false;
        var expectedPath = Path.GetFullPath(Path.Combine(installRoot, "runtime", "agent.ps1"));
        var recordedPath = state["agent_path"]?.GetValue<string>() ?? "";
        if (string.IsNullOrWhiteSpace(recordedPath) || !string.Equals(Path.GetFullPath(recordedPath), expectedPath, StringComparison.OrdinalIgnoreCase)) return false;
        var recordedHash = state["agent_sha256"]?.GetValue<string>() ?? "";
        if (string.IsNullOrWhiteSpace(recordedHash)) return false;
        var recordedStart = state["agent_process_start_utc"]?.GetValue<string>() ?? "";
        if (!DateTimeOffset.TryParse(recordedStart, out var expectedStart)) return false;
        using var p = Process.GetProcessById(pid);
        var actualStart = new DateTimeOffset(p.StartTime.ToUniversalTime());
        if (p.HasExited || Math.Abs((expectedStart.ToUniversalTime() - actualStart).TotalSeconds) > 1) return false;
        return true;
    }
    catch { return false; }
}

if (action == "start")
{
    if (OwnedAgentAlive(installRoot, pidPath, launcherStatePath)) return 0;
    var self = Environment.ProcessPath ?? throw new InvalidOperationException("Launcher executable path unavailable");
    var psi = new ProcessStartInfo(self) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = installRoot };
    psi.ArgumentList.Add("run"); psi.ArgumentList.Add("--install-root"); psi.ArgumentList.Add(installRoot);
    _ = Process.Start(psi) ?? throw new InvalidOperationException("Unable to start launcher supervisor");
    return 0;
}
if (action != "run") { Console.Error.WriteLine("Unknown action: " + action); return 2; }
if (OwnedAgentAlive(installRoot, pidPath, launcherStatePath)) return 0;

var agent = Path.Combine(runtime, "agent.ps1");
var config = Path.Combine(installRoot, "config.json");
if (!File.Exists(agent) || !File.Exists(config)) { Console.Error.WriteLine("Agent runtime/config missing"); return 3; }
var logDir = Path.Combine(installRoot, "logs", "runtime"); Directory.CreateDirectory(logDir);
var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmssfff") + "-" + Guid.NewGuid().ToString("N")[..6];
var stdout = Path.Combine(logDir, "agent-" + stamp + "-stdout.log");
var stderr = Path.Combine(logDir, "agent-" + stamp + "-stderr.log");
var psiAgent = new ProcessStartInfo("powershell.exe")
{
    UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = runtime,
    RedirectStandardOutput = true, RedirectStandardError = true
};
psiAgent.ArgumentList.Add("-NoProfile"); psiAgent.ArgumentList.Add("-ExecutionPolicy"); psiAgent.ArgumentList.Add("Bypass");
psiAgent.ArgumentList.Add("-File"); psiAgent.ArgumentList.Add(agent); psiAgent.ArgumentList.Add("-ConfigPath"); psiAgent.ArgumentList.Add(config);
using var process = Process.Start(psiAgent) ?? throw new InvalidOperationException("Unable to launch Agent runtime");
Directory.CreateDirectory(stateDir);
var launcherState = new
{
    schema = "sokna-agent-launcher-state-v1", launcher_pid = Environment.ProcessId, agent_pid = process.Id,
    agent_path = agent, agent_sha256 = Sha256(agent), agent_process_start_utc = process.StartTime.ToUniversalTime().ToString("O"),
    started_at = DateTimeOffset.UtcNow.ToString("O")
};
var temp = launcherStatePath + ".tmp." + Environment.ProcessId;
File.WriteAllText(temp, JsonSerializer.Serialize(launcherState, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false)); File.Move(temp, launcherStatePath, true);
var copyOut = process.StandardOutput.ReadToEndAsync(); var copyErr = process.StandardError.ReadToEndAsync();
await process.WaitForExitAsync();
await File.WriteAllTextAsync(stdout, await copyOut, new UTF8Encoding(false)); await File.WriteAllTextAsync(stderr, await copyErr, new UTF8Encoding(false));
File.AppendAllText(Path.Combine(logDir, "launcher-events.jsonl"), JsonSerializer.Serialize(new { ts = DateTimeOffset.UtcNow.ToString("O"), phase = "runtime_exit", agent_pid = process.Id, exit_code = process.ExitCode }) + Environment.NewLine, new UTF8Encoding(false));
return process.ExitCode;
