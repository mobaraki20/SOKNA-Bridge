package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var artifactManagedDirs = []string{"incoming", "staging", "accepted", "failed", "cache", "browser", "logs"}

type ArtifactRetentionPolicy struct {
	Incoming time.Duration
	Staging  time.Duration
	Accepted time.Duration
	Failed   time.Duration
	Cache    time.Duration
	Browser  time.Duration
}

type ArtifactPolicy struct {
	MaxRootBytes     int64
	MaxArtifactBytes int64
	Retention        ArtifactRetentionPolicy
}

func DefaultArtifactPolicy() ArtifactPolicy {
	return ArtifactPolicy{
		MaxRootBytes:     10 * 1024 * 1024 * 1024,
		MaxArtifactBytes: 512 * 1024 * 1024,
		Retention: ArtifactRetentionPolicy{
			Incoming: 7 * 24 * time.Hour,
			Staging:  24 * time.Hour,
			Accepted: 30 * 24 * time.Hour,
			Failed:   14 * 24 * time.Hour,
			Cache:    7 * 24 * time.Hour,
			Browser:  30 * 24 * time.Hour,
		},
	}
}

type ArtifactManager struct {
	Root   string
	Policy ArtifactPolicy
	Now    func() time.Time
}

type ArtifactImportRecord struct {
	ArtifactID  string    `json:"artifact_id"`
	Provider    string    `json:"provider"`
	SourceRef   string    `json:"source_ref"`
	LocalPath   string    `json:"local_path"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	ContentType string    `json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
	State       string    `json:"state"`
}

type ArtifactRootStatus struct {
	Root           string           `json:"root"`
	UsageBytes     int64            `json:"usage_bytes"`
	QuotaBytes     int64            `json:"quota_bytes"`
	RemainingBytes int64            `json:"remaining_bytes"`
	Directories    map[string]int64 `json:"directories"`
}

type ArtifactCleanupResult struct {
	DryRun         bool     `json:"dry_run"`
	Removed        []string `json:"removed"`
	ReclaimedBytes int64    `json:"reclaimed_bytes"`
}

func NewArtifactManager(root string, policy ArtifactPolicy) (*ArtifactManager, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("artifact root is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("artifact root: %w", err)
	}
	if policy.MaxRootBytes <= 0 || policy.MaxArtifactBytes <= 0 || policy.MaxArtifactBytes > policy.MaxRootBytes {
		return nil, errors.New("invalid artifact quota policy")
	}
	m := &ArtifactManager{Root: filepath.Clean(abs), Policy: policy, Now: time.Now}
	if err := m.initialize(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *ArtifactManager) initialize() error {
	if err := os.MkdirAll(m.Root, 0755); err != nil {
		return fmt.Errorf("create artifact root: %w", err)
	}
	if err := assertNoSymlink(m.Root); err != nil {
		return err
	}
	for _, name := range artifactManagedDirs {
		p := filepath.Join(m.Root, name)
		if err := os.MkdirAll(p, 0755); err != nil {
			return fmt.Errorf("create managed directory %s: %w", name, err)
		}
		if err := assertNoSymlink(p); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Join(m.Root, "logs", "artifact-metadata"), 0755); err != nil {
		return err
	}
	return nil
}

func assertNoSymlink(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("artifact reparse/symlink blocked: %s", path)
	}
	return nil
}

func (m *ArtifactManager) ResolveManagedPath(rel string, allowMissing bool) (string, error) {
	if filepath.IsAbs(rel) {
		return "", errors.New("managed path must be relative")
	}
	clean := filepath.Clean(rel)
	if clean == "." || clean == "" {
		return m.Root, nil
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("artifact path escapes root")
	}
	full := filepath.Join(m.Root, clean)
	relative, err := filepath.Rel(m.Root, full)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("artifact path escapes root")
	}
	current := m.Root
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if statErr != nil {
			if os.IsNotExist(statErr) && allowMissing {
				return full, nil
			}
			return "", statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("artifact reparse/symlink blocked: %s", current)
		}
	}
	return full, nil
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func sanitizeArtifactName(name string) string {
	name = filepath.Base(name)
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r) {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), ".")
	if out == "" {
		out = "artifact.bin"
	}
	if len(out) > 120 {
		out = out[:120]
	}
	return out
}

func (m *ArtifactManager) ImportLocal(source, artifactID, expectedSHA, contentType string) (*ArtifactImportRecord, error) {
	if !safeID(artifactID) {
		return nil, errors.New("invalid artifact id")
	}
	src, err := filepath.Abs(source)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(src)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("source must be a regular non-symlink file")
	}
	if info.Size() <= 0 || info.Size() > m.Policy.MaxArtifactBytes {
		return nil, errors.New("artifact size outside policy")
	}
	status, err := m.Status()
	if err != nil {
		return nil, err
	}
	if status.UsageBytes+info.Size() > m.Policy.MaxRootBytes {
		_ = m.appendAudit(map[string]any{"action": "artifact.import.local", "phase": "quota_rejected", "ok": false, "artifact_id": artifactID, "size": info.Size()})
		return nil, errors.New("artifact root quota exceeded")
	}

	incoming, err := m.ResolveManagedPath("incoming", false)
	if err != nil {
		return nil, err
	}
	staging, err := m.ResolveManagedPath("staging", false)
	if err != nil {
		return nil, err
	}
	finalName := artifactID + "--" + sanitizeArtifactName(filepath.Base(src))
	finalPath := filepath.Join(incoming, finalName)
	if _, err := os.Lstat(finalPath); err == nil {
		return nil, errors.New("artifact destination already exists")
	}
	tmpPath := filepath.Join(staging, ".partial-"+artifactID+"-"+fmt.Sprint(m.Now().UnixNano()))
	if _, err := m.ResolveManagedPath(filepath.Join("staging", filepath.Base(tmpPath)), true); err != nil {
		return nil, err
	}

	in, err := os.Open(src)
	if err != nil {
		return nil, err
	}
	defer in.Close()
	out, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return nil, err
	}
	copyOK := false
	defer func() {
		_ = out.Close()
		if !copyOK {
			_ = os.Remove(tmpPath)
		}
	}()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), in)
	if err != nil {
		return nil, err
	}
	if err := out.Sync(); err != nil {
		return nil, err
	}
	if err := out.Close(); err != nil {
		return nil, err
	}
	gotSHA := hex.EncodeToString(h.Sum(nil))
	if expectedSHA != "" && !strings.EqualFold(expectedSHA, gotSHA) {
		_ = m.appendAudit(map[string]any{"action": "artifact.import.local", "phase": "hash_rejected", "ok": false, "artifact_id": artifactID, "size": n, "sha256": gotSHA})
		return nil, errors.New("artifact sha256 mismatch")
	}
	if n != info.Size() {
		return nil, errors.New("artifact source changed during import")
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return nil, err
	}
	copyOK = true

	rel, _ := filepath.Rel(m.Root, finalPath)
	rec := &ArtifactImportRecord{
		ArtifactID:  artifactID,
		Provider:    "local_file",
		SourceRef:   src,
		LocalPath:   filepath.ToSlash(rel),
		Size:        n,
		SHA256:      gotSHA,
		ContentType: contentType,
		CreatedAt:   m.Now().UTC(),
		State:       "incoming",
	}
	if rec.ContentType == "" {
		if strings.EqualFold(filepath.Ext(src), ".zip") {
			rec.ContentType = "application/zip"
		} else {
			rec.ContentType = "application/octet-stream"
		}
	}
	if err := m.writeMetadata(rec); err != nil {
		_ = os.Remove(finalPath)
		return nil, err
	}
	if err := m.appendAudit(map[string]any{"action": "artifact.import.local", "phase": "imported", "ok": true, "artifact_id": artifactID, "provider": rec.Provider, "source_ref": rec.SourceRef, "path": rec.LocalPath, "size": rec.Size, "sha256": rec.SHA256, "content_type": rec.ContentType}); err != nil {
		_ = os.Remove(finalPath)
		_ = os.Remove(m.metadataPath(artifactID))
		return nil, err
	}
	return rec, nil
}

func (m *ArtifactManager) metadataPath(id string) string {
	return filepath.Join(m.Root, "logs", "artifact-metadata", id+".json")
}

func (m *ArtifactManager) writeMetadata(rec *ArtifactImportRecord) error {
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	p := m.metadataPath(rec.ArtifactID)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (m *ArtifactManager) appendAudit(v map[string]any) error {
	v["ts"] = m.Now().UTC().Format(time.RFC3339Nano)
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	p := filepath.Join(m.Root, "logs", "artifact-events.jsonl")
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	if _, err := w.Write(append(b, '\n')); err != nil {
		return err
	}
	return w.Flush()
}

func treeBytes(root string) (int64, error) {
	var total int64
	stack := []string{root}
	for len(stack) > 0 {
		dir := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		entries, err := os.ReadDir(dir)
		if err != nil {
			return 0, err
		}
		for _, entry := range entries {
			p := filepath.Join(dir, entry.Name())
			info, err := os.Lstat(p)
			if err != nil {
				return 0, err
			}
			if info.Mode()&os.ModeSymlink != 0 {
				return 0, fmt.Errorf("artifact reparse/symlink blocked: %s", p)
			}
			if info.IsDir() {
				stack = append(stack, p)
			} else if info.Mode().IsRegular() {
				total += info.Size()
			}
		}
	}
	return total, nil
}

func (m *ArtifactManager) Status() (*ArtifactRootStatus, error) {
	out := &ArtifactRootStatus{Root: m.Root, QuotaBytes: m.Policy.MaxRootBytes, Directories: map[string]int64{}}
	for _, name := range artifactManagedDirs {
		p, err := m.ResolveManagedPath(name, false)
		if err != nil {
			return nil, err
		}
		n, err := treeBytes(p)
		if err != nil {
			return nil, err
		}
		out.Directories[name] = n
		out.UsageBytes += n
	}
	out.RemainingBytes = out.QuotaBytes - out.UsageBytes
	if out.RemainingBytes < 0 {
		out.RemainingBytes = 0
	}
	return out, nil
}

func (m *ArtifactManager) Cleanup(dryRun bool) (*ArtifactCleanupResult, error) {
	now := m.Now()
	retention := map[string]time.Duration{
		"incoming": m.Policy.Retention.Incoming,
		"staging":  m.Policy.Retention.Staging,
		"accepted": m.Policy.Retention.Accepted,
		"failed":   m.Policy.Retention.Failed,
		"cache":    m.Policy.Retention.Cache,
		"browser":  m.Policy.Retention.Browser,
	}
	result := &ArtifactCleanupResult{DryRun: dryRun, Removed: []string{}}
	names := make([]string, 0, len(retention))
	for name := range retention {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		base, err := m.ResolveManagedPath(name, false)
		if err != nil {
			return nil, err
		}
		entries, err := os.ReadDir(base)
		if err != nil {
			return nil, err
		}
		cutoff := now.Add(-retention[name])
		for _, entry := range entries {
			p := filepath.Join(base, entry.Name())
			info, err := os.Lstat(p)
			if err != nil {
				return nil, err
			}
			if info.Mode()&os.ModeSymlink != 0 {
				return nil, fmt.Errorf("artifact reparse/symlink blocked: %s", p)
			}
			if !info.ModTime().Before(cutoff) {
				continue
			}
			rel, _ := filepath.Rel(m.Root, p)
			bytes := info.Size()
			if info.IsDir() {
				bytes, err = treeBytes(p)
				if err != nil {
					return nil, err
				}
			}
			result.Removed = append(result.Removed, filepath.ToSlash(rel))
			result.ReclaimedBytes += bytes
			if !dryRun {
				if info.IsDir() {
					if err := os.RemoveAll(p); err != nil {
						return nil, err
					}
				} else if err := os.Remove(p); err != nil {
					return nil, err
				}
			}
		}
	}
	if err := m.appendAudit(map[string]any{"action": "artifact.cleanup", "phase": "completed", "ok": true, "dry_run": dryRun, "removed": len(result.Removed), "reclaimed_bytes": result.ReclaimedBytes}); err != nil {
		return nil, err
	}
	return result, nil
}
