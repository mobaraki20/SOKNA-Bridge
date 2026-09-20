package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormRemote(t *testing.T) {
	cases := map[string]string{
		"https://github.com/mobaraki20/SoknaCafe.git": "mobaraki20/soknacafe",
		"git@github.com:mobaraki20/SOKNA-Bridge.git":  "mobaraki20/sokna-bridge",
	}
	for in, want := range cases {
		if got := normRemote(in); got != want {
			t.Fatalf("%q => %q want %q", in, got, want)
		}
	}
}
func TestRemoteOKGeneric(t *testing.T) {
	if !remoteOK("https://github.com/mobaraki20/SOKNA-Bridge.git", bridgeRepo) {
		t.Fatal("bridge remote should match")
	}
	if remoteOK("https://github.com/other/SOKNA-Bridge.git", bridgeRepo) {
		t.Fatal("foreign remote accepted")
	}
}
func TestPayloadAndManifest(t *testing.T) {
	d := t.TempDir()
	if err := copyPayload(d); err != nil {
		t.Fatal(err)
	}
	for _, r := range []string{"agent.ps1", "extension/manifest.json", "extension/background.js", "extension/content.js", "extension/popup.html", "extension/popup.js", "start-agent-visible.cmd", "uninstall.cmd"} {
		if _, err := os.Stat(filepath.Join(d, filepath.FromSlash(r))); err != nil {
			t.Fatalf("missing %s: %v", r, err)
		}
	}
	if err := manifestOK(filepath.Join(d, "extension", "manifest.json")); err != nil {
		t.Fatal(err)
	}
}
func TestManifestManualOnly(t *testing.T) {
	d := t.TempDir()
	_ = copyPayload(d)
	raw, _ := os.ReadFile(filepath.Join(d, "extension", "manifest.json"))
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["content_scripts"]; ok {
		t.Fatal("content_scripts must not auto-inject")
	}
	perms := m["permissions"].([]any)
	have := map[string]bool{}
	for _, x := range perms {
		have[x.(string)] = true
	}
	if !have["activeTab"] || !have["scripting"] {
		t.Fatalf("manual permissions missing: %v", perms)
	}
}
func TestAgentWorkspaceProtectionMarkers(t *testing.T) {
	b, err := payload.ReadFile("payload/agent.ps1")
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	required := []string{"WORKSPACE_READ_ONLY", "default_workspace", "write_enabled", "AssertFreshWritable", "workspace.list", "github.repo.create"}
	for _, x := range required {
		if !strings.Contains(s, x) {
			t.Fatalf("agent missing marker %q", x)
		}
	}
}
func TestAgentNoLegacySingleRoot(t *testing.T) {
	b, _ := payload.ReadFile("payload/agent.ps1")
	s := string(b)
	if strings.Contains(s, "function RepoRoot") {
		t.Fatal("legacy single RepoRoot remains")
	}
	if strings.Contains(s, "$script:cfg.repo_root") {
		t.Fatal("legacy repo_root usage remains")
	}
}
