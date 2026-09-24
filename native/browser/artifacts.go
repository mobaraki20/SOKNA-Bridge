package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func safeName(s string) string {
	s = unsafeName.ReplaceAllString(s, "_")
	s = strings.Trim(s, "._-")
	if s == "" {
		return "item"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}
func shaFile(path string) (string, int64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", 0, err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), int64(len(b)), nil
}
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o600)
}
func writeText(path, text string) error { return os.WriteFile(path, []byte(text), 0o600) }
func artifactFrom(path, base, id, kind, viewport, contentType string) (Artifact, error) {
	sha, n, err := shaFile(path)
	if err != nil {
		return Artifact{}, err
	}
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return Artifact{}, err
	}
	return Artifact{ID: id, Kind: kind, ViewportID: viewport, Path: filepath.ToSlash(rel), Bytes: n, SHA256: sha, ContentType: contentType}, nil
}
func addArtifact(dst *[]Artifact, path, base, scenario, viewport, kind, contentType string) error {
	idx := len(*dst) + 1
	raw := fmt.Sprintf("%s|%s|%03d|%s|%s", scenario, viewport, idx, kind, filepath.ToSlash(path))
	h := sha256.Sum256([]byte(raw))
	id := fmt.Sprintf("browser-%s-%03d-%s", hex.EncodeToString(h[:8]), idx, safeName(kind))
	a, err := artifactFrom(path, base, id, kind, viewport, contentType)
	if err != nil {
		return err
	}
	*dst = append(*dst, a)
	return nil
}
