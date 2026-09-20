package main

import("flag";"fmt";"log";"net/http")
func main(){
 p:=flag.Int("port",8767,"listen port");flag.Parse()
 s:=&StatusStore{};s.Update(func(v *AgentStatus){v.State="online"})
 m:=http.NewServeMux();m.HandleFunc("/health",healthHandler);m.HandleFunc("/status",statusHandler(s))
 a:=fmt.Sprintf("127.0.0.1:%d",*p);log.Fatal(http.ListenAndServe(a,m))
}

