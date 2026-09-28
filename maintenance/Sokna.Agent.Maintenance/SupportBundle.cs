using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Sokna.Agent.Maintenance;

internal sealed record SupportBundleResult(string Path, bool Partial, int ErrorCount, int FilesWritten);
internal sealed record BundleError(string Stage, string Source, string Error);

internal static class SupportBundle
{
    private static readonly Encoding StrictUtf8 = new UTF8Encoding(false, true);

    internal static async Task<SupportBundleResult> CreateAsync(string installRoot, string outputPath, CancellationToken ct)
    {
        outputPath = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        var temp = Path.Combine(Path.GetTempPath(), "sokna-support-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        var errors = new List<BundleError>();
        var written = 0;
        RuntimeOwnershipState? ownership = null;

        try
        {
            await TryAsync("diagnostics", installRoot, async () =>
            {
                var diagnostics = await HealthDiagnostics.DiagnosticsAsync(installRoot, ct);
                await WriteTextAsync(Path.Combine(temp, "summary.json"), diagnostics.ToJsonString(JsonFiles.Options), ct);
                written++;
            }, errors);

            var ownershipPath = Path.Combine(installRoot, "state", "runtime-ownership.json");
            Try("ownership", ownershipPath, () =>
            {
                if (File.Exists(ownershipPath)) ownership = JsonFiles.Read<RuntimeOwnershipState>(ownershipPath);
            }, errors);

            await TryAsync("health", installRoot, async () =>
            {
                var health = await HealthDiagnostics.HealthAsync(installRoot, ownership?.ActiveVersion, ct);
                await WriteTextAsync(Path.Combine(temp, "health.json"), JsonSerializer.Serialize(health, JsonFiles.Options), ct);
                written++;
            }, errors);

            if (File.Exists(ownershipPath))
            {
                if (TryCopyRedactedJson(ownershipPath, Path.Combine(temp, "versions.json"), "versions", errors)) written++;
            }
            else
            {
                await WriteTextAsync(Path.Combine(temp, "versions.json"), "{}", ct);
                written++;
            }

            var config = Path.Combine(installRoot, "config.json");
            if (File.Exists(config) && TryCopyRedactedJson(config, Path.Combine(temp, "config.redacted.json"), "config", errors)) written++;

            var stateDir = Path.Combine(installRoot, "state");
            foreach (var stateName in new[] { "workspaces.json", "workspace-grants.json", "components.json", "automations.json", "launcher-state.json", "runtime-ownership.json" })
            {
                var source = Path.Combine(stateDir, stateName);
                if (File.Exists(source) && TryCopyRedactedJson(source, Path.Combine(temp, "state", stateName), "state", errors)) written++;
            }
            written += TryCopyRedactedJsonDir(Path.Combine(stateDir, "component-transactions"), Path.Combine(temp, "state", "component-transactions"), 16, errors);

            var maintenanceLogs = Path.Combine(installRoot, "logs", "maintenance");
            var rootEvents = Path.Combine(temp, "events.jsonl");
            if (Directory.Exists(maintenanceLogs))
            {
                var eventSource = Path.Combine(maintenanceLogs, "events.jsonl");
                if (File.Exists(eventSource))
                {
                    if (TryCopyRedactedText(eventSource, rootEvents, "events", errors)) written++;
                }
                else
                {
                    await WriteTextAsync(rootEvents, "", ct);
                    written++;
                }
                written += TryCopyRedactedTextDir(maintenanceLogs, Path.Combine(temp, "logs", "maintenance"), "*.jsonl", int.MaxValue, errors);
            }
            else
            {
                await WriteTextAsync(rootEvents, "", ct);
                written++;
            }

            written += TryCopyRedactedTextDir(Path.Combine(installRoot, "logs", "installer"), Path.Combine(temp, "logs", "installer"), "*.log", 4, errors);
            written += TryCopyRedactedTextDir(Path.Combine(installRoot, "logs", "runtime"), Path.Combine(temp, "logs", "runtime"), "*", 8, errors);

            foreach (var auditName in new[] { "workspace-audit.jsonl", "component-audit.jsonl", "automation-audit.jsonl" })
            {
                var source = Path.Combine(installRoot, "logs", auditName);
                if (File.Exists(source) && TryCopyRedactedText(source, Path.Combine(temp, "logs", auditName), "audit", errors)) written++;
            }

            var artifactRoot = ownership?.ArtifactRoot;
            if (string.IsNullOrWhiteSpace(artifactRoot))
            {
                Try("artifact-root-discovery", config, () =>
                {
                    if (!File.Exists(config)) return;
                    var cfg = JsonNode.Parse(ReadStrictText(config))?.AsObject();
                    artifactRoot = cfg?["artifact_root"]?.GetValue<string>();
                }, errors);
            }
            if (!string.IsNullOrWhiteSpace(artifactRoot))
            {
                var artifactAudit = Path.Combine(artifactRoot, "logs", "artifact-audit.jsonl");
                if (File.Exists(artifactAudit) && TryCopyRedactedText(artifactAudit, Path.Combine(temp, "logs", "artifact-audit.jsonl"), "artifact-audit", errors)) written++;
            }

            var errorArray = new JsonArray(errors.Select(e => (JsonNode?)new JsonObject
            {
                ["stage"] = e.Stage, ["source"] = e.Source, ["error"] = e.Error
            }).ToArray());
            await WriteTextAsync(Path.Combine(temp, "bundle-errors.json"), errorArray.ToJsonString(JsonFiles.Options), ct);
            written++;

            var manifest = new JsonObject
            {
                ["schema"] = "sokna-support-bundle-v2",
                ["generated_at"] = DateTimeOffset.UtcNow.ToString("O"),
                ["partial"] = errors.Count > 0,
                ["error_count"] = errors.Count,
                ["files_written"] = written,
                ["install_root"] = installRoot
            };
            await WriteTextAsync(Path.Combine(temp, "bundle-manifest.json"), manifest.ToJsonString(JsonFiles.Options), ct);
            written++;

            if (File.Exists(outputPath)) File.Delete(outputPath);
            ZipFile.CreateFromDirectory(temp, outputPath, CompressionLevel.Optimal, false);
            return new SupportBundleResult(outputPath, errors.Count > 0, errors.Count, written);
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
        }
    }

    private static async Task WriteTextAsync(string path, string text, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, text, new UTF8Encoding(false), ct);
    }

    private static string ReadStrictText(string path) => StrictUtf8.GetString(File.ReadAllBytes(path));

    private static void Try(string stage, string source, Action action, List<BundleError> errors)
    {
        try { action(); }
        catch (Exception ex) { errors.Add(new BundleError(stage, source, ex.Message)); }
    }

    private static async Task TryAsync(string stage, string source, Func<Task> action, List<BundleError> errors)
    {
        try { await action(); }
        catch (Exception ex) { errors.Add(new BundleError(stage, source, ex.Message)); }
    }

    private static int TryCopyRedactedJsonDir(string source, string dest, int max, List<BundleError> errors)
    {
        if (!Directory.Exists(source)) return 0;
        var count = 0;
        IEnumerable<string> files;
        try { files = Directory.EnumerateFiles(source, "*.json").OrderByDescending(File.GetLastWriteTimeUtc).Take(max).ToArray(); }
        catch (Exception ex) { errors.Add(new BundleError("json-dir-enumerate", source, ex.Message)); return 0; }
        foreach (var f in files)
            if (TryCopyRedactedJson(f, Path.Combine(dest, Path.GetFileName(f)), "json-file", errors)) count++;
        return count;
    }

    private static int TryCopyRedactedTextDir(string source, string dest, string pattern, int max, List<BundleError> errors)
    {
        if (!Directory.Exists(source)) return 0;
        var count = 0;
        IEnumerable<string> files;
        try { files = Directory.EnumerateFiles(source, pattern).OrderByDescending(File.GetLastWriteTimeUtc).Take(max).ToArray(); }
        catch (Exception ex) { errors.Add(new BundleError("text-dir-enumerate", source, ex.Message)); return 0; }
        foreach (var f in files)
            if (TryCopyRedactedText(f, Path.Combine(dest, Path.GetFileName(f)), "text-file", errors)) count++;
        return count;
    }

    private static bool TryCopyRedactedText(string source, string dest, string stage, List<BundleError> errors)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            var raw = ReadStrictText(source);
            File.WriteAllText(dest, SecretRedactor.RedactText(raw), new UTF8Encoding(false));
            return true;
        }
        catch (Exception ex)
        {
            errors.Add(new BundleError(stage, source, ex.Message));
            return false;
        }
    }

    private static bool TryCopyRedactedJson(string source, string dest, string stage, List<BundleError> errors)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            var node = JsonNode.Parse(ReadStrictText(source)) ?? throw new InvalidDataException("JSON parsed to null");
            SecretRedactor.Redact(node);
            File.WriteAllText(dest, node.ToJsonString(JsonFiles.Options), new UTF8Encoding(false));
            return true;
        }
        catch (Exception ex)
        {
            errors.Add(new BundleError(stage, source, ex.Message));
            return false;
        }
    }
}
