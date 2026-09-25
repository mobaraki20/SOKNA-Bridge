(()=>{
"use strict";
importScripts("protocol.js","capability_gate.js");
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const CAP=globalThis.__SOKNA_CAPABILITY_GATE_V1__;
const HOST="com.sokna.bridge.v3";
const event=chrome.runtime.onMessage;
const originalAdd=event.addListener.bind(event);
const ID=/^[A-Za-z0-9._-]{1,96}$/;
function idOf(m){const id=String(m?.command?.id||m?.command?.correlationId||"");return ID.test(id)?id:""}
function uid(prefix="cap"){return crypto.randomUUID?.()||(`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)}
function rejection(m,error){
  const cid=idOf(m);
  return {
    type:"TRANSPORT_DIAG",
    diagnostic:{
      kind:"background-command-rejected",
      final:!!cid,
      reason:"invalid_compact_command",
      version:"unified-background-gate-v2",
      commandId:cid,
      source:String(m?.source||m?.detector||"background-gate"),
      error:String(error||"UNIFIED_ENVELOPE_INVALID"),
      executed:false,
      retryable:false
    }
  };
}
function nativeMessage(msg){
  return new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,msg,r=>{
    const e=chrome.runtime.lastError;
    if(e)reject(new Error(e.message));else resolve(r||{});
  }));
}
function unifiedCommand(action,params={}){
  const id=uid("bridge"),ts=Date.now();
  return {protocolVersion:"2",messageId:id,correlationId:id,parentId:"",kind:"command",action,schemaVersion:"2",timestamp:ts,id,params};
}
function capabilityCommand(){return unifiedCommand("agent.capabilities",{})}
const capabilityGate=CAP?.create?.({
  ttlMs:60000,
  extensionActions:["artifact.chat.apply","job.list","job.events","bridge.activity"],
  fetchCapabilities:async()=>{
    const command=capabilityCommand();
    const r=await nativeMessage({type:"agent.exec",request_id:uid("cap-request"),command});
    if(!r?.ok)throw new Error(r?.error||"CAPABILITY_NATIVE_REQUEST_FAILED");
    const result=r?.result||{};
    if(result?.ok===false)throw new Error(result?.error||"CAPABILITY_AGENT_REQUEST_FAILED");
    const actions=result?.capabilities?.actions;
    if(!Array.isArray(actions)||!actions.length)throw new Error("CAPABILITY_ACTIONS_MISSING");
    return actions;
  }
});
if(!capabilityGate)throw new Error("BACKGROUND_CAPABILITY_GATE_UNAVAILABLE");
async function activitySnapshot(m){
  const limit=Math.min(Math.max(Number(m?.limit)||50,1),200);
  const jobId=String(m?.jobId||"").trim();
  const action=jobId?"job.events":"bridge.activity";
  const params=jobId?{id:jobId,limit}:{limit};
  const command=unifiedCommand(action,params);
  const r=await nativeMessage({type:"agent.exec",request_id:uid("activity-request"),command});
  if(!r?.ok)throw new Error(r?.error||"ACTIVITY_NATIVE_REQUEST_FAILED");
  const result=r?.result||{};
  if(result?.ok===false)throw new Error(result?.error||"ACTIVITY_REQUEST_FAILED");
  return result;
}
function wrapListener(listener){
  return function(m,sender,reply){
    if(m?.type==="ACTIVITY_SNAPSHOT"){
      activitySnapshot(m).then(x=>reply({ok:true,activity:x}),e=>reply({ok:false,error:String(e)}));
      return true;
    }
    if(m?.type!=="COMMAND")return listener(m,sender,reply);
    if(!m?.semantic)return listener(rejection(m,"SEMANTIC_ROUTE_REQUIRED"),sender,reply);
    const v=PROTO?.validateEnvelope?.(m.command,{kind:"command"})||{ok:false,error:"PROTOCOL_VALIDATOR_UNAVAILABLE"};
    if(!v.ok)return listener(rejection(m,"UNIFIED_ENVELOPE_INVALID:"+String(v.error||"UNKNOWN")),sender,reply);
    capabilityGate.check(m.command.action).then(g=>{
      if(!g?.ok)return listener(rejection(m,`${g?.code||"CAPABILITY_PREFLIGHT_FAILED"}:${g?.error||m.command.action}`),sender,reply);
      return listener(m,sender,reply);
    }).catch(e=>listener(rejection(m,"CAPABILITY_PREFLIGHT_FAILED:"+String(e)),sender,reply));
    return true;
  };
}
try{
  event.addListener=function(listener){return originalAdd(wrapListener(listener))};
}catch(e){
  throw new Error("BACKGROUND_FAIL_CLOSED_GATE_INSTALL_FAILED:"+String(e));
}
importScripts("background.js");
})();
