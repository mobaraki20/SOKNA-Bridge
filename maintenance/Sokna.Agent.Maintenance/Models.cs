using System.Text.Json.Serialization;

namespace Sokna.Agent.Maintenance;

internal sealed record OwnedFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("bytes")] long Bytes,
    [property: JsonPropertyName("owner")] string Owner);

internal sealed record InstallManifest(
    [property: JsonPropertyName("schema")] string Schema,
    [property: JsonPropertyName("product_version")] string ProductVersion,
    [property: JsonPropertyName("launcher_version")] string LauncherVersion,
    [property: JsonPropertyName("source_commit")] string SourceCommit,
    [property: JsonPropertyName("files")] List<OwnedFile> Files);

internal sealed class RuntimeOwnershipState
{
    [JsonPropertyName("schema")] public string Schema { get; set; } = "sokna-agent-runtime-ownership-v1";
    [JsonPropertyName("install_root")] public string InstallRoot { get; set; } = "";
    [JsonPropertyName("active_version")] public string ActiveVersion { get; set; } = "";
    [JsonPropertyName("previous_version")] public string PreviousVersion { get; set; } = "";
    [JsonPropertyName("launcher_version")] public string LauncherVersion { get; set; } = "";
    [JsonPropertyName("agent_pid")] public int? AgentPid { get; set; }
    [JsonPropertyName("config_path")] public string ConfigPath { get; set; } = "";
    [JsonPropertyName("artifact_root")] public string ArtifactRoot { get; set; } = "";
    [JsonPropertyName("activation_tx_id")] public string? ActivationTxId { get; set; }
    [JsonPropertyName("last_health")] public string? LastHealth { get; set; }
    [JsonPropertyName("last_rollback")] public string? LastRollback { get; set; }
    [JsonPropertyName("source_artifact_hash")] public string? SourceArtifactHash { get; set; }
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; set; } = DateTimeOffset.UtcNow.ToString("O");
}

internal sealed record HealthResult(bool Ok, string Version, bool Ping, bool Capabilities, bool PidAlive, string? Error, IReadOnlyDictionary<string, bool>? Subsystems = null);
internal sealed record OperationResult(bool Ok, string Action, string SessionId, object? Data = null, string? Error = null, string? NextAction = null);
