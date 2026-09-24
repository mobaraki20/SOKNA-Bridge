package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type provider interface {
	Probe(context.Context, ProviderRequest) (probeResult, error)
	Acquire(context.Context, ProviderRequest, string) (probeResult, int, int64, error)
}

type localProvider struct{ managed bool }

func (p localProvider) resolve(req ProviderRequest) (string, string, error) {
	var path string
	var err error
	if p.managed {
		if strings.TrimSpace(req.Source.ManagedRoot) == "" {
			return "", "", errors.New("managed_folder requires managed_root")
		}
		path, err = resolveManagedChild(req.Source.ManagedRoot, req.Source.RelativePath, true)
		if err != nil {
			return "", "", err
		}
	} else {
		path, err = cleanAbs(req.Source.Path)
		if err != nil {
			return "", "", err
		}
		if err = assertExistingPathNoSymlink(path); err != nil {
			return "", "", err
		}
	}
	st, err := os.Lstat(path)
	if err != nil {
		return "", "", err
	}
	if !st.Mode().IsRegular() {
		return "", "", errors.New("source must be regular file")
	}
	ref := path
	if p.managed {
		ref = "managed://" + safeFileName(filepath.Base(req.Source.ManagedRoot)) + "/" + filepath.ToSlash(filepath.Clean(req.Source.RelativePath))
	}
	return path, ref, nil
}

func (p localProvider) Probe(ctx context.Context, req ProviderRequest) (probeResult, error) {
	path, ref, err := p.resolve(req)
	if err != nil {
		return probeResult{}, err
	}
	st, _ := os.Stat(path)
	return probeResult{SourceRef: ref, ResolvedRef: ref, FileName: safeFileName(filepath.Base(path)), Size: st.Size(), ContentType: guessContentType(path)}, nil
}

func (p localProvider) Acquire(ctx context.Context, req ProviderRequest, partial string) (probeResult, int, int64, error) {
	pr, err := p.Probe(ctx, req)
	if err != nil {
		return pr, 0, 0, err
	}
	path, _, _ := p.resolve(req)
	in, err := os.Open(path)
	if err != nil {
		return pr, 0, 0, err
	}
	defer in.Close()
	out, err := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return pr, 0, 0, err
	}
	n, copyErr := io.Copy(out, io.LimitReader(in, req.MaxBytes+1))
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr != nil {
		return pr, 1, 0, copyErr
	}
	if syncErr != nil {
		return pr, 1, 0, syncErr
	}
	if closeErr != nil {
		return pr, 1, 0, closeErr
	}
	if n <= 0 || n > req.MaxBytes {
		return pr, 1, 0, errors.New("artifact size outside policy")
	}
	if pr.Size != n {
		return pr, 1, 0, errors.New("source changed during acquisition")
	}
	return pr, 1, 0, nil
}

type remoteProvider struct{ e *engine }

func (p remoteProvider) Probe(ctx context.Context, req ProviderRequest) (probeResult, error) {
	return p.e.probeHTTP(ctx, req)
}

func (p remoteProvider) Acquire(ctx context.Context, req ProviderRequest, partial string) (probeResult, int, int64, error) {
	u, ref, err := p.e.resolveRemoteURL(ctx, req)
	if err != nil {
		return probeResult{}, 0, 0, err
	}
	size, attempts, resumed, name, ct, err := p.e.acquireHTTP(ctx, req, partial, u)
	if err != nil {
		return probeResult{SourceRef: ref, ResolvedRef: redactedURL(u), FileName: name, ContentType: ct}, attempts, resumed, err
	}
	return probeResult{SourceRef: ref, ResolvedRef: redactedURL(u), FileName: name, Size: size, ContentType: ct}, attempts, resumed, nil
}

func guessContentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".zip":
		return "application/zip"
	case ".json":
		return "application/json"
	case ".txt", ".log":
		return "text/plain"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	}
	return "application/octet-stream"
}

func providerFor(req ProviderRequest, e *engine) (provider, error) {
	switch req.Provider {
	case "local_file":
		return localProvider{}, nil
	case "managed_folder":
		return localProvider{managed: true}, nil
	case "https", "github_release_asset", "object_storage", "google_drive", "onedrive":
		return remoteProvider{e: e}, nil
	default:
		return nil, fmt.Errorf("unsupported provider: %s", req.Provider)
	}
}

func providerBoundary(provider string) string {
	switch provider {
	case "google_drive", "onedrive":
		return "external-plugin-or-presigned-url"
	case "github_release_asset":
		return "github-release-https"
	case "object_storage":
		return "https-object-storage"
	default:
		return "core"
	}
}

func prepareStaging(req ProviderRequest) (string, string, error) {
	root, err := cleanAbs(req.ArtifactRoot)
	if err != nil {
		return "", "", err
	}
	if err = os.MkdirAll(root, 0755); err != nil {
		return "", "", err
	}
	if err = assertExistingPathNoSymlink(root); err != nil {
		return "", "", err
	}
	staging := filepath.Join(root, "staging")
	if err = os.MkdirAll(staging, 0755); err != nil {
		return "", "", err
	}
	if err = assertExistingPathNoSymlink(staging); err != nil {
		return "", "", err
	}
	partial, err := resolveManagedChild(root, filepath.Join("staging", ".provider-"+req.ArtifactID+".partial"), false)
	if err != nil {
		return "", "", err
	}
	return partial, partial + ".state.json", nil
}

type partialState struct {
	Fingerprint    string `json:"fingerprint"`
	Provider       string `json:"provider"`
	SourceRef      string `json:"source_ref"`
	ExpectedSHA256 string `json:"expected_sha256"`
}

func ensurePartialState(partial, sidecar string, req ProviderRequest, ref string) error {
	fp := sourceFingerprint(req.Provider, ref, req.ExpectedSHA256)
	var old partialState
	if b, err := os.ReadFile(sidecar); err == nil {
		if json.Unmarshal(b, &old) != nil || old.Fingerprint != fp {
			_ = os.Remove(partial)
			_ = os.Remove(sidecar)
		}
	} else if _, err := os.Stat(partial); err == nil {
		_ = os.Remove(partial)
	}
	st := partialState{Fingerprint: fp, Provider: req.Provider, SourceRef: ref, ExpectedSHA256: req.ExpectedSHA256}
	b, _ := json.Marshal(st)
	return os.WriteFile(sidecar, b, 0600)
}

func validateRequest(req *ProviderRequest) error {
	if req.Schema != "" && req.Schema != requestSchema {
		return errors.New("unsupported request schema")
	}
	if req.Operation != "probe" && req.Operation != "acquire" && req.Operation != "verify" {
		return errors.New("operation must be probe, acquire or verify")
	}
	if req.Operation != "verify" && !validID(req.ArtifactID) {
		return errors.New("invalid artifact_id")
	}
	sha, err := normalizeSHA(req.ExpectedSHA256)
	if err != nil {
		return err
	}
	req.ExpectedSHA256 = sha
	if req.MaxBytes <= 0 {
		req.MaxBytes = 512 << 20
	}
	if req.MaxBytes > 2<<30 {
		return errors.New("max_bytes exceeds hard safety ceiling")
	}
	if req.Operation == "acquire" && req.Provider != "local_file" && req.Provider != "managed_folder" && req.ExpectedSHA256 == "" {
		return errors.New("remote provider requires expected_sha256")
	}
	if (req.Provider == "google_drive" || req.Provider == "onedrive") && strings.TrimSpace(req.Source.URLEnv) == "" {
		return errors.New("cloud provider requires url_env from external plugin/presigned boundary")
	}
	return nil
}
