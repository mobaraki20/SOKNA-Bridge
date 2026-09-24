using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Sokna.Agent.Maintenance;

internal static class AgentConfiguration
{
    internal static string DefaultArtifactRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SOKNA", "Bridge", "artifacts");

    internal static string LocatorPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SOKNA", "Agent", "install-locator.json");

    internal static string? Initialize(string installRoot, string artifactRoot)
    {
        installRoot = Path.GetFullPath(installRoot);
        artifactRoot = Path.GetFullPath(artifactRoot);
        ValidateArtifactRoot(installRoot, artifactRoot);
        Directory.CreateDirectory(installRoot);
        foreach (var name in new[] { "incoming", "staging", "accepted", "failed", "cache", "browser", "logs" })
            Directory.CreateDirectory(Path.Combine(artifactRoot, name));
        ValidateArtifactRoot(installRoot, artifactRoot);
        var probe = Path.Combine(artifactRoot, ".maintenance-write-probe-" + Guid.NewGuid().ToString("N"));
        File.WriteAllText(probe, "ok", Encoding.ASCII); File.Delete(probe);

        var configPath = Path.Combine(installRoot, "config.json");
        string? migrationSource = null;
        JsonObject cfg;
        if (File.Exists(configPath)) cfg = ReadObject(configPath);
        else
        {
            var legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SOKNA-Bridge-V2", "config.json");
            if (!Path.GetFullPath(legacy).Equals(Path.GetFullPath(configPath), StringComparison.OrdinalIgnoreCase) && File.Exists(legacy))
            {
                cfg = ReadObject(legacy); migrationSource = legacy;
            }
            else
            {
                cfg = new JsonObject
                {
                    ["port"] = 8766,
                    ["token"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                    ["default_workspace"] = "",
                    ["workspaces"] = new JsonObject()
                };
            }
        }
        cfg["artifact_root"] = artifactRoot;
        if (cfg["port"] is null) cfg["port"] = 8766;
        if (cfg["token"] is null || string.IsNullOrWhiteSpace(cfg["token"]!.GetValue<string>())) cfg["token"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        if (cfg["default_workspace"] is null) cfg["default_workspace"] = "";
        if (cfg["workspaces"] is null) cfg["workspaces"] = new JsonObject();
        JsonFiles.WriteAtomic(configPath, cfg);

        var locator = new JsonObject
        {
            ["schema"] = "sokna-agent-install-locator-v1",
            ["install_root"] = installRoot,
            ["config_path"] = configPath,
            ["updated_at"] = DateTimeOffset.UtcNow.ToString("O")
        };
        JsonFiles.WriteAtomic(LocatorPath(), locator);
        WriteNativeHostManifest(installRoot);
        if (migrationSource is not null)
        {
            JsonFiles.WriteAtomic(Path.Combine(installRoot, "state", "config-migration.json"), new
            {
                schema = "sokna-agent-config-migration-v1", source = migrationSource, destination = configPath,
                source_preserved = true, migrated_at = DateTimeOffset.UtcNow.ToString("O")
            });
        }
        return migrationSource;
    }

    private static JsonObject ReadObject(string path) => JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8))?.AsObject()
        ?? throw new InvalidDataException($"Config JSON is invalid: {path}");

    private static void ValidateArtifactRoot(string installRoot, string artifactRoot)
    {
        var app = installRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var art = artifactRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (art.StartsWith(app, StringComparison.OrdinalIgnoreCase) || app.StartsWith(art, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("ArtifactRoot and InstallRoot cannot contain one another; lifecycle ownership must remain separate from artifact data.");
        var current = Path.GetPathRoot(artifactRoot) ?? throw new InvalidOperationException("ArtifactRoot must be rooted");
        foreach (var part in Path.GetRelativePath(current, artifactRoot).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            if (!Directory.Exists(current) && !File.Exists(current)) continue;
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("ArtifactRoot reparse point rejected: " + current);
        }
    }

    internal static void WriteNativeHostManifest(string installRoot)
    {
        var hostExe = Path.Combine(installRoot, "native-host", "sokna-bridge-native-host.exe");
        var manifest = new JsonObject
        {
            ["name"] = "com.sokna.bridge.v3",
            ["description"] = "SOKNA Agent Native Messaging Host",
            ["path"] = hostExe,
            ["type"] = "stdio",
            ["allowed_origins"] = new JsonArray("chrome-extension://gnclegfheoegfdnhndkpemnlheilnick/")
        };
        JsonFiles.WriteAtomic(Path.Combine(installRoot, "native-host", "com.sokna.bridge.v3.json"), manifest);
    }
}
