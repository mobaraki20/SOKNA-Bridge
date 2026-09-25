(()=>{
"use strict";
importScripts("protocol.js","capability_gate.js");
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const CAP=globalThis.__SOKNA_CAPABILITY_GATE_V1__;
const HOST="com.sokna.bridge.v3";
const event=chrome.runtime.onMessage;
const originalAdd=event.addListener.bind(event);
const ID=/^[A-Za-z0-9._-]{1,96}$/;
const bootstrappedConversations=new Set();
function idOf(m){const id=String(m?.command?.id||m?.command?.correlationId||"");return ID.test(id)?id:""}
function uid(prefix="cap"){return crypto.randomUUID?.()||(`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)}
function conversationKey(sender){try{const u=new URL(sender?.url||sender?.tab?.url||"");return `${sender?.tab?.id??"?"}:${u.origin}${u.pathname}`}catch{return `${sender?.tab?.id??"?"}:unknown`}}
function rejection(m,error,reason="invalid_compact_command",retryable=false){const cid=idOf(m);return {type:"TRANSPORT_DIAG",diagnostic:{kind:"background-command-rejected",final:!!cid,reason,version:"unified-background-gate-v3",commandId:cid,source:String(m?.source||m?.detector||"background-gate"),error:String(error||"REJECTED"),executed:false,retryable:!!retryable}}}
function nativeMessage(msg){return new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,msg,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}))}
function unifiedCommand(action,params={}){const id=uid("bridge"),ts=Date.now();return {protocolVersion:"2",messageId:id,correlationId:id,parentId:"",kind:"command",action,schemaVersion:"2",timestamp:ts,id,params}}
function capabilityCommand(){return unifiedCommand("agent.capabilities",{})}
const bridgeLocalActions=["artifact.chat.apply","job.list","job.events","bridge.activity","artifact.out.publish","artifact.out.get","artifact.out.info","artifact.out.list","browser.audit.run","bridge.bootstrap","session.open","session.resume","session.checkpoint","session.close","session.list"];
const recoveryActions=new Set(["ping","agent.capabilities","bridge.bootstrap","session.open","session.resume","session.list","session.close","job.list","job.events","bridge.activity","artifact.out.get","artifact.out.info","artifact.out.list","result.get","workspace.registry.status","workspace.list","workspace.inspect","browser.qa.status","artifact.root.status","artifact.provider.status"]);
const capabilityGate=CAP?.create?.({ttlMs:60000,extensionActions:bridgeLocalActions,fetchCapabilities:async()=>{const command=capabilityCommand();const r=await nativeMessage({type:"agent.exec",request_id:uid("cap-request"),command});if(!r?.ok)throw new Error(r?.error||"CAPABILITY_NATIVE_REQUEST_FAILED");const result=r?.result||{};if(result?.ok===false)throw new Error(result?.error||"CAPABILITY_AGENT_REQUEST_FAILED");const actions=result?.capabilities?.actions;if(!Array.isArray(actions)||!actions.length)throw new Error("CAPABILITY_ACTIONS_MISSING");return actions}});
if(!capabilityGate)throw new Error("BACKGROUND_CAPABILITY_GATE_UNAVAILABLE");
async function directLocal(action,params={}){const command=unifiedCommand(action,params);const r=await nativeMessage({type:"agent.exec",request_id:uid("local-request"),command});if(!r?.ok)throw new Error(r?.error||`${action}:NATIVE_REQUEST_FAILED`);const result=r?.result||{};if(result?.ok===false)throw new Error(result?.error||`${action}:REQUEST_FAILED`);return result}
async function activitySnapshot(m){const limit=Math.min(Math.max(Number(m?.limit)||50,1),200);const jobId=String(m?.jobId||"").trim();return await directLocal(jobId?"job.events":"bridge.activity",jobId?{id:jobId,limit}:{limit})}
async function ensureSessionGate(m,sender){
  const action=String(m?.command?.action||"");
  if(recoveryActions.has(action)){
    if(action==="bridge.bootstrap"){
      await directLocal("bridge.bootstrap",{});
      bootstrappedConversations.add(conversationKey(sender));
    }
    return {ok:true,recovery:true};
  }
  const key=conversationKey(sender);
  if(!bootstrappedConversations.has(key))return {ok:false,code:"BOOTSTRAP_REQUIRED",error:"This chat/conversation must execute bridge.bootstrap before mutation/execution."};
  let b;try{b=await directLocal("bridge.bootstrap",{})}catch(e){return {ok:false,code:"BOOTSTRAP_UNAVAILABLE",error:String(e)}}
  if(b?.ready!==true)return {ok:false,code:"SESSION_NOT_READY",error:"Bridge bootstrap is not ready. Open or resume a persistent work session first."};
  return {ok:true,session:b.active_session||null};
}
function wrapListener(listener){return function(m,sender,reply){
  if(m?.type==="ACTIVITY_SNAPSHOT"){activitySnapshot(m).then(x=>reply({ok:true,activity:x}),e=>reply({ok:false,error:String(e)}));return true}
  if(m?.type!=="COMMAND")return listener(m,sender,reply);
  if(!m?.semantic)return listener(rejection(m,"SEMANTIC_ROUTE_REQUIRED"),sender,reply);
  const v=PROTO?.validateEnvelope?.(m.command,{kind:"command"})||{ok:false,error:"PROTOCOL_VALIDATOR_UNAVAILABLE"};if(!v.ok)return listener(rejection(m,"UNIFIED_ENVELOPE_INVALID:"+String(v.error||"UNKNOWN")),sender,reply);
  capabilityGate.check(m.command.action).then(async g=>{
    if(!g?.ok)return listener(rejection(m,`${g?.code||"CAPABILITY_PREFLIGHT_FAILED"}:${g?.error||m.command.action}`),sender,reply);
    const gate=await ensureSessionGate(m,sender);
    if(!gate.ok)return listener(rejection(m,`${gate.code}:${gate.error}`,"session_gate_rejected",true),sender,reply);
    return listener(m,sender,reply);
  }).catch(e=>listener(rejection(m,"PREFLIGHT_FAILED:"+String(e),"session_gate_rejected",true),sender,reply));
  return true
}}
try{event.addListener=function(listener){return originalAdd(wrapListener(listener))}}catch(e){throw new Error("BACKGROUND_FAIL_CLOSED_GATE_INSTALL_FAILED:"+String(e))}
importScripts("background.js");
})();
