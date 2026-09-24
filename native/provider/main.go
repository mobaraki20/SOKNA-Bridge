package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func run(ctx context.Context, req ProviderRequest, e *engine) (ProviderResult, error) {
	if err := validateRequest(&req); err != nil {
		return ProviderResult{}, err
	}
	if req.Operation == "verify" {
		return runVerify(req)
	}
	p, err := providerFor(req, e)
	if err != nil {
		return ProviderResult{}, err
	}
	pr, err := p.Probe(ctx, req)
	if err != nil {
		return ProviderResult{}, err
	}
	base := ProviderResult{OK: true, Schema: resultSchema, Operation: req.Operation, Provider: req.Provider, ArtifactID: req.ArtifactID, SourceRef: pr.SourceRef, ResolvedRef: pr.ResolvedRef, FileName: pr.FileName, Size: pr.Size, ContentType: pr.ContentType, Workspace: req.Workspace, JobID: req.JobID, ProviderBoundary: providerBoundary(req.Provider)}
	if req.Operation == "probe" {
		return base, nil
	}
	if pr.Size > req.MaxBytes && pr.Size >= 0 {
		return ProviderResult{}, errors.New("artifact exceeds size policy")
	}
	partial, sidecar, err := prepareStaging(req)
	if err != nil {
		return ProviderResult{}, err
	}
	if err = ensurePartialState(partial, sidecar, req, pr.SourceRef); err != nil {
		return ProviderResult{}, err
	}
	acq, attempts, resumed, err := p.Acquire(ctx, req, partial)
	if err != nil {
		return ProviderResult{}, err
	}
	if acq.SourceRef != "" {
		base.SourceRef = acq.SourceRef
	}
	if acq.ResolvedRef != "" {
		base.ResolvedRef = acq.ResolvedRef
	}
	if acq.FileName != "" {
		base.FileName = acq.FileName
	}
	if acq.ContentType != "" {
		base.ContentType = acq.ContentType
	}
	sha, size, sig, sigOK, err := verifyFile(partial, req.ExpectedSHA256, req.MaxBytes, req.Signature)
	if err != nil {
		// A transport interruption keeps the partial for resume, but a completed file
		// that fails integrity/signature must never poison the next attempt.
		_ = os.Remove(partial)
		_ = os.Remove(sidecar)
		return ProviderResult{}, err
	}
	verifiedName := "provider-" + req.ArtifactID + "--" + safeFileName(base.FileName)
	verified, err := resolveManagedChild(req.ArtifactRoot, filepath.Join("staging", verifiedName), false)
	if err != nil {
		return ProviderResult{}, err
	}
	if _, err = os.Lstat(verified); err == nil {
		return ProviderResult{}, errors.New("verified staging destination already exists")
	}
	if err = os.Rename(partial, verified); err != nil {
		return ProviderResult{}, err
	}
	_ = os.Remove(sidecar)
	rel, _ := filepath.Rel(req.ArtifactRoot, verified)
	base.Operation = "acquire"
	base.StagingPath = verified
	base.ManagedPath = filepath.ToSlash(rel)
	base.Size = size
	base.SHA256 = sha
	base.ResumedBytes = resumed
	base.Attempts = attempts
	base.Signature = sig
	base.SignatureOK = sigOK
	base.VerifiedAt = verifiedAt()
	return base, nil
}

func runVerify(req ProviderRequest) (ProviderResult, error) {
	if strings.TrimSpace(req.ArtifactRoot) == "" || strings.TrimSpace(req.ManagedPath) == "" {
		return ProviderResult{}, errors.New("verify requires artifact_root and managed_path")
	}
	path, err := resolveManagedChild(req.ArtifactRoot, req.ManagedPath, true)
	if err != nil {
		return ProviderResult{}, err
	}
	st, err := os.Stat(path)
	if err != nil || !st.Mode().IsRegular() {
		return ProviderResult{}, errors.New("verify target must be regular managed file")
	}
	sha, size, sig, sigOK, err := verifyFile(path, req.ExpectedSHA256, req.MaxBytes, req.Signature)
	if err != nil {
		return ProviderResult{}, err
	}
	return ProviderResult{OK: true, Schema: resultSchema, Operation: "verify", Provider: req.Provider, ArtifactID: req.ArtifactID, ManagedPath: filepath.ToSlash(filepath.Clean(req.ManagedPath)), Size: size, SHA256: sha, Signature: sig, SignatureOK: sigOK, VerifiedAt: verifiedAt()}, nil
}

func main() {
	dec := json.NewDecoder(os.Stdin)
	dec.DisallowUnknownFields()
	var req ProviderRequest
	if err := dec.Decode(&req); err != nil {
		emitError("invalid_request", err)
		os.Exit(2)
	}
	res, err := run(context.Background(), req, newEngine())
	if err != nil {
		emitError("provider_failed", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(res)
}

func emitError(code string, err error) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "schema": resultSchema, "error": code, "message": redactErrorMessage(err.Error())})
}
