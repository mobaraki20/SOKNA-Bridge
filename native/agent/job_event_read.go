package main

import (
 "bufio"
 "encoding/json"
 "os"
 "path/filepath"
)

func(s *JobStore) ReadEvents(id string)([]Event,error){
 if !safeID(id){ return nil,os.ErrInvalid }
 f,e:=os.Open(filepath.Join(s.root,id,"events.jsonl"))
 if os.IsNotExist(e){ return []Event{},nil }
 if e!=nil{return nil,e}
 defer f.Close()
 out:=[]Event{}
 sc:=bufio.NewScanner(f)
 for sc.Scan(){ var v Event; if json.Unmarshal(sc.Bytes(),&v)==nil{out=append(out,v)} }
 return out,sc.Err()
}
