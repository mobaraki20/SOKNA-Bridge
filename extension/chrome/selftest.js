(()=>{
"use strict";
const HOST="com.sokna.bridge.v3";
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const CORE=globalThis.__SOKNA_SEMANTIC_CORE_V1__;
const log=document.getElementById("log"),status=document.getElementById("status");
const say=s=>{log.textContent+=s+"\n"};
const uid=p=>p+"-"+(crypto.randomUUID?.()||Date.now());
const native=m=>new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,m,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}));
const command=(action,params={})=>PROTO.commandEnvelope({id:uid("selftest"),action,params});
async function step(name,fn){
  say(name+"…");
  await fn();
  say("  PASS");
}
(async()=>{
try{
  if(!PROTO||!CORE)throw new Error("Current semantic protocol modules are unavailable");
  await step("1/6 Protocol v2 envelope validation",async()=>{
    const c=command("ping",{});
    const v=PROTO.validateEnvelope(c,{kind:"command"});
    if(!v?.ok)throw new Error(v?.error||"valid command rejected");
    const bad={...c,protocolVersion:"1"};
    if(PROTO.validateEnvelope(bad,{kind:"command"})?.ok)throw new Error("unsupported protocol accepted");
    if(PROTO.bytes("سلام")<=4)throw new Error("UTF-8 byte accounting failed");
  });
  await step("2/6 Semantic compiler",async()=>{
    const r=CORE.compile({intent:"exec",action:"ping",params:{}},()=>uid("semantic"));
    if(!r?.ok||r.command?.action!=="ping"||r.route!=="control")throw new Error(r?.message||r?.code||"semantic compile failed");
    if(!PROTO.validateEnvelope(r.command,{kind:"command"})?.ok)throw new Error("compiled command envelope invalid");
  });
  await step("3/6 Native Messaging host",async()=>{
    const r=await native({type:"host.ping",request_id:uid("host")});
    if(!r?.ok)throw new Error(r?.error||"host ping failed");
  });
  await step("4/6 Windows Agent round-trip",async()=>{
    const r=await native({type:"agent.exec",request_id:uid("agent"),command:command("ping",{})});
    if(!r?.ok||!r.result?.ok)throw new Error(r?.error||r?.result?.error||"agent ping failed");
  });
  await step("5/6 Capability discovery",async()=>{
    const r=await native({type:"agent.exec",request_id:uid("caps"),command:command("agent.capabilities",{})});
    const a=r?.result?.capabilities?.actions||r?.result?.actions||[];
    if(!r?.ok||!r.result?.ok||!Array.isArray(a)||!a.includes("workspace.list"))throw new Error(r?.error||"capabilities missing");
  });
  await step("6/6 Bridge bootstrap",async()=>{
    const r=await native({type:"agent.exec",request_id:uid("bootstrap"),command:command("bridge.bootstrap",{})});
    if(!r?.ok||!r.result?.ok||String(r.result?.protocol_version||"")!=="2")throw new Error(r?.error||r?.result?.error||"bootstrap failed");
  });
  status.textContent="PASS — Semantic v2 / Native Host / Agent سالم هستند";
  status.style.background="#e7f6ec";status.style.color="#11643d";
  say("\nSelf Test کامل شد. این نتیجه به معنی اتصال خودکار به یک Chat نیست؛ اتصال هر گفتگو از Popup با «Connect this Chat» انجام می‌شود.");
}catch(e){
  const msg=String(e?.stack||e);say("FAIL - "+msg);
  status.textContent="FAIL — "+String(e?.message||e);
  status.style.background="#fde8e7";status.style.color="#8a1c1c";
}
})();
})();