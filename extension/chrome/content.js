(()=>{
"use strict";
const G="__SOKNA_BRIDGE_V33_CONTENT__";
try{globalThis[G]?.dispose?.()}catch{}

const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const Core=globalThis.__SOKNA_V33_DOM_CORE__;
const RE=/\[SOKNA-V2-CMD\]([\s\S]*?)\[\/SOKNA-V2-CMD\]/g;
const B64_RE=/\[SOKNA-CMD-B64\]([\s\S]*?)\[\/SOKNA-CMD-B64\]/g;
const B64_START="[SOKNA-CMD-B64]";
const B64_END="[/SOKNA-CMD-B64]";
const seen=new Set();
const rejectedB64=new Set();
const rejectedLegacy=new Set();
const observers=new Map();

let armed=false,disposed=false;
let lastScanAt=0,lastCommandDetectedAt=0,lastPostMethod="",lastPostError="";
let mutationCallbacks=0,addedNodesSeen=0,characterMutationsSeen=0;
let legacyMarkerCaptures=0,lastLegacyCaptureAt=0,lastLegacySource="";
let immediateTextChars=0,b64ParseErrors=0,legacyParseErrors=0;
let deliveryStateTimer=0,lastDeliveryGate="",lastDeliveryReadySignalAt=0,periodicScanTimer=0;

// V3.8: secondary streaming reassembly path for long commands.
const STREAM_START="SOKNA3CMD:";
const STREAM_END=":SOKNA3END";
const V4_START="SOKNA4CMD:";
const V4_END=":SOKNA4END";
const MAX_V3_CARRIER_CHARS=PROTO.maxCarrierChars,MAX_V3_PAYLOAD_BYTES=PROTO.maxPayloadBytes;
const VERSION="3.10.9",DETECTOR="v3.10.9-core-wire";
const rejectedV3Bodies=new Set();
const laneBuffers=new Map();
const laneTouched=new Map();
const streamPartialLanes=new Set();
const MAX_STREAM_LANES=64,STREAM_LANE_TTL=30000;
const laneIds=new WeakMap();
let nextLaneId=1;
let streamFragments=0,streamBytes=0,streamStartsSeen=0,streamCompleted=0,streamParseErrors=0;
let lastStreamCaptureAt=0,lastStreamLane="";

// V3.8: once a START marker appears, track the rendered container's current
// snapshot instead of relying only on concatenated mutation fragments.
const activeCandidates=new Set();
let candidateStartsSeen=0,candidateCompleted=0,candidateParseErrors=0;
let lastCandidateAt=0,lastCandidateSource="",partialDiagTimer=0,lastPartialDiagAt=0;
const recentV4Starts=new Map(),V4_START_EVIDENCE_TTL=15000;
function noteRecentV4Start(text){
  const t=String(text||""),re=/SOKNA4CMD:([A-Za-z0-9._-]{1,96}):/g,now=Date.now();let m;
  while((m=re.exec(t)))recentV4Starts.set(m[1],now);
  for(const [id,ts] of recentV4Starts)if(now-ts>V4_START_EVIDENCE_TTL)recentV4Starts.delete(id);
}
function hasRecentV4Start(id){const ts=recentV4Starts.get(String(id||""));return !!ts&&Date.now()-ts<=V4_START_EVIDENCE_TTL;}

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const utf8Bytes=s=>PROTO.bytes(s);

function stableTransportRef(s){
  s=String(s||"");let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return "rx-"+(h>>>0).toString(16).padStart(8,"0");
}
function commandIdHint(raw){
  try{const x=JSON.parse(raw);return String(x?.id||x?.i||"")}catch{}
  const m=String(raw||"").match(/(?:"id"|"i")\s*:\s*"([A-Za-z0-9._:-]{1,96})"/);
  return m?.[1]||"";
}
function validCommandId(id){return /^[A-Za-z0-9._-]{1,96}$/.test(String(id||""))}
function legacyFailure(raw,source,reason,error,report=true){
  const clipped=String(raw||"").slice(0,4096),ref=stableTransportRef(clipped||source||reason);
  const key=`${ref}:${reason}`;if(rejectedLegacy.has(key))return;
  rejectedLegacy.add(key);if(rejectedLegacy.size>64)rejectedLegacy.delete(rejectedLegacy.values().next().value);
  legacyParseErrors++;
  if(!report)return;
  const hinted=commandIdHint(clipped),commandId=validCommandId(hinted)?hinted:"";
  chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"command-intake-failed",final:!!commandId,reason,version:VERSION,error:String(error?.message||error||reason),source,commandId,transportRef:ref}}).catch(()=>{});
}

function pageBroken(){
  return (document.body?.innerText||"").toLowerCase().includes("content failed to load");
}
function commands(text,report=true){
  const out=[];RE.lastIndex=0;let m;
  while((m=RE.exec(text||""))){
    const raw=m[1].trim();
    try{
      const c=JSON.parse(raw);
      if(c?.id&&c?.action)out.push(c);
      else legacyFailure(raw,"legacy-v2","invalid_compact_command",new Error("legacy command requires id and action"),report);
    }catch(e){legacyFailure(raw,"legacy-v2","invalid_json",e,report)}
  }
  return out;
}

function b64urlDecodeUtf8(s){
  s=String(s||"").replace(/\s+/g,"");if(!s||!/^[A-Za-z0-9_-]+={0,2}$/.test(s)){const e=new Error("invalid_base64url");e.code="invalid_base64url";throw e}
  s=s.replace(/=+$/,"").replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4)s+="=";
  const bin=atob(s),bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function decodeV3Body(body,span,outerId=""){
  let raw;
  try{raw=b64urlDecodeUtf8(body)}catch(e){if(!e.code)e.code="invalid_base64url";e.commandId=outerId||"";throw e}
  if(!PROTO.accept(raw,span)){
    const e=new Error("contract_budget_exceeded");e.code="contract_budget_exceeded";e.commandId=outerId||commandIdHint(raw);e.payloadBytes=utf8Bytes(raw);throw e;
  }
  let parsed;try{parsed=JSON.parse(raw)}catch(e){const x=new Error("invalid_json");x.code="invalid_json";x.commandId=outerId||commandIdHint(raw);x.raw=raw;throw x}
  const c=PROTO.expand(parsed);
  if(!(c?.id&&c?.action)){const e=new Error("invalid_compact_command");e.code="invalid_compact_command";e.commandId=outerId||String(parsed?.id||parsed?.i||"");throw e}
  if(outerId&&c.id!==outerId){const e=new Error("outer_id_mismatch");e.code="outer_id_mismatch";e.commandId=outerId;e.innerCommandId=c.id;throw e}
  Object.defineProperty(c,"__soknaTransportValidated",{value:true});
  return c;
}
function recordV3ParseFailure(body,source,error,extra={},report=true){
  const normalized=String(body||"").replace(/\s+/g,"").slice(0,4096);
  const ref=extra.transportRef||stableTransportRef(normalized||String(extra.outerId||source||"parse"));
  const key=`${ref}:${error?.code||"carrier_parse_failed"}`;
  if(rejectedV3Bodies.has(key))return;
  rejectedV3Bodies.add(key);if(rejectedV3Bodies.size>64)rejectedV3Bodies.delete(rejectedV3Bodies.values().next().value);
  if(!report)return;
  const candidateId=String(error?.commandId||extra.outerId||"");
  const commandId=/^[A-Za-z0-9._-]{1,96}$/.test(candidateId)?candidateId:"";
  chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"command-intake-failed",final:extra.final!==false,reason:error?.code||"carrier_parse_failed",version:VERSION,error:String(error?.message||error||"parse failed"),source,commandId,transportRef:ref,span:extra.span??null}}).catch(()=>{});
}
function b64Commands(text,report=true){
  const out=[];B64_RE.lastIndex=0;let m;
  while((m=B64_RE.exec(text||""))){
    const encoded=String(m?.[1]||"").replace(/\s+/g,"").slice(0,4096);
    let raw="";
    try{
      raw=b64urlDecodeUtf8(encoded);
      const c=JSON.parse(raw);
      if(c?.id&&c?.action)out.push(c);
      else legacyFailure(raw,"legacy-b64","invalid_compact_command",new Error("legacy B64 command requires id and action"),report);
    }catch(e){
      if(!rejectedB64.has(encoded)){
        rejectedB64.add(encoded);if(rejectedB64.size>64)rejectedB64.delete(rejectedB64.values().next().value);
        b64ParseErrors++;
      }
      legacyFailure(raw||encoded,"legacy-b64",raw?"invalid_json":"invalid_base64url",e,report);
    }
  }
  return out;
}

function v3Commands(text,report=true){
  const out=[];
  text=String(text||"");
  let from=0;
  while(true){
    const a=text.indexOf(STREAM_START,from);
    if(a<0)break;
    const b=text.indexOf(STREAM_END,a+STREAM_START.length);
    if(b<0)break;
    const body=text.slice(a+STREAM_START.length,b).trim(),span=b+STREAM_END.length-a;
    try{
      out.push(decodeV3Body(body,span));
    }catch(e){
      if(e?.code==="contract_budget_exceeded"){
        const ref=stableTransportRef(body),key=`${ref}:${e.code}`;
        if(!rejectedV3Bodies.has(key)){
          rejectedV3Bodies.add(key);if(rejectedV3Bodies.size>64)rejectedV3Bodies.delete(rejectedV3Bodies.values().next().value);
          if(report)chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"command-rejected",final:true,commandId:e.commandId||"",transportRef:ref,reason:e.code,version:VERSION,span,payloadBytes:e.payloadBytes??null,maxBytes:PROTO.maxPayloadBytes}}).catch(()=>{});
        }
      }else recordV3ParseFailure(body,"snapshot",e,{span},report);
    }
    from=b+STREAM_END.length;
  }
  return out;
}
function v4Commands(text,report=true){
  const out=[];text=String(text||"");let from=0;
  while(true){
    const frame=PROTO.nextV4Frame(text,from);if(!frame||frame.kind==="partial")break;
    if(frame.kind==="nested"){from=frame.nextFrom;continue}
    const {inner,outerId,body,span,validOuterId,hasWhitespace}=frame;
    from=frame.nextFrom;
    // Broad ancestor snapshots can contain an old START before a newer complete carrier.
    // nextV4Frame classifies that as nested and restarts at the newer START, so the old
    // fragment cannot manufacture a visible NACK or hide the real carrier.
    if(hasWhitespace){
      const e=new Error("carrier_contains_whitespace");e.code="carrier_parse_failed";e.commandId=validOuterId?outerId:"";
      recordV3ParseFailure(inner,"v4-snapshot",e,{outerId,span,transportRef:stableTransportRef(inner),final:PROTO.correlatableMalformedV4(frame)},report);continue;
    }
    if(!validOuterId){
      const e=new Error("invalid_outer_id");e.code="invalid_outer_id";recordV3ParseFailure(body||inner,"v4-snapshot",e,{outerId,span,transportRef:stableTransportRef(inner),final:false},report);continue;
    }
    try{out.push(decodeV3Body(body,span,outerId))}
    catch(e){
      if(e?.code==="contract_budget_exceeded"){
        const ref=stableTransportRef(inner),key=`${ref}:${e.code}`;
        if(!rejectedV3Bodies.has(key)){
          rejectedV3Bodies.add(key);if(rejectedV3Bodies.size>64)rejectedV3Bodies.delete(rejectedV3Bodies.values().next().value);
          if(report)chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"command-rejected",final:true,commandId:outerId,transportRef:ref,reason:e.code,version:VERSION,span,payloadBytes:e.payloadBytes??null,maxBytes:PROTO.maxPayloadBytes}}).catch(()=>{});
        }
      }else recordV3ParseFailure(body,"v4-snapshot",e,{outerId,span,transportRef:stableTransportRef(inner)},report);
    }
  }
  return out;
}

function emit(c,source){
  if(!armed||!c?.id||seen.has(c.id))return;
  const payloadBytes=utf8Bytes(JSON.stringify(c));
  if(payloadBytes>(c.__soknaTransportValidated?PROTO.maxExpandedCommandBytes:MAX_V3_PAYLOAD_BYTES)){chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"command-rejected",reason:"contract_payload_budget_exceeded",version:VERSION,commandId:c.id,payloadBytes,maxBytes:(c.__soknaTransportValidated?PROTO.maxExpandedCommandBytes:MAX_V3_PAYLOAD_BYTES),source}}).catch(()=>{});return}
  seen.add(c.id);
  legacyMarkerCaptures++;
  lastLegacyCaptureAt=Date.now();
  lastLegacySource=source||"";
  lastCommandDetectedAt=Date.now();
  chrome.runtime.sendMessage({
    type:"COMMAND",command:c,frameHref:location.href,
    detector:DETECTOR,source:lastLegacySource
  }).catch(()=>{});
}


function candidateContainer(node){
  let el=null;
  try{el=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement}catch{}
  if(!el)return null;

  let depth=0;
  while(el && el!==document.body && el!==document.documentElement && depth<14){
    let t="";
    try{t=el.textContent||""}catch{}
    if((t.includes(STREAM_START)||t.includes(V4_START)||t.includes(B64_START)) && t.length<=262144)return el;
    el=el.parentElement;
    depth++;
  }
  return null;
}

function candidateStillPartial(text){
  text=String(text||"");
  const a3=text.lastIndexOf(STREAM_START),a4=text.lastIndexOf(V4_START);
  const a=Math.max(a3,a4);if(a<0)return false;
  const start=a4>a3?V4_START:STREAM_START,end=a4>a3?V4_END:STREAM_END;
  const b=text.indexOf(end,a+start.length);
  return b<0;
}

function schedulePartialDiagnostic(){
  clearTimeout(partialDiagTimer);
  if(!armed||activeCandidates.size===0)return;
  partialDiagTimer=setTimeout(()=>{
    if(!armed||activeCandidates.size===0)return;
    lastPartialDiagAt=Date.now();
    // A stalled complete-message candidate is observable. V4 can expose an outer id even if its body/end is broken.
    let stalledId="";try{for(const el of activeCandidates){const t=el?.textContent||"";const a=t.lastIndexOf(V4_START);if(a>=0){const r=t.slice(a+V4_START.length);const c=r.indexOf(":");if(c>0){const x=r.slice(0,c).trim();if(/^[A-Za-z0-9._-]{1,96}$/.test(x)){stalledId=x;break}}}}}catch{}
    const correlatedStall=!!stalledId&&hasRecentV4Start(stalledId);
    chrome.runtime.sendMessage({
      type:"TRANSPORT_DIAG",
      diagnostic:{
        kind:"partial-command-stalled",
        final:correlatedStall,
        commandId:correlatedStall?stalledId:"",
        transportRef:stalledId?stableTransportRef(stalledId+":"+lastCandidateAt):"",
        reason:correlatedStall?"carrier_incomplete":"partial-command-stalled",
        version:VERSION,
        activeCandidates:activeCandidates.size,
        candidateStartsSeen,
        candidateCompleted,
        candidateParseErrors,
        streamStartsSeen,
        streamCompleted,
        streamParseErrors,
        mutationCallbacks,
        addedNodesSeen,
        characterMutationsSeen,
        lastCandidateAt,
        lastCandidateSource
      }
    }).catch(()=>{});
  },5000);
}

const candidateErrorText=new WeakMap();

function inspectCandidate(el,source,isNew=false){
  if(!armed||!el)return;
  let text="";
  try{text=el.textContent||""}catch{return}

  if(!(text.includes(STREAM_START)||text.includes(V4_START)||text.includes(B64_START))){
    activeCandidates.delete(el);
    candidateErrorText.delete(el);
    return;
  }

  const parsed=[...v4Commands(text),...v3Commands(text),...commands(text),...b64Commands(text)];
  const fresh=parsed.filter(cmd=>cmd?.id&&!seen.has(cmd.id));

  const legacyPartial=candidateStillPartial(text);
  const b64A=text.lastIndexOf(B64_START);
  const b64B=b64A>=0?text.indexOf(B64_END,b64A+B64_START.length):-1;
  const b64Partial=b64A>=0&&b64B<0;
  const partial=legacyPartial||b64Partial;

  if(isNew&&(partial||fresh.length>0))candidateStartsSeen++;

  if(partial||fresh.length>0){
    lastCandidateAt=Date.now();
    lastCandidateSource=source||"";
  }

  for(const cmd of fresh){
    candidateCompleted++;
    emit(cmd,"candidate:"+source);
  }

  if(partial){
    activeCandidates.add(el);
    schedulePartialDiagnostic();
  }else{
    activeCandidates.delete(el);
    if(activeCandidates.size===0)clearTimeout(partialDiagTimer);
  }

  const anyClosed=(text.includes(STREAM_END)||text.includes(B64_END));
  if(parsed.length===0&&anyClosed&&!partial){
    if(candidateErrorText.get(el)!==text){
      candidateParseErrors++;
      candidateErrorText.set(el,text);
    }
  }else{
    candidateErrorText.delete(el);
  }
}

function trackCandidate(node,source){
  const el=candidateContainer(node);
  if(!el)return;
  if(activeCandidates.size>=32&&!activeCandidates.has(el)){
    const first=activeCandidates.values().next().value;
    if(first)activeCandidates.delete(first);
  }
  const isNew=!activeCandidates.has(el);
  inspectCandidate(el,source,isNew);
}
function inspectActiveCandidates(source){
  for(const el of [...activeCandidates]){
    try{
      if(!el.isConnected){
        activeCandidates.delete(el);
        continue;
      }
    }catch{}
    inspectCandidate(el,source);
  }
  if(activeCandidates.size===0)clearTimeout(partialDiagTimer);
}

function laneForNode(node){
  let el=null;
  try{
    el=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
    if(el){
      el=el.closest?.(
        '[data-message-id],[data-testid*="message" i],[role="article"],article,main'
      )||el;
    }
  }catch{}
  if(!el)return "document";
  let id=laneIds.get(el);
  if(!id){id="lane-"+(nextLaneId++);laneIds.set(el,id)}
  return id;
}

function feedStream(fragment,node,source){
  if(!armed||!fragment)return;
  fragment=String(fragment);
  if(!fragment)return;

  streamFragments++;
  streamBytes+=fragment.length;

  const lane=laneForNode(node);
  const laneNow=Date.now();
  for(const [k,t] of [...laneTouched]){
    if(laneNow-t>STREAM_LANE_TTL){laneTouched.delete(k);laneBuffers.delete(k);streamPartialLanes.delete(k)}
  }
  if(!laneBuffers.has(lane)&&laneBuffers.size>=MAX_STREAM_LANES){
    let oldest=null,oldestAt=Infinity;
    for(const [k,t] of laneTouched)if(t<oldestAt){oldest=k;oldestAt=t}
    if(oldest){laneTouched.delete(oldest);laneBuffers.delete(oldest);streamPartialLanes.delete(oldest)}
  }
  laneTouched.set(lane,laneNow);
  let buf=(laneBuffers.get(lane)||"")+fragment;

  // Bound memory while preserving a possible in-progress envelope.
  const MAX=262144;
  if(buf.length>MAX){
    const lastStart=buf.lastIndexOf(STREAM_START);
    buf=lastStart>=0?buf.slice(lastStart):buf.slice(-65536);
  }

  while(true){
    const a=buf.indexOf(STREAM_START);
    if(a<0){
      streamPartialLanes.delete(lane);
      buf=buf.slice(-Math.max(0,STREAM_START.length-1));
      break;
    }
    if(a>0)buf=buf.slice(a);

    const b=buf.indexOf(STREAM_END,STREAM_START.length);
    if(b<0){
      if(!streamPartialLanes.has(lane)){
        streamStartsSeen++;
        streamPartialLanes.add(lane);
      }
      break;
    }

    streamPartialLanes.delete(lane);
    const body=buf.slice(STREAM_START.length,b).trim();
    const span=b+STREAM_END.length;
    try{
      const cmd=decodeV3Body(body,span);
      streamCompleted++;
      lastStreamCaptureAt=Date.now();
      lastStreamLane=lane+":"+source;
      emit(cmd,"stream:"+source);
    }catch(e){
      streamParseErrors++;
      if(e?.code==="contract_budget_exceeded")chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"command-rejected",commandId:e.commandId||"",reason:e.code,version:VERSION,span,payloadBytes:e.payloadBytes??null,maxBytes:PROTO.maxPayloadBytes}}).catch(()=>{});
      else recordV3ParseFailure(body,"stream:"+source,e);
    }
    buf=buf.slice(b+STREAM_END.length);
  }

  if(buf)laneBuffers.set(lane,buf);else{laneBuffers.delete(lane);laneTouched.delete(lane)}
}

function mutationDelta(m){
  try{
    const now=m.target?.nodeValue||"";
    const old=m.oldValue||"";
    if(now.startsWith(old))return now.slice(old.length);
    let i=0,lim=Math.min(now.length,old.length);
    while(i<lim&&now.charCodeAt(i)===old.charCodeAt(i))i++;
    return now.slice(i);
  }catch{return ""}
}

function captureText(text,source){
  if(!armed||!text)return;
  text=String(text);
  if(text.length>262144)text=text.slice(-262144);
  immediateTextChars+=text.length;
  const hasLegacy=text.includes("[SOKNA-V2-CMD]");
  const hasB64=text.includes(B64_START);
  const hasV3=text.includes(STREAM_START);
  const hasV4=text.includes(V4_START);
  if(!hasLegacy&&!hasB64&&!hasV3&&!hasV4)return;
  if(hasLegacy)for(const c of commands(text))emit(c,source);
  if(hasB64)for(const c of b64Commands(text))emit(c,source+":b64");
  if(hasV4)for(const c of v4Commands(text))emit(c,source+":v4");
  if(hasV3)for(const c of v3Commands(text))emit(c,source+":v3");
}
function captureNode(node,source,feed=true){
  if(!armed||!node)return;
  let t="";
  try{
    if(node.nodeType===Node.TEXT_NODE)t=node.nodeValue||"";
    else if(node.nodeType===Node.ELEMENT_NODE)t=node.innerText||node.textContent||"";
    else t=node.textContent||"";
  }catch{}
  captureText(t,source);
  trackCandidate(node,source);
  if(feed)feedStream(t,node,source);
  try{
    const p=node.parentNode;
    if(p&&p!==document&&p.textContent)captureText(p.textContent,source+":parent");
  }catch{}
}
function immediateMutation(ms){
  if(!armed)return;
  mutationCallbacks++;
  for(const m of ms){
    if(m.type==="childList"){
      for(const n of m.addedNodes){
        addedNodesSeen++;
        try{noteRecentV4Start(n?.textContent||n?.nodeValue||"")}catch{}
        captureNode(n,"addedNode");
      }
      try{captureText(m.target?.textContent||"","childListTarget")}catch{}
    }else if(m.type==="characterData"){
      characterMutationsSeen++;
      const delta=mutationDelta(m);
      if(delta){noteRecentV4Start(delta);feedStream(delta,m.target,"characterDataDelta");}
      captureNode(m.target,"characterData",false);
      try{captureText(m.target?.parentNode?.textContent||"","characterDataParent")}catch{}
    }else if(m.type==="attributes"){
      try{
        const el=m.target;
        captureText(el?.getAttribute?.(m.attributeName)||"","attribute:"+m.attributeName);
        captureText(el?.textContent||"","attributeTargetText");
      }catch{}
    }
  }
  inspectActiveCandidates("mutationFlush");try{for(const c of Core.scanAll().commands)emit(c,"core")}catch{}
  scheduleDeliveryStateCheck();
  observeRoots();
}
function observeRoots(){
  if(!armed||disposed)return;
  let roots=[document];
  try{roots=Core.collectRoots().roots}catch{}
  for(const root of roots){
    if(observers.has(root))continue;
    try{
      const mo=new MutationObserver(immediateMutation);
      const target=root===document?(document.documentElement||document):root;
      mo.observe(target,{
        subtree:true,childList:true,characterData:true,characterDataOldValue:true,attributes:true,
        attributeFilter:["href","src","aria-label","data-testid","data-message-id"]
      });
      observers.set(root,mo);
    }catch{}
  }
}
function disconnect(){
  for(const o of observers.values())try{o.disconnect()}catch{}
  observers.clear();
}
function baseline(){
  const map=new Map(),candidates=[];
  try{candidates.push(document.body?.innerText||"")}catch{}
  try{candidates.push(document.body?.textContent||"")}catch{}
  for(const t of candidates){
    // Baseline is discovery-only: seed valid command ids and rejection fingerprints,
    // but never emit transport NACKs for historical examples already on the page.
    for(const c of commands(t,false)){seen.add(c.id);if(c?.id)map.set(c.id,c)}
    for(const c of b64Commands(t,false)){seen.add(c.id);if(c?.id)map.set(c.id,c)}
    for(const c of v3Commands(t,false)){seen.add(c.id);if(c?.id)map.set(c.id,c)}
    for(const c of v4Commands(t,false)){seen.add(c.id);if(c?.id)map.set(c.id,c)}
  }
  try{const r=Core.scanAll();for(const c of(r.commands||[])){seen.add(c.id);if(c?.id)map.set(c.id,c)}lastScanAt=Date.now()}catch{};return [...map.values()]
}
function runPeriodicScan(){
  if(!armed)return;
  try{const r=Core.scanAll();lastScanAt=Date.now();for(const c of(r.commands||[]))emit(c,"periodic")}catch{}
  scheduleDeliveryStateCheck();
}
function start(){
  if(armed)return;
  armed=true;const base=baseline();observeRoots();lastDeliveryGate=deliveryGateState();scheduleDeliveryStateCheck();clearInterval(periodicScanTimer);periodicScanTimer=setInterval(runPeriodicScan,1000);return base;
}
function stop(){
  armed=false;
  disconnect();
  clearTimeout(partialDiagTimer);
  clearInterval(periodicScanTimer);periodicScanTimer=0;
  activeCandidates.clear();
}

/* Exact V2.5.1-style result insertion and submit sequence, with draft protection. */
function vis(e){
  if(!e)return false;
  try{
    const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0;
  }catch{return false}
}
function composer(){
  for(const q of [
    '[data-testid="prompt-textarea"]','#prompt-textarea','textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"][role="textbox"]',
    '[contenteditable="true"]'
  ]){
    let a=[];try{a=[...document.querySelectorAll(q)].filter(vis)}catch{}
    if(a.length)return a[a.length-1];
  }
  try{return Core.composer()}catch{return null}
}
const CHATART=globalThis.__SOKNA_CHAT_ARTIFACT_CORE_V1__;
function chatArtifactNodes(){
  if(window.top!==window)return [];
  const selectors=['a[href]','a[download]','[role="link"]','button[data-testid*="download" i]','button[aria-label*="download" i]'];
  const els=[];const seenEls=new Set();
  for(const q of selectors){
    let found=[];try{found=[...document.querySelectorAll(q)]}catch{}
    for(const el of found){if(seenEls.has(el)||!vis(el))continue;seenEls.add(el);els.push(el)}
  }
  return els.map((el,index)=>({el,desc:{
    index,tag:String(el.tagName||""),href:String(el.href||el.getAttribute?.("href")||""),download:String(el.getAttribute?.("download")||""),
    text:String((el.innerText||el.textContent||"").trim()),ariaLabel:String(el.getAttribute?.("aria-label")||""),title:String(el.getAttribute?.("title")||""),
    authorRole:String(el.closest?.('[data-message-author-role]')?.getAttribute?.('data-message-author-role')||""),visible:true
  }}));
}
function findChatArtifact(filename){
  if(!CHATART)return {ok:false,reason:"chat_artifact_core_unavailable"};
  const nodes=chatArtifactNodes(),sel=CHATART.selectCandidate(nodes.map(x=>x.desc),filename);
  if(!sel.ok)return sel;
  const node=nodes.find(x=>x.desc.index===sel.candidate.index);if(!node)return {ok:false,reason:"attachment_race"};
  return {ok:true,candidate:node.desc};
}
function clickChatArtifact(filename){
  if(!CHATART)return {ok:false,reason:"chat_artifact_core_unavailable"};
  const nodes=chatArtifactNodes(),sel=CHATART.selectCandidate(nodes.map(x=>x.desc),filename);
  if(!sel.ok)return sel;
  const node=nodes.find(x=>x.desc.index===sel.candidate.index);if(!node)return {ok:false,reason:"attachment_race"};
  try{node.el.click();return {ok:true,candidate:node.desc,clicked:true}}catch(e){return {ok:false,reason:"attachment_click_failed",error:String(e)}}
}
function textOf(el){
  if(!el)return "";
  if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement)return el.value||"";
  return el.innerText||el.textContent||"";
}
function isBridgeEnvelopeText(text){
  const t=String(text||"").trim();
  return (t.startsWith("[SOKNA-V2-RESULT]")&&t.endsWith("[/SOKNA-V2-RESULT]"))||
    (t.startsWith("[SOKNA-V2-STATUS]")&&t.endsWith("[/SOKNA-V2-STATUS]"));
}
function samePayload(text,payload){return String(text||"").trim()===String(payload||"").trim()}
function nearestForm(el){return el?.closest?.("form")||null}
function sendButton(el,payload){
  try{const b=Core.sendButton();if(b)return b}catch{}
  if(!el||textOf(el).trim()!==String(payload||"").trim()||!String(payload||"").trim())return null;
  const f=nearestForm(el)||document;
  let a=[];try{a=[...f.querySelectorAll('button[type="submit"],[data-testid*="send" i],button[aria-label*="send" i],button[title*="send" i],[role="button"][aria-label*="send" i]')].filter(x=>{const s=((x.getAttribute("data-testid")||"")+" "+(x.getAttribute("aria-label")||"")+" "+(x.title||"")).toLowerCase();return vis(x)&&!x.disabled&&x.getAttribute("aria-disabled")!=="true"&&!/(mic|voice|upload|attach|stop|cancel|tool|camera|record)/.test(s)})}catch{}
  return a.length?a[a.length-1]:null;
}
function fireInput(el,text){
  try{el.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,cancelable:true,inputType:"insertText",data:text}))}catch{}
  try{el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}catch{el.dispatchEvent(new Event("input",{bubbles:true}))}
  el.dispatchEvent(new Event("change",{bubbles:true}));
}
function setInput(el,text){
  el.focus();
  if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
    const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(p,"value")?.set;
    setter?setter.call(el,text):(el.value=text);
    fireInput(el,text);return;
  }
  try{
    const sel=window.getSelection(),range=document.createRange();
    range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);
    if(document.queryCommandSupported?.("insertText")&&document.execCommand("insertText",false,text)){
      fireInput(el,text);return;
    }
  }catch{}
  el.textContent="";
  el.appendChild(document.createTextNode(text));
  fireInput(el,text);
}
async function sent(payload,el){
  return await waitForResultVisible(payload,1500);
}
async function clickAttempt(el,payload){
  const b=sendButton(el,payload);
  if(!b||b.disabled||b.getAttribute("aria-disabled")==="true")return false;
  try{
    b.scrollIntoView?.({block:"nearest"});b.focus?.({preventScroll:true});
    b.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerType:"mouse",isPrimary:true}));
    b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0}));
    b.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerType:"mouse",isPrimary:true}));
    b.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,button:0}));
    b.click();
  }catch{try{HTMLElement.prototype.click.call(b)}catch{}}
  return await sent(payload,el);
}
async function submitAttempt(el,payload){
  const f=nearestForm(el);if(!f)return false;
  try{
    const b=sendButton(el,payload);
    if(f.requestSubmit)f.requestSubmit(b&&b.form===f?b:undefined);
    else f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  }catch{return false}
  return await sent(payload,el);
}
async function enterAttempt(el,payload){
  try{
    el.focus();
    const opts={key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true};
    el.dispatchEvent(new KeyboardEvent("keydown",opts));
    el.dispatchEvent(new KeyboardEvent("keypress",opts));
    el.dispatchEvent(new KeyboardEvent("keyup",opts));
  }catch{return false}
  return await sent(payload,el);
}
function resultVisibleInUserTurn(payload){
  try{
    const p=''+(payload||'');
    const m=p.match(/"eventId"\s*:\s*"([^"]+)"/)||p.match(/"id"\s*:\s*"([^"]+)"/)||p.match(/"commandId"\s*:\s*"([^"]+)"/);
    const id=m&&m[1]?m[1]:'';

    if(!id)return false;

    const b=document.body;
    if(!b)return false;

    const s=b['inner\u0054ext']||b['text\u0043ontent']||'';

    const isEventId=p.includes('"eventId"');
    const hit=isEventId
      ?(s.includes('"eventId":"'+id+'"')||s.includes('"eventId": "'+id+'"'))
      :(s.includes('"id":"'+id+'"')||s.includes('"id": "'+id+'"')||s.includes('"commandId":"'+id+'"')||s.includes('"commandId": "'+id+'"'));

    if(!hit)return false;

    const el=composer();

    if(!el)return true;

    const c=('value' in el)
      ?(el.value||'')
      :(el['inner\u0054ext']||el['text\u0043ontent']||'');

    return !c.includes(id);
  }catch{}

  return false;
}async function waitForResultVisible(payload,timeoutMs=8000){
  const end=Date.now()+timeoutMs;
  do{if(resultVisibleInUserTurn(payload))return true;await wait(125)}while(Date.now()<end);
  return false;
}
function deliveryBlockReason(el){
  try{
    if([...document.querySelectorAll('[data-testid="stop-button"],button[aria-label*="stop" i],button[title*="stop" i]')].some(vis))
      return "assistant_generating";
  }catch{}
  try{
    const root=nearestForm(el)||document;
    if([...root.querySelectorAll('input[type="file"]')].some(x=>x.files?.length))
      return "attachment_present";
    if([...root.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-testid*="upload" i],[data-testid*="attachment" i],[data-testid*="file-preview" i]')].some(vis))
      return "attachment_or_upload";
  }catch{}
  return "";
}
function deliveryGateState(){
  const el=composer();
  if(!el)return "composer_missing";
  const block=deliveryBlockReason(el);if(block)return block;
  const t=textOf(el).trim();
  if(!t)return "ready";
  if(isBridgeEnvelopeText(t))return sendButton(el,t)?"ready":"bridge_payload_waiting";
  return "user_draft";
}
function scheduleDeliveryStateCheck(){
  clearTimeout(deliveryStateTimer);
  if(!armed||disposed)return;
  deliveryStateTimer=setTimeout(()=>{
    const el=composer(),gate=deliveryGateState();
    const prev=lastDeliveryGate,bridgeReady=gate==="ready"&&isBridgeEnvelopeText(textOf(el));
    lastDeliveryGate=gate;
    const now=Date.now();
    if((prev&&prev!=="ready"&&gate==="ready")||(bridgeReady&&now-lastDeliveryReadySignalAt>=1500)){
      lastDeliveryReadySignalAt=now;
      chrome.runtime.sendMessage({
        type:"DELIVERY_READY",from:prev,to:gate,force:!bridgeReady,bridgeDraft:bridgeReady,ts:now,frameHref:location.href
      }).catch(()=>{});
    }
  },250);
}
async function post(payload){
  if(window.top!==window)
    return {ok:false,error:"POST_RESULT must target top frame"};

  // Conversation is the source of truth.
  if(resultVisibleInUserTurn(payload))
    return {ok:true,method:"existing-bubble"};

  const existing=composer();
  const draft=textOf(existing).trim();

  if(draft&&!samePayload(draft,payload))
    return {
      ok:false,
      waiting:true,
      reason:"user_draft",
      error:"Composer contains user text; delivery queued."
    };

  let initialGate=deliveryBlockReason(existing);

  if(initialGate==="assistant_generating"){
    for(let i=0;i<480&&initialGate==="assistant_generating";i++){
      await wait(250);
      initialGate=deliveryBlockReason(composer());
    }
  }

  if(initialGate)
    return {
      ok:false,
      waiting:true,
      reason:initialGate,
      error:"Automatic delivery is waiting for the page to become safe."
    };

  for(let i=0;i<3;i++){
    // Reconcile before every retry.
    if(resultVisibleInUserTurn(payload))
      return {ok:true,method:"existing-bubble"};

    if(pageBroken()){
      await wait(1000);
      continue;
    }

    let el=composer();
    if(!el){
      await wait(500);
      continue;
    }

    const gate=deliveryBlockReason(el);
    if(gate)
      return {
        ok:false,
        waiting:true,
        reason:gate,
        error:"Automatic delivery is waiting for the page to become safe."
      };

    const current=textOf(el);

    if(current.trim()&&!samePayload(current,payload))
      return {
        ok:false,
        waiting:true,
        reason:"user_draft",
        error:"Composer contains user text; delivery queued."
      };

    if(!samePayload(current,payload))
      setInput(el,payload);

    // The Send control can materialize only after input/render settles.
    for(let r=0;r<24;r++){
      if(resultVisibleInUserTurn(payload))
        return {ok:true,method:"existing-bubble"};

      el=composer()||el;
      if(sendButton(el,payload))
        break;

      await wait(125);
    }

    el=composer()||el;

    if(await clickAttempt(el,payload))
      return {ok:true,method:"rbt-click-ack"};

    el=composer()||el;

    // Submitted but ACK has not rendered yet: do not submit again.
    if(!textOf(el).trim())
      return {
        ok:false,
        waiting:true,
        submitted:true,
        reason:"awaiting_conversation_ack",
        error:"Result submitted; waiting for conversation ACK."
      };
    if(!samePayload(textOf(el),payload))
      return {ok:false,waiting:true,reason:"user_draft",error:"Composer changed after submit attempt; Bridge stopped to protect user text."};

    if(await submitAttempt(el,payload))
      return {ok:true,method:"rbt-requestSubmit-ack"};

    el=composer()||el;

    if(!textOf(el).trim())
      return {
        ok:false,
        waiting:true,
        submitted:true,
        reason:"awaiting_conversation_ack",
        error:"Result submitted; waiting for conversation ACK."
      };
    if(!samePayload(textOf(el),payload))
      return {ok:false,waiting:true,reason:"user_draft",error:"Composer changed after submit attempt; Bridge stopped to protect user text."};

    if(await enterAttempt(el,payload))
      return {ok:true,method:"rbt-enter-ack"};

    el=composer()||el;

    if(!textOf(el).trim())
      return {
        ok:false,
        waiting:true,
        submitted:true,
        reason:"awaiting_conversation_ack",
        error:"Result submitted; waiting for conversation ACK."
      };
    if(!samePayload(textOf(el),payload))
      return {ok:false,waiting:true,reason:"user_draft",error:"Composer changed after submit attempt; Bridge stopped to protect user text."};

    await wait(750);
  }

  const cur=composer();
  const retained=!!cur&&samePayload(textOf(cur),payload);
  return {
    ok:false,
    waiting:true,
    reason:"submit_blocked",
    bridgeDraftRetained:retained,
    error:"Automatic submit did not complete; result remains queued for durable retry."
  };
}

function deliveryProbe(){
  const el=composer();
  const pack=e=>{
    if(!e)return null;
    let r=null;try{r=e.getBoundingClientRect()}catch{}
    return {
      tag:e.tagName||"",id:e.id||"",
      testid:e.getAttribute?.("data-testid")||"",
      role:e.getAttribute?.("role")||"",
      ariaLabel:e.getAttribute?.("aria-label")||"",
      title:e.getAttribute?.("title")||"",
      type:e.getAttribute?.("type")||"",
      contenteditable:e.getAttribute?.("contenteditable")||"",
      disabled:!!e.disabled,ariaDisabled:e.getAttribute?.("aria-disabled")||"",
      visible:!!r&&r.width>0&&r.height>0,
      textLen:(textOf(e)||"").length
    };
  };
  let buttons=[];
  try{
    const qs=[
      '[data-testid*="send" i]','button[aria-label*="send" i]',
      'button[aria-label*="ط§ط±ط³ط§ظ„" i]','button[title*="send" i]',
      'button[title*="ط§ط±ط³ط§ظ„" i]','button[type="submit"]',
      '[role="button"][aria-label*="send" i]'
    ];
    const seen=new Set();
    for(const q of qs)for(const e of document.querySelectorAll(q)){
      if(seen.has(e))continue;seen.add(e);
      const p=pack(e);if(p?.visible)buttons.push(p);
      if(buttons.length>=12)break;
    }
  }catch{}
  const chosen=sendButton();
  const f=nearestForm(el);
  const composerText=textOf(el).trim();
  return {
    composer:pack(el),composerKind:!composerText?"empty":isBridgeEnvelopeText(composerText)?"bridge_payload":"user_draft",
    chosenSend:pack(chosen),buttons,
    form:f?{tag:f.tagName||"",id:f.id||"",action:f.getAttribute?.("action")||"",method:f.getAttribute?.("method")||""}:null,
    active:pack(document.activeElement),
    blockReason:deliveryBlockReason(el)
  };
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="BASELINE"){
    const base=start()||[];
    reply({ok:true,commands:base,diagnostics:{
      detector:DETECTOR,baselineSeen:seen.size,observerRootCount:observers.size
    },frameHref:location.href});
    return;
  }
  if(m?.type==="RECONCILE"){
    const current=start()||[];
    reply({ok:true,commands:current,diagnostics:{
      detector:DETECTOR,reconcileSeen:seen.size,observerRootCount:observers.size
    },frameHref:location.href});
    return;
  }
  if(m?.type==="FIND_CHAT_ARTIFACT"){if(window.top!==window){reply({ok:false,reason:"top_frame_required"});return}reply(findChatArtifact(String(m.filename||"")));return}
  if(m?.type==="CLICK_CHAT_ARTIFACT"){if(window.top!==window){reply({ok:false,reason:"top_frame_required"});return}reply(clickChatArtifact(String(m.filename||"")));return}
  if(m?.type==="POST_RESULT"){
    if(window.top!==window){reply({ok:false,error:"POST_RESULT must target top frame"});return}
    post(String(m.envelope||"")).then(r=>{
      lastPostMethod=r?.method||"";lastPostError=r?.ok?"":(r?.error||"Submit failed");reply(r);
    }).catch(e=>{lastPostError=String(e);reply({ok:false,error:String(e)})});
    return true;
  }
  if(m?.type==="STOP"){stop();reply({ok:true});return}
  if(m?.type==="DIAG"){
    let fallback={};
    try{fallback=Core.scanAll().diagnostics||{}}catch{}
    lastScanAt=Date.now();
    reply({
      ok:true,version:VERSION,armed,frameHref:location.href,topFrame:window.top===window,
      detector:DETECTOR,commandCount:0,commandIds:[],
      diagnostics:{
        ...fallback,observerRootCount:observers.size,mutationCallbacks,
        addedNodesSeen,characterMutationsSeen,legacyMarkerCaptures,
        lastLegacyCaptureAt,lastLegacySource,immediateTextChars,
        streamFragments,streamBytes,streamStartsSeen,streamCompleted,streamParseErrors,
        lastStreamCaptureAt,lastStreamLane,streamLaneCount:laneBuffers.size,
        activeCandidateCount:activeCandidates.size,candidateStartsSeen,candidateCompleted,
        candidateParseErrors,lastCandidateAt,lastCandidateSource,lastPartialDiagAt,
        b64Transport:true,b64ParseErrors,legacyParseErrors
      },
      lastScanAt,lastCommandDetectedAt,lastPostMethod,lastPostError,
      hasChromeDom:!!chrome?.dom?.openOrClosedShadowRoot,deliveryProbe:deliveryProbe()
    });
    return;
  }
});

function dispose(){if(disposed)return;disposed=true;stop()}
globalThis[G]={version:VERSION,dispose};
chrome.runtime.sendMessage({
  type:"CONTENT_READY",url:location.href,topFrame:window.top===window,
  detector:DETECTOR
}).catch(()=>{});
})();