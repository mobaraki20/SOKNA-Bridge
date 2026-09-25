package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func setupSessionFixture(t *testing.T) {
	t.Helper()
	local:=t.TempDir(); install:=filepath.Join(t.TempDir(),"agent"); artifact:=filepath.Join(t.TempDir(),"artifacts")
	if err:=os.MkdirAll(install,0o755);err!=nil{t.Fatal(err)}
	if err:=os.MkdirAll(artifact,0o755);err!=nil{t.Fatal(err)}
	cfg:=map[string]any{"port":1,"token":"test-token","artifact_root":artifact}; b,_:=json.Marshal(cfg)
	config:=filepath.Join(install,"config.json");if err:=os.WriteFile(config,b,0o600);err!=nil{t.Fatal(err)}
	t.Setenv("LOCALAPPDATA",local);t.Setenv("SOKNA_AGENT_CONFIG_PATH",config)
}

func TestWorkSessionPersistsCheckpointAndCloses(t *testing.T){
	setupSessionFixture(t)
	r,err:=openSession(map[string]any{"id":"session-test-1","project":"SOKNA-Bridge","workspace":"bridge","phase":"R2-E","summary":"continuity","refs":map[string]any{"job":"job-1","artifact":"abc"}});if err!=nil{t.Fatal(err)}
	s:=r["session"].(WorkSession);if s.State!="ready"||s.ID!="session-test-1"{t.Fatalf("bad session: %#v",s)}
	active,err:=activeSession();if err!=nil{t.Fatal(err)};if active.ID!=s.ID{t.Fatalf("active mismatch: %#v",active)}
	cp,err:=checkpointSession(map[string]any{"phase":"R2-E-test","summary":"checkpointed","refs":map[string]any{"job":"job-2"}});if err!=nil{t.Fatal(err)}
	updated:=cp["session"].(WorkSession);if updated.Phase!="R2-E-test"||updated.Refs["job"]!="job-2"{t.Fatalf("checkpoint mismatch: %#v",updated)}
	closed,err:=closeSession();if err!=nil{t.Fatal(err)};if closed["session"].(WorkSession).State!="closed"{t.Fatal("session not closed")}
	if _,err:=activeSession();err==nil{t.Fatal("active session pointer must be cleared")}
}

func TestWorkSessionRejectsSensitiveRefs(t *testing.T){
	setupSessionFixture(t)
	if _,err:=openSession(map[string]any{"id":"session-secret","refs":map[string]any{"github_token":"SECRET"}});err==nil{t.Fatal("sensitive ref key must be rejected")}
	if _,err:=openSession(map[string]any{"id":"session-secret2","refs":map[string]any{"credential_ref":"SECRET"}});err==nil{t.Fatal("credential ref value must not be persisted in generic session refs")}
}

func TestBootstrapIsFailClosedWhenAgentUnavailable(t *testing.T){
	setupSessionFixture(t)
	if _,err:=openSession(map[string]any{"id":"session-bootstrap","project":"SOKNA-Bridge"});err!=nil{t.Fatal(err)}
	b,err:=bootstrapResult();if err!=nil{t.Fatal(err)}
	if b["ready"]==true{t.Fatal("bootstrap must not be ready when agent capabilities cannot be verified")}
	if b["agent_ready"]==true{t.Fatal("agent_ready must be false")}
	if b["protocol_version"]!="2"||b["semantic_transport"]!="SOKNA-INTENT"{t.Fatalf("bootstrap contract missing: %#v",b)}
	routes:=b["route_policy"].(map[string]any);if routes["large_bytes"]==nil||routes["browser_inspection"]==nil{t.Fatalf("route policy incomplete: %#v",routes)}
	files:=b["file_delivery_rules"].(map[string]any);if files["local_path_is_delivery"]!=false{t.Fatalf("unsafe file delivery rule: %#v",files)}
}
