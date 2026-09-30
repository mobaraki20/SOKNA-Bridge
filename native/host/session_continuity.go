package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type WorkSession struct {
	Schema string `json:"schema"`
	ID string `json:"id"`
	Project string `json:"project"`
	Workspace string `json:"workspace,omitempty"`
	State string `json:"state"`
	Phase string `json:"phase,omitempty"`
	Summary string `json:"summary,omitempty"`
	Refs map[string]string `json:"refs,omitempty"`
	ProtocolVersion string `json:"protocol_version"`
	SchemaVersion string `json:"schema_version"`
	CreatedAt int64 `json:"created_at"`
	UpdatedAt int64 `json:"updated_at"`
}
type activeSessionPointer struct { ID string `json:"id"`; UpdatedAt int64 `json:"updated_at"` }

func sessionsDir()(string,error){local:=strings.TrimSpace(os.Getenv("LOCALAPPDATA"));if local==""{return "",errors.New("LOCALAPPDATA not found")};return filepath.Join(local,"SOKNA","Bridge","sessions"),nil}
func sessionPath(id string)(string,error){if !safeID.MatchString(id){return "",errors.New("invalid session id")};d,err:=sessionsDir();if err!=nil{return "",err};return filepath.Join(d,id+".json"),nil}
func activeSessionPath()(string,error){d,err:=sessionsDir();if err!=nil{return "",err};return filepath.Join(d,"active.json"),nil}
func readSession(id string)(WorkSession,error){var s WorkSession;p,err:=sessionPath(id);if err!=nil{return s,err};b,err:=os.ReadFile(p);if err!=nil{return s,err};if err:=json.Unmarshal(b,&s);err!=nil{return s,err};if s.ID!=id{return s,errors.New("session id integrity mismatch")};return s,nil}
func writeSession(s WorkSession)error{p,err:=sessionPath(s.ID);if err!=nil{return err};if err:=os.MkdirAll(filepath.Dir(p),0o700);err!=nil{return err};b,err:=json.MarshalIndent(s,"","  ");if err!=nil{return err};tmp:=p+".tmp";if err:=os.WriteFile(tmp,b,0o600);err!=nil{return err};return os.Rename(tmp,p)}
func setActiveSession(id string)error{p,err:=activeSessionPath();if err!=nil{return err};if err:=os.MkdirAll(filepath.Dir(p),0o700);err!=nil{return err};b,_:=json.Marshal(activeSessionPointer{ID:id,UpdatedAt:time.Now().UTC().UnixMilli()});tmp:=p+".tmp";if err:=os.WriteFile(tmp,b,0o600);err!=nil{return err};return os.Rename(tmp,p)}
func activeSession()(WorkSession,error){var empty WorkSession;p,err:=activeSessionPath();if err!=nil{return empty,err};b,err:=os.ReadFile(p);if err!=nil{return empty,err};var a activeSessionPointer;if err:=json.Unmarshal(b,&a);err!=nil{return empty,err};return readSession(a.ID)}
func clearActiveSession()error{p,err:=activeSessionPath();if err!=nil{return err};if err:=os.Remove(p);err!=nil&&!errors.Is(err,os.ErrNotExist){return err};return nil}
func sensitiveKey(k string)bool{k=strings.ToLower(k);return strings.Contains(k,"token")||strings.Contains(k,"secret")||strings.Contains(k,"password")||strings.Contains(k,"credential")||strings.Contains(k,"key")}
func cleanRefs(v any)(map[string]string,error){out:=map[string]string{};m,ok:=v.(map[string]any);if !ok||m==nil{return out,nil};if len(m)>50{return nil,errors.New("session refs exceed 50 entries")};for k,val:=range m{if sensitiveKey(k){return nil,fmt.Errorf("sensitive session ref key rejected: %s",k)};if !safeID.MatchString(k){return nil,fmt.Errorf("invalid session ref key: %s",k)};x:=strings.TrimSpace(fmt.Sprint(val));if len(x)>500{return nil,fmt.Errorf("session ref too large: %s",k)};out[k]=x};return out,nil}
func sessionID()string{return fmt.Sprintf("session-%x",time.Now().UTC().UnixNano())}

func agentCapabilitySnapshot()(map[string]any,string,error){
	id:="bootstrap-cap-"+fmt.Sprintf("%x",time.Now().UnixNano());cmd:=map[string]any{"protocolVersion":"2","messageId":id,"correlationId":id,"parentId":"","kind":"command","action":"agent.capabilities","schemaVersion":"2","timestamp":time.Now().UTC().UnixMilli(),"id":id,"params":map[string]any{}};b,_:=json.Marshal(cmd);raw,err:=proxy(b);if err!=nil{return nil,"",err};var result map[string]any;if err:=json.Unmarshal(raw,&result);err!=nil{return nil,"",err};sum:=sha256.Sum256(raw);return result,hex.EncodeToString(sum[:]),nil
}
func listSessionFiles()([]WorkSession,error){d,err:=sessionsDir();if err!=nil{return nil,err};entries,err:=os.ReadDir(d);if errors.Is(err,os.ErrNotExist){return []WorkSession{},nil};if err!=nil{return nil,err};out:=[]WorkSession{};for _,e:=range entries{if e.IsDir()||e.Name()=="active.json"||!strings.HasSuffix(e.Name(),".json"){continue};id:=strings.TrimSuffix(e.Name(),".json");s,er:=readSession(id);if er==nil{out=append(out,s)}};sort.Slice(out,func(i,j int)bool{return out[i].UpdatedAt>out[j].UpdatedAt});if len(out)>20{out=out[:20]};return out,nil}

func bootstrapResult()(map[string]any,error){
	var session any=nil;activeReady:=false;if s,err:=activeSession();err==nil{session=s;activeReady=s.State=="ready"}
	caps,capHash,capErr:=agentCapabilitySnapshot();jobs,_:=readJobs();observeJobStates(jobs);if len(jobs)>50{jobs=jobs[:50]};events,_:=readEvents("",100);arts,_:=artifactList(map[string]any{"limit":50});sessions,_:=listSessionFiles();ready:=activeReady&&capErr==nil
	result:=map[string]any{"ok":true,"schema":"sokna-bridge-bootstrap-v1","ready":ready,"protocol_version":"2","schema_version":"2","semantic_transport":"SOKNA-INTENT","legacy_command_carriers":[]string{},"control_plane_max_bytes":800,"artifact_chunk_max_bytes":maxArtifactChunk,"active_session":session,"recent_sessions":sessions,"jobs":jobs,"events":events,"outbound_artifacts":arts["artifacts"],"route_policy":map[string]any{"short_command":"semantic exec -> control","bounded_multi_step":"semantic batch -> job.batch","long_recoverable":"semantic job -> job.submit","large_bytes":"Artifact Plane by ref/hash","browser_interactive":"browser.tabs.list -> browser.tab.claim/open -> browser.page.snapshot -> ref-based page actions","browser_evidence":"browser.page.screenshot -> durable artifact_ref","browser_qa":"browser.audit.run compatibility/QA only","result_large_json":"result_ref/result.get","outbound_bytes":"artifact.out.publish + artifact.out.get"},"file_delivery_rules":map[string]any{"local_path_is_delivery":false,"public_https":"only sanitized URL without credentials","signed_or_credential_url":"protected ref only; never persist raw in chat","ai_file":"artifact_ref then artifact.out.get chunks, reconstruct/attach on AI side","user_file":"prefer AI attachment generated from artifact_ref; do not claim a PC path is downloadable"},"github_rules":map[string]any{"probe_capability":true,"workspace_permission_required":true,"use_agent_git_gh_actions":true,"direct_protected_branch_push":false},"session_rules":map[string]any{"mutation_requires_ready_session":true,"resume_without_user_reexplaining":true,"checkpoint_refs_no_secrets":true}}
	if capErr!=nil{result["agent_ready"]=false;result["agent_error"]=capErr.Error()}else{result["agent_ready"]=true;result["agent_capabilities"]=caps;result["agent_capabilities_sha256"]=capHash};return result,nil
}

func openSession(p map[string]any)(map[string]any,error){id:=strings.TrimSpace(fmt.Sprint(p["id"]));if id==""{id=sessionID()};if !safeID.MatchString(id){return nil,errors.New("invalid session id")};project:=strings.TrimSpace(fmt.Sprint(p["project"]));if project==""{project="SOKNA"};workspace:=strings.TrimSpace(fmt.Sprint(p["workspace"]));refs,err:=cleanRefs(p["refs"]);if err!=nil{return nil,err};now:=time.Now().UTC().UnixMilli();s:=WorkSession{Schema:"sokna-work-session-v1",ID:id,Project:project,Workspace:workspace,State:"ready",Phase:strings.TrimSpace(fmt.Sprint(p["phase"])),Summary:strings.TrimSpace(fmt.Sprint(p["summary"])),Refs:refs,ProtocolVersion:"2",SchemaVersion:"2",CreatedAt:now,UpdatedAt:now};if len(s.Summary)>4000{return nil,errors.New("session summary exceeds 4000 chars")};if err:=writeSession(s);err!=nil{return nil,err};if err:=setActiveSession(id);err!=nil{return nil,err};ev:=newEvent("session.opened");ev.State="ready";_ = appendActivity(ev);return map[string]any{"ok":true,"session":s,"ready":true},nil}
func resumeSession(p map[string]any)(map[string]any,error){id:=strings.TrimSpace(fmt.Sprint(p["id"]));var s WorkSession;var err error;if id==""{s,err=activeSession()}else{s,err=readSession(id)};if err!=nil{return nil,err};s.State="ready";s.UpdatedAt=time.Now().UTC().UnixMilli();if err:=writeSession(s);err!=nil{return nil,err};if err:=setActiveSession(s.ID);err!=nil{return nil,err};b,err:=bootstrapResult();if err!=nil{return nil,err};b["resumed_session"]=s;return b,nil}
func checkpointSession(p map[string]any)(map[string]any,error){s,err:=activeSession();if err!=nil{return nil,err};if v:=strings.TrimSpace(fmt.Sprint(p["phase"]));v!=""{s.Phase=v};if _,ok:=p["summary"];ok{s.Summary=strings.TrimSpace(fmt.Sprint(p["summary"]));if len(s.Summary)>4000{return nil,errors.New("session summary exceeds 4000 chars")}};if _,ok:=p["refs"];ok{refs,er:=cleanRefs(p["refs"]);if er!=nil{return nil,er};s.Refs=refs};s.UpdatedAt=time.Now().UTC().UnixMilli();if err:=writeSession(s);err!=nil{return nil,err};return map[string]any{"ok":true,"session":s},nil}
func closeSession()(map[string]any,error){s,err:=activeSession();if err!=nil{return nil,err};s.State="closed";s.UpdatedAt=time.Now().UTC().UnixMilli();if err:=writeSession(s);err!=nil{return nil,err};if err:=clearActiveSession();err!=nil{return nil,err};return map[string]any{"ok":true,"session":s},nil}

func localSession(c CommandEnvelope)(json.RawMessage,bool,error){
	if c.Action!="bridge.bootstrap"&&c.Action!="session.open"&&c.Action!="session.resume"&&c.Action!="session.checkpoint"&&c.Action!="session.close"&&c.Action!="session.list"{return nil,false,nil};p:=parseParams(c.Params);var r map[string]any;var err error
	switch c.Action{case "bridge.bootstrap":r,err=bootstrapResult();case "session.open":r,err=openSession(p);case "session.resume":r,err=resumeSession(p);case "session.checkpoint":r,err=checkpointSession(p);case "session.close":r,err=closeSession();case "session.list":ss,e:=listSessionFiles();err=e;r=map[string]any{"ok":e==nil,"sessions":ss}}
	if err!=nil{return nil,true,err};b,err:=json.Marshal(r);return b,true,err
}
