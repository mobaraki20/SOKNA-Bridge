using System.Diagnostics;
using System.Text;

namespace Sokna.Agent.Maintenance;

internal sealed class Lifecycle
{
    private readonly string _installRoot;
    private readonly EventWriter _log;
    internal Lifecycle(string installRoot, EventWriter log) { _installRoot = Path.GetFullPath(installRoot); _log = log; }

    private static void ValidateToken(string value, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 96 || value.Any(ch => !(char.IsLetterOrDigit(ch) || ch is '.' or '-' or '_' or '+')))
            throw new InvalidDataException($"Unsafe {label}: {value}");
    }

    private void RequireInstallerOwnedFilesCurrent(InstallManifest manifest, string reasonCode)
    {
        var mismatches = new List<string>();
        foreach (var file in manifest.Files.Where(f => f.Owner == "installer"))
        {
            var live = SafePath.Resolve(_installRoot, file.Path);
            if (!File.Exists(live)) { mismatches.Add(file.Path + ":missing"); continue; }
            try { Hashing.Verify(live, file); } catch { mismatches.Add(file.Path + ":hash"); }
        }
        if (mismatches.Count > 0) throw new InvalidOperationException(reasonCode + ": " + string.Join(",", mismatches));
    }

    private void RequireMaintenanceFilesCurrent(InstallManifest manifest, string reasonCode)
    {
        var mismatches = new List<string>();
        foreach (var file in manifest.Files.Where(f => f.Owner == "maintenance"))
        {
            var live = SafePath.Resolve(_installRoot, file.Path);
            if (!File.Exists(live)) { mismatches.Add(file.Path + ":missing"); continue; }
            try { Hashing.Verify(live, file); } catch { mismatches.Add(file.Path + ":hash"); }
        }
        if (mismatches.Count > 0) throw new InvalidOperationException(reasonCode + ": " + string.Join(",", mismatches));
    }

    private static void ValidateManifestShape(InstallManifest manifest)
    {
        if (manifest.Schema != "sokna-agent-install-manifest-v1") throw new InvalidDataException("Unsupported install manifest schema");
        ValidateToken(manifest.ProductVersion, "product version");
        ValidateToken(manifest.LauncherVersion, "launcher version");
        if (manifest.Files.Count == 0) throw new InvalidDataException("Install manifest is empty");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in manifest.Files)
        {
            if (!seen.Add(file.Path.Replace('\\', '/'))) throw new InvalidDataException($"Duplicate owned path: {file.Path}");
            if (file.Owner is not ("maintenance" or "installer")) throw new InvalidDataException($"Unknown owner for {file.Path}: {file.Owner}");
            if (file.Bytes < 0 || file.Sha256.Length != 64 || !file.Sha256.All(Uri.IsHexDigit)) throw new InvalidDataException($"Invalid file metadata: {file.Path}");
        }
    }

    internal InstallManifest LoadAndVerifyManifest(string manifestPath, string payloadRoot)
    {
        var manifest = JsonFiles.Read<InstallManifest>(manifestPath);
        ValidateManifestShape(manifest);
        foreach (var file in manifest.Files)
        {
            var source = SafePath.Resolve(payloadRoot, file.Path, false);
            Hashing.Verify(source, file);
        }
        return manifest;
    }

    private InstallManifest LoadInstalledManifest()
    {
        var path = Path.Combine(_installRoot, "manifests", "installed-manifest.json");
        if (!File.Exists(path)) throw new InvalidOperationException("INSTALLED_MANIFEST_MISSING");
        var manifest = JsonFiles.Read<InstallManifest>(path);
        ValidateManifestShape(manifest);
        return manifest;
    }

    internal object Preflight(string manifestPath, string payloadRoot)
    {
        var manifest = LoadAndVerifyManifest(manifestPath, payloadRoot);
        var probeDir = Path.Combine(_installRoot, "state"); Directory.CreateDirectory(probeDir);
        var probe = Path.Combine(probeDir, ".write-probe-" + Guid.NewGuid().ToString("N"));
        File.WriteAllText(probe, "ok", Encoding.ASCII); File.Delete(probe);
        return new { manifest.ProductVersion, manifest.LauncherVersion, owned_files = manifest.Files.Count, install_root = _installRoot };
    }

    internal async Task RepairAsync(string manifestPath, string payloadRoot, CancellationToken ct)
    {
        var manifest = LoadAndVerifyManifest(manifestPath, payloadRoot);
        RequireInstallerOwnedFilesCurrent(manifest, "INSTALLER_OWNED_REPAIR_REQUIRES_EXACT_SETUP");
        var toRestore = new List<OwnedFile>();
        foreach (var file in manifest.Files.Where(f => f.Owner == "maintenance"))
        {
            var dest = SafePath.Resolve(_installRoot, file.Path);
            var valid = File.Exists(dest);
            if (valid) { try { Hashing.Verify(dest, file); } catch { valid = false; } }
            if (!valid) toRestore.Add(file);
        }
        if (toRestore.Count > 0) await StopAgent(ct);
        foreach (var file in toRestore)
        {
            var source = SafePath.Resolve(payloadRoot, file.Path, false);
            AtomicCopyVerified(source, SafePath.Resolve(_installRoot, file.Path), file);
        }
        JsonFiles.WriteAtomic(Path.Combine(_installRoot, "manifests", "installed-manifest.json"), manifest);
        var health = await StartAndWaitForHealth(manifest.ProductVersion, ct);
        _log.Event("repair", "completed", true, detail: new { restored = toRestore.Select(f => f.Path).ToArray(), health });
    }

    internal async Task UpgradeAsync(string manifestPath, string payloadRoot, CancellationToken ct)
    {
        var manifest = LoadAndVerifyManifest(manifestPath, payloadRoot);
        RequireInstallerOwnedFilesCurrent(manifest, "INSTALLER_OWNED_CHANGE_REQUIRES_SETUP");
        var installed = LoadInstalledManifest();

        var ownershipPath = Path.Combine(_installRoot, "state", "runtime-ownership.json");
        var state = File.Exists(ownershipPath) ? JsonFiles.Read<RuntimeOwnershipState>(ownershipPath) : new RuntimeOwnershipState { InstallRoot = _installRoot };
        if (string.IsNullOrWhiteSpace(state.ActiveVersion)) state.ActiveVersion = installed.ProductVersion;
        if (!string.Equals(state.ActiveVersion, installed.ProductVersion, StringComparison.Ordinal))
            throw new InvalidOperationException($"OWNERSHIP_MANIFEST_VERSION_MISMATCH: ownership={state.ActiveVersion}, manifest={installed.ProductVersion}");
        if (installed.ProductVersion == manifest.ProductVersion)
        {
            await RepairAsync(manifestPath, payloadRoot, ct);
            _log.Event("upgrade", "completed", true, detail: new { idempotent = true, verified_or_repaired = true, version = manifest.ProductVersion });
            return;
        }
        RequireMaintenanceFilesCurrent(installed, "CURRENT_RUNTIME_NOT_LKG_REPAIR_FIRST");

        var tx = "upgrade-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "-" + Guid.NewGuid().ToString("N")[..8];
        var txRoot = Path.Combine(_installRoot, "updates", manifest.ProductVersion, tx);
        var stage = Path.Combine(txRoot, "stage"); var backup = Path.Combine(txRoot, "backup");
        Directory.CreateDirectory(stage); Directory.CreateDirectory(backup);

        var oldMaintenance = installed.Files.Where(f => f.Owner == "maintenance").ToDictionary(f => f.Path.Replace('\\', '/'), StringComparer.OrdinalIgnoreCase);
        var newMaintenance = manifest.Files.Where(f => f.Owner == "maintenance").ToDictionary(f => f.Path.Replace('\\', '/'), StringComparer.OrdinalIgnoreCase);
        var newFiles = newMaintenance.Keys.Where(p => !oldMaintenance.ContainsKey(p)).OrderBy(p => p, StringComparer.OrdinalIgnoreCase).ToList();
        var removedFiles = oldMaintenance.Keys.Where(p => !newMaintenance.ContainsKey(p)).OrderBy(p => p, StringComparer.OrdinalIgnoreCase).ToList();

        foreach (var file in manifest.Files.Where(f => f.Owner == "maintenance"))
        {
            var src = SafePath.Resolve(payloadRoot, file.Path, false);
            AtomicCopyVerified(src, SafePath.Resolve(stage, file.Path), file);
        }
        foreach (var file in installed.Files.Where(f => f.Owner == "maintenance"))
        {
            var live = SafePath.Resolve(_installRoot, file.Path, false);
            Hashing.Verify(live, file);
            AtomicCopyVerified(live, SafePath.Resolve(backup, file.Path), file);
        }

        var recoveryManifest = new InstallManifest(installed.Schema, installed.ProductVersion, installed.LauncherVersion, installed.SourceCommit,
            installed.Files.Where(f => f.Owner == "maintenance").ToList());
        JsonFiles.WriteAtomic(Path.Combine(txRoot, "recovery-manifest.json"), recoveryManifest);
        JsonFiles.WriteAtomic(Path.Combine(txRoot, "rollback-new-files.json"), newFiles);
        JsonFiles.WriteAtomic(Path.Combine(txRoot, "removed-old-files.json"), removedFiles);
        var installedManifestPath = Path.Combine(_installRoot, "manifests", "installed-manifest.json");
        File.Copy(installedManifestPath, Path.Combine(txRoot, "previous-installed-manifest.json"), true);
        JsonFiles.WriteAtomic(Path.Combine(txRoot, "previous-ownership.json"), state);
        WriteTxStage(txRoot, "staged", new { tx, from = installed.ProductVersion, to = manifest.ProductVersion, new_files = newFiles, removed_files = removedFiles });

        state.PreviousVersion = installed.ProductVersion; state.ActiveVersion = manifest.ProductVersion; state.LauncherVersion = manifest.LauncherVersion;
        state.ActivationTxId = tx; state.LastHealth = "pending"; state.AgentPid = null; state.SourceArtifactHash = Hashing.Sha256(manifestPath); state.UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
        JsonFiles.WriteAtomic(ownershipPath, state);
        _log.Event("upgrade", "mutation_started", true, detail: new { tx, from = state.PreviousVersion, to = manifest.ProductVersion, removed_files = removedFiles });
        try
        {
            await StopAgent(ct);
            WriteTxStage(txRoot, "agent_stopped", new { tx });
            foreach (var file in manifest.Files.Where(f => f.Owner == "maintenance"))
                AtomicCopyVerified(SafePath.Resolve(stage, file.Path, false), SafePath.Resolve(_installRoot, file.Path), file);
            foreach (var rel in removedFiles)
            {
                var path = SafePath.Resolve(_installRoot, rel);
                if (File.Exists(path)) File.Delete(path);
            }
            JsonFiles.WriteAtomic(installedManifestPath, manifest);
            WriteTxStage(txRoot, "switched", new { tx });
            var health = await StartAndWaitForHealth(manifest.ProductVersion, ct);
            state.LastHealth = "pass"; if (AgentProcessOwnership.TryGetOwnedPid(_installRoot, out var livePid, out _)) state.AgentPid = livePid; state.UpdatedAt = DateTimeOffset.UtcNow.ToString("O"); JsonFiles.WriteAtomic(ownershipPath, state);
            WriteTxStage(txRoot, "committed", new { tx, health });
            _log.Event("upgrade", "completed", true, detail: new { tx, health, removed_files = removedFiles });
        }
        catch (Exception ex)
        {
            _log.Event("upgrade", "health_failed", false, ex.Message, "automatic rollback");
            await RollbackTxAsync(tx, ct);
            throw;
        }
    }

    internal async Task RollbackTxAsync(string tx, CancellationToken ct)
    {
        ValidateToken(tx, "transaction id");
        var ownershipPath = Path.Combine(_installRoot, "state", "runtime-ownership.json");
        var state = JsonFiles.Read<RuntimeOwnershipState>(ownershipPath);
        if (!string.Equals(state.ActivationTxId, tx, StringComparison.Ordinal)) throw new InvalidOperationException("Rollback transaction is not current ownership transaction");
        ValidateToken(state.ActiveVersion, "active version");
        var txRoot = Path.Combine(_installRoot, "updates", state.ActiveVersion, tx);
        var backup = Path.Combine(txRoot, "backup");
        var recovery = JsonFiles.Read<InstallManifest>(Path.Combine(txRoot, "recovery-manifest.json"));
        ValidateManifestShape(recovery);
        var previousOwnershipPath = Path.Combine(txRoot, "previous-ownership.json");
        var previousState = File.Exists(previousOwnershipPath) ? JsonFiles.Read<RuntimeOwnershipState>(previousOwnershipPath) : null;

        await StopAgent(ct);
        foreach (var file in recovery.Files)
        {
            var source = SafePath.Resolve(backup, file.Path, false); Hashing.Verify(source, file);
            AtomicCopyVerified(source, SafePath.Resolve(_installRoot, file.Path), file);
        }
        var newFilesPath = Path.Combine(txRoot, "rollback-new-files.json");
        if (File.Exists(newFilesPath))
        {
            foreach (var rel in JsonFiles.Read<List<string>>(newFilesPath))
            {
                var path = SafePath.Resolve(_installRoot, rel); if (File.Exists(path)) File.Delete(path);
            }
        }
        var installedManifestPath = Path.Combine(_installRoot, "manifests", "installed-manifest.json");
        var previousManifestPath = Path.Combine(txRoot, "previous-installed-manifest.json");
        if (!File.Exists(previousManifestPath)) throw new InvalidOperationException("Previous installed manifest missing for rollback");
        File.Copy(previousManifestPath, installedManifestPath, true);

        var restored = previousState ?? state;
        restored.ActiveVersion = recovery.ProductVersion;
        restored.LauncherVersion = recovery.LauncherVersion;
        restored.ActivationTxId = null;
        restored.AgentPid = null;
        restored.LastRollback = DateTimeOffset.UtcNow.ToString("O"); restored.LastHealth = "pending";
        restored.UpdatedAt = DateTimeOffset.UtcNow.ToString("O"); JsonFiles.WriteAtomic(ownershipPath, restored);
        var health = await StartAndWaitForHealth(restored.ActiveVersion, ct);
        restored.LastHealth = "rollback-pass"; if (AgentProcessOwnership.TryGetOwnedPid(_installRoot, out var rollbackPid, out _)) restored.AgentPid = rollbackPid; restored.UpdatedAt = DateTimeOffset.UtcNow.ToString("O"); JsonFiles.WriteAtomic(ownershipPath, restored);
        WriteTxStage(txRoot, "rolled_back", new { tx, health });
        _log.Event("rollback", "completed", true, detail: new { tx, health });
    }

    private static void WriteTxStage(string txRoot, string stage, object detail) =>
        JsonFiles.WriteAtomic(Path.Combine(txRoot, "transaction.json"), new { schema = "sokna-agent-upgrade-transaction-v1", stage, updated_at = DateTimeOffset.UtcNow.ToString("O"), detail });

    private static void AtomicCopyVerified(string source, string dest, OwnedFile expected)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        var temp = dest + ".tmp." + Environment.ProcessId + "." + Guid.NewGuid().ToString("N");
        try { File.Copy(source, temp, true); Hashing.Verify(temp, expected); File.Move(temp, dest, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    private async Task StopAgent(CancellationToken ct)
    {
        if (!AgentProcessOwnership.TryGetOwnedPid(_installRoot, out var pid, out _, false)) return;
        try { using var process = Process.GetProcessById(pid); process.Kill(true); await process.WaitForExitAsync(ct); } catch (ArgumentException) { }
    }

    private async Task<HealthResult> StartAndWaitForHealth(string expectedVersion, CancellationToken ct)
    {
        await EnsureLauncherStarted(ct);
        HealthResult health = new(false, "", false, false, false, "not started");
        for (var i = 0; i < 20; i++)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(500, ct);
            health = await HealthDiagnostics.HealthAsync(_installRoot, expectedVersion, ct);
            if (health.Ok) return health;
        }
        throw new InvalidOperationException($"Agent health failed for expected version {expectedVersion}: {health.Error}");
    }

    private async Task EnsureLauncherStarted(CancellationToken ct)
    {
        var launcher = Path.Combine(_installRoot, "Sokna.Agent.Launcher.exe");
        if (!File.Exists(launcher)) throw new FileNotFoundException("Stable launcher missing", launcher);
        var psi = new ProcessStartInfo(launcher) { UseShellExecute = false, CreateNoWindow = true };
        psi.ArgumentList.Add("start"); psi.ArgumentList.Add("--install-root"); psi.ArgumentList.Add(_installRoot);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start launcher");
        await process.WaitForExitAsync(ct);
        if (process.ExitCode != 0) throw new InvalidOperationException("Launcher exited with code " + process.ExitCode);
    }
}
