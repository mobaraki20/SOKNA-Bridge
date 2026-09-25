package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const credentialSchema = "sokna-browser-credential-v1"

type CredentialRecord struct {
	Schema    string `json:"schema"`
	ID        string `json:"id"`
	Username  string `json:"username,omitempty"`
	Secret    string `json:"secret"`
	UpdatedAt string `json:"updated_at"`
}

type CredentialSummary struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
}

func credentialDirectory() (string, error) {
	root := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if root == "" {
		return "", errors.New("LOCALAPPDATA not available")
	}
	return filepath.Join(root, "SOKNA", "Bridge", "credentials"), nil
}

func validateCredentialID(id string) error {
	if !safeID.MatchString(id) {
		return errors.New("credential id must match [A-Za-z0-9._-]{1,100}")
	}
	return nil
}

func credentialPath(id string) (string, error) {
	if err := validateCredentialID(id); err != nil {
		return "", err
	}
	dir, err := credentialDirectory()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, id+".bin"), nil
}

func replaceCredentialFile(path string, protected []byte) error {
	tmp := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	backup := fmt.Sprintf("%s.bak.%d", path, os.Getpid())
	_ = os.Remove(tmp)
	_ = os.Remove(backup)
	if err := os.WriteFile(tmp, protected, 0o600); err != nil {
		return err
	}
	defer os.Remove(tmp)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return os.Rename(tmp, path)
	} else if err != nil {
		return err
	}
	// Windows os.Rename does not reliably replace an existing destination.
	// Preserve the old DPAPI blob until the new one has been activated.
	if err := os.Rename(path, backup); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Rename(backup, path)
		return err
	}
	_ = os.Remove(backup)
	return nil
}

func storeCredential(id, username, secret string) error {
	if err := validateCredentialID(id); err != nil {
		return err
	}
	if len(username) > 512 {
		return errors.New("credential username too long")
	}
	if secret == "" || len(secret) > 16384 {
		return errors.New("credential secret must be 1..16384 bytes")
	}
	rec := CredentialRecord{Schema: credentialSchema, ID: id, Username: username, Secret: secret, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	protected, err := protectCredentialBytes(raw)
	if err != nil {
		return fmt.Errorf("credential protection failed: %w", err)
	}
	path, err := credentialPath(id)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return replaceCredentialFile(path, protected)
}

func loadCredential(id string) (CredentialRecord, error) {
	path, err := credentialPath(id)
	if err != nil {
		return CredentialRecord{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CredentialRecord{}, fmt.Errorf("credential not found: %s", id)
		}
		return CredentialRecord{}, err
	}
	if len(raw) == 0 || len(raw) > 1<<20 {
		return CredentialRecord{}, errors.New("credential blob size invalid")
	}
	plain, err := unprotectCredentialBytes(raw)
	if err != nil {
		return CredentialRecord{}, fmt.Errorf("credential unprotect failed: %w", err)
	}
	var rec CredentialRecord
	if err := json.Unmarshal(plain, &rec); err != nil {
		return CredentialRecord{}, errors.New("credential record invalid")
	}
	if rec.Schema != credentialSchema || rec.ID != id || rec.Secret == "" {
		return CredentialRecord{}, errors.New("credential record contract invalid")
	}
	return rec, nil
}

func deleteCredential(id string) error {
	path, err := credentialPath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func listCredentials() ([]CredentialSummary, error) {
	dir, err := credentialDirectory()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []CredentialSummary{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []CredentialSummary{}
	for _, entry := range entries {
		if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".bin" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if validateCredentialID(id) != nil {
			continue
		}
		rec, err := loadCredential(id)
		if err != nil {
			continue
		}
		out = append(out, CredentialSummary{ID: rec.ID, Username: rec.Username})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func credentialValue(id, field string) (string, error) {
	rec, err := loadCredential(id)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(strings.TrimSpace(field)) {
	case "username":
		return rec.Username, nil
	case "secret", "password":
		return rec.Secret, nil
	default:
		return "", errors.New("credential_field must be username or secret")
	}
}
