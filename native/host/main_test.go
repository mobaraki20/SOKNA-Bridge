package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveConfigPathUsesLocator(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "custom", "config.json")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(`{"port":8766,"token":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	locator := filepath.Join(root, "SOKNA", "Agent", "install-locator.json")
	if err := os.MkdirAll(filepath.Dir(locator), 0o755); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(InstallLocator{ConfigPath: target})
	if err := os.WriteFile(locator, b, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("SOKNA_AGENT_CONFIG_PATH", "")
	got, err := resolveConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != target {
		t.Fatalf("got %q want %q", got, target)
	}
}

func TestResolveConfigPathFallsBackToLegacy(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "SOKNA-Bridge-V2", "config.json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte(`{"port":8766,"token":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("SOKNA_AGENT_CONFIG_PATH", "")
	got, err := resolveConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != legacy {
		t.Fatalf("got %q want %q", got, legacy)
	}
}

func TestResolveConfigPathRejectsRelativeOverride(t *testing.T) {
	t.Setenv("SOKNA_AGENT_CONFIG_PATH", `relative\\config.json`)
	if _, err := resolveConfigPath(); err == nil {
		t.Fatal("expected relative override rejection")
	}
}
