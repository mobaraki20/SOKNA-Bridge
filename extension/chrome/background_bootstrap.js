(()=>{
"use strict";
importScripts("protocol.js","capability_gate.js","terminal_outcome_core.js","origin_registry_core.js","browser_target_core.js","session_gate_state_core.js","action_contracts_core.js");
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
const ATTACH_MANY_PROGRESS_KEY="outbound_attach_many_progress_v1";
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
  "artifact.chat.apply","job.list","job.events","bridge.activity","bridge.actions.list","bridge.action.describe","bridge.doctor","bridge.command.get","bridge.command.list","bridge.diagnostics.get",
  "artifact.out.publish","artifact.out.get","artifact.out.info","artifact.out.list","artifact.out.attach","artifact.out.attach_many","artifact.collection.get","browser.audit.run",
  "credential.ref.list",
  "browser.backend.status","browser.tabs.list","browser.tab.open","browser.tab.claim","browser.tab.release",
  "browser.page.snapshot","browser.page.text","browser.page.click","browser.page.fill","browser.page.scroll","browser.page.wait","browser.page.screenshot","browser.capture.batch",
  "bridge.bootstrap","session.open","session.resume","session.checkpoint","session.close","session.list",
  "instagram.adapter.status","instagram.profile.scan","instagram.post.inspect","instagram.scan.get","instagram.scan.search",
  "instagram.media.download","instagram.media.attach","instagram.research.plan","instagram.candidates.get","instagram.candidates.attach",
  "instagram.selection.confirm","instagram.selection.reject","instagram.export"
];
globalThis.__SOKNA_EXTENSION_ACTIONS_V1__=Object.freeze([...bridgeLocalActions]);
const recoveryActions=new Set(["ping","agent.capabilities","bridge.bootstrap","bridge.actions.list","bridge.action.describe","bridge.doctor","bridge.command.get","bridge.command.list","bridge.diagnostics.get","session.open","session.resume","session.list","session.close","job.list","job.events","bridge.activity","artifact.out.get","artifact.out.info","artifact.out.list","artifact.collection.get","result.get","workspace.registry.status","workspace.list","workspace.inspect","browser.qa.status","browser.backend.status","artifact.root.status","artifact.provider.status","instagram.adapter.status"]);
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
async function artifactRefForDelivery(artifactId,parentId){
  artifactId=String(artifactId||"").trim().toLowerCase();
  if(!SHA.test(artifactId))throw new Error("OUTBOUND_ATTACHMENT_ID_INVALID");
  const info=await directLocal("artifact.out.info",{id:artifactId},parentId),ref=info?.artifact_ref||{};
  const bytes=Number(ref?.bytes),sha=String(ref?.sha256||"").toLowerCase();
  if(String(ref?.id||"").toLowerCase()!==artifactId||sha!==artifactId||!Number.isSafeInteger(bytes)||bytes<0)throw new Error("OUTBOUND_ATTACHMENT_REF_INVALID");
  if(bytes>MAX_CHAT_ATTACHMENT_BYTES)throw new Error(`OUTBOUND_ATTACHMENT_TOO_LARGE:${bytes}>${MAX_CHAT_ATTACHMENT_BYTES}`);
  return ref;
}
async function streamOutboundArtifact(command,tabId,artifactId,{append=false,submit=true,note=""}={}){
  if(!Number.isInteger(tabId))throw new Error("OUTBOUND_ATTACHMENT_TARGET_TAB_REQUIRED");
  const ref=await artifactRefForDelivery(artifactId,command.id),bytes=Number(ref.bytes);
  const transferId=`out-${String(ref.id).slice(0,12)}-${uid("x").replace(/[^A-Za-z0-9._-]/g,"").slice(-12)}`;
  let begun=false;
  try{
    const begin=await topMessageAfterAssistantIdle(tabId,{type:"OUTBOUND_ATTACHMENT_BEGIN",transferId,artifactRef:ref,append:append===true});
    if(!begin?.ok)throw new Error(`${begin?.code||"OUTBOUND_ATTACHMENT_BEGIN_FAILED"}:${begin?.error||"page rejected transfer"}`);begun=true;
    let offset=0,index=0;
    while(offset<bytes){
      if(index>400)throw new Error("OUTBOUND_ATTACHMENT_CHUNK_LIMIT_EXCEEDED");
      const part=await directLocal("artifact.out.get",{id:ref.id,offset,limit:OUT_CHUNK_BYTES},command.id);
      const partRef=part?.artifact_ref||{},actualOffset=Number(part?.offset),next=Number(part?.next_offset),dataB64=String(part?.data_b64||"");
      if(String(partRef?.sha256||"").toLowerCase()!==String(ref.id).toLowerCase()||actualOffset!==offset||!Number.isSafeInteger(next)||next<=offset||next>bytes||!dataB64)throw new Error("OUTBOUND_ATTACHMENT_CHUNK_INVALID");
      const ack=await topMessage(tabId,{type:"OUTBOUND_ATTACHMENT_CHUNK",transferId,index,dataB64});
      if(!ack?.ok)throw new Error(`${ack?.code||"OUTBOUND_ATTACHMENT_CHUNK_REJECTED"}:${ack?.error||"page rejected chunk"}`);
      offset=next;index++;
      if(part?.eof===true&&offset!==bytes)throw new Error("OUTBOUND_ATTACHMENT_EARLY_EOF");
    }
    const committed=await topMessageAfterAssistantIdle(tabId,{type:"OUTBOUND_ATTACHMENT_COMMIT",transferId,append:append===true,submit:submit!==false,note:String(note||"")});
    if(!committed?.ok)throw new Error(`${committed?.code||"OUTBOUND_ATTACHMENT_COMMIT_FAILED"}:${committed?.error||"page rejected commit"}`);
    return {artifact_ref:ref,transfer_id:transferId,status:String(committed.status||""),method:String(committed.method||"")};
  }catch(e){if(begun){try{await topMessage(tabId,{type:"OUTBOUND_ATTACHMENT_ABORT",transferId})}catch{}}throw e}
}
async function waitAttachmentComposerReady(tabId,timeoutMs=60000){
  const deadline=Date.now()+Math.max(1000,Number(timeoutMs)||60000);
  for(;;){
    let r;try{r=await topMessage(tabId,{type:"OUTBOUND_ATTACHMENT_READY"})}catch(e){r={ok:false,code:"ATTACHMENT_PAGE_UNAVAILABLE",error:String(e)}}
    if(r?.ok)return r;
    if(!["ATTACHMENT_ASSISTANT_BUSY","ATTACHMENT_EXISTING_FILES_PRESENT","ATTACHMENT_UPLOAD_BUSY"].includes(String(r?.code||"")))throw new Error(`${r?.code||"OUTBOUND_ATTACHMENT_NOT_READY"}:${r?.error||"composer is not safe for attachment delivery"}`);
    if(Date.now()>=deadline)throw new Error(`${r?.code||"OUTBOUND_ATTACHMENT_READY_TIMEOUT"}:timed out waiting for attachment composer`);
    await new Promise(resolve=>setTimeout(resolve,500));
  }
}
async function deliverOutboundAttachment(command,tabId){
  const artifactId=String(command?.params?.id||command?.params?.artifact_id||"").trim().toLowerCase();
  const one=await streamOutboundArtifact(command,tabId,artifactId,{append:false,submit:true});
  return {ok:true,artifact_ref:one.artifact_ref,transfer_id:one.transfer_id,delivery:{user:"chat_attachment",status:one.status||"submitted_to_conversation",method:one.method||"",public_url:false,local_path_is_delivery:false}};
}
async function bootstrapSha256Text(text){
  const bytes=new TextEncoder().encode(String(text||"")),digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function attachManyProgressAll(){const d=await chrome.storage.local.get([ATTACH_MANY_PROGRESS_KEY]);return d[ATTACH_MANY_PROGRESS_KEY]||{}}
async function saveAttachManyProgress(all){
  const entries=Object.entries(all||{}).sort((a,b)=>Number(a[1]?.updated_at||0)-Number(b[1]?.updated_at||0));
  const trimmed=entries.length>40?Object.fromEntries(entries.slice(entries.length-40)):Object.fromEntries(entries);
  await chrome.storage.local.set({[ATTACH_MANY_PROGRESS_KEY]:trimmed});
}
async function deliverOutboundAttachmentMany(command,tabId){
  const deliveryId=String(command?.params?.delivery_id||"").trim();
  const ids=[...new Set((Array.isArray(command?.params?.ids)?command.params.ids:[]).map(x=>String(x||"").trim().toLowerCase()))];
  if(!/^[A-Za-z0-9._-]{1,96}$/.test(deliveryId))throw new Error("OUTBOUND_ATTACHMENT_DELIVERY_ID_INVALID");
  if(!ids.length||ids.length>100||ids.some(x=>!SHA.test(x)))throw new Error("OUTBOUND_ATTACHMENT_MANY_IDS_INVALID");
  const batchSize=Math.min(10,Math.max(1,Number(command?.params?.batch_size)||5)),customNote=String(command?.params?.note||"").trim();
  const planSha=await bootstrapSha256Text(JSON.stringify({ids,batch_size:batchSize,note:customNote}));
  const all=await attachManyProgressAll(),old=all[deliveryId];
  if(old&&String(old.plan_sha256||"")!==planSha)throw new Error("ATTACHMENT_BATCH_PLAN_MISMATCH");
  if(old?.state==="completed")return {ok:true,schema:"sokna-outbound-attachment-batch-v1",delivery_id:deliveryId,resumed:true,requested:ids.length,attached_count:Number(old.attached_count||ids.length),batch_count:Number(old.batch_count||Math.ceil(ids.length/batchSize)),batch_size:batchSize};
  const previous=Array.isArray(old?.batches)?old.batches.slice():[];
  const uncertain=previous.find(x=>x?.state==="executing");
  if(uncertain)throw new Error("ATTACHMENT_BATCH_OUTCOME_UNKNOWN: batch "+String(uncertain.batch));
  all[deliveryId]={schema:"sokna-outbound-attachment-progress-v1",delivery_id:deliveryId,plan_sha256:planSha,created_at:Number(old?.created_at||Date.now()),updated_at:Date.now(),state:"running",requested:ids.length,batch_size:batchSize,batches:previous};
  await saveAttachManyProgress(all);
  const totalBatches=Math.ceil(ids.length/batchSize);
  for(let batchIndex=0;batchIndex<totalBatches;batchIndex++){
    if(previous[batchIndex]?.state==="submitted")continue;
    const start=batchIndex*batchSize,part=ids.slice(start,start+batchSize),batchNo=batchIndex+1;
    await waitAttachmentComposerReady(tabId);
    previous[batchIndex]={batch:batchNo,state:"executing",count:part.length,started_at:Date.now()};
    all[deliveryId]={...all[deliveryId],updated_at:Date.now(),batches:previous};
    await saveAttachManyProgress(all);
    for(let i=0;i<part.length;i++){
      const last=i===part.length-1;
      const note=last?[customNote,`SOKNA Bridge artifact batch ${batchNo}/${totalBatches} — ${part.length} file(s).`].filter(Boolean).join("\n"):"";
      await streamOutboundArtifact(command,tabId,part[i],{append:i>0,submit:last,note});
    }
    previous[batchIndex]={batch:batchNo,state:"submitted",count:part.length,completed_at:Date.now()};
    all[deliveryId]={...all[deliveryId],updated_at:Date.now(),batches:previous};
    await saveAttachManyProgress(all);
  }
  const attachedCount=previous.filter(x=>x?.state==="submitted").reduce((n,b)=>n+Number(b.count||0),0);
  all[deliveryId]={...all[deliveryId],updated_at:Date.now(),state:"completed",attached_count:attachedCount,batch_count:totalBatches,batches:previous};
  await saveAttachManyProgress(all);
  return {ok:true,schema:"sokna-outbound-attachment-batch-v1",delivery_id:deliveryId,resumed:!!old,requested:ids.length,attached_count:attachedCount,batch_count:totalBatches,batch_size:batchSize,batches:previous.map(x=>({batch:x.batch,count:x.count,status:x.state}))};
}
async function deliverOutboundAttachmentLedgered(command,tabId){
  const begun=await externalLedger("ledger.external.begin",command);
  if(begun?.duplicate)return externalRecoveredResult(begun);
  try{
    const result=command?.action==="artifact.out.attach_many"?await deliverOutboundAttachmentMany(command,tabId):await deliverOutboundAttachment(command,tabId);
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
      if(command?.action!=="artifact.out.attach"&&command?.action!=="artifact.out.attach_many")return rawNativeSend(host,msg,callback);
      const id=String(command?.id||""),entry=commandTabs.get(id),p=deliverOutboundAttachmentLedgered(command,entry?.tabId).finally(()=>commandTabs.delete(id));
      if(typeof callback==="function"){
        p.then(result=>callback({ok:true,type:"agent.result",request_id:msg?.request_id||"",version:(chrome.runtime.getManifest?.().version||"3.14.0"),result}),e=>callback({ok:false,type:"error",request_id:msg?.request_id||"",error:String(e?.message||e)}));
        return;
      }
      return p.then(result=>({ok:true,type:"agent.result",request_id:msg?.request_id||"",version:(chrome.runtime.getManifest?.().version||"3.14.0"),result}),e=>({ok:false,type:"error",request_id:msg?.request_id||"",error:String(e?.message||e)}));
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
    if(m.command.action==="artifact.out.attach"||m.command.action==="artifact.out.attach_many")rememberCommandTab(String(m.command.id||""),sender);
    return listener(m,sender,reply);
  }).catch(e=>listener(rejection(m,"PREFLIGHT_FAILED:"+String(e),"session_gate_rejected",true,"PREFLIGHT_FAILED","bridge.diagnostics.get"),sender,reply));
  return true
}}
try{event.addListener=function(listener){return originalAdd(wrapListener(listener))}}catch(e){throw new Error("BACKGROUND_FAIL_CLOSED_GATE_INSTALL_FAILED:"+String(e))}
importScripts("background.js");
})();
