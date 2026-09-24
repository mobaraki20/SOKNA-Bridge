package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func testArtifactPolicy() ArtifactPolicy {
	p := DefaultArtifactPolicy()
	p.MaxRootBytes = 1024 * 1024
	p.MaxArtifactBytes = 512 * 1024
	p.Retention.Incoming = 24 * time.Hour
	p.Retention.Staging = time.Hour
	p.Retention.Accepted = 24 * time.Hour
	p.Retention.Failed = 24 * time.Hour
	p.Retention.Cache = 24 * time.Hour
	p.Retention.Browser = 24 * time.Hour
	return p
}

func TestArtifactRootCreatesManagedDirectories(t *testing.T) {
	m, err := NewArtifactManager(filepath.Join(t.TempDir(), "artifacts"), testArtifactPolicy())
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range artifactManagedDirs {
		if info, err := os.Stat(filepath.Join(m.Root, name)); err != nil || !info.IsDir() {
			t.Fatalf("managed dir missing: %s", name)
		}
	}
}

func TestArtifactRootTraversalBlocked(t *testing.T) {
	m, err := NewArtifactManager(filepath.Join(t.TempDir(), "artifacts"), testArtifactPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ResolveManagedPath(filepath.Join("..", "escape.txt"), true); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestArtifactRootSymlinkBlocked(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("developer linux test covers symlink; Windows gate covers reparse/junction")
	}
	base := t.TempDir()
	m, err := NewArtifactManager(filepath.Join(base, "artifacts"), testArtifactPolicy())
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(outside, 0755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(m.Root, "incoming", "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ResolveManagedPath(filepath.Join("incoming", "escape", "x.zip"), true); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
	if _, err := m.Status(); err == nil {
		t.Fatal("status must fail closed on managed symlink")
	}
}

func TestArtifactImportHashAndAudit(t *testing.T) {
	base := t.TempDir()
	m, err := NewArtifactManager(filepath.Join(base, "artifacts"), testArtifactPolicy())
	if err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "payload.zip")
	if err := os.WriteFile(src, []byte("hello-artifact"), 0644); err != nil {
		t.Fatal(err)
	}
	rec, err := m.ImportLocal(src, "a1", "", "application/zip")
	if err != nil {
		t.Fatal(err)
	}
	if rec.Size != int64(len("hello-artifact")) || len(rec.SHA256) != 64 || rec.Provider != "local_file" {
		t.Fatalf("bad record: %+v", rec)
	}
	if _, err := os.Stat(filepath.Join(m.Root, filepath.FromSlash(rec.LocalPath))); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(m.metadataPath("a1")); err != nil {
		t.Fatal(err)
	}
	audit, err := os.ReadFile(filepath.Join(m.Root, "logs", "artifact-events.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(audit), "artifact.import.local") || !strings.Contains(string(audit), "\"imported\"") {
		t.Fatalf("audit missing: %s", audit)
	}
}

func TestArtifactImportRejectsHashMismatchAndRollsBack(t *testing.T) {
	base := t.TempDir()
	m, err := NewArtifactManager(filepath.Join(base, "artifacts"), testArtifactPolicy())
	if err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "payload.zip")
	if err := os.WriteFile(src, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ImportLocal(src, "bad-hash", strings.Repeat("0", 64), "application/zip"); err == nil {
		t.Fatal("expected hash mismatch")
	}
	entries, err := os.ReadDir(filepath.Join(m.Root, "incoming"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("partial/final file leaked: %v", entries)
	}
}

func TestArtifactQuotaEnforced(t *testing.T) {
	p := testArtifactPolicy()
	p.MaxRootBytes = 32
	p.MaxArtifactBytes = 32
	base := t.TempDir()
	m, err := NewArtifactManager(filepath.Join(base, "artifacts"), p)
	if err != nil {
		t.Fatal(err)
	}
	prefill := filepath.Join(m.Root, "cache", "existing.bin")
	if err := os.WriteFile(prefill, []byte(strings.Repeat("p", 16)), 0644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(base, "payload.bin")
	if err := os.WriteFile(src, []byte(strings.Repeat("x", 24)), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ImportLocal(src, "q1", "", "application/octet-stream"); err == nil {
		t.Fatal("expected quota rejection with existing managed usage")
	}
}

func TestArtifactCleanupRetentionAndDryRun(t *testing.T) {
	p := testArtifactPolicy()
	p.Retention.Cache = time.Hour
	m, err := NewArtifactManager(filepath.Join(t.TempDir(), "artifacts"), p)
	if err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(m.Root, "cache", "old.bin")
	fresh := filepath.Join(m.Root, "cache", "fresh.bin")
	if err := os.WriteFile(old, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fresh, []byte("fresh"), 0644); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := os.Chtimes(old, now.Add(-2*time.Hour), now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	m.Now = func() time.Time { return now }
	dry, err := m.Cleanup(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.Removed) != 1 || dry.Removed[0] != "cache/old.bin" {
		t.Fatalf("unexpected dry-run: %+v", dry)
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("dry-run deleted old file")
	}
	real, err := m.Cleanup(false)
	if err != nil {
		t.Fatal(err)
	}
	if len(real.Removed) != 1 {
		t.Fatalf("unexpected cleanup: %+v", real)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old file not removed: %v", err)
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatal("fresh file removed")
	}
}

func TestArtifactOutsideRootDeleteImpossible(t *testing.T) {
	base := t.TempDir()
	m, err := NewArtifactManager(filepath.Join(base, "artifacts"), testArtifactPolicy())
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(outside, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ResolveManagedPath(filepath.Join("..", "outside.txt"), false); err == nil {
		t.Fatal("escape unexpectedly resolved")
	}
	if b, err := os.ReadFile(outside); err != nil || string(b) != "keep" {
		t.Fatalf("outside file changed: %v %q", err, b)
	}
}

func TestArtifactCleanupInterruptedStagingTransition(t *testing.T) {
	p := testArtifactPolicy()
	p.Retention.Staging = time.Hour
	m, err := NewArtifactManager(filepath.Join(t.TempDir(), "artifacts"), p)
	if err != nil {
		t.Fatal(err)
	}
	partial := filepath.Join(m.Root, "staging", ".partial-interrupted")
	if err := os.WriteFile(partial, []byte("partial"), 0644); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := os.Chtimes(partial, now.Add(-2*time.Hour), now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	m.Now = func() time.Time { return now }
	result, err := m.Cleanup(false)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Removed) != 1 || result.Removed[0] != "staging/.partial-interrupted" {
		t.Fatalf("interrupted transition not reclaimed: %+v", result)
	}
	if _, err := os.Stat(partial); !os.IsNotExist(err) {
		t.Fatalf("stale partial remains: %v", err)
	}
}
