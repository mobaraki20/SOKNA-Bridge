(()=>{
"use strict";
const G="__SOKNA_SEMANTIC_INTENT_V1__";
try{globalThis[G]?.dispose?.()}catch{}
const Core=globalThis.__SOKNA_SEMANTIC_CORE_V1__;
const VERSION="2.0.0",START="[SOKNA-INTENT]",END="[/SOKNA-INTENT]";
const FALLBACK_KEY="semantic_fallback_diagnostics_v2";
const attempts=new Map(),nodeIds=new WeakMap();
let nodeSeq=0,armed=false,disposed=false,observer=null,scanTimer=0,baselineCount=0;
const state={loaded:true,armed:false,observer_active:false,last_scan_at:0,last_marker_seen_at:0,last_command_id:"",last_dispatch_at:0,last_dispatch_ok:null,last_parse_error:"",last_send_error:"",seen_count:0,assistant_message_count:0,selector_ready:false,last_trigger:"",version:VERSION};
function now(){return Date.now()}
function hash(s){s=String(s||"");let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")}
function idFor(raw){return "sem-"+hash(raw)}
function safeCommandId(v,raw){v=String(v||"");return /^[A-Za-z0-9._-]{1,96}$/.test(v)?v:idFor(raw)}
function nodeText(n){try{return String(n?.innerText||n?.textContent||"")}catch{return""}}
function nodeIdentity(n,index){
  for(const a of ["data-message-id","data-testid","id"]){const v=String(n?.getAttribute?.(a)||"").trim();if(v)return a+":"+v}
  if(!nodeIds.has(n))nodeIds.set(n,"node-"+(++nodeSeq));
  return nodeIds.get(n)+"-idx-"+index;
}
function assistantNodes(){
  if(window.top!==window)return [];
  let nodes=[];try{nodes=[...document.querySelectorAll('[data-message-author-role="assistant"]')]}catch{}
  state.assistant_message_count=nodes.length;state.selector_ready=nodes.length>0;
  return nodes;
}
async function persistFallback(entry){
  try{
    const d=await chrome.storage.local.get([FALLBACK_KEY]),a=Array.isArray(d[FALLBACK_KEY])?d[FALLBACK_KEY]:[];
    a.push({ts:now(),url:location.href,...entry});
    await chrome.storage.local.set({[FALLBACK_KEY]:a.slice(-120)});
  }catch{}
}
async function sendRuntime(message,fallbackEvent="runtime.send_failed"){
  try{
    const r=await chrome.runtime.sendMessage(message);
    return r;
  }catch(e){
    const error=String(e?.message||e);
    state.last_send_error=error;state.last_dispatch_ok=false;
    await persistFallback({event:fallbackEvent,error,message_type:String(message?.type||""),command_id:String(message?.command?.id||message?.diagnostic?.commandId||"")});
    return {ok:false,error,runtime_unavailable:true};
  }
}
async function trace(event,extra={}){
  const payload={event,ts:now(),source:"semantic-intent",semantic_version:VERSION,url:location.href,...extra};
  const r=await sendRuntime({type:"SEMANTIC_TRACE",trace:payload},"semantic.trace_persisted");
  if(r?.runtime_unavailable)await persistFallback(payload);
  return r;
}
async function reject(raw,reason,error,commandId="",extra={}){
  const cid=safeCommandId(commandId,raw);state.last_parse_error=String(error||reason);state.last_command_id=cid;
  await trace("semantic.rejected",{reason,error:String(error||reason),command_id:cid,...extra});
  return await sendRuntime({type:"TRANSPORT_DIAG",diagnostic:{kind:"semantic-command-rejected",final:true,reason,version:VERSION,error:String(error||reason),source:"semantic-intent",commandId:cid,transportRef:"semantic-"+hash(raw),...extra}},"semantic.rejected_unreported");
}
function candidateFor(node,index){
  const text=nodeText(node).trim();if(!text.includes(START))return null;
  state.last_marker_seen_at=now();
  const a=text.indexOf(START),b=text.indexOf(END,a+START.length);
  const extraStart=text.indexOf(START,a+START.length);
  const extraEnd=b>=0?text.indexOf(END,b+END.length):-1;
  if(a!==0||b<0||b+END.length!==text.length||extraStart>=0||extraEnd>=0){
    return {kind:"nonstandalone",message_identity:nodeIdentity(node,index),raw:"",text_hash:hash(text),reason:b<0?"incomplete_marker":"non_standalone_or_multiple_markers"};
  }
  const raw=text.slice(START.length,b).trim();
  if(!raw)return {kind:"invalid",message_identity:nodeIdentity(node,index),raw,text_hash:hash(text),reason:"empty_payload"};
  const messageIdentity=nodeIdentity(node,index),rawHash=hash(raw);
  return {kind:"command",message_identity:messageIdentity,raw,raw_hash:rawHash,attempt_key:messageIdentity+":"+rawHash};
}
async function dispatchCandidate(c,trigger){
  if(attempts.has(c.attempt_key))return {ok:true,local_duplicate:true};
  attempts.set(c.attempt_key,{state:"detected",ts:now(),trigger,raw_hash:c.raw_hash,message_identity:c.message_identity});
  state.seen_count=attempts.size;state.last_trigger=trigger;
  let spec;
  try{spec=JSON.parse(c.raw)}catch(e){
    attempts.get(c.attempt_key).state="rejected";
    await reject(c.raw,"invalid_json",e,"",{attemptKey:c.attempt_key,messageIdentity:c.message_identity,trigger});
    return {ok:false,rejected:true};
  }
  const compiled=Core?.compile?.(spec,()=>idFor(c.raw));
  if(!compiled?.ok){
    attempts.get(c.attempt_key).state="rejected";
    const reason=compiled?.code==="ARTIFACT_ROUTE_REQUIRED"?"contract_payload_budget_exceeded":"invalid_compact_command";
    await reject(c.raw,reason,compiled?.message||compiled?.code||"semantic compile failed",String(spec?.id||compiled?.commandId||idFor(c.raw)),{semanticCode:compiled?.code||"SCHEMA_INVALID",canonicalRoute:compiled?.canonical_route||"",attemptKey:c.attempt_key,messageIdentity:c.message_identity,trigger});
    return {ok:false,rejected:true};
  }
  const cid=String(compiled.command.id||"");state.last_command_id=cid;state.last_dispatch_at=now();state.last_dispatch_ok=null;state.last_parse_error="";
  await trace("semantic.detected",{command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,message_identity:c.message_identity,trigger});
  await trace("semantic.dispatch_started",{command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,message_identity:c.message_identity,trigger});
  const meta={intent:compiled.intent,route:compiled.route,bytes:compiled.bytes,trigger,attemptKey:c.attempt_key,messageIdentity:c.message_identity,semanticVersion:VERSION};
  state.last_send_error="";
  const r=await sendRuntime({type:"COMMAND",command:compiled.command,detector:"semantic-v2",source:"semantic:"+compiled.route,semantic:meta},"semantic.dispatch_failed");
  const ok=!!r?.ok&&!r?.runtime_unavailable;
  state.last_dispatch_ok=ok;attempts.get(c.attempt_key).state=ok?"dispatched":"dispatch_failed";
  if(ok)await trace("semantic.dispatched",{command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,trigger});
  else{
    state.last_send_error=String(r?.error||"background command dispatch failed");
    await persistFallback({event:"semantic.dispatch_failed",command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,trigger,error:state.last_send_error});
    await trace("semantic.dispatch_failed",{command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,trigger,error:state.last_send_error});
  }
  return r;
}
async function scan(trigger="mutation",emit=true){
  if(disposed||(!armed&&trigger!=="baseline"))return {ok:false,armed:false};
  state.last_scan_at=now();state.last_trigger=trigger;
  const nodes=assistantNodes();let found=0,dispatched=0,rejected=0,ignored=0;
  for(let i=0;i<nodes.length;i++){
    const c=candidateFor(nodes[i],i);if(!c)continue;found++;
    if(c.kind!=="command"){
      ignored++;
      if(c.kind==="invalid")await reject(c.raw,c.reason,c.reason,"",{messageIdentity:c.message_identity,trigger});
      continue;
    }
    if(!emit){
      if(!attempts.has(c.attempt_key)){attempts.set(c.attempt_key,{state:"baseline",ts:now(),trigger:"baseline",raw_hash:c.raw_hash,message_identity:c.message_identity});baselineCount++}
      continue;
    }
    const before=attempts.has(c.attempt_key);
    const r=await dispatchCandidate(c,trigger);
    if(!before){if(r?.rejected)rejected++;else if(!r?.local_duplicate)dispatched++}
  }
  state.seen_count=attempts.size;
  return {ok:true,armed,trigger,found,dispatched,rejected,ignored,baseline_count:baselineCount,semantic:diagSnapshot()};
}
function schedule(){clearTimeout(scanTimer);if(!armed||disposed)return;scanTimer=setTimeout(()=>scan("mutation",true).catch(()=>{}),60)}
function startObserver(){
  if(observer||disposed||window.top!==window)return;
  try{observer=new MutationObserver(schedule);observer.observe(document,{subtree:true,childList:true,characterData:true});state.observer_active=true}catch(e){state.observer_active=false;state.last_send_error=String(e)}
}
function stopObserver(){clearTimeout(scanTimer);try{observer?.disconnect()}catch{};observer=null;state.observer_active=false}
function diagSnapshot(){return {...state,armed,observer_active:!!observer,seen_count:attempts.size,baseline_count:baselineCount,top_frame:window.top===window}}
async function baseline(){armed=true;state.armed=true;startObserver();return await scan("baseline",false)}
async function reconcile(){armed=true;state.armed=true;startObserver();return await scan("reconcile",true)}
async function e2eProbe(){
  const probeId="semprobe-"+now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
  const r=await sendRuntime({type:"SEMANTIC_PROBE_REQUEST",probeId,semantic:diagSnapshot()},"semantic.probe_failed");
  const ok=!!r?.ok&&!!r?.agent_ok;state.last_dispatch_ok=ok;if(!ok)state.last_send_error=String(r?.error||"probe failed");
  return {ok,probe_id:probeId,background_reachable:!!r&&!r.runtime_unavailable,agent_ok:!!r?.agent_ok,agent_version:String(r?.agent_version||""),semantic:diagSnapshot(),error:String(r?.error||"")};
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.type==="SEMANTIC_BASELINE"){baseline().then(reply,e=>reply({ok:false,error:String(e),semantic:diagSnapshot()}));return true}
  if(m?.type==="SEMANTIC_RECONCILE"){reconcile().then(reply,e=>reply({ok:false,error:String(e),semantic:diagSnapshot()}));return true}
  if(m?.type==="SEMANTIC_DIAG"){reply({ok:true,semantic:diagSnapshot(),frameHref:location.href});return}
  if(m?.type==="SEMANTIC_E2E_PROBE"){e2eProbe().then(reply,e=>reply({ok:false,error:String(e),semantic:diagSnapshot()}));return true}
  if(m?.type==="SEMANTIC_STOP"){armed=false;state.armed=false;stopObserver();reply?.({ok:true});return}
});
startObserver();
function dispose(){disposed=true;armed=false;state.armed=false;stopObserver()}
globalThis[G]={version:VERSION,dispose,scanNow:()=>scan("manual",true),diag:diagSnapshot};
})();