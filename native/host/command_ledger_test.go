package main

import (
	"encoding/json"
	"testing"
)

func withLedgerTemp(t *testing.T) {
	t.Helper()
	t.Setenv("LOCALAPPDATA", t.TempDir())
}

func TestCommandLedgerCompletesAndReplays(t *testing.T) {
	withLedgerTemp(t)
	c := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: "cmd-ledger-1", Action: "file.read", Params: json.RawMessage(`{"workspace":"x","path":"a.txt"}`)}
	rec, dup, err := beginCommandRecord(c)
	if err != nil || dup || rec.State != "accepted" {
		t.Fatalf("begin failed: rec=%+v dup=%v err=%v", rec, dup, err)
	}
	result := json.RawMessage(`{"ok":true,"value":"done"}`)
	if err := completeCommandRecord(c, result); err != nil {
		t.Fatal(err)
	}
	rec, dup, err = beginCommandRecord(c)
	if err != nil || !dup || rec.State != "succeeded" {
		t.Fatalf("duplicate replay lookup failed: rec=%+v dup=%v err=%v", rec, dup, err)
	}
	out := replayCommandRecord(rec, "req-1")
	var got map[string]any
	if !out.OK || json.Unmarshal(out.Result, &got) != nil || got["ok"] != true || got["value"] != "done" {
		t.Fatalf("replay failed: %+v", out)
	}
}

func TestCommandLedgerRejectsConflictingReuse(t *testing.T) {
	withLedgerTemp(t)
	a := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: "cmd-ledger-2", Action: "file.read", Params: json.RawMessage(`{"path":"a"}`)}
	if _, _, err := beginCommandRecord(a); err != nil {
		t.Fatal(err)
	}
	b := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: "cmd-ledger-2", Action: "file.write", Params: json.RawMessage(`{"path":"a"}`)}
	if _, dup, err := beginCommandRecord(b); err == nil || !dup {
		t.Fatalf("conflicting command id was not rejected: dup=%v err=%v", dup, err)
	}
}

func TestCommandLedgerDoesNotReexecuteInterruptedCommand(t *testing.T) {
	withLedgerTemp(t)
	c := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: "cmd-ledger-3", Action: "git.commit", Params: json.RawMessage(`{"message":"x"}`)}
	if _, _, err := beginCommandRecord(c); err != nil {
		t.Fatal(err)
	}
	rec, dup, err := beginCommandRecord(c)
	if err != nil || !dup || rec.State != "outcome_unknown" {
		t.Fatalf("interrupted command not protected: rec=%+v dup=%v err=%v", rec, dup, err)
	}
	onDisk, err := readCommandRecord(commandScope(c), c.ID)
	if err != nil || onDisk.State != "outcome_unknown" {
		t.Fatalf("unknown outcome not durable: %+v err=%v", onDisk, err)
	}
}

func TestCommandLedgerCursor(t *testing.T) {
	withLedgerTemp(t)
	for _, id := range []string{"cmd-ledger-4a", "cmd-ledger-4b"} {
		c := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: id, Action: "artifact.out.get", Params: json.RawMessage(`{"id":"x"}`)}
		if _, _, err := beginCommandRecord(c); err != nil {
			t.Fatal(err)
		}
		if err := completeCommandRecord(c, json.RawMessage(`{"ok":true}`)); err != nil {
			t.Fatal(err)
		}
	}
	items, next, more, err := listCommandRecords("chatgpt:c:test-a", 0, 1)
	if err != nil || len(items) != 1 || next <= 0 || !more {
		t.Fatalf("first cursor page invalid: len=%d next=%d more=%v err=%v", len(items), next, more, err)
	}
	items2, next2, more2, err := listCommandRecords("chatgpt:c:test-a", next, 10)
	if err != nil || len(items2) != 1 || next2 <= next || more2 {
		t.Fatalf("second cursor page invalid: len=%d next=%d more=%v err=%v", len(items2), next2, more2, err)
	}
}

func TestCommandLedgerScopesSameIDByConversation(t *testing.T) {
	withLedgerTemp(t)
	a := CommandEnvelope{ConversationKey: "chatgpt:c:a", ID: "same-id", Action: "file.read", Params: json.RawMessage(`{"path":"a"}`)}
	b := CommandEnvelope{ConversationKey: "chatgpt:c:b", ID: "same-id", Action: "file.write", Params: json.RawMessage(`{"path":"b"}`)}
	if _, dup, err := beginCommandRecord(a); err != nil || dup {
		t.Fatalf("first conversation begin failed: dup=%v err=%v", dup, err)
	}
	if _, dup, err := beginCommandRecord(b); err != nil || dup {
		t.Fatalf("second conversation collided with first: dup=%v err=%v", dup, err)
	}
}

func TestChildCommandsAreNotLedgerAuthorities(t *testing.T) {
	withLedgerTemp(t)
	c := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: "child-1", ParentID: "parent-1", Action: "artifact.out.get", Params: json.RawMessage(`{"id":"x"}`)}
	if shouldLedgerCommand(c) {
		t.Fatal("child command must not become an authoritative top-level ledger entry")
	}
}
