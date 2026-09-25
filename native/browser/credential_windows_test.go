//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCredentialStoreRoundTripUsesProtectedBlob(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	id := "ci-test-admin"
	username := "qa@example.test"
	secret := "SOKNA-CI-secret-9f4b7d"
	if err := storeCredential(id, username, secret); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "SOKNA", "Bridge", "credentials", id+".bin")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secret) || strings.Contains(string(raw), username) {
		t.Fatal("credential blob contains plaintext")
	}
	rec, err := loadCredential(id)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Username != username || rec.Secret != secret {
		t.Fatalf("roundtrip mismatch: %#v", rec)
	}
	items, err := listCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != id || items[0].Username != username {
		t.Fatalf("list mismatch: %#v", items)
	}
	if got, err := credentialValue(id, "username"); err != nil || got != username {
		t.Fatalf("username resolve failed: %q %v", got, err)
	}
	if got, err := credentialValue(id, "secret"); err != nil || got != secret {
		t.Fatalf("secret resolve failed: %q %v", got, err)
	}
	if err := deleteCredential(id); err != nil {
		t.Fatal(err)
	}
	if _, err := loadCredential(id); err == nil {
		t.Fatal("deleted credential still readable")
	}
}

func TestRecipeCredentialReferenceValidation(t *testing.T) {
	r := Recipe{
		Schema: recipeSchema,
		ScenarioID: "credential-login",
		URL: "https://example.test/login",
		Viewports: []Viewport{{ID: "desktop", Width: 1280, Height: 720, DPR: 1}},
		Actions: []Action{
			{Op: "type", Selector: "#user", CredentialRef: "test-admin", CredentialField: "username"},
			{Op: "type", Selector: "#pass", CredentialRef: "test-admin", CredentialField: "secret"},
		},
		Captures: CaptureConfig{Screenshot: true},
	}
	if err := validateRecipe(&r); err != nil {
		t.Fatal(err)
	}
	r.Actions[1].Value = "plaintext-must-not-mix"
	if err := validateRecipe(&r); err == nil {
		t.Fatal("credential_ref mixed with plaintext value was accepted")
	}
}
