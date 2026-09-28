using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Sokna.Agent.Maintenance;

internal static class JsonFiles
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true
    };

    internal static T Read<T>(string path) =>
        JsonSerializer.Deserialize<T>(File.ReadAllText(path, Encoding.UTF8), Options)
        ?? throw new InvalidDataException($"JSON deserialized to null: {path}");

    internal static void WriteAtomic<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp." + Environment.ProcessId + "." + Guid.NewGuid().ToString("N");
        File.WriteAllText(temp, JsonSerializer.Serialize(value, Options), new UTF8Encoding(false));
        File.Move(temp, path, true);
    }
}

internal static class SafePath
{
    internal static string Resolve(string root, string relative, bool allowMissing = true)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative))
            throw new InvalidDataException($"Unsafe owned path: {relative}");
        var parts = relative.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Any(p => p is "." or "..")) throw new InvalidDataException($"Traversal rejected: {relative}");
        var rootBase = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (Directory.Exists(rootBase) || File.Exists(rootBase))
        {
            if ((File.GetAttributes(rootBase) & FileAttributes.ReparsePoint) != 0)
                throw new IOException($"Root reparse point rejected: {rootBase}");
        }
        else if (!allowMissing) throw new DirectoryNotFoundException($"Owned root missing: {rootBase}");
        var rootFull = rootBase + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(rootFull, relative));
        if (!full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Path escapes root: {relative}");
        RejectReparseAncestors(rootFull, full, allowMissing);
        return full;
    }

    private static void RejectReparseAncestors(string root, string full, bool allowMissing)
    {
        var current = root.TrimEnd(Path.DirectorySeparatorChar);
        var rel = Path.GetRelativePath(current, full);
        foreach (var part in rel.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            if (!File.Exists(current) && !Directory.Exists(current))
            {
                if (allowMissing) continue;
                throw new FileNotFoundException("Owned path missing", current);
            }
            var attrs = File.GetAttributes(current);
            if ((attrs & FileAttributes.ReparsePoint) != 0)
                throw new IOException($"Reparse point rejected: {current}");
        }
    }
}

internal static class Hashing
{
    internal static string Sha256(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    internal static void Verify(string path, OwnedFile file)
    {
        var info = new FileInfo(path);
        if (info.Length != file.Bytes) throw new InvalidDataException($"Size mismatch: {file.Path}");
        var actual = Sha256(path);
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual), Convert.FromHexString(file.Sha256)))
            throw new InvalidDataException($"SHA-256 mismatch: {file.Path}");
    }
}

internal sealed class EventWriter
{
    private readonly string _summary;
    private readonly string _events;
    internal string SessionId { get; }

    internal EventWriter(string installRoot, string action)
    {
        SessionId = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "-" + Guid.NewGuid().ToString("N")[..10];
        var dir = Path.Combine(installRoot, "logs", "maintenance");
        Directory.CreateDirectory(dir);
        _summary = Path.Combine(dir, "summary.jsonl");
        _events = Path.Combine(dir, "events.jsonl");
        Event(action, "session_started", true, null, null);
    }

    internal void Event(string action, string stage, bool ok, string? error = null, string? nextAction = null, object? detail = null)
    {
        var payload = new
        {
            ts = DateTimeOffset.UtcNow.ToString("O"), session_id = SessionId, action, stage,
            result = ok ? "ok" : "failed", error, next_action = nextAction, detail
        };
        Append(_events, payload);
        if (stage is "completed" or "failed") Append(_summary, payload);
    }

    private static void Append(string path, object value) =>
        File.AppendAllText(path, JsonSerializer.Serialize(value, JsonFiles.Options) + Environment.NewLine, new UTF8Encoding(false));
}

internal static partial class SecretRedactor
{
    private static readonly HashSet<string> SecretKeys = new(StringComparer.OrdinalIgnoreCase)
    { "token", "password", "secret", "api_key", "apikey", "private_key", "cookie", "cookies", "authorization", "session", "session_token", "refresh_token", "access_token" };

    [GeneratedRegex("(?i)(Bearer\\s+)[A-Za-z0-9._~+/-]+=*")]
    private static partial Regex BearerRegex();
    [GeneratedRegex("""(?i)(["']?(?:token|password|secret|api[_-]?key|cookie|authorization|session[_-]?token|access[_-]?token|refresh[_-]?token)["']?)(\s*[=:]\s*)(["']?)([^"'\s,;]+)(["']?)""")]
    private static partial Regex KeyValueRegex();
    [GeneratedRegex("(?ims)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----")]
    private static partial Regex PrivateKeyRegex();
    [GeneratedRegex("(?im)^([A-Z0-9_]*(TOKEN|PASSWORD|SECRET|API_KEY|APIKEY|PRIVATE_KEY|COOKIE)[A-Z0-9_]*=).*$")]
    private static partial Regex EnvSecretRegex();

    internal static JsonNode? Redact(JsonNode? node)
    {
        // Mutate children in place. Re-assigning a non-secret JsonNode that is
        // already parented by obj/arr throws "The node already has a parent".
        if (node is JsonObject obj)
        {
            foreach (var key in obj.Select(x => x.Key).ToList())
            {
                if (SecretKeys.Contains(key)) obj[key] = "[REDACTED]";
                else Redact(obj[key]);
            }
        }
        else if (node is JsonArray arr)
        {
            foreach (var child in arr) Redact(child);
        }
        return node;
    }

    internal static string RedactText(string text)
    {
        text = PrivateKeyRegex().Replace(text, "[REDACTED PRIVATE KEY]");
        var lines = text.Replace("\r\n", "\n").Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            try
            {
                var node = JsonNode.Parse(line);
                if (node is not null) { lines[i] = Redact(node)?.ToJsonString(JsonFiles.Options) ?? "null"; continue; }
            }
            catch { }
            line = BearerRegex().Replace(line, "$1[REDACTED]");
            line = KeyValueRegex().Replace(line, "$1$2$3[REDACTED]$5");
            line = EnvSecretRegex().Replace(line, "$1[REDACTED]");
            lines[i] = line;
        }
        return string.Join(Environment.NewLine, lines);
    }
}
