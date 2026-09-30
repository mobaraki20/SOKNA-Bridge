package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveConfigPathUsesLocator(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "custom", "config.json")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(target, []byte(`{"port":8766,"token":"x"}`), 0o600); err != nil { t.Fatal(err) }
	locator := filepath.Join(root, "SOKNA", "Agent", "install-locator.json")
	if err := os.MkdirAll(filepath.Dir(locator), 0o755); err != nil { t.Fatal(err) }
	b, _ := json.Marshal(InstallLocator{ConfigPath: target})
	if err := os.WriteFile(locator, b, 0o600); err != nil { t.Fatal(err) }
	t.Setenv("LOCALAPPDATA", root); t.Setenv("SOKNA_AGENT_CONFIG_PATH", "")
	got, err := resolveConfigPath(); if err != nil { t.Fatal(err) }
	if got != target { t.Fatalf("got %q want %q", got, target) }
}

func TestResolveConfigPathFallsBackToLegacy(t *testing.T) {
	root := t.TempDir(); legacy := filepath.Join(root, "SOKNA-Bridge-V2", "config.json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(legacy, []byte(`{"port":8766,"token":"x"}`), 0o600); err != nil { t.Fatal(err) }
	t.Setenv("LOCALAPPDATA", root); t.Setenv("SOKNA_AGENT_CONFIG_PATH", "")
	got, err := resolveConfigPath(); if err != nil { t.Fatal(err) }
	if got != legacy { t.Fatalf("got %q want %q", got, legacy) }
}

func TestResolveConfigPathRejectsRelativeOverride(t *testing.T) {
	t.Setenv("SOKNA_AGENT_CONFIG_PATH", `relative\\config.json`)
	if _, err := resolveConfigPath(); err == nil { t.Fatal("expected relative override rejection") }
}

func setupObservabilityFixture(t *testing.T) string {
	t.Helper(); local := t.TempDir(); install := filepath.Join(t.TempDir(), "agent"); artifact := filepath.Join(t.TempDir(), "artifacts")
	config := filepath.Join(install, "config.json"); if err := os.MkdirAll(filepath.Dir(config), 0o755); err != nil { t.Fatal(err) }
	cfg := map[string]any{"port":8766,"token":"x","artifact_root":artifact}; bcfg,_:=json.Marshal(cfg)
	if err := os.WriteFile(config, bcfg, 0o600); err != nil { t.Fatal(err) }
	jobs := filepath.Join(install, "runtime", "jobs"); if err := os.MkdirAll(jobs, 0o755); err != nil { t.Fatal(err) }
	job := map[string]any{"id":"job-r2b-1","status":"running","workspace":"SOKNA-Bridge","path":"plan.json","worker_pid":4242,"created_at":1000,"started_at":1100,"finished_at":0,"result":nil,"error":nil}
	b, _ := json.Marshal(job); if err := os.WriteFile(filepath.Join(jobs, "job-r2b-1.json"), b, 0o600); err != nil { t.Fatal(err) }
	if err:=os.MkdirAll(filepath.Join(artifact,"browser"),0o755);err!=nil{t.Fatal(err)}
	t.Setenv("LOCALAPPDATA", local); t.Setenv("SOKNA_AGENT_CONFIG_PATH", config)
	return artifact
}

func TestJobListUsesAgentJobStoreAndOwnedProcesses(t *testing.T) {
	setupObservabilityFixture(t); params := json.RawMessage(`{"limit":20}`)
	c := CommandEnvelope{ID:"cmd-list",Action:"job.list",Params:params,MessageID:"cmd-list",CorrelationID:"cmd-list"}
	raw, handled, err := localObservability(c); if err != nil { t.Fatal(err) }; if !handled { t.Fatal("job.list must be handled locally") }
	var r struct { OK bool `json:"ok"`; Source string `json:"source"`; Jobs []JobRecord `json:"jobs"`; Owned []map[string]any `json:"owned_processes"` }
	if err := json.Unmarshal(raw, &r); err != nil { t.Fatal(err) }
	if !r.OK || r.Source != "agent-job-store" { t.Fatalf("unexpected result: %s", raw) }
	if len(r.Jobs) != 1 || r.Jobs[0].ID != "job-r2b-1" || r.Jobs[0].Status != "running" { t.Fatalf("bad jobs: %s", raw) }
	if len(r.Owned) != 1 { t.Fatalf("expected one owned process: %s", raw) }
}

func TestJobEventsAreDurableAndDeduplicatedByState(t *testing.T) {
	setupObservabilityFixture(t); jobs, err := readJobs(); if err != nil { t.Fatal(err) }
	observeJobStates(jobs); observeJobStates(jobs)
	events, err := readEvents("job-r2b-1", 20); if err != nil { t.Fatal(err) }
	if len(events) != 1 { t.Fatalf("expected one state event, got %d: %#v", len(events), events) }
	if events[0].Kind != "job.running" || events[0].State != "running" || events[0].WorkerPID != 4242 { t.Fatalf("unexpected event: %#v", events[0]) }
}

func TestCommandActivityDoesNotPersistParamsOrSecrets(t *testing.T) {
	setupObservabilityFixture(t); c := CommandEnvelope{ID:"cmd-secret",Action:"exec.test",CorrelationID:"cmd-secret",Params:json.RawMessage(`{"token":"TOP_SECRET"}`)}
	recordCommandEvent(c, "command.accepted", ""); events, err := readEvents("", 20); if err != nil { t.Fatal(err) }; b, _ := json.Marshal(events)
	if string(b) == "" || contains(string(b), "TOP_SECRET") { t.Fatalf("secret leaked into event journal: %s", b) }
}

func TestOutboundArtifactPublishAndChunkRoundTrip(t *testing.T){
	artifact:=setupObservabilityFixture(t); src:=filepath.Join(artifact,"browser","shot.png"); payload:=[]byte("PNG_TEST_BYTES_0123456789")
	if err:=os.WriteFile(src,payload,0o600);err!=nil{t.Fatal(err)}
	pub,err:=publishArtifact(map[string]any{"path":"browser/shot.png","name":"evidence.png"});if err!=nil{t.Fatal(err)}
	refAny:=pub["artifact_ref"]; b,_:=json.Marshal(refAny); var ref ArtifactRef;if err:=json.Unmarshal(b,&ref);err!=nil{t.Fatal(err)}
	if ref.ID==""||ref.SHA256!=ref.ID||ref.Bytes!=int64(len(payload))||ref.Name!="evidence.png"{t.Fatalf("bad ref: %#v",ref)}
	if ref.Delivery["local_path_is_delivery"]!=false{t.Fatalf("local path must not be delivery: %#v",ref.Delivery)}
	got,err:=getArtifactChunk(map[string]any{"id":ref.ID,"offset":0,"limit":8});if err!=nil{t.Fatal(err)}
	chunk,err:=base64.StdEncoding.DecodeString(got["data_b64"].(string));if err!=nil{t.Fatal(err)}
	if string(chunk)!=string(payload[:8]){t.Fatalf("bad first chunk: %q",chunk)}
	if got["eof"].(bool){t.Fatal("first chunk should not be eof")}
	next:=int(got["next_offset"].(int64)); got2,err:=getArtifactChunk(map[string]any{"id":ref.ID,"offset":next,"limit":maxArtifactChunk});if err!=nil{t.Fatal(err)}
	chunk2,err:=base64.StdEncoding.DecodeString(got2["data_b64"].(string));if err!=nil{t.Fatal(err)}
	joined:=append(append([]byte{},chunk...),chunk2...);if string(joined)!=string(payload){t.Fatalf("round trip mismatch: %q",joined)}
	if !got2["eof"].(bool){t.Fatal("final chunk must be eof")}
}

func TestOutboundArtifactIngestRoundTrip(t *testing.T){
	setupObservabilityFixture(t)
	png:=[]byte{0x89,'P','N','G',0x0d,0x0a,0x1a,0x0a,1,2,3,4,5,6}
	out,err:=ingestOutboundArtifact(map[string]any{"name":"browser-shot.png","content_type":"image/png","data_b64":base64.StdEncoding.EncodeToString(png)})
	if err!=nil{t.Fatal(err)}
	b,_:=json.Marshal(out["artifact_ref"]);var ref ArtifactRef;if err:=json.Unmarshal(b,&ref);err!=nil{t.Fatal(err)}
	if ref.ID==""||ref.Bytes!=int64(len(png))||ref.Name!="browser-shot.png"||ref.ContentType!="image/png"{t.Fatalf("bad ingested ref: %#v",ref)}
	got,err:=getArtifactChunk(map[string]any{"id":ref.ID,"offset":0,"limit":64});if err!=nil{t.Fatal(err)}
	data,err:=base64.StdEncoding.DecodeString(got["data_b64"].(string));if err!=nil{t.Fatal(err)}
	if string(data)!=string(png){t.Fatalf("ingested artifact mismatch")}
}

func TestOutboundArtifactIngestRejectsSpoofedContent(t *testing.T){
	setupObservabilityFixture(t)
	_,err:=ingestOutboundArtifact(map[string]any{"name":"fake.png","content_type":"image/png","data_b64":base64.StdEncoding.EncodeToString([]byte("not-png"))})
	if err==nil||!contains(err.Error(),"CONTENT_MISMATCH"){t.Fatalf("expected content mismatch, got %v",err)}
}

func TestOutboundArtifactRejectsPathEscape(t *testing.T){
	setupObservabilityFixture(t); if _,err:=publishArtifact(map[string]any{"path":"../secret.txt"});err==nil{t.Fatal("expected ArtifactRoot escape rejection")}
}

func contains(s, sub string) bool { for i := 0; i+len(sub) <= len(s); i++ { if s[i:i+len(sub)] == sub { return true } }; return false }
