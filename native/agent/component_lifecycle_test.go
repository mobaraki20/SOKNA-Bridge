package main

import (
	"testing"
	"time"
)

func TestComponentValidationAndLKGCommit(t *testing.T) {
	c := ComponentDefinition{ID: "worker", DisplayName: "Worker", Type: ComponentProcess, InstallOwner: "sokna-agent", ReleaseChannel: "stable", Releases: map[string]ComponentRelease{"1.0.0": {Version: "1.0.0", ArtifactPath: "incoming/a.zip", SHA256: "abc"}}, ActiveVersion: "1.0.0", LKGVersion: "1.0.0", State: "active", Health: "healthy"}
	if err := validateComponent(c); err != nil {
		t.Fatal(err)
	}
	tx, err := NewComponentTransaction("tx-1", c.ID, "1.0.0", "1.1.0")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range []string{"stage", "verify", "activate", "health_pass", "commit"} {
		if err := tx.Advance(e); err != nil {
			t.Fatalf("%s: %v", e, err)
		}
	}
	if err := CommitComponentRelease(&c, *tx, ComponentRelease{Version: "1.1.0", ArtifactPath: "incoming/b.zip", SHA256: "def", Health: "healthy"}); err != nil {
		t.Fatal(err)
	}
	if c.ActiveVersion != "1.1.0" || c.LKGVersion != "1.0.0" || c.Health != "healthy" {
		t.Fatalf("bad component state: %#v", c)
	}
}

func TestComponentTransactionRollbackOnHealthFailure(t *testing.T) {
	tx, err := NewComponentTransaction("tx-2", "worker", "1.0.0", "2.0.0")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range []string{"stage", "verify", "activate", "health_fail"} {
		if err := tx.Advance(e); err != nil {
			t.Fatal(err)
		}
	}
	if !tx.RequiresRollback() {
		t.Fatal("health failure must require rollback")
	}
	if err := tx.Advance("rollback"); err != nil {
		t.Fatal(err)
	}
	if tx.State != "rolled_back" {
		t.Fatalf("state=%s", tx.State)
	}
	if err := tx.Advance("commit"); err == nil {
		t.Fatal("rolled back transaction may not commit")
	}
}

func TestOwnedProcessProtection(t *testing.T) {
	expected := ProcessOwnership{PID: 123, StartUnixMillis: 1000, Executable: `C:\\App\\worker.exe`, OwnerToken: "tok"}
	if err := CanStopOwnedProcess(expected, expected); err != nil {
		t.Fatal(err)
	}
	bad := expected
	bad.StartUnixMillis++
	if err := CanStopOwnedProcess(expected, bad); err == nil {
		t.Fatal("stale/reused PID must fail")
	}
	bad = expected
	bad.OwnerToken = "other"
	if err := CanStopOwnedProcess(expected, bad); err == nil {
		t.Fatal("foreign process must fail")
	}
}

func TestAutomationIntervalDedupeMissedAndConcurrency(t *testing.T) {
	base := time.Date(2026, 9, 24, 1, 0, 0, 0, time.UTC)
	a := AutomationSpec{ID: "nightly", WorkspaceID: "main", PlanPath: "tools/plans/x.json", Type: "interval", IntervalSeconds: 60, MissedRunPolicy: "run_once", ConcurrencyKey: "build", MaxConcurrency: 1, Enabled: true, NextRunUnixMilli: base.UnixMilli()}
	d, err := EvaluateAutomation(a, base.Add(2*time.Minute), 0, "")
	if err != nil || !d.Due || d.RunKey == "" {
		t.Fatalf("decision=%#v err=%v", d, err)
	}
	a.LastRunKey = d.RunKey
	d2, _ := EvaluateAutomation(a, base.Add(2*time.Minute), 0, "")
	if d2.Due || d2.Reason != "duplicate" {
		t.Fatalf("dedupe=%#v", d2)
	}
	a.LastRunKey = ""
	d3, _ := EvaluateAutomation(a, base.Add(2*time.Minute), 1, "")
	if d3.Due || d3.Reason != "concurrency_limit" {
		t.Fatalf("concurrency=%#v", d3)
	}
	a.MissedRunPolicy = "skip"
	d4, _ := EvaluateAutomation(a, base.Add(2*time.Minute), 0, "")
	if d4.Due || d4.Reason != "missed_skipped" {
		t.Fatalf("missed=%#v", d4)
	}
}

func TestAutomationTriggerDedupe(t *testing.T) {
	now := time.Date(2026, 9, 24, 1, 2, 3, 0, time.UTC)
	a := AutomationSpec{ID: "on-release", WorkspaceID: "main", PlanPath: "tools/plans/x.json", Type: "trigger", TriggerKey: "component.release", MissedRunPolicy: "skip", ConcurrencyKey: "release", MaxConcurrency: 2, Enabled: true}
	d, err := EvaluateAutomation(a, now, 0, "component.release")
	if err != nil || !d.Due {
		t.Fatalf("decision=%#v err=%v", d, err)
	}
	a.LastRunKey = d.RunKey
	d2, _ := EvaluateAutomation(a, now.Add(20*time.Second), 0, "component.release")
	if d2.Due || d2.Reason != "duplicate" {
		t.Fatalf("dedupe=%#v", d2)
	}
	d3, _ := EvaluateAutomation(a, now, 0, "other")
	if d3.Due || d3.Reason != "trigger_mismatch" {
		t.Fatalf("mismatch=%#v", d3)
	}
}
