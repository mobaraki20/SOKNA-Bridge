using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Sokna.Agent.Maintenance;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "help" or "--help" or "-h") { Help(); return 0; }
        var action = args[0].ToLowerInvariant();
        var opt = Parse(args.Skip(1).ToArray());
        var installRoot = Path.GetFullPath(Get(opt, "install-root", AppContext.BaseDirectory));
        var log = new EventWriter(installRoot, action);
        try
        {
            object? data = action switch
            {
                "initialize" => await Initialize(installRoot, Get(opt, "artifact-root", AgentConfiguration.DefaultArtifactRoot())),
                "preflight" => new Lifecycle(installRoot, log).Preflight(Required(opt, "manifest"), Required(opt, "payload-root")),
                "status" => Status(installRoot),
                "health" => await HealthDiagnostics.HealthAsync(installRoot, opt.GetValueOrDefault("expected-version"), CancellationToken.None),
                "start" => await Start(installRoot, opt.GetValueOrDefault("expected-version")),
                "stop" => await Stop(installRoot),
                "settings-apply" => await ApplySettings(installRoot, Required(opt, "port"), Required(opt, "artifact-root"), Required(opt, "autostart")),
                "uninstall-prep" => await UninstallPrep(installRoot),
                "diagnostics" => await Diagnostics(installRoot, Required(opt, "output")),
                "support-bundle" => await SupportBundle.CreateAsync(installRoot, Required(opt, "output"), CancellationToken.None),
                "repair" => await Repair(installRoot, log, Required(opt, "manifest"), Required(opt, "payload-root")),
                "upgrade" => await Upgrade(installRoot, log, Required(opt, "manifest"), Required(opt, "payload-root")),
                "rollback" => await Rollback(installRoot, log, Required(opt, "tx-id")),
                _ => throw new ArgumentException("Unknown action: " + action)
            };
            log.Event(action, "completed", true, detail: data);
            Console.WriteLine(JsonSerializer.Serialize(new OperationResult(true, action, log.SessionId, data), JsonFiles.Options));
            return 0;
        }
        catch (Exception ex)
        {
            var next = action == "support-bundle"
                ? "open maintenance logs or run diagnostics; retry the best-effort bundle"
                : "inspect maintenance logs or create a support bundle";
            log.Event(action, "failed", false, ex.Message, next);
            Console.Error.WriteLine(JsonSerializer.Serialize(new OperationResult(false, action, log.SessionId, Error: ex.Message, NextAction: next), JsonFiles.Options));
            return 10;
        }
    }

    private static async Task<object> Initialize(string root, string artifactRoot)
    {
        var preparation = await ExistingRuntimePreparation.PrepareAsync(root, CancellationToken.None);
        var migrationSource = AgentConfiguration.Initialize(root, artifactRoot);
        var configPath = Path.Combine(root, "config.json");
        var cfg = JsonNode.Parse(await File.ReadAllTextAsync(configPath))?.AsObject()
            ?? throw new InvalidDataException("config.json invalid after initialize");
        var port = cfg["port"]?.GetValue<int>() ?? throw new InvalidDataException("config port missing after initialize");
        await ExistingRuntimePreparation.WaitForEndpointAvailableAsync(port, CancellationToken.None);

        var manifestPath = Path.Combine(root, "manifests", "installed-manifest.json");
        var manifest = File.Exists(manifestPath) ? JsonFiles.Read<InstallManifest>(manifestPath) : null;
        var statePath = Path.Combine(root, "state", "runtime-ownership.json");
        var state = File.Exists(statePath) ? JsonFiles.Read<RuntimeOwnershipState>(statePath) : new RuntimeOwnershipState();
        state.InstallRoot = root; state.ActiveVersion = manifest?.ProductVersion ?? state.ActiveVersion; state.LauncherVersion = manifest?.LauncherVersion ?? state.LauncherVersion;
        state.ConfigPath = configPath; state.ArtifactRoot = Path.GetFullPath(artifactRoot); state.SourceArtifactHash = manifest is null ? state.SourceArtifactHash : Hashing.Sha256(manifestPath); state.UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
        JsonFiles.WriteAtomic(statePath, state);
        JsonFiles.WriteAtomic(Path.Combine(root, "state", "install-preparation.json"), new
        {
            schema = "sokna-agent-install-preparation-v1",
            current_runtime_stopped = preparation.CurrentRuntimeStopped,
            current_runtime_pid = preparation.CurrentRuntimePid,
            legacy_runtime_detected = preparation.LegacyRuntimeDetected,
            legacy_runtime_stopped = preparation.LegacyRuntimeStopped,
            legacy_runtime_pid = preparation.LegacyRuntimePid,
            legacy_port = preparation.LegacyPort,
            legacy_autostart_removed = preparation.LegacyAutostartRemoved,
            legacy_config_path = preparation.LegacyConfigPath,
            prepared_at = DateTimeOffset.UtcNow.ToString("O")
        });
        return new
        {
            install_root = root,
            artifact_root = state.ArtifactRoot,
            config_path = state.ConfigPath,
            migrated_from = migrationSource,
            migration_source_preserved = migrationSource is not null,
            preparation
        };
    }

    private static object Status(string root)
    {
        var statePath = Path.Combine(root, "state", "runtime-ownership.json");
        var state = File.Exists(statePath) ? JsonFiles.Read<RuntimeOwnershipState>(statePath) : null;
        return new { installed = state is not null, ownership = state, locator = AgentConfiguration.LocatorPath() };
    }

    private static async Task<object> Start(string root, string? expectedVersion)
    {
        var launcher = Path.Combine(root, "Sokna.Agent.Launcher.exe");
        if (!File.Exists(launcher)) throw new FileNotFoundException("Stable launcher missing", launcher);
        using var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(launcher) { UseShellExecute = false, CreateNoWindow = true, ArgumentList = { "start", "--install-root", root } })
            ?? throw new InvalidOperationException("Unable to invoke launcher");
        await p.WaitForExitAsync(); if (p.ExitCode != 0) throw new InvalidOperationException("Launcher start failed: " + p.ExitCode);
        HealthResult health = new(false, "", false, false, false, "not started");
        for (var i = 0; i < 20; i++)
        {
            await Task.Delay(500); health = await HealthDiagnostics.HealthAsync(root, expectedVersion, CancellationToken.None);
            if (health.Ok)
            {
                var statePath = Path.Combine(root, "state", "runtime-ownership.json");
                if (File.Exists(statePath))
                {
                    var state = JsonFiles.Read<RuntimeOwnershipState>(statePath);
                    if (AgentProcessOwnership.TryGetOwnedPid(root, out var pid, out _)) state.AgentPid = pid;
                    state.LastHealth = "pass"; state.UpdatedAt = DateTimeOffset.UtcNow.ToString("O"); JsonFiles.WriteAtomic(statePath, state);
                }
                return new { started = true, health };
            }
        }
        throw new InvalidOperationException("Agent failed health after start: " + health.Error);
    }

    private static async Task<object> Stop(string root)
    {
        if (!AgentProcessOwnership.TryGetOwnedPid(root, out var pid, out var ownershipError, false)) return new { stopped = false, reason = ownershipError ?? "not-running" };
        try { using var p = System.Diagnostics.Process.GetProcessById(pid); p.Kill(true); await p.WaitForExitAsync(); } catch (ArgumentException) { }
        return new { stopped = true, pid };
    }

    private static async Task<object> UninstallPrep(string root)
    {
        await Stop(root);
        var locatorPath = AgentConfiguration.LocatorPath();
        if (File.Exists(locatorPath))
        {
            try
            {
                var locator = JsonNode.Parse(await File.ReadAllTextAsync(locatorPath))?.AsObject();
                var pointed = locator?["install_root"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(pointed) && string.Equals(Path.GetFullPath(pointed), Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase)) File.Delete(locatorPath);
            }
            catch { }
        }
        return new { prepared = true, artifact_root_preserved = true };
    }

    private static async Task<object> ApplySettings(string root, string portRaw, string artifactRoot, string autostartRaw)
    {
        if (!int.TryParse(portRaw, out var port) || port < 1024 || port > 65535)
            throw new ArgumentException("Port must be between 1024 and 65535.");
        if (!bool.TryParse(autostartRaw, out var autostart))
            throw new ArgumentException("Autostart must be true or false.");

        var configPath = Path.Combine(root, "config.json");
        if (!File.Exists(configPath)) throw new FileNotFoundException("config.json missing", configPath);
        var previousConfig = await File.ReadAllTextAsync(configPath);
        var previousRun = GetAutostartValue();
        var expectedVersion = ProductVersion(root);

        await Stop(root);
        try
        {
            await ExistingRuntimePreparation.WaitForEndpointAvailableAsync(port, CancellationToken.None);
            var cfg = AgentConfiguration.ApplyUserSettings(root, port, artifactRoot);
            SetAutostart(root, autostart);
            var started = await Start(root, expectedVersion);
            return new { applied = true, port, artifact_root = cfg["artifact_root"]?.GetValue<string>(), autostart, started };
        }
        catch
        {
            await File.WriteAllTextAsync(configPath, previousConfig);
            RestoreAutostart(previousRun);
            try { await Start(root, expectedVersion); } catch { }
            throw;
        }
    }

    private static string ProductVersion(string root)
    {
        try
        {
            var path = Path.Combine(root, "manifests", "installed-manifest.json");
            return JsonNode.Parse(File.ReadAllText(path))?.AsObject()["product_version"]?.GetValue<string>() ?? "";
        }
        catch { return ""; }
    }

    private static string? GetAutostartValue()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        return key?.GetValue("SOKNA Agent")?.ToString();
    }

    private static void SetAutostart(string root, bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true)
            ?? throw new InvalidOperationException("Unable to open Windows Run registry key.");
        if (!enabled) { key.DeleteValue("SOKNA Agent", throwOnMissingValue: false); return; }
        var launcher = Path.Combine(root, "Sokna.Agent.Launcher.exe");
        key.SetValue("SOKNA Agent", $"\"{launcher}\" start --install-root \"{root}\"", RegistryValueKind.String);
    }

    private static void RestoreAutostart(string? value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
        if (key is null) return;
        if (string.IsNullOrWhiteSpace(value)) key.DeleteValue("SOKNA Agent", throwOnMissingValue: false);
        else key.SetValue("SOKNA Agent", value, RegistryValueKind.String);
    }

    private static async Task<object> Diagnostics(string root, string output)
    {
        var data = await HealthDiagnostics.DiagnosticsAsync(root, CancellationToken.None);
        JsonFiles.WriteAtomic(Path.GetFullPath(output), data);
        return new { output = Path.GetFullPath(output) };
    }

    private static async Task<object> Repair(string root, EventWriter log, string manifest, string payload)
    { await new Lifecycle(root, log).RepairAsync(manifest, payload, CancellationToken.None); return new { repaired = true }; }
    private static async Task<object> Upgrade(string root, EventWriter log, string manifest, string payload)
    { await new Lifecycle(root, log).UpgradeAsync(manifest, payload, CancellationToken.None); return new { upgraded = true }; }
    private static async Task<object> Rollback(string root, EventWriter log, string tx)
    { await new Lifecycle(root, log).RollbackTxAsync(tx, CancellationToken.None); return new { rolled_back = true, tx_id = tx }; }

    private static Dictionary<string, string> Parse(string[] args)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < args.Length; i++)
        {
            if (!args[i].StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("Expected option, got " + args[i]);
            var key = args[i][2..]; if (i + 1 >= args.Length || args[i + 1].StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("Missing value for --" + key);
            d[key] = args[++i];
        }
        return d;
    }
    private static string Required(Dictionary<string, string> d, string k) => d.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? v : throw new ArgumentException("Missing --" + k);
    private static string Get(Dictionary<string, string> d, string k, string fallback) => d.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? v : fallback;
    private static void Help() => Console.WriteLine("SOKNA Agent Maintenance: initialize|preflight|status|health|start|stop|settings-apply|uninstall-prep|diagnostics|support-bundle|repair|upgrade|rollback");
}
