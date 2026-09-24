package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newAdvancedManager(t *testing.T) (*WorkspaceManager, string) {
	t.Helper()
	base := t.TempDir()
	state := filepath.Join(base, "state")
	if err := os.MkdirAll(state, 0755); err != nil {
		t.Fatal(err)
	}
	m, err := NewWorkspaceManager(filepath.Join(state, "workspaces.json"), filepath.Join(state, "audit.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(filepath.Join(root, "secret"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.RegisterPersistentLocal("main", "Main", root, []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}, {Path: "secret", Access: WorkspaceDeny}}, []string{"git", "node", "remote.exec"}); err != nil {
		t.Fatal(err)
	}
	return m, root
}

func TestGrantIntersectionAndEscalationBlocked(t *testing.T) {
	m, _ := newAdvancedManager(t)
	now := time.Now().UTC()
	if _, err := m.CreateGrant("g1", "main", "job-1", "test", "narrow", []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, []string{"git"}, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := m.EffectiveAuthorizePath("main", "g1", "job-1", "a.txt", WorkspaceRead); err != nil {
		t.Fatal(err)
	}
	if _, err := m.EffectiveAuthorizePath("main", "g1", "job-1", "a.txt", WorkspaceWrite); err == nil {
		t.Fatal("write escalation should be blocked")
	}
	if _, err := m.EffectiveAuthorizePath("main", "g1", "job-1", "secret/x", WorkspaceRead); err == nil {
		t.Fatal("base deny must win")
	}
	if ok, err := m.EffectiveToolAllowed("main", "g1", "job-1", "git"); err != nil || !ok {
		t.Fatalf("git expected: %v %v", ok, err)
	}
	if ok, err := m.EffectiveToolAllowed("main", "g1", "job-1", "node"); err != nil || ok {
		t.Fatalf("node should be grant-blocked: %v %v", ok, err)
	}
	if _, err := m.CreateGrant("bad", "main", "job-1", "test", "escalate", []WorkspaceScope{{Path: "secret", Access: WorkspaceRead}}, nil, now.Add(time.Hour)); err == nil {
		t.Fatal("grant may not expand deny")
	}
}

func TestGrantExpiryRevocationAndCrossJob(t *testing.T) {
	m, _ := newAdvancedManager(t)
	g, err := m.CreateGrant("g1", "main", "job-a", "issuer", "", []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, []string{"git"}, time.Now().UTC().Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.InspectGrant(g.ID, "main", "job-b", time.Now()); err == nil {
		t.Fatal("cross-job grant use must fail")
	}
	if err := m.RevokeGrant(g.ID, "issuer"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.InspectGrant(g.ID, "main", "job-a", time.Now()); err == nil {
		t.Fatal("revoked grant must fail")
	}
	m2, _ := newAdvancedManager(t)
	g2, err := m2.CreateGrant("g2", "main", "job-a", "issuer", "", []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, nil, time.Now().UTC().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m2.InspectGrant(g2.ID, "main", "job-a", time.Now().UTC().Add(2*time.Minute)); err == nil {
		t.Fatal("expired grant must fail")
	}
}

func TestEphemeralOwnershipAndOrphanCleanup(t *testing.T) {
	m, _ := newAdvancedManager(t)
	_, epRoot := m.advancedPaths()
	root := filepath.Join(epRoot, "job-1", "checkout")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := m.RegisterEphemeral("ep1", "Ephemeral", root, "job-1", time.Now().UTC().Add(time.Hour), []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}}, []string{"git"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.RegisterEphemeral("bad", "Bad", t.TempDir(), "job-1", time.Now().UTC().Add(time.Hour), []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}}, nil); err == nil {
		t.Fatal("unmanaged ephemeral root must fail")
	}
	got, err := m.CleanupAdvanced(time.Now().UTC(), map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if got["ephemeral_removed"] != 1 {
		t.Fatalf("cleanup=%v", got)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("ephemeral root should be removed: %v", err)
	}
}

func TestRemoteWorkspaceBoundary(t *testing.T) {
	m, _ := newAdvancedManager(t)
	w, err := m.RegisterRemote("remote1", "Remote", RemoteWorkspaceSpec{Adapter: "ssh-adapter", EndpointRef: "prod-01", RootRef: "srv/app", CredentialRef: "cred-prod"}, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}, {Path: "tmp", Access: WorkspaceDeny}}, []string{"git"})
	if err != nil {
		t.Fatal(err)
	}
	if w.Kind != "remote" || w.Remote == nil {
		t.Fatalf("unexpected remote: %#v", w)
	}
	if _, err := m.RegisterRemote("remote2", "Remote", RemoteWorkspaceSpec{Adapter: "ssh", EndpointRef: "user@host", RootRef: "/srv"}, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, nil); err == nil {
		t.Fatal("credential-looking endpoint must fail")
	}
	g, err := m.CreateGrant("rg", "remote1", "job-r", "issuer", "", []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, []string{"git"}, time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.EffectiveAuthorizePath("remote1", g.ID, "job-r", "docs/readme.md", WorkspaceRead); err != nil {
		t.Fatal(err)
	}
	if _, err := m.EffectiveAuthorizePath("remote1", g.ID, "job-r", "../escape", WorkspaceRead); err == nil {
		t.Fatal("remote traversal must fail")
	}
	if _, err := m.EffectiveAuthorizePath("remote1", g.ID, "job-r", "tmp/x", WorkspaceRead); err == nil {
		t.Fatal("remote deny must win")
	}
}

func TestJobScopedAccessRequiresGrant(t *testing.T) {
	m, _ := newAdvancedManager(t)
	if _, err := m.EffectiveAuthorizePath("main", "", "job-1", "a.txt", WorkspaceRead); err == nil {
		t.Fatal("job access without grant must fail closed")
	}
	if ok, err := m.EffectiveToolAllowed("main", "", "job-1", "git"); err == nil || ok {
		t.Fatal("job tool without grant must fail closed")
	}
}
