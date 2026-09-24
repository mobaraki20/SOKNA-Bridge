package main

import "time"

const requestSchema = "sokna-artifact-provider-request-v1"
const resultSchema = "sokna-artifact-provider-result-v1"

type ProviderRequest struct {
	Schema         string          `json:"schema"`
	Operation      string          `json:"operation"`
	Provider       string          `json:"provider"`
	ArtifactRoot   string          `json:"artifact_root"`
	ArtifactID     string          `json:"artifact_id"`
	ManagedPath    string          `json:"managed_path,omitempty"`
	Source         ProviderSource  `json:"source"`
	ExpectedSHA256 string          `json:"expected_sha256,omitempty"`
	MaxBytes       int64           `json:"max_bytes,omitempty"`
	Retries        int             `json:"retries,omitempty"`
	BackoffMS      int             `json:"backoff_ms,omitempty"`
	TimeoutSeconds int             `json:"timeout_seconds,omitempty"`
	Signature      SignaturePolicy `json:"signature,omitempty"`
	Workspace      string          `json:"workspace,omitempty"`
	JobID          string          `json:"job_id,omitempty"`
}

type ProviderSource struct {
	Path                   string   `json:"path,omitempty"`
	ManagedRoot            string   `json:"managed_root,omitempty"`
	RelativePath           string   `json:"relative_path,omitempty"`
	URL                    string   `json:"url,omitempty"`
	URLEnv                 string   `json:"url_env,omitempty"`
	CredentialEnv          string   `json:"credential_env,omitempty"`
	Repository             string   `json:"repository,omitempty"`
	Tag                    string   `json:"tag,omitempty"`
	Asset                  string   `json:"asset,omitempty"`
	AllowedRedirectOrigins []string `json:"allowed_redirect_origins,omitempty"`
}

type SignaturePolicy struct {
	Required     bool   `json:"required,omitempty"`
	Algorithm    string `json:"algorithm,omitempty"`
	PublicKeyB64 string `json:"public_key_b64,omitempty"`
	PublicKeyEnv string `json:"public_key_env,omitempty"`
	SignatureB64 string `json:"signature_b64,omitempty"`
	SignatureEnv string `json:"signature_env,omitempty"`
}

type ProviderResult struct {
	OK               bool      `json:"ok"`
	Schema           string    `json:"schema"`
	Operation        string    `json:"operation"`
	Provider         string    `json:"provider"`
	ArtifactID       string    `json:"artifact_id,omitempty"`
	SourceRef        string    `json:"source_ref,omitempty"`
	ResolvedRef      string    `json:"resolved_ref,omitempty"`
	StagingPath      string    `json:"staging_path,omitempty"`
	ManagedPath      string    `json:"managed_path,omitempty"`
	FileName         string    `json:"file_name,omitempty"`
	Size             int64     `json:"size,omitempty"`
	SHA256           string    `json:"sha256,omitempty"`
	ContentType      string    `json:"content_type,omitempty"`
	ResumedBytes     int64     `json:"resumed_bytes,omitempty"`
	Attempts         int       `json:"attempts,omitempty"`
	Signature        string    `json:"signature,omitempty"`
	SignatureOK      bool      `json:"signature_ok,omitempty"`
	Workspace        string    `json:"workspace,omitempty"`
	JobID            string    `json:"job_id,omitempty"`
	VerifiedAt       time.Time `json:"verified_at,omitempty"`
	ProviderBoundary string    `json:"provider_boundary,omitempty"`
}

type probeResult struct {
	SourceRef   string
	ResolvedRef string
	FileName    string
	Size        int64
	ContentType string
	RemoteURL   string
}
