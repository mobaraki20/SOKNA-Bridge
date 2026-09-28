using System.Diagnostics;
using Microsoft.Win32;

namespace Sokna.Agent.Maintenance;

internal sealed record LegacyRuntimeMigrationResult(
    bool LegacyConfigPresent,
    bool RuntimeDetected,
    bool RuntimeStopped,
    bool LegacyAutostartRemoved,
    bool StartupEntryRemoved,
    int? Port,
    int? LegacyPid,
    string? Detail);

internal static class LegacyRuntimeMigration
{
    private const string LegacyRunValue = "SOKNA Bridge Agent";

    internal static LegacyRuntimeMigrationResult Quiesce(string currentInstallRoot)
    {
        if (!OperatingSystem.IsWindows())
            return new(false, false, false, false, false, null, null, "non-windows");

        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var legacyRoot = Path.Combine(local, "SOKNA-Bridge-V2");
        var legacyConfig = Path.Combine(legacyRoot, "config.json");
        var legacyAgent = Path.GetFullPath(Path.Combine(legacyRoot, "agent.ps1"));
        var legacyPidPath = Path.Combine(legacyRoot, "agent.pid");
        var currentAgent = Path.GetFullPath(Path.Combine(currentInstallRoot, "runtime", "agent.ps1"));

        var configPresent = File.Exists(legacyConfig);
        var port = TryReadPort(legacyConfig);
        var candidatePids = new HashSet<int>();

        if (TryReadPid(legacyPidPath, out var recordedPid))
            candidatePids.Add(recordedPid);

        int? listenerPid = port is > 0 ? TryGetListeningPid(port.Value) : null;
        if (listenerPid is > 0)
            candidatePids.Add(listenerPid.Value);

        var detected = false;
        var stopped = false;
        int? stoppedPid = null;
        foreach (var pid in candidatePids)
        {
            if (!TryGetProcess(pid, out var process))
                continue;

            using (process)
            {
                var commandLine = TryGetCommandLine(pid);
                if (!IsOwnedLegacyProcess(process.ProcessName, commandLine, legacyAgent))
                    continue;

                detected = true;
                try
                {
                    process.Kill(entireProcessTree: true);
                    if (!process.WaitForExit(5000))
                        throw new InvalidOperationException("LEGACY_RUNTIME_STOP_TIMEOUT: pid=" + pid);
                    stopped = true;
                    stoppedPid = pid;
                }
                catch (Exception ex) when (ex is not InvalidOperationException)
                {
                    throw new InvalidOperationException("LEGACY_RUNTIME_STOP_FAILED: pid=" + pid + " error=" + ex.Message, ex);
                }
            }
        }

        if (stopped && File.Exists(legacyPidPath))
        {
            try { File.Delete(legacyPidPath); } catch { }
        }

        var autostartRemoved = RemoveLegacyRunValue(legacyRoot);
        var startupRemoved = RemoveLegacyStartupEntry(legacyRoot);

        if (port is > 0)
        {
            int? remaining = null;
            for (var i = 0; i < 25; i++)
            {
                remaining = TryGetListeningPid(port.Value);
                if (remaining is null) break;
                if (stoppedPid is not null && remaining != stoppedPid) break;
                Thread.Sleep(100);
            }

            if (remaining is > 0)
            {
                if (TryGetProcess(remaining.Value, out var process))
                {
                    using (process)
                    {
                        var commandLine = TryGetCommandLine(remaining.Value);
                        if (IsOwnedLegacyProcess(process.ProcessName, commandLine, legacyAgent))
                            throw new InvalidOperationException("LEGACY_RUNTIME_STILL_LISTENING: port=" + port + " pid=" + remaining);
                        if (!IsOwnedCurrentProcess(process.ProcessName, commandLine, currentAgent))
                            throw new InvalidOperationException("AGENT_PORT_CONFLICT_UNOWNED: port=" + port + " pid=" + remaining);
                    }
                }
            }
        }

        var detail = stopped ? "legacy-runtime-stopped" :
            detected ? "legacy-runtime-detected" :
            configPresent ? "legacy-config-present-no-owned-runtime" : "legacy-not-present";

        return new(configPresent, detected, stopped, autostartRemoved, startupRemoved, port, stoppedPid, detail);
    }

    private static int? TryReadPort(string configPath)
    {
        try
        {
            if (!File.Exists(configPath)) return null;
            var node = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(configPath))?.AsObject();
            var port = node?["port"]?.GetValue<int>() ?? 0;
            return port is > 0 and <= 65535 ? port : null;
        }
        catch { return null; }
    }

    private static bool TryReadPid(string pidPath, out int pid)
    {
        pid = 0;
        try
        {
            return File.Exists(pidPath) &&
                   int.TryParse(File.ReadAllText(pidPath).Trim(), out pid) &&
                   pid > 0;
        }
        catch { return false; }
    }

    private static bool TryGetProcess(int pid, out Process process)
    {
        try
        {
            process = Process.GetProcessById(pid);
            if (process.HasExited) { process.Dispose(); process = null!; return false; }
            return true;
        }
        catch
        {
            process = null!;
            return false;
        }
    }

    private static bool IsOwnedLegacyProcess(string processName, string? commandLine, string legacyAgent)
    {
        if (!IsPowerShell(processName) || string.IsNullOrWhiteSpace(commandLine)) return false;
        return commandLine.Contains(legacyAgent, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsOwnedCurrentProcess(string processName, string? commandLine, string currentAgent)
    {
        if (!IsPowerShell(processName) || string.IsNullOrWhiteSpace(commandLine)) return false;
        return commandLine.Contains(currentAgent, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPowerShell(string processName) =>
        processName.Equals("powershell", StringComparison.OrdinalIgnoreCase) ||
        processName.Equals("pwsh", StringComparison.OrdinalIgnoreCase);

    private static string? TryGetCommandLine(int pid)
    {
        var script =
            "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid +
            "' -ErrorAction SilentlyContinue; if($null -ne $p){[Console]::Out.Write([string]$p.CommandLine)}";
        return RunPowerShell(script);
    }

    private static int? TryGetListeningPid(int port)
    {
        var script =
            "$c=Get-NetTCPConnection -State Listen -LocalPort " + port +
            " -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::')} | Select-Object -First 1 -ExpandProperty OwningProcess; if($null -ne $c){[Console]::Out.Write([string]$c)}";
        var output = RunPowerShell(script);
        return int.TryParse(output?.Trim(), out var pid) && pid > 0 ? pid : null;
    }

    private static string? RunPowerShell(string script)
    {
        try
        {
            var psi = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-NonInteractive");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-Command");
            psi.ArgumentList.Add(script);
            using var process = Process.Start(psi);
            if (process is null) return null;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(10000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return null;
            }
            var output = stdout.GetAwaiter().GetResult();
            _ = stderr.GetAwaiter().GetResult();
            return process.ExitCode == 0 ? output : null;
        }
        catch { return null; }
    }

    private static bool RemoveLegacyRunValue(string legacyRoot)
    {
        try
        {
            using var run = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
            if (run is null) return false;
            var raw = run.GetValue(LegacyRunValue)?.ToString();
            if (string.IsNullOrWhiteSpace(raw)) return false;
            if (!raw.Contains(legacyRoot, StringComparison.OrdinalIgnoreCase) &&
                !raw.Contains("SOKNA-Bridge-V2", StringComparison.OrdinalIgnoreCase))
                return false;
            run.DeleteValue(LegacyRunValue, throwOnMissingValue: false);
            return true;
        }
        catch { return false; }
    }

    private static bool RemoveLegacyStartupEntry(string legacyRoot)
    {
        try
        {
            var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            var path = Path.Combine(startup, "SOKNA-Bridge-Agent.vbs");
            if (!File.Exists(path)) return false;
            var text = File.ReadAllText(path);
            if (!text.Contains(legacyRoot, StringComparison.OrdinalIgnoreCase) &&
                !text.Contains("SOKNA-Bridge-V2", StringComparison.OrdinalIgnoreCase))
                return false;
            File.Delete(path);
            return true;
        }
        catch { return false; }
    }
}
