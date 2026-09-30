(()=>{
"use strict";
importScripts("protocol.js","capability_gate.js","terminal_outcome_core.js","origin_registry_core.js","session_gate_state_core.js","action_contracts_core.js");
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const CAP=globalThis.__SOKNA_CAPABILITY_GATE_V1__;
const ORIGIN=globalThis.__SOKNA_CHAT_ORIGIN_REGISTRY_V1__;
const GATECORE=globalThis.__SOKNA_SESSION_GATE_STATE_CORE_V1__;
const HOST="com.sokna.bridge.v3";
const event=chrome.runtime.onMessage;
const originalAdd=event.addListener.bind(event);
const rawNativeSend=chrome.runtime.sendNativeMessage.bind(chrome.runtime);
const ID=/^[A-Za-z0-9._-]{1,96}$/;
const SHA=/^[a-f0-9]{64}$/i;
const MAX_CHAT_ATTACHMENT_BYTES=64*1024*1024;
const OUT_CHUNK_BYTES=192*1024;
const BOOTSTRAP_GATE_KEY="bootstrap_gate_v1";
const commandTabs=new Map();
function idOf(m){const id=String(m?.command?.id||m?.command?.correlationId||"");return ID.test(id)?id:""}
function uid(prefix="cap"){return crypto.randomUUID?.()||(`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)}
function conversationKey(sender){const url=sender?.url||sender?.tab?.url||"",key=ORIGIN?.conversationKey?.(url)||"";return `${sender?.tab?.id??"?"}:${key||"unknown"}`}
async function gateAll(){const d=await chrome.storage.session.get([BOOTSTRAP_GATE_KEY]);return d[BOOTSTRAP_GATE_KEY]||{}}
async function saveGate(v){await chrome.storage.session.set({[BOOTSTRAP_GATE_KEY]:v})}
function senderIdentity(sender){return GATECORE.identity(sender?.tab?.id,sender?.url||sender?.tab?.url||"",ORIGIN)}
async function markBootstrappedSender(sender){const cur=senderIdentity(sender);if(!cur.origin||cur.tabId===null)return false;const all=await gateAll();all[String(cur.tabId)]=GATECORE.recordFor(cur,Date.now());await saveGate(all);return true}
async function markBootstrappedTab(tabId,url){const cur=GATECORE.identity(tabId,url,ORIGIN);if(!cur.origin||cur.tabId===null)return false;const all=await gateAll();all[String(cur.tabId)]=GATECORE.recordFor(cur,Date.now());await saveGate(all);return true}
async function hasBootstrappedSender(sender){const cur=senderIdentity(sender),all=await gateAll(),rec=all[String(cur.tabId)],chk=GATECORE.check(rec,cur);if(chk.ok&&chk.migrate){all[String(cur.tabId)]={...rec,...cur,updatedAt:Date.now()};await saveGate(all)}return chk}
async function clearBootstrappedTab(tabId){const all=await gateAll();delete all[String(tabId)];await saveGate(all)}
globalThis.__SOKNA_SESSION_GATE_RUNTIME_V1__=Object.freeze({markTab:markBootstrappedTab,clearTab:clearBootstrappedTab});
function rejection(m,error,reason="invalid_compact_command",retryable=false,code="",recoveryAction=""){const cid=idOf(m),rawError=String(error||"REJECTED"),derived=String(code||rawError.split(":",1)[0]||"COMMAND_REJECTED");return {type:"TRANSPORT_DIAG",diagnostic:{kind:"background-command-rejected",final:!!cid,reason,version:"unified-background-gate-v3",commandId:cid,source:String(m?.source||m?.detector||"background-gate"),error:rawError,code:derived,executed:false,retryable:!!retryable,recovery_action:String(recoveryAction||"")}}}
function nativeMessage(msg){return new Promise((resolve,reject)=>rawNativeSend(HOST,msg,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}))}
async function externalLedger(type,command,result=null,error=""){
  const msg={type,request_id:uid("ledger"),command};if(result!==null)msg.result=result;if(error)msg.error=String(error);
  const r=await nativeMessage(msg);if(!r?.ok)throw new Error(r?.error||"EXTENSION_LEDGER_FAILED");return r?.result||{};
}
function externalRecoveredResult(x){return String(x?.state||"")==="succeeded"?(x?.result??{ok:true}):{ok:false,error:String(x?.error||"COMMAND_OUTCOME_UNKNOWN")}}
function unifiedCommand(action,params={},parentId=""){const id=uid("bridge"),ts=Date.now();return {protocolVersion:"2",messageId:id,correlationId:id,parentId:String(parentId||""),kind:"command",action,schemaVersion:"2",timestamp:ts,id,params}}
function capabilityCommand(){return unifiedCommand("agent.capabilities",{})}
const bridgeLocalActions=[
  "artifact.chat.apply","job.list","job.events","bridge.activity","bridge.actions.list","bridge.action.describe","bridge.command.get","bridge.command.list","bridge.diagnostics.get",
  "artifact.out.publish","artifact.out.get","artifact.out.info","artifact.out.list","artifact.out.attach","browser.audit.run",
  "bridge.bootstrap","session.open","session.resume","session.checkpoint","session.close","session.list",
  "instagram.adapter.status","instagram.profile.scan","instagram.post.inspect","instagram.scan.get","instagram.scan.search",
  "instagram.media.download","instagram.media.attach","instagram.research.plan","instagram.candidates.get","instagram.candidates.attach",
  "instagram.selection.confirm","instagram.selection.reject","instagram.export"
];
globalThis.__SOKNA_EXTENSION_ACTIONS_V1__=Object.freeze([...bridgeLocalActions]);
const recoveryActions=new Set(["ping","agent.capabilities","bridge.bootstrap","bridge.actions.list","bridge.action.describe","bridge.command.get","bridge.command.list","bridge.diagnostics.get","session.open","session.resume","session.list","session.close","job.list","job.events","bridge.activity","artifact.out.get","artifact.out.info","artifact.out.list","result.get","workspace.registry.status","workspace.list","workspace.inspect","browser.qa.status","artifact.root.status","artifact.provider.status","instagram.adapter.status"]);
globalThis.__SOKNA_RECOVERY_ACTIONS_V1__=Object.freeze([...recoveryActions]);
const capabilityGate=CAP?.create?.({ttlMs:60000,extensionActions:bridgeLocalActions,fetchCapabilities:async()=>{const command=capabilityCommand();const r=await nativeMessage({type:"agent.exec",request_id:uid("cap-request"),command});if(!r?.ok)throw new Error(r?.error||"CAPABILITY_NATIVE_REQUEST_FAILED");const result=r?.result||{};if(result?.ok===false)throw new Error(result?.error||"CAPABILITY_AGENT_REQUEST_FAILED");const actions=result?.capabilities?.actions;if(!Array.isArray(actions)||!actions.length)throw new Error("CAPABILITY_ACTIONS_MISSING");return actions}});
if(!capabilityGate)throw new Error("BACKGROUND_CAPABILITY_GATE_UNAVAILABLE");
async function directLocal(action,params={},parentId=""){const command=unifiedCommand(action,params,parentId);const r=await nativeMessage({type:"agent.exec",request_id:uid("local-request"),command});if(!r?.ok)throw new Error(r?.error||`${action}:NATIVE_REQUEST_FAILED`);const result=r?.result||{};if(result?.ok===false)throw new Error(result?.error||`${action}:REQUEST_FAILED`);return result}
async function activitySnapshot(m){const limit=Math.min(Math.max(Number(m?.limit)||50,1),200);const jobId=String(m?.jobId||"").trim();return await directLocal(jobId?"job.events":"bridge.activity",jobId?{id:jobId,limit}:{limit})}
async function ensureSessionGate(m,sender){
  const action=String(m?.command?.action||"");
  if(recoveryActions.has(action)){
    if(action==="bridge.bootstrap"){
      await directLocal("bridge.bootstrap",{});
      await markBootstrappedSender(sender);
    }
    return {ok:true,recovery:true};
  }
  const gate=await hasBootstrappedSender(sender);
  if(!gate.ok)return {ok:false,code:"BOOTSTRAP_REQUIRED",error:"This chat/conversation must execute bridge.bootstrap before mutation/execution. Gate: "+String(gate.reason||"unverified")};
  let b;try{b=await directLocal("bridge.bootstrap",{})}catch(e){return {ok:false,code:"BOOTSTRAP_UNAVAILABLE",error:String(e)}}
  if(b?.ready!==true)return {ok:false,code:"SESSION_NOT_READY",error:"Bridge bootstrap is not ready. Open or resume a persistent work session first."};
  return {ok:true,session:b.active_session||null};
}
function rememberCommandTab(commandId,sender){
  const tabId=sender?.tab?.id;if(!Number.isInteger(tabId))return;
  commandTabs.set(commandId,{tabId,expiresAt:Date.now()+5*60*1000});
  setTimeout(()=>{const cur=commandTabs.get(commandId);if(cur&&cur.expiresAt<=Date.now())commandTabs.delete(commandId)},5*60*1000+1000);
}
async function topMessage(tabId,msg){return await chrome.tabs.sendMessage(tabId,msg,{frameId:0})}
async function topMessageAfterAssistantIdle(tabId,msg,timeoutMs=30000){
  const deadline=Date.now()+Math.max(1000,Number(timeoutMs)||30000);
  for(;;){
    const r=await topMessage(tabId,msg);
    if(r?.ok||r?.code!=="ATTACHMENT_ASSISTANT_BUSY")return r;
    if(Date.now()>=deadline)return {...r,deferred_timeout:true,retryable:true};
    await new Promise(resolve=>setTimeout(resolve,500));
  }
}
async function deliverOutboundAttachment(command,tabId){
  const artifactId=String(command?.params?.id||command?.params?.artifact_id||"").trim().toLowerCase();
  if(!SHA.test(artifactId))throw new Error("OUTBOUND_ATTACHMENT_ID_INVALID");
  if(!Number.isInteger(tabId))throw new Error("OUTBOUND_ATTACHMENT_TARGET_TAB_REQUIRED");
  const info=await directLocal("artifact.out.info",{id:artifactId},command.id),ref=info?.artifact_ref||{};
  const bytes=Number(ref?.bytes),sha=String(ref?.sha256||"").toLowerCase();
  if(String(ref?.id||"").toLowerCase()!==artifactId||sha!==artifactId||!Number.isSafeInteger(bytes)||bytes<0)throw new Error("OUTBOUND_ATTACHMENT_REF_INVALID");
  if(bytes>MAX_CHAT_ATTACHMENT_BYTES)throw new Error(`OUTBOUND_ATTACHMENT_TOO_LARGE:${bytes}>${MAX_CHAT_ATTACHMENT_BYTES}`);
  const transferId=`out-${artifactId.slice(0,12)}-${uid("x").replace(/[^A-Za-z0-9._-]/g,"").slice(-12)}`;
  let begun=false;
  try{
    const begin=await topMessageAfterAssistantIdle(tabId,{type:"OUTBOUND_ATTACHMENT_BEGIN",transferId,artifactRef:ref});
    if(!begin?.ok)throw new Error(`${begin?.code||"OUTBOUND_ATTACHMENT_BEGIN_FAILED"}:${begin?.error||"page rejected transfer"}`);begun=true;
    let offset=0,index=0;
    while(offset<bytes){
      if(index>400)throw new Error("OUTBOUND_ATTACHMENT_CHUNK_LIMIT_EXCEEDED");
      const part=await directLocal("artifact.out.get",{id:artifactId,offset,limit:OUT_CHUNK_BYTES},command.id);
      const partRef=part?.artifact_ref||{},actualOffset=Number(part?.offset),next=Number(part?.next_offset),dataB64=String(part?.data_b64||"");
      if(String(partRef?.sha256||"").toLowerCase()!==artifactId||actualOffset!==offset||!Number.isSafeInteger(next)||next<=offset||next>bytes||!dataB64)throw new Error("OUTBOUND_ATTACHMENT_CHUNK_INVALID");
      const ack=await topMessage(tabId,{type:"OUTBOUND_ATTACHMENT_CHUNK",transferId,index,dataB64});
      if(!ack?.ok)throw new Error(`${ack?.code||"OUTBOUND_ATTACHMENT_CHUNK_REJECTED"}:${ack?.error||"page rejected chunk"}`);
      offset=next;index++;
      if(part?.eof===true&&offset!==bytes)throw new Error("OUTBOUND_ATTACHMENT_EARLY_EOF");
    }
    const committed=await topMessageAfterAssistantIdle(tabId,{type:"OUTBOUND_ATTACHMENT_COMMIT",transferId});
    if(!committed?.ok)throw new Error(`${committed?.code||"OUTBOUND_ATTACHMENT_COMMIT_FAILED"}:${committed?.error||"page rejected commit"}`);
    return {ok:true,artifact_ref:ref,transfer_id:transferId,delivery:{user:"chat_attachment",status:String(committed.status||"submitted_to_conversation"),method:String(committed.method||""),public_url:false,local_path_is_delivery:false}};
  }catch(e){if(begun){try{await topMessage(tabId,{type:"OUTBOUND_ATTACHMENT_ABORT",transferId})}catch{}}throw e}
}
async function deliverOutboundAttachmentLedgered(command,tabId){
  const begun=await externalLedger("ledger.external.begin",command);
  if(begun?.duplicate)return externalRecoveredResult(begun);
  try{
    const result=await deliverOutboundAttachment(command,tabId);
    await externalLedger("ledger.external.complete",command,result);
    return result;
  }catch(e){
    try{await externalLedger("ledger.external.fail",command,null,String(e?.message||e))}catch{}
    throw e;
  }
}
function installOutboundNativeInterceptor(){
  try{
    chrome.runtime.sendNativeMessage=function(host,msg,callback){
      const command=host===HOST&&msg?.type==="agent.exec"?msg?.command:null;
      if(command?.action!=="artifact.out.attach")return rawNativeSend(host,msg,callback);
      const id=String(command?.id||""),entry=commandTabs.get(id),p=deliverOutboundAttachmentLedgered(command,entry?.tabId).finally(()=>commandTabs.delete(id));
      if(typeof callback==="function"){
        p.then(result=>callback({ok:true,type:"agent.result",request_id:msg?.request_id||"",version:"3.1.0-r2c",result}),e=>callback({ok:false,type:"error",request_id:msg?.request_id||"",error:String(e?.message||e)}));
        return;
      }
      return p.then(result=>({ok:true,type:"agent.result",request_id:msg?.request_id||"",version:"3.1.0-r2c",result}),e=>({ok:false,type:"error",request_id:msg?.request_id||"",error:String(e?.message||e)}));
    };
  }catch(e){throw new Error("OUTBOUND_ATTACHMENT_NATIVE_INTERCEPTOR_INSTALL_FAILED:"+String(e))}
}
installOutboundNativeInterceptor();
function wrapListener(listener){return function(m,sender,reply){
  if(m?.type==="ACTIVITY_SNAPSHOT"){activitySnapshot(m).then(x=>reply({ok:true,activity:x}),e=>reply({ok:false,error:String(e)}));return true}
  if(m?.type!=="COMMAND")return listener(m,sender,reply);
  if(!m?.semantic)return listener(rejection(m,"SEMANTIC_ROUTE_REQUIRED"),sender,reply);
  const v=PROTO?.validateEnvelope?.(m.command,{kind:"command"})||{ok:false,error:"PROTOCOL_VALIDATOR_UNAVAILABLE"};if(!v.ok)return listener(rejection(m,"UNIFIED_ENVELOPE_INVALID:"+String(v.error||"UNKNOWN")),sender,reply);
  capabilityGate.check(m.command.action).then(async g=>{
    if(!g?.ok)return listener(rejection(m,`${g?.code||"CAPABILITY_PREFLIGHT_FAILED"}:${g?.error||m.command.action}`),sender,reply);
    const gate=await ensureSessionGate(m,sender);
    if(!gate.ok)return listener(rejection(m,`${gate.code}:${gate.error}`,"session_gate_rejected",true,gate.code,gate.code==="BOOTSTRAP_REQUIRED"?"bridge.bootstrap":(gate.code==="SESSION_NOT_READY"?"session.resume":"bridge.diagnostics.get")),sender,reply);
    if(m.command.action==="artifact.out.attach")rememberCommandTab(String(m.command.id||""),sender);
    return listener(m,sender,reply);
  }).catch(e=>listener(rejection(m,"PREFLIGHT_FAILED:"+String(e),"session_gate_rejected",true,"PREFLIGHT_FAILED","bridge.diagnostics.get"),sender,reply));
  return true
}}
try{event.addListener=function(listener){return originalAdd(wrapListener(listener))}}catch(e){throw new Error("BACKGROUND_FAIL_CLOSED_GATE_INSTALL_FAILED:"+String(e))}
importScripts("background.js");
})();
