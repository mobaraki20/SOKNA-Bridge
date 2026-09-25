package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type auditViewport struct { ID string `json:"id"`; Width int `json:"width"`; Height int `json:"height"`; DPR float64 `json:"dpr,omitempty"` }
type auditPage struct { ID string `json:"id"`; URL string `json:"url"`; Actions []map[string]any `json:"actions,omitempty"`; Assertions []map[string]any `json:"assertions,omitempty"`; Captures map[string]any `json:"captures,omitempty"`; Setup map[string]any `json:"setup,omitempty"`; Visual map[string]any `json:"visual,omitempty"`; BaselineID string `json:"baseline_id,omitempty"` }
type auditRequest struct { Workspace string `json:"workspace"`; AllowedOrigins []string `json:"allowed_origins"`; Viewports []auditViewport `json:"viewports,omitempty"`; Pages []auditPage `json:"pages"`; JobID string `json:"job_id,omitempty"` }

func auditOrigin(raw string)(string,error){u,err:=url.Parse(raw);if err!=nil||u.Scheme==""||u.Host==""{return "",errors.New("invalid audit URL")};if u.Scheme!="http"&&u.Scheme!="https"{return "",errors.New("audit URL must use http/https")};return strings.ToLower(u.Scheme+"://"+u.Host),nil}
func auditID(s string)bool{return safeID.MatchString(s)}
func browserExecutable()(string,error){root,err:=installRoot();if err!=nil{return "",err};name:="sokna-browser-qa";if runtime.GOOS=="windows"{name+=".exe"};p:=filepath.Join(root,"browser",name);if st,err:=os.Stat(p);err!=nil||st.IsDir(){return "",fmt.Errorf("browser QA runner not found: %s",p)};return p,nil}
func verifyBrowserWorkspace(workspace string)error{id:="audit-ws-"+fmt.Sprint(time.Now().UnixNano());cmd:=map[string]any{"protocolVersion":"2","messageId":id,"correlationId":id,"parentId":"","kind":"command","action":"workspace.inspect","schemaVersion":"2","timestamp":time.Now().UTC().UnixMilli(),"id":id,"params":map[string]any{"workspace":workspace}};b,_:=json.Marshal(cmd);raw,err:=proxy(b);if err!=nil{return err};var r map[string]any;if json.Unmarshal(raw,&r)!=nil{return errors.New("workspace inspection result invalid")};if ok,v:=r["ok"].(bool);ok&&!v{return errors.New("workspace inspection failed")};tools,_:=r["tools"].([]any);for _,t:=range tools{if strings.EqualFold(fmt.Sprint(t),"browser"){return nil}};return errors.New("workspace does not allow browser tool")}
func defaultAuditViewports()[]auditViewport{return []auditViewport{{ID:"desktop",Width:1366,Height:768,DPR:1},{ID:"mobile",Width:390,Height:844,DPR:1}}}
func defaultAuditAssertions()[]map[string]any{return []map[string]any{{"type":"no_horizontal_overflow"},{"type":"console_errors_max","max":0},{"type":"network_failures_max","max":0}}}
func defaultAuditCaptures()map[string]any{return map[string]any{"screenshot":true,"full_page":true,"dom":true,"geometry":true,"a11y":true,"console":true,"network":true,"slow_resource_ms":2000}}
func safeAuditRel(root,path string)(string,error){root=filepath.Clean(root);full,err:=filepath.Abs(path);if err!=nil{return "",err};rel,err:=filepath.Rel(root,full);if err!=nil{return "",err};if rel==".."||strings.HasPrefix(rel,".."+string(filepath.Separator)){return "",errors.New("audit artifact escaped ArtifactRoot")};return filepath.ToSlash(rel),nil}

func runBrowserAudit(params map[string]any)(map[string]any,error){
	b,_:=json.Marshal(params);var req auditRequest;if err:=json.Unmarshal(b,&req);err!=nil{return nil,err};req.Workspace=strings.TrimSpace(req.Workspace);if req.Workspace==""{return nil,errors.New("browser.audit.run requires workspace")};if len(req.Pages)<1||len(req.Pages)>12{return nil,errors.New("browser audit pages must contain 1..12 entries")};if len(req.AllowedOrigins)<1||len(req.AllowedOrigins)>20{return nil,errors.New("browser audit requires 1..20 allowed_origins")}
	allowed:=map[string]bool{};for _,o:=range req.AllowedOrigins{x,err:=auditOrigin(o);if err!=nil{return nil,fmt.Errorf("invalid allowed origin: %w",err)};allowed[x]=true};if len(req.Viewports)==0{req.Viewports=defaultAuditViewports()};if len(req.Viewports)>12{return nil,errors.New("max 12 audit viewports")};if err:=verifyBrowserWorkspace(req.Workspace);err!=nil{return nil,err}
	root,err:=configuredArtifactRoot();if err!=nil{return nil,err};runner,err:=browserExecutable();if err!=nil{return nil,err};auditIDValue:="audit-"+fmt.Sprintf("%x",time.Now().UTC().UnixNano());stage:=filepath.Join(root,"staging","browser-audit",auditIDValue);outRoot:=filepath.Join(root,"browser","audits",auditIDValue);if err:=os.MkdirAll(stage,0o700);err!=nil{return nil,err};if err:=os.MkdirAll(outRoot,0o700);err!=nil{return nil,err};defer os.RemoveAll(stage)
	pageResults:=make([]map[string]any,0,len(req.Pages));overall:=true
	for i,p:=range req.Pages{
		p.ID=strings.TrimSpace(p.ID);if p.ID==""{p.ID=fmt.Sprintf("page-%02d",i+1)};if !auditID(p.ID){return nil,fmt.Errorf("invalid audit page id: %s",p.ID)};origin,err:=auditOrigin(p.URL);if err!=nil{return nil,err};if !allowed[origin]{return nil,fmt.Errorf("audit page origin not allowed: %s",origin)}
		assertions:=p.Assertions;if len(assertions)==0{assertions=defaultAuditAssertions()};captures:=p.Captures;if len(captures)==0{captures=defaultAuditCaptures()};recipe:=map[string]any{"schema":"sokna-browser-recipe-v1","scenario_id":auditIDValue+"-"+p.ID,"url":p.URL,"workspace":req.Workspace,"job_id":req.JobID,"allowed_origins":req.AllowedOrigins,"viewports":req.Viewports,"actions":p.Actions,"assertions":assertions,"captures":captures,"setup":p.Setup,"visual":p.Visual}
		recipePath:=filepath.Join(stage,p.ID+".json");rb,_:=json.MarshalIndent(recipe,"","  ");if err:=os.WriteFile(recipePath,rb,0o600);err!=nil{return nil,err};pageOut:=filepath.Join(outRoot,p.ID);if err:=os.MkdirAll(pageOut,0o700);err!=nil{return nil,err};args:=[]string{"run","--recipe",recipePath,"--artifact-root",root,"--output-dir",pageOut,"--max-run-bytes","268435456","--workspace",req.Workspace};if req.JobID!=""{args=append(args,"--job-id",req.JobID)};if p.BaselineID!=""{if !auditID(p.BaselineID){return nil,errors.New("invalid baseline id")};base:=filepath.Join(root,"browser","baselines",p.BaselineID);if st,err:=os.Stat(base);err!=nil||!st.IsDir(){return nil,fmt.Errorf("baseline not found: %s",p.BaselineID)};args=append(args,"--baseline-dir",base)}
		cmd:=exec.Command(runner,args...);cmd.Env=os.Environ();var stdout,stderr bytes.Buffer;cmd.Stdout=&stdout;cmd.Stderr=&stderr;runErr:=cmd.Run();if runErr!=nil&&stdout.Len()==0{return nil,fmt.Errorf("browser audit %s failed: %s",p.ID,strings.TrimSpace(stderr.String()))};var summary map[string]any;if err:=json.Unmarshal(bytes.TrimSpace(stdout.Bytes()),&summary);err!=nil{return nil,fmt.Errorf("browser audit %s invalid result: %w",p.ID,err)};ok,_:=summary["ok"].(bool);if !ok{overall=false}
		refs:=make([]any,0);walkErr:=filepath.Walk(pageOut,func(path string,info os.FileInfo,walkErr error)error{if walkErr!=nil{return walkErr};if info==nil||info.IsDir(){return nil};ext:=strings.ToLower(filepath.Ext(path));base:=strings.ToLower(filepath.Base(path));if ext!=".png"&&base!="report.json"{return nil};rel,er:=safeAuditRel(root,path);if er!=nil{return er};pub,er:=publishArtifact(map[string]any{"path":rel,"name":auditIDValue+"-"+p.ID+"-"+filepath.Base(path)});if er!=nil{return er};refs=append(refs,pub["artifact_ref"]);return nil});if walkErr!=nil{return nil,walkErr}
		pageResults=append(pageResults,map[string]any{"id":p.ID,"url":p.URL,"ok":ok,"status":summary["status"],"findings":summary["findings"],"evidence":refs,"stderr":strings.TrimSpace(stderr.String())})
	}
	ev:=newEvent("browser.audit.completed");if overall{ev.State="completed"}else{ev.State="failed"};ev.Action="browser.audit.run";_ = appendActivity(ev);return map[string]any{"ok":overall,"schema":"sokna-browser-audit-result-v1","audit_id":auditIDValue,"workspace":req.Workspace,"pages":pageResults,"evidence_delivery":"artifact.out.get","manual_screenshot_transfer_required":false},nil
}

func localBrowserAudit(c CommandEnvelope)(json.RawMessage,bool,error){if c.Action!="browser.audit.run"{return nil,false,nil};r,err:=runBrowserAudit(parseParams(c.Params));if err!=nil{return nil,true,err};b,err:=json.Marshal(r);return b,true,err}
