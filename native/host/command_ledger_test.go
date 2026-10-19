package main

import (
	"encoding/json"
	"strings"
	"sync"
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
	if err != nil || !dup || rec.State != "accepted" {
		t.Fatalf("in-flight duplicate must remain pending: rec=%+v dup=%v err=%v", rec, dup, err)
	}
	onDisk, err := readCommandRecord(commandScope(c), c.ID)
	if err != nil || onDisk.State != "accepted" {
		t.Fatalf("in-flight duplicate poisoned durable record: %+v err=%v", onDisk, err)
	}
	if out := replayCommandRecord(rec, "req-dup"); out.OK || !strings.Contains(out.Error, "COMMAND_STILL_PENDING") {
		t.Fatalf("pending duplicate misreported: %+v", out)
	}
	if err := completeCommandRecord(c, json.RawMessage(`{"ok":true}`)); err != nil {
		t.Fatalf("the still-running original must be allowed to complete: %v", err)
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

func TestExternalLedgerRoundTrip(t *testing.T) {
	withLedgerTemp(t)
	c := CommandEnvelope{ConversationKey: "chatgpt:c:ext", ID: "ext-1", Action: "bridge.diagnostics.get", Params: json.RawMessage(`{}`)}
	raw, _ := json.Marshal(c)
	begin := handleExternalLedgerBegin(InMsg{Type:"ledger.external.begin", RequestID:"r1", Command:raw})
	if !begin.OK {
		t.Fatalf("external begin failed: %+v", begin)
	}
	var bp map[string]any
	if json.Unmarshal(begin.Result,&bp) != nil || bp["duplicate"] != false || bp["state"] != "running" {
		t.Fatalf("external begin payload invalid: %s", string(begin.Result))
	}
	token, _ := bp["completion_token"].(string)
    if len(token)!=32 {t.Fatalf("begin did not return a completion capability: %s",string(begin.Result))}
    result := json.RawMessage(`{"ok":true,"diagnostic":"done"}`)
    unauth := handleExternalLedgerComplete(InMsg{Type:"ledger.external.complete",RequestID:"bad",Command:raw,Result:result})
    if unauth.OK {t.Fatal("missing token was accepted")}
    bad := handleExternalLedgerComplete(InMsg{Type:"ledger.external.complete",RequestID:"wrong",Command:raw,Result:result,CompletionToken:"00000000000000000000000000000000"})
    if bad.OK {t.Fatal("incorrect completion token accepted")}
    done := handleExternalLedgerComplete(InMsg{Type:"ledger.external.complete", RequestID:"r2", Command:raw, Result:result,CompletionToken:token})
	if !done.OK {
		t.Fatalf("external complete failed: %+v", done)
	}
	replay := handleExternalLedgerBegin(InMsg{Type:"ledger.external.begin", RequestID:"r3", Command:raw})
	if !replay.OK {
		t.Fatalf("external replay failed: %+v", replay)
	}
	var rp map[string]any
	if json.Unmarshal(replay.Result,&rp) != nil || rp["duplicate"] != true || rp["state"] != "succeeded" {
		t.Fatalf("external replay payload invalid: %s", string(replay.Result))
	}
	embedded, ok := rp["result"].(map[string]any)
	if !ok || embedded["diagnostic"] != "done" {
		t.Fatalf("external replay result missing: %+v", rp)
	}
}

func TestChildCommandsAreNotLedgerAuthorities(t *testing.T) {
	withLedgerTemp(t)
	c := CommandEnvelope{ConversationKey: "chatgpt:c:test-a", ID: "child-1", ParentID: "parent-1", Action: "artifact.out.get", Params: json.RawMessage(`{"id":"x"}`)}
	if shouldLedgerCommand(c) {
		t.Fatal("child command must not become an authoritative top-level ledger entry")
	}
}

func TestCommandLedgerConcurrentDuplicateAndImmutablePhase(t *testing.T) {
	withLedgerTemp(t)
	c := CommandEnvelope{ConversationKey:"chatgpt:c:concurrency",ID:"same-command",Action:"file.write",Params:json.RawMessage(`{"path":"x"}`)}
	var wg sync.WaitGroup
	type result struct {duplicate bool; err error}
	out := make(chan result, 32)
	for i:=0;i<32;i++ {
		wg.Add(1)
		go func(){defer wg.Done(); _,dup,err:=beginCommandRecord(c); out<-result{dup,err}}()
	}
	wg.Wait();close(out)
	fresh:=0
	for r:=range out {
		if r.err!=nil {t.Fatalf("concurrent claim error: %v",r.err)}
		if !r.duplicate {fresh++}
	}
	if fresh!=1 {t.Fatalf("exactly one invocation must own execution, fresh=%d",fresh)}
	rec,err:=readCommandRecord(commandScope(c),c.ID)
	if err!=nil||rec.State!="accepted" {t.Fatalf("ledger was overwritten or poisoned: %+v %v",rec,err)}
	if err:=completeCommandRecord(c,json.RawMessage(`{"ok":true}`));err!=nil {t.Fatal(err)}
	if err:=completeCommandRecord(c,json.RawMessage(`{"ok":false}`));err==nil {t.Fatal("conflicting terminal result accepted")}
	if err:=completeCommandRecord(CommandEnvelope{ConversationKey:c.ConversationKey,ID:c.ID,Action:"file.write",Params:json.RawMessage(`{"path":"else"}`)},json.RawMessage(`{"ok":true}`));err==nil {t.Fatal("mismatched command completion accepted")}
}
