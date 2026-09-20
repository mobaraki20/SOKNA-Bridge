package main
import("encoding/json";"os";"path/filepath";"time")
func(s *JobStore)AppendEvent(e Event)error{
 if !safeID(e.JobID){return os.ErrInvalid}
 if e.CreatedAt.IsZero(){e.CreatedAt=time.Now()}
 if e.Seq==0{e.Seq=e.CreatedAt.UnixNano()}
 b,x:=json.Marshal(e);if x!=nil{return x}
 d:=filepath.Join(s.root,e.JobID);if x=os.MkdirAll(d,0755);x!=nil{return x}
 s.mu.Lock();defer s.mu.Unlock()
 f,x:=os.OpenFile(filepath.Join(d,"events.jsonl"),os.O_CREATE|os.O_APPEND|os.O_WRONLY,0644);if x!=nil{return x};defer f.Close()
 _,x=f.Write(append(b,'\n'));return x
}
