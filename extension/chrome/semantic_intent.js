(()=>{
"use strict";
const G="__SOKNA_SEMANTIC_INTENT_V1__";
try{globalThis[G]?.dispose?.()}catch{}
const Core=globalThis.__SOKNA_SEMANTIC_CORE_V1__;
const VERSION="2.1.1",START="[SOKNA-INTENT]",END="[/SOKNA-INTENT]",PROBE_START="[SOKNA-PROBE]",PROBE_END="[/SOKNA-PROBE]";
const FALLBACK_KEY="semantic_fallback_diagnostics_v2";
const attempts=new Map(),nodeIds=new WeakMap(),nodeProvenance=new WeakMap(),untrustedNodes=new WeakSet();
let nodeSeq=0,armed=false,disposed=false,observer=null,scanTimer=0,baselineCount=0;
let intakeChallenge="",challengeSetAt=0,probeVerified=false,probeVerifiedAt=0,probeSignature="",probeParent=null,probeOrdinal=-1;
const state={loaded:true,armed:false,observer_active:false,last_scan_at:0,last_marker_seen_at:0,last_command_id:"",last_dispatch_at:0,last_dispatch_ok:null,last_parse_error:"",last_send_error:"",seen_count:0,assistant_message_count:0,selector_ready:false,selector_mode:"",role_candidate_count:0,unknown_role_candidate_count:0,last_role_evidence:"",intake_verified_at:0,last_trigger:"",probe_verified:false,probe_verified_at:0,probe_signature:"",challenge_set:false,challenge_set_at:0,marker_witness_count:0,untrusted_marker_count:0,provenance_mode:"",version:VERSION};
function now(){return Date.now()}
function hash(s){s=String(s||"");let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")}
function idFor(raw){return "sem-"+hash(raw)}
function safeCommandId(v,raw){v=String(v||"");return /^[A-Za-z0-9._-]{1,96}$/.test(v)?v:idFor(raw)}
function nodeText(n){try{return String(n?.innerText||n?.textContent||"")}catch{return""}}
function nodeIdentity(n,index){
  for(const a of ["data-message-id","data-testid","id"]){const v=String(n?.getAttribute?.(a)||"").trim();if(v)return a+":"+v}
  if(!nodeIds.has(n))nodeIds.set(n,"node-"+(++nodeSeq));
  return nodeIds.get(n);
}
function classifyTurnRole(n){
  const direct=String(n?.getAttribute?.("data-message-author-role")||"").trim().toLowerCase();
  if(direct==="assistant")return {role:"assistant",evidence:"data-message-author-role"};
  if(direct==="user")return {role:"user",evidence:"data-message-author-role"};
  try{
    const nested=n?.querySelector?.('[data-message-author-role="assistant"],[data-message-author-role="user"]');
    const role=String(nested?.getAttribute?.("data-message-author-role")||"").trim().toLowerCase();
    if(role==="assistant"||role==="user")return {role,evidence:"nested-data-message-author-role"};
  }catch{}
  const cls=String(n?.className||"");
  if(/(^|\s)(agent-turn|assistant-turn)(\s|$)/i.test(cls))return {role:"assistant",evidence:"assistant-turn-class"};
  if(/(^|\s)user-turn(\s|$)/i.test(cls))return {role:"user",evidence:"user-turn-class"};
  const attrs=["data-author","data-role","data-turn","aria-label","data-testid"].map(a=>String(n?.getAttribute?.(a)||"")).join(" | ");
  if(/(^|\b)(assistant message|assistant response|assistant said|chatgpt said)(\b|$)/i.test(attrs))return {role:"assistant",evidence:"assistant-role-attribute"};
  if(/(^|\b)(user message|user said|you said)(\b|$)/i.test(attrs))return {role:"user",evidence:"user-role-attribute"};
  try{
    if(n?.querySelector?.('[data-testid*="good-response" i],[data-testid*="bad-response" i],[data-testid*="regenerate" i],button[aria-label*="good response" i],button[aria-label*="bad response" i],button[aria-label*="regenerate" i]'))return {role:"assistant",evidence:"assistant-action-controls"};
  }catch{}
  return {role:"unknown",evidence:""};
}
function markerBody(root){
  if(!root)return root;
  const rootText=nodeText(root).trim();if(!rootText.includes(START))return root;
  let all=[root];
  try{all.push(...root.querySelectorAll('div,article,section,p,pre,code,[data-message-content],[data-testid*="message-content" i],[class*="markdown"],[class*="prose"]'))}catch{}
  const exact=[];const seen=new Set();
  for(const n of all){
    if(!n||seen.has(n))continue;seen.add(n);
    const t=nodeText(n).trim();
    if(t.startsWith(START)&&t.endsWith(END))exact.push(n);
  }
  exact.sort((a,b)=>nodeText(a).trim().length-nodeText(b).trim().length);
  return exact[0]||root;
}
function mainRoot(){
  try{return document.querySelector?.("main,[role='main']")||document.body||document.documentElement}catch{return document.body||document.documentElement}
}
function hasUnsafeAncestor(n){
  let cur=n,depth=0;
  while(cur&&depth++<20){
    const tag=String(cur.tagName||"").toUpperCase(),ce=String(cur.getAttribute?.("contenteditable")||"").toLowerCase();
    if(tag==="FORM"||tag==="TEXTAREA"||tag==="INPUT"||ce==="true")return true;
    cur=cur.parentElement;
  }
  return false;
}
function roleFromAncestors(n){
  let cur=n,depth=0;
  while(cur&&depth++<16){
    const r=classifyTurnRole(cur);
    if(r.role!=="unknown")return r;
    cur=cur.parentElement;
  }
  return {role:"unknown",evidence:""};
}
function stableShape(n){
  if(!n)return "";
  const tag=String(n.tagName||"").toUpperCase();
  const role=String(n.getAttribute?.("role")||"").trim().toLowerCase();
  let testid=String(n.getAttribute?.("data-testid")||"").trim().toLowerCase();
  testid=testid.replace(/[0-9]+/g,"#").replace(/[a-f0-9]{8,}/gi,"*");
  const cls=String(n.className||"").split(/\s+/).filter(Boolean).filter(x=>!/^_?R_/i.test(x)&&!/^css-/i.test(x)).slice(0,10).sort().join(".");
  return [tag,role?"r="+role:"",testid?"t="+testid:"",cls?"c="+cls:""].filter(Boolean).join("|");
}
function meaningfulChildren(p){
  try{return [...(p?.children||[])].filter(x=>nodeText(x).trim().length>=8)}catch{return[]}
}
function shellContext(n){
  const root=mainRoot();let cur=n,chosen=null,parent=null,ordinal=-1,children=[];
  while(cur&&cur!==root&&cur.parentElement){
    const p=cur.parentElement,kids=meaningfulChildren(p);
    if(kids.length>=2){chosen=cur;parent=p;children=kids;ordinal=kids.indexOf(cur);break}
    cur=p;
  }
  if(!chosen){
    cur=n;
    while(cur?.parentElement&&cur.parentElement!==root)cur=cur.parentElement;
    chosen=cur||n;parent=chosen?.parentElement||root;children=meaningfulChildren(parent);ordinal=children.indexOf(chosen);
  }
  return {shell:chosen,parent,ordinal,signature:stableShape(chosen)};
}
function markerWitnesses(){
  const root=mainRoot();if(!root)return [];
  let whole="";try{whole=String(root.textContent||root.innerText||"")}catch{}
  if(!whole.includes(START)&&!whole.includes(PROBE_START)){state.marker_witness_count=0;return[]}
  let all=[root];try{all.push(...root.querySelectorAll("p,pre,code,div,section,span"))}catch{}
  const exact=[],seen=new Set();
  for(const n of all){
    if(!n||seen.has(n))continue;seen.add(n);
    const t=nodeText(n).trim();
    const intent=t.startsWith(START)&&t.endsWith(END);
    const probe=t.startsWith(PROBE_START)&&t.endsWith(PROBE_END);
    if(intent||probe)exact.push(n);
  }
  const deepest=exact.filter(n=>!exact.some(m=>m!==n&&n.contains?.(m)));
  state.marker_witness_count=deepest.length;
  return deepest;
}
function resetChallenge(challenge){
  const next=String(challenge||"").trim();
  if(next&&next===intakeChallenge&&probeVerified){
    challengeSetAt=now();state.challenge_set=true;state.challenge_set_at=challengeSetAt;return;
  }
  intakeChallenge=next;challengeSetAt=now();probeVerified=false;probeVerifiedAt=0;probeSignature="";probeParent=null;probeOrdinal=-1;
  state.challenge_set=!!intakeChallenge;state.challenge_set_at=challengeSetAt;state.probe_verified=false;state.probe_verified_at=0;state.probe_signature="";state.provenance_mode="";
  if(!state.last_role_evidence)state.selector_ready=false;
}
function restoreChallengeProof(proof){
  const challenge=String(proof?.challenge||"").trim();
  const verifiedAt=Number(proof?.verifiedAt||0);
  if(!/^[A-Za-z0-9._-]{8,96}$/.test(challenge)||verifiedAt<=0)return {ok:false,error:"invalid restored intake proof"};
  intakeChallenge=challenge;challengeSetAt=now();probeVerified=true;probeVerifiedAt=verifiedAt;probeSignature=String(proof?.probeSignature||"");probeParent=null;probeOrdinal=-1;
  state.challenge_set=true;state.challenge_set_at=challengeSetAt;state.probe_verified=true;state.probe_verified_at=probeVerifiedAt;state.probe_signature=probeSignature;state.selector_ready=true;state.selector_mode="restored-session-proof";state.intake_verified_at=probeVerifiedAt;state.last_role_evidence=String(proof?.evidence||"restored-session-proof");state.provenance_mode="restored-session-proof";
  return {ok:true,restored:true,semantic:diagSnapshot()};
}
async function verifyProbeNode(n,trigger){
  if(probeVerified||!intakeChallenge||hasUnsafeAncestor(n))return false;
  const t=nodeText(n).trim(),expected=PROBE_START+intakeChallenge+PROBE_END;
  if(t!==expected)return false;
  const role=roleFromAncestors(n);if(role.role==="user")return false;
  const c=shellContext(n);if(!c.parent||c.ordinal<0||!c.signature)return false;
  probeVerified=true;probeVerifiedAt=now();probeSignature=c.signature;probeParent=c.parent;probeOrdinal=c.ordinal;
  state.probe_verified=true;state.probe_verified_at=probeVerifiedAt;state.probe_signature=probeSignature;state.selector_ready=true;state.selector_mode="challenge-shell";state.intake_verified_at=probeVerifiedAt;state.last_role_evidence=role.role==="assistant"?(role.evidence||"explicit-assistant"):"challenge-response";state.provenance_mode=role.role==="assistant"?"explicit-role+challenge":"challenge-nonce";
  await trace("semantic.intake_verified",{trigger,evidence:state.last_role_evidence,selector_mode:state.selector_mode,probe_signature:probeSignature});
  await sendRuntime({type:"SEMANTIC_INTAKE_PROVEN",challenge:intakeChallenge,evidence:state.last_role_evidence,selectorMode:state.selector_mode,probeSignature:probeSignature},"semantic.intake_verified_unreported");
  return true;
}
function trustCommandNode(n){
  if(hasUnsafeAncestor(n))return {ok:false,evidence:"unsafe-editable",requiresNonce:false};
  const role=roleFromAncestors(n);
  if(role.role==="assistant")return {ok:true,evidence:role.evidence||"explicit-assistant",requiresNonce:false};
  if(role.role==="user")return {ok:false,evidence:role.evidence||"explicit-user",requiresNonce:false};
  if(probeVerified)return {ok:true,evidence:"challenge-nonce",requiresNonce:true};
  return {ok:false,evidence:"unproven-marker",requiresNonce:false};
}
function assistantNodes(){
  if(window.top!==window)return [];
  let direct=[];try{direct=[...document.querySelectorAll('[data-message-author-role="assistant"]')]}catch{}
  if(direct.length){
    state.assistant_message_count=direct.length;state.selector_ready=true;state.selector_mode="data-message-author-role";state.role_candidate_count=direct.length;state.unknown_role_candidate_count=0;state.last_role_evidence="data-message-author-role";if(!state.intake_verified_at)state.intake_verified_at=now();
    return direct.map(markerBody);
  }
  let turns=[];const seen=new Set();
  for(const q of ['[data-testid^="conversation-turn-"]','article','[data-message-id]','.agent-turn','.assistant-turn']){
    let found=[];try{found=[...document.querySelectorAll(q)]}catch{}
    for(const n of found){if(!seen.has(n)){seen.add(n);turns.push(n)}}
  }
  const assistant=[];let unknown=0,lastEvidence="";
  for(const turn of turns){
    const r=classifyTurnRole(turn);
    if(r.role==="assistant"){assistant.push(markerBody(turn));lastEvidence=r.evidence||lastEvidence}
    else if(r.role==="unknown")unknown++;
  }
  state.assistant_message_count=assistant.length||(probeVerified?1:0);state.role_candidate_count=turns.length;state.unknown_role_candidate_count=unknown;state.selector_ready=assistant.length>0||probeVerified;state.selector_mode=assistant.length?"role-evidence-fallback":(probeVerified?"challenge-shell":(turns.length?"role-unresolved":"no-turns"));state.last_role_evidence=lastEvidence||(probeVerified?"challenge-response":"");
  if(state.selector_ready&&!state.intake_verified_at)state.intake_verified_at=now();
  return assistant;
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
async function dispatchCandidate(c,trigger,provenance={evidence:"",requiresNonce:false}){
  if(attempts.has(c.attempt_key))return {ok:true,local_duplicate:true};
  attempts.set(c.attempt_key,{state:"detected",ts:now(),trigger,raw_hash:c.raw_hash,message_identity:c.message_identity});
  state.seen_count=attempts.size;state.last_trigger=trigger;
  let spec;
  try{spec=JSON.parse(c.raw)}catch(e){
    attempts.get(c.attempt_key).state="rejected";
    await reject(c.raw,"invalid_json",e,"",{attemptKey:c.attempt_key,messageIdentity:c.message_identity,trigger});
    return {ok:false,rejected:true};
  }
  const nonceRequired=!!intakeChallenge||!!provenance?.requiresNonce;
  if(nonceRequired){
    const supplied=String(spec?.bridge_nonce||"").trim();
    if(!probeVerified||!intakeChallenge||supplied!==intakeChallenge){
      attempts.get(c.attempt_key).state="rejected";
      state.last_parse_error=!probeVerified?"semantic intake proof incomplete":"semantic nonce missing or mismatch";
      await trace("semantic.marker_untrusted",{trigger,evidence:!probeVerified?"proof-incomplete":"nonce-mismatch",command_id:String(spec?.id||""),attempt_key:c.attempt_key,message_identity:c.message_identity});
      return {ok:false,rejected:true,untrusted:true};
    }
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
  const meta={intent:compiled.intent,route:compiled.route,bytes:compiled.bytes,trigger,attemptKey:c.attempt_key,messageIdentity:c.message_identity,semanticVersion:VERSION,provenance:String(provenance?.evidence||""),nonceBound:nonceRequired};
  state.last_send_error="";
  const r=await sendRuntime({type:"COMMAND",command:compiled.command,detector:"semantic-v2",source:"semantic:"+compiled.route,semantic:meta},"semantic.dispatch_failed");
  const rejected=!!r?.rejected||r?.executed===false;
  const ok=!!r?.ok&&!r?.runtime_unavailable&&!rejected;
  state.last_dispatch_ok=ok;attempts.get(c.attempt_key).state=rejected?"rejected":(ok?"dispatched":"dispatch_failed");
  if(rejected){
    state.last_send_error=String(r?.error||r?.code||r?.reason||"command rejected");
    await trace("semantic.rejected",{command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,trigger,code:String(r?.code||""),reason:String(r?.reason||""),executed:false,retryable:!!r?.retryable,recovery_action:String(r?.recovery_action||"")});
  }else if(ok)await trace("semantic.dispatched",{command_id:cid,action:compiled.command.action,attempt_key:c.attempt_key,trigger});
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
  const roleNodes=assistantNodes(),witnesses=markerWitnesses();let found=0,dispatched=0,rejected=0,ignored=0;
  for(const w of witnesses)if(nodeText(w).trim().startsWith(PROBE_START))await verifyProbeNode(w,trigger);
  const nodes=[...roleNodes],nodeSet=new Set(nodes);
  for(let wi=0;wi<witnesses.length;wi++){
    const w=witnesses[wi],text=nodeText(w).trim();if(!text.startsWith(START))continue;
    const c=candidateFor(w,100000+wi);if(!c)continue;
    if(!emit){
      if(c.kind==="command"&&!attempts.has(c.attempt_key)){attempts.set(c.attempt_key,{state:"baseline",ts:now(),trigger:"baseline",raw_hash:c.raw_hash,message_identity:c.message_identity});baselineCount++}
      continue;
    }
    if(nodeSet.has(w))continue;
    const trust=trustCommandNode(w);
    if(trust.ok){nodeProvenance.set(w,trust);nodes.push(w);nodeSet.add(w);state.last_role_evidence=trust.evidence;state.provenance_mode=trust.requiresNonce?"challenge-nonce":"explicit-role"}
    else{
      ignored++;state.untrusted_marker_count++;
      if(!untrustedNodes.has(w)){untrustedNodes.add(w);await trace("semantic.marker_untrusted",{trigger,evidence:trust.evidence,text_hash:hash(text)})}
    }
  }
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
    const provenance=nodeProvenance.get(nodes[i])||{evidence:"explicit-assistant",requiresNonce:false};
    const r=await dispatchCandidate(c,trigger,provenance);
    if(!before){if(r?.rejected)rejected++;else if(!r?.local_duplicate)dispatched++}
  }
  state.seen_count=attempts.size;
  return {ok:true,armed,trigger,found,dispatched,rejected,ignored,baseline_count:baselineCount,semantic:diagSnapshot()};
}
function schedule(){clearTimeout(scanTimer);if(!armed||disposed)return;scanTimer=setTimeout(()=>scan("mutation",true).catch(async e=>{const error=String(e?.message||e);state.last_send_error=error;state.last_dispatch_ok=false;await persistFallback({event:"semantic.scan_failed",error})}),60)}
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
  return {ok,probe_id:probeId,background_reachable:!!r&&!r.runtime_unavailable,agent_ok:!!r?.agent_ok,agent_version:String(r?.agent_version||""),intake_ready:!!state.selector_ready&&(!state.challenge_set||!!state.probe_verified),semantic:diagSnapshot(),error:String(r?.error||"")};
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.type==="SEMANTIC_BASELINE"){baseline().then(reply,e=>reply({ok:false,error:String(e),semantic:diagSnapshot()}));return true}
  if(m?.type==="SEMANTIC_RECONCILE"){reconcile().then(reply,e=>reply({ok:false,error:String(e),semantic:diagSnapshot()}));return true}
  if(m?.type==="SEMANTIC_SET_CHALLENGE"){const c=String(m?.challenge||"").trim();if(!/^[A-Za-z0-9._-]{8,96}$/.test(c)){reply({ok:false,error:"invalid intake challenge",semantic:diagSnapshot()});return}resetChallenge(c);reply({ok:true,challenge_set:true,semantic:diagSnapshot()});return}
  if(m?.type==="SEMANTIC_RESTORE_PROOF"){reply(restoreChallengeProof(m?.proof||{}));return}
  if(m?.type==="SEMANTIC_DIAG"){reply({ok:true,semantic:diagSnapshot(),frameHref:location.href});return}
  if(m?.type==="SEMANTIC_E2E_PROBE"){e2eProbe().then(reply,e=>reply({ok:false,error:String(e),semantic:diagSnapshot()}));return true}
  if(m?.type==="SEMANTIC_STOP"){armed=false;state.armed=false;stopObserver();reply?.({ok:true});return}
});
startObserver();
function dispose(){disposed=true;armed=false;state.armed=false;stopObserver()}
globalThis[G]={version:VERSION,dispose,scanNow:()=>scan("manual",true),diag:diagSnapshot};
})();