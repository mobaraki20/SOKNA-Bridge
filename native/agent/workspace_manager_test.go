package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func newWorkspaceManagerForTest(t *testing.T) *WorkspaceManager {
	t.Helper()
	d := t.TempDir()
	m, err := NewWorkspaceManager(filepath.Join(d, "state", "workspaces.json"), filepath.Join(d, "logs", "workspace-audit.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestWorkspacePersistentLocalDoesNotRequireGit(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := filepath.Join(t.TempDir(), "plain-folder")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	w, err := m.RegisterPersistentLocal("plain", "Plain Folder", root, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if w.Kind != "persistent_local" {
		t.Fatalf("unexpected kind %s", w.Kind)
	}
	if _, err := os.Stat(filepath.Join(root, ".git")); !os.IsNotExist(err) {
		t.Fatal("test folder unexpectedly became a git repository")
	}
}

func TestWorkspaceScopesDenyPrecedenceAndSpecificWrite(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	for _, p := range []string{"public", "editable", "editable/secret"} {
		if err := os.MkdirAll(filepath.Join(root, p), 0755); err != nil {
			t.Fatal(err)
		}
	}
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}, {Path: "editable", Access: WorkspaceWrite}, {Path: "editable/secret", Access: WorkspaceDeny}}, []string{"node"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.AuthorizePath("w", "public/a.txt", WorkspaceRead); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AuthorizePath("w", "public/a.txt", WorkspaceWrite); err == nil {
		t.Fatal("root read scope must not grant write")
	}
	if _, err := m.AuthorizePath("w", "editable/a.txt", WorkspaceWrite); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AuthorizePath("w", "editable/secret/a.txt", WorkspaceRead); err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("deny must win, got %v", err)
	}
}

func TestWorkspaceTraversalAndSymlinkFailClosed(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	base := t.TempDir()
	root := filepath.Join(base, "root")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.AuthorizePath("w", "../escape.txt", WorkspaceRead); err == nil {
		t.Fatal("traversal must be rejected")
	}
	if runtime.GOOS != "windows" {
		outside := filepath.Join(base, "outside")
		_ = os.MkdirAll(outside, 0755)
		link := filepath.Join(root, "link")
		if err := os.Symlink(outside, link); err != nil {
			t.Fatal(err)
		}
		if _, err := m.AuthorizePath("w", "link/file.txt", WorkspaceRead); err == nil || !strings.Contains(err.Error(), "symlink") {
			t.Fatalf("symlink must fail closed: %v", err)
		}
	}
}

func TestWorkspaceToolAllowlist(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}}, []string{"git.exe", "Node"})
	if err != nil {
		t.Fatal(err)
	}
	ok, err := m.ToolAllowed("w", "git")
	if err != nil || !ok {
		t.Fatalf("git should be allowed: %v", err)
	}
	ok, err = m.ToolAllowed("w", "php")
	if err != nil || ok {
		t.Fatalf("php must not be allowed: %v", err)
	}
}

func TestWorkspaceFullAccessRejectsRestrictiveScope(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "private"), 0755)
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}, {Path: "private", Access: WorkspaceDeny}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.FullAccess("w", WorkspaceWrite); err == nil {
		t.Fatal("broad mutation must fail when any deny scope exists")
	}
}

func TestWorkspaceUnregisterNeverDeletesSource(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	sentinel := filepath.Join(root, "keep.txt")
	if err := os.WriteFile(sentinel, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := m.Unregister("w")
	if err != nil {
		t.Fatal(err)
	}
	if !pathEqual(got, root) {
		t.Fatalf("root mismatch %s", got)
	}
	if _, err := os.Stat(sentinel); err != nil {
		t.Fatal("unregister deleted source data")
	}
	events, err := m.AuditEvents()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range events {
		if e["action"] == "workspace.unregister" {
			found = true
			if e["source_deleted"] != false {
				t.Fatal("audit must record source_deleted=false")
			}
		}
	}
	if !found {
		t.Fatal("unregister audit missing")
	}
}

func TestWorkspaceLegacyMigrationPreservesReadOnlySemantics(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	readRoot := t.TempDir()
	writeRoot := t.TempDir()
	source := filepath.Join(t.TempDir(), "config.json")
	_ = os.WriteFile(source, []byte("legacy"), 0644)
	count, err := m.MigrateLegacy(map[string]LegacyWorkspace{"readonly": {Path: readRoot, WriteEnabled: false}, "editable": {Path: writeRoot, WriteEnabled: true}}, "readonly", source)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("count=%d", count)
	}
	if _, err := m.AuthorizePath("readonly", "x.txt", WorkspaceWrite); err == nil {
		t.Fatal("write_enabled=false must migrate as read-only")
	}
	if _, err := m.AuthorizePath("readonly", "x.txt", WorkspaceRead); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AuthorizePath("editable", "x.txt", WorkspaceWrite); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("legacy source config must be preserved")
	}
	ok, err := m.ToolAllowed("editable", "git")
	if err != nil || ok {
		t.Fatal("legacy migration must require explicit tool review")
	}
}

func TestWorkspaceManagedCopyPlanIsNonDestructive(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	source := t.TempDir()
	dest := filepath.Join(t.TempDir(), "managed")
	p, err := m.PlanManagedCopy(source, dest)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"copy", "verify", "test", "switch"}
	if strings.Join(p.Stages, ",") != strings.Join(want, ",") {
		t.Fatalf("stages=%v", p.Stages)
	}
	if p.AutomaticExecution {
		t.Fatal("P2 plan must not auto-execute")
	}
	if !strings.Contains(p.SourceDeletion, "separate") {
		t.Fatal("source deletion must be separate")
	}
	nested := filepath.Join(source, "nested")
	if _, err := m.PlanManagedCopy(source, nested); err == nil {
		t.Fatal("nested destination must be rejected")
	}
}

func TestWorkspaceRegistryPersistsAndAuditRecordsMutations(t *testing.T) {
	d := t.TempDir()
	rp := filepath.Join(d, "state", "workspaces.json")
	ap := filepath.Join(d, "logs", "workspace-audit.jsonl")
	root := t.TempDir()
	m, err := NewWorkspaceManager(rp, ap)
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, []string{"node"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.UpdatePermissions("w", []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}}, []string{"node", "git"})
	if err != nil {
		t.Fatal(err)
	}
	m2, err := NewWorkspaceManager(rp, ap)
	if err != nil {
		t.Fatal(err)
	}
	w, err := m2.Inspect("w")
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Tools) != 2 {
		t.Fatalf("tools=%v", w.Tools)
	}
	events, err := m2.AuditEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 {
		t.Fatalf("events=%d", len(events))
	}
}

func TestWorkspaceRejectsConflictingReadWriteScopeAtSamePath(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}, {Path: ".", Access: WorkspaceWrite}}, nil)
	if err == nil || !strings.Contains(err.Error(), "conflicting") {
		t.Fatalf("ambiguous same-path read/write must be rejected, got %v", err)
	}
}

func TestWorkspaceLegacyMigrationCanonicalizesInvalidIDsAndPreservesRepoHint(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	count, err := m.MigrateLegacy(map[string]LegacyWorkspace{
		"My Legacy Workspace": {Path: root, ExpectedRepo: "example/legacy", WriteEnabled: false},
	}, "My Legacy Workspace", filepath.Join(t.TempDir(), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("count=%d", count)
	}
	items, def, err := m.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || !strings.HasPrefix(items[0].ID, "legacy-") {
		t.Fatalf("unexpected migrated id: %+v", items)
	}
	if def != items[0].ID {
		t.Fatalf("default=%q want %q", def, items[0].ID)
	}
	w, err := m.Inspect(def)
	if err != nil {
		t.Fatal(err)
	}
	if w.DisplayName != "My Legacy Workspace" || w.LegacyExpectedRepo != "example/legacy" {
		t.Fatalf("legacy metadata lost: %+v", w)
	}
}

func TestWorkspaceInspectFailsClosedOnTamperedScope(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceRead}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(m.RegistryPath)
	if err != nil {
		t.Fatal(err)
	}
	txt := strings.Replace(string(b), `"path": "."`, `"path": "../escape"`, 1)
	if err := os.WriteFile(m.RegistryPath, []byte(txt), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Inspect("w"); err == nil || !strings.Contains(err.Error(), "invalid persisted workspace scopes") {
		t.Fatalf("tampered scope must fail closed, got %v", err)
	}
}

func TestWorkspaceManagedCopyRejectsSymlinkDestinationAncestor(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation may require developer mode; Windows reparse coverage is authored in PowerShell acceptance")
	}
	m := newWorkspaceManagerForTest(t)
	source := t.TempDir()
	base := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(base, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := m.PlanManagedCopy(source, filepath.Join(link, "managed")); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("managed-copy destination via symlink must fail closed, got %v", err)
	}
}

func TestWorkspaceFullWriteRejectsNarrowerReadScope(t *testing.T) {
	m := newWorkspaceManagerForTest(t)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "protected"), 0755); err != nil {
		t.Fatal(err)
	}
	_, err := m.RegisterPersistentLocal("w", "w", root, []WorkspaceScope{{Path: ".", Access: WorkspaceWrite}, {Path: "protected", Access: WorkspaceRead}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.FullAccess("w", WorkspaceWrite); err == nil || !strings.Contains(err.Error(), "read scope") {
		t.Fatalf("broad write must fail when a narrower read-only scope exists, got %v", err)
	}
}
