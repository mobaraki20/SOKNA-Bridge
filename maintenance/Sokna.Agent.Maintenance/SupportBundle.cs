using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Sokna.Agent.Maintenance;

internal static class SupportBundle
{
    internal static async Task<string> CreateAsync(string installRoot, string outputPath, CancellationToken ct)
    {
        outputPath = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        var temp = Path.Combine(Path.GetTempPath(), "sokna-support-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            var diagnostics = await HealthDiagnostics.DiagnosticsAsync(installRoot, ct);
            await File.WriteAllTextAsync(Path.Combine(temp, "summary.json"), diagnostics.ToJsonString(JsonFiles.Options), new UTF8Encoding(false), ct);
            var ownershipPath = Path.Combine(installRoot, "state", "runtime-ownership.json");
            RuntimeOwnershipState? ownership = File.Exists(ownershipPath) ? JsonFiles.Read<RuntimeOwnershipState>(ownershipPath) : null;
            var health = await HealthDiagnostics.HealthAsync(installRoot, ownership?.ActiveVersion, ct);
            await File.WriteAllTextAsync(Path.Combine(temp, "health.json"), JsonSerializer.Serialize(health, JsonFiles.Options), new UTF8Encoding(false), ct);
            if (File.Exists(ownershipPath)) CopyRedactedJson(ownershipPath, Path.Combine(temp, "versions.json"));
            else await File.WriteAllTextAsync(Path.Combine(temp, "versions.json"), "{}", new UTF8Encoding(false), ct);
            var config = Path.Combine(installRoot, "config.json");
            if (File.Exists(config)) CopyRedactedJson(config, Path.Combine(temp, "config.redacted.json"));

            // Whole-product runtime state. Copy only known diagnostic registries/evidence; never include jobs, artifacts or component payloads.
            var stateDir = Path.Combine(installRoot, "state");
            foreach (var stateName in new[] { "workspaces.json", "workspace-grants.json", "components.json", "automations.json", "launcher-state.json", "runtime-ownership.json" })
            {
                var source = Path.Combine(stateDir, stateName);
                if (File.Exists(source)) CopyRedactedJson(source, Path.Combine(temp, "state", stateName));
            }
            CopyRedactedJsonDir(Path.Combine(stateDir, "component-transactions"), Path.Combine(temp, "state", "component-transactions"), 16);

            var maintenanceLogs = Path.Combine(installRoot, "logs", "maintenance");
            var rootEvents = Path.Combine(temp, "events.jsonl");
            if (Directory.Exists(maintenanceLogs))
            {
                var eventSource = Path.Combine(maintenanceLogs, "events.jsonl");
                File.WriteAllText(rootEvents, File.Exists(eventSource) ? SecretRedactor.RedactText(File.ReadAllText(eventSource)) : "", new UTF8Encoding(false));
                CopyRedactedTextDir(maintenanceLogs, Path.Combine(temp, "logs", "maintenance"), "*.jsonl", int.MaxValue);
            }
            else File.WriteAllText(rootEvents, "", new UTF8Encoding(false));

            CopyRedactedTextDir(Path.Combine(installRoot, "logs", "installer"), Path.Combine(temp, "logs", "installer"), "*.log", 4);
            CopyRedactedTextDir(Path.Combine(installRoot, "logs", "runtime"), Path.Combine(temp, "logs", "runtime"), "*", 8);
            foreach (var auditName in new[] { "workspace-audit.jsonl", "component-audit.jsonl", "automation-audit.jsonl" })
            {
                var source = Path.Combine(installRoot, "logs", auditName);
                if (File.Exists(source))
                {
                    var dest = Path.Combine(temp, "logs", auditName);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    File.WriteAllText(dest, SecretRedactor.RedactText(File.ReadAllText(source)), new UTF8Encoding(false));
                }
            }
            if (!string.IsNullOrWhiteSpace(ownership?.ArtifactRoot))
            {
                var artifactAudit = Path.Combine(ownership.ArtifactRoot, "logs", "artifact-audit.jsonl");
                if (File.Exists(artifactAudit))
                {
                    var dest = Path.Combine(temp, "logs", "artifact-audit.jsonl");
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    File.WriteAllText(dest, SecretRedactor.RedactText(File.ReadAllText(artifactAudit)), new UTF8Encoding(false));
                }
            }

            if (File.Exists(outputPath)) File.Delete(outputPath);
            ZipFile.CreateFromDirectory(temp, outputPath, CompressionLevel.Optimal, false);
            return outputPath;
        }
        finally { try { Directory.Delete(temp, true); } catch { } }
    }


    private static void CopyRedactedJsonDir(string source, string dest, int max)
    {
        if (!Directory.Exists(source)) return;
        Directory.CreateDirectory(dest);
        foreach (var f in Directory.EnumerateFiles(source, "*.json").OrderByDescending(File.GetLastWriteTimeUtc).Take(max))
            CopyRedactedJson(f, Path.Combine(dest, Path.GetFileName(f)));
    }

    private static void CopyRedactedTextDir(string source, string dest, string pattern, int max)
    {
        if (!Directory.Exists(source)) return;
        Directory.CreateDirectory(dest);
        foreach (var f in Directory.EnumerateFiles(source, pattern).OrderByDescending(File.GetLastWriteTimeUtc).Take(max))
            File.WriteAllText(Path.Combine(dest, Path.GetFileName(f)), SecretRedactor.RedactText(File.ReadAllText(f)), new UTF8Encoding(false));
    }

    private static void CopyRedactedJson(string source, string dest)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        var node = JsonNode.Parse(File.ReadAllText(source, Encoding.UTF8));
        File.WriteAllText(dest, SecretRedactor.Redact(node)?.ToJsonString(JsonFiles.Options) ?? "null", new UTF8Encoding(false));
    }
}
