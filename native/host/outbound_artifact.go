package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxArtifactChunk = 512 * 1024

type artifactConfig struct { ArtifactRoot string `json:"artifact_root"` }
type ArtifactRef struct { ID string `json:"id"`; Name string `json:"name"`; Bytes int64 `json:"bytes"`; SHA256 string `json:"sha256"`; ContentType string `json:"content_type"`; CreatedAt int64 `json:"created_at"`; Delivery map[string]any `json:"delivery"` }
type artifactMeta struct { Schema string `json:"schema"`; Ref ArtifactRef `json:"artifact_ref"`; StoredName string `json:"stored_name"`; SourceClass string `json:"source_class"` }

func configuredArtifactRoot()(string,error){configPath,err:=resolveConfigPath();if err!=nil{return "",err};b,err:=os.ReadFile(configPath);if err!=nil{return "",err};var c artifactConfig;if err:=json.Unmarshal(b,&c);err!=nil{return "",err};if strings.TrimSpace(c.ArtifactRoot)==""{return "",errors.New("artifact_root missing from config")};root,err:=filepath.Abs(c.ArtifactRoot);if err!=nil{return "",err};return filepath.Clean(root),nil}
func withinRoot(root,candidate string)(string,error){root=filepath.Clean(root);if filepath.IsAbs(candidate){return "",errors.New("artifact path must be ArtifactRoot-relative")};full,err:=filepath.Abs(filepath.Join(root,filepath.Clean(candidate)));if err!=nil{return "",err};rel,err:=filepath.Rel(root,full);if err!=nil{return "",err};if rel==".."||strings.HasPrefix(rel,".."+string(filepath.Separator)){return "",errors.New("artifact path escapes ArtifactRoot")};return full,nil}
func safeArtifactName(name string)string{name=filepath.Base(strings.TrimSpace(name));if name=="."||name==""{return "artifact.bin"};var b strings.Builder;for _,r:=range name{if(r>='a'&&r<='z')||(r>='A'&&r<='Z')||(r>='0'&&r<='9')||strings.ContainsRune("._- ()",r){b.WriteRune(r)}else{b.WriteRune('_')}};out:=strings.TrimSpace(b.String());if out==""{out="artifact.bin"};if len(out)>180{out=out[:180]};return out}
func shaFile(path string)(string,int64,error){f,err:=os.Open(path);if err!=nil{return "",0,err};defer f.Close();h:=sha256.New();n,err:=io.Copy(h,f);if err!=nil{return "",0,err};return hex.EncodeToString(h.Sum(nil)),n,nil}
func outboundDirs(root string)(refs,data string){base:=filepath.Join(root,"outbound");return filepath.Join(base,"refs"),filepath.Join(base,"data")}
func writeArtifactMeta(root string,m artifactMeta)error{refs,_:=outboundDirs(root);if err:=os.MkdirAll(refs,0o700);err!=nil{return err};b,err:=json.MarshalIndent(m,"","  ");if err!=nil{return err};p:=filepath.Join(refs,m.Ref.ID+".json");tmp:=p+".tmp";if err:=os.WriteFile(tmp,b,0o600);err!=nil{return err};return os.Rename(tmp,p)}
func readArtifactMeta(root,id string)(artifactMeta,error){var m artifactMeta;if !safeID.MatchString(id){return m,errors.New("invalid artifact ref id")};refs,_:=outboundDirs(root);b,err:=os.ReadFile(filepath.Join(refs,id+".json"));if err!=nil{return m,err};if err:=json.Unmarshal(b,&m);err!=nil{return m,err};if m.Ref.ID!=id||m.Ref.SHA256!=id{return m,errors.New("artifact ref integrity mismatch")};return m,nil}
func artifactDataPath(root string,m artifactMeta)string{_,data:=outboundDirs(root);return filepath.Join(data,m.Ref.ID,m.StoredName)}

func publishArtifact(params map[string]any)(map[string]any,error){
	root,err:=configuredArtifactRoot();if err!=nil{return nil,err};rel:=strings.TrimSpace(fmt.Sprint(params["path"]));if rel==""{return nil,errors.New("artifact.out.publish requires path")};src,err:=withinRoot(root,rel);if err!=nil{return nil,err};st,err:=os.Stat(src);if err!=nil{return nil,err};if st.IsDir(){return nil,errors.New("outbound artifact must be a file")};sha,size,err:=shaFile(src);if err!=nil{return nil,err};name:=safeArtifactName(fmt.Sprint(params["name"]));if name=="artifact.bin"{name=safeArtifactName(filepath.Base(src))};_,data:=outboundDirs(root);dataDir:=filepath.Join(data,sha);if err:=os.MkdirAll(dataDir,0o700);err!=nil{return nil,err};dst:=filepath.Join(dataDir,name)
	if _,err:=os.Stat(dst);errors.Is(err,os.ErrNotExist){in,err:=os.Open(src);if err!=nil{return nil,err};defer in.Close();out,err:=os.OpenFile(dst+".tmp",os.O_CREATE|os.O_TRUNC|os.O_WRONLY,0o600);if err!=nil{return nil,err};_,cpErr:=io.Copy(out,in);closeErr:=out.Close();if cpErr!=nil{return nil,cpErr};if closeErr!=nil{return nil,closeErr};if err:=os.Rename(dst+".tmp",dst);err!=nil{return nil,err}}
	check,checkSize,err:=shaFile(dst);if err!=nil{return nil,err};if check!=sha||checkSize!=size{return nil,errors.New("outbound artifact copy integrity mismatch")};ct:=mime.TypeByExtension(strings.ToLower(filepath.Ext(name)));if ct==""{ct="application/octet-stream"};ref:=ArtifactRef{ID:sha,Name:name,Bytes:size,SHA256:sha,ContentType:ct,CreatedAt:time.Now().UTC().UnixMilli(),Delivery:map[string]any{"ai":"artifact.out.get","user":"ai_attachment","chunk_bytes":maxArtifactChunk,"public_url":false,"local_path_is_delivery":false}};meta:=artifactMeta{Schema:"sokna-outbound-artifact-v1",Ref:ref,StoredName:name,SourceClass:"artifact-root"};if err:=writeArtifactMeta(root,meta);err!=nil{return nil,err};ev:=newEvent("artifact.published");ev.State="ready";ev.Action="artifact.out.publish";_ = appendActivity(ev);return map[string]any{"ok":true,"artifact_ref":ref},nil
}
func getArtifactChunk(params map[string]any)(map[string]any,error){root,err:=configuredArtifactRoot();if err!=nil{return nil,err};id:=strings.TrimSpace(fmt.Sprint(params["id"]));m,err:=readArtifactMeta(root,id);if err!=nil{return nil,err};p:=artifactDataPath(root,m);st,err:=os.Stat(p);if err!=nil{return nil,err};offset:=int64(intParam(params,"offset",0));if offset<0{offset=0};if offset>st.Size(){offset=st.Size()};limit:=int64(intParam(params,"limit",256*1024));if limit<1{limit=1};if limit>maxArtifactChunk{limit=maxArtifactChunk};f,err:=os.Open(p);if err!=nil{return nil,err};defer f.Close();if _,err:=f.Seek(offset,io.SeekStart);err!=nil{return nil,err};buf:=make([]byte,limit);n,err:=f.Read(buf);if err!=nil&&!errors.Is(err,io.EOF){return nil,err};buf=buf[:n];next:=offset+int64(n);eof:=next>=st.Size();return map[string]any{"ok":true,"artifact_ref":m.Ref,"offset":offset,"next_offset":next,"eof":eof,"data_b64":base64.StdEncoding.EncodeToString(buf)},nil}
func artifactInfo(params map[string]any)(map[string]any,error){root,err:=configuredArtifactRoot();if err!=nil{return nil,err};id:=strings.TrimSpace(fmt.Sprint(params["id"]));m,err:=readArtifactMeta(root,id);if err!=nil{return nil,err};return map[string]any{"ok":true,"artifact_ref":m.Ref},nil}
func artifactList(params map[string]any)(map[string]any,error){root,err:=configuredArtifactRoot();if err!=nil{return nil,err};refs,_:=outboundDirs(root);entries,err:=os.ReadDir(refs);if errors.Is(err,os.ErrNotExist){return map[string]any{"ok":true,"artifacts":[]ArtifactRef{}},nil};if err!=nil{return nil,err};items:=make([]ArtifactRef,0,len(entries));for _,e:=range entries{if e.IsDir()||!strings.HasSuffix(e.Name(),".json"){continue};id:=strings.TrimSuffix(e.Name(),".json");m,er:=readArtifactMeta(root,id);if er==nil{items=append(items,m.Ref)}};sort.Slice(items,func(i,j int)bool{return items[i].CreatedAt>items[j].CreatedAt});limit:=intParam(params,"limit",50);if limit<1{limit=1};if limit>200{limit=200};if len(items)>limit{items=items[:limit]};return map[string]any{"ok":true,"artifacts":items},nil}


const maxExtensionArtifactBytes = 32 * 1024 * 1024

func ingestOutboundArtifact(params map[string]any)(map[string]any,error){
	root,err:=configuredArtifactRoot();if err!=nil{return nil,err}
	name:=safeArtifactName(fmt.Sprint(params["name"]));if name=="artifact.bin"{return nil,errors.New("artifact.out.ingest requires name")}
	contentType:=strings.ToLower(strings.TrimSpace(fmt.Sprint(params["content_type"])))
	switch contentType{
	case "image/png","image/jpeg","image/webp","application/json","text/plain":
	default:return nil,errors.New("ARTIFACT_INGEST_CONTENT_TYPE_NOT_ALLOWED")
	}
	dataB64:=strings.TrimSpace(fmt.Sprint(params["data_b64"]));if dataB64==""{return nil,errors.New("artifact.out.ingest requires data_b64")}
	if len(dataB64)>((maxExtensionArtifactBytes+2)/3)*4+16{return nil,errors.New("ARTIFACT_INGEST_TOO_LARGE")}
	data,err:=base64.StdEncoding.DecodeString(dataB64);if err!=nil{return nil,errors.New("ARTIFACT_INGEST_BASE64_INVALID")}
	if len(data)==0||len(data)>maxExtensionArtifactBytes{return nil,errors.New("ARTIFACT_INGEST_SIZE_INVALID")}
	ext:=strings.ToLower(filepath.Ext(name))
	expectedExt:=map[string][]string{"image/png":{".png"},"image/jpeg":{".jpg",".jpeg"},"image/webp":{".webp"},"application/json":{".json"},"text/plain":{".txt",".log"}}[contentType]
	okExt:=false;for _,x:=range expectedExt{if ext==x{okExt=true;break}};if !okExt{return nil,errors.New("ARTIFACT_INGEST_EXTENSION_MISMATCH")}
	stageDir:=filepath.Join(root,"staging","extension-ingest");if err:=os.MkdirAll(stageDir,0o700);err!=nil{return nil,err}
	stage:=filepath.Join(stageDir,fmt.Sprintf("%d-%s",time.Now().UTC().UnixNano(),name))
	if err:=os.WriteFile(stage,data,0o600);err!=nil{return nil,err};defer os.Remove(stage)
	rel,err:=filepath.Rel(root,stage);if err!=nil{return nil,err}
	out,err:=publishArtifact(map[string]any{"path":filepath.ToSlash(rel),"name":name});if err!=nil{return nil,err}
	if ref,ok:=out["artifact_ref"].(ArtifactRef);ok{ref.ContentType=contentType;out["artifact_ref"]=ref}
	return out,nil
}

func handleOutboundArtifactIngest(m InMsg) OutMsg {
	var p map[string]any
	if len(m.Params)==0||json.Unmarshal(m.Params,&p)!=nil{return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:"ARTIFACT_INGEST_PARAMS_INVALID"}}
	result,err:=ingestOutboundArtifact(p);if err!=nil{return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}}
	b,err:=json.Marshal(result);if err!=nil{return OutMsg{OK:false,RequestID:m.RequestID,Version:version,Error:err.Error()}}
	return OutMsg{OK:true,Type:"artifact.out.ingested",RequestID:m.RequestID,Version:version,Result:b}
}

func localOutbound(c CommandEnvelope)(json.RawMessage,bool,error){
	if r,handled,err:=localSession(c);handled{return r,true,err}
	if r,handled,err:=localBrowserAudit(c);handled{return r,true,err}
	if c.Action!="artifact.out.publish"&&c.Action!="artifact.out.get"&&c.Action!="artifact.out.info"&&c.Action!="artifact.out.list"{return nil,false,nil}
	p:=parseParams(c.Params);var result map[string]any;var err error;switch c.Action{case "artifact.out.publish":result,err=publishArtifact(p);case "artifact.out.get":result,err=getArtifactChunk(p);case "artifact.out.info":result,err=artifactInfo(p);case "artifact.out.list":result,err=artifactList(p)};if err!=nil{return nil,true,err};b,err:=json.Marshal(result);return b,true,err
}
