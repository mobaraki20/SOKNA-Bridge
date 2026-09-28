(()=>{
"use strict";
const G="__SOKNA_BRIDGE_V33_CONTENT__";
try{globalThis[G]?.dispose?.()}catch{}

const Core=globalThis.__SOKNA_V33_DOM_CORE__;
const CHATART=globalThis.__SOKNA_CHAT_ARTIFACT_CORE_V1__;
const VERSION="3.12.1",DETECTOR="semantic-delivery-v2";
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let armed=false,disposed=false,observer=null,deliveryStateTimer=0;
let lastPostMethod="",lastPostError="",lastDeliveryGate="",lastDeliveryReadySignalAt=0,lastActivityAt=0;
const CONTENT_FALLBACK_KEY="content_fallback_diagnostics_v1";
async function persistContentFallback(event,error,extra={}){
  try{
    const d=await chrome.storage.local.get([CONTENT_FALLBACK_KEY]),a=Array.isArray(d[CONTENT_FALLBACK_KEY])?d[CONTENT_FALLBACK_KEY]:[];
    a.push({ts:Date.now(),event:String(event||""),error:String(error||""),url:location.href,topFrame:window.top===window,...extra});
    await chrome.storage.local.set({[CONTENT_FALLBACK_KEY]:a.slice(-80)});
  }catch{}
}
async function runtimeSendSafe(message,event){
  try{return await chrome.runtime.sendMessage(message)}
  catch(e){await persistContentFallback(event||"content.runtime_send_failed",e,{message_type:String(message?.type||"")});return {ok:false,error:String(e),runtime_unavailable:true}}
}


function pageBroken(){
  return (document.body?.innerText||"").toLowerCase().includes("content failed to load");
}
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
  try{return Core?.composer?.()||null}catch{return null}
}

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
  try{const b=Core?.sendButton?.();if(b)return b}catch{}
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
async function sent(payload){return await waitForResultVisible(payload,1500)}
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
  return await sent(payload);
}
async function submitAttempt(el,payload){
  const f=nearestForm(el);if(!f)return false;
  try{
    const b=sendButton(el,payload);
    if(f.requestSubmit)f.requestSubmit(b&&b.form===f?b:undefined);
    else f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  }catch{return false}
  return await sent(payload);
}
async function enterAttempt(el,payload){
  try{
    el.focus();
    const opts={key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true};
    el.dispatchEvent(new KeyboardEvent("keydown",opts));
    el.dispatchEvent(new KeyboardEvent("keypress",opts));
    el.dispatchEvent(new KeyboardEvent("keyup",opts));
  }catch{return false}
  return await sent(payload);
}
function resultVisibleInUserTurn(payload){
  try{
    const p=String(payload||"");
    const m=p.match(/"eventId"\s*:\s*"([^"]+)"/)||p.match(/"id"\s*:\s*"([^"]+)"/)||p.match(/"commandId"\s*:\s*"([^"]+)"/);
    const id=m?.[1]||"";if(!id)return false;
    const b=document.body;if(!b)return false;
    const s=b.innerText||b.textContent||"";
    const isEventId=p.includes('"eventId"');
    const hit=isEventId
      ?(s.includes('"eventId":"'+id+'"')||s.includes('"eventId": "'+id+'"'))
      :(s.includes('"id":"'+id+'"')||s.includes('"id": "'+id+'"')||s.includes('"commandId":"'+id+'"')||s.includes('"commandId": "'+id+'"'));
    if(!hit)return false;
    const el=composer();if(!el)return true;
    return !textOf(el).includes(id);
  }catch{return false}
}
async function waitForResultVisible(payload,timeoutMs=8000){
  const end=Date.now()+timeoutMs;
  do{if(resultVisibleInUserTurn(payload))return true;await wait(125)}while(Date.now()<end);
  return false;
}
function deliveryBlockReason(el){
  try{
    if([...document.querySelectorAll('[data-testid="stop-button"],button[aria-label*="stop" i],button[title*="stop" i]')].some(vis))return "assistant_generating";
  }catch{}
  try{
    const root=nearestForm(el)||document;
    if([...root.querySelectorAll('input[type="file"]')].some(x=>x.files?.length))return "attachment_present";
    if([...root.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-testid*="upload" i],[data-testid*="attachment" i],[data-testid*="file-preview" i]')].some(vis))return "attachment_or_upload";
  }catch{}
  return "";
}
function deliveryGateState(){
  const el=composer();if(!el)return "composer_missing";
  const block=deliveryBlockReason(el);if(block)return block;
  const t=textOf(el).trim();if(!t)return "ready";
  if(isBridgeEnvelopeText(t))return sendButton(el,t)?"ready":"bridge_payload_waiting";
  return "user_draft";
}
function scheduleDeliveryStateCheck(){
  clearTimeout(deliveryStateTimer);
  if(!armed||disposed)return;
  deliveryStateTimer=setTimeout(()=>{
    lastActivityAt=Date.now();
    const el=composer(),gate=deliveryGateState();
    const prev=lastDeliveryGate,bridgeReady=gate==="ready"&&isBridgeEnvelopeText(textOf(el));
    lastDeliveryGate=gate;
    const now=Date.now();
    if((prev&&prev!=="ready"&&gate==="ready")||(bridgeReady&&now-lastDeliveryReadySignalAt>=1500)){
      lastDeliveryReadySignalAt=now;
      runtimeSendSafe({type:"DELIVERY_READY",from:prev,to:gate,force:!bridgeReady,bridgeDraft:bridgeReady,ts:now,frameHref:location.href},"content.delivery_ready_failed");
    }
  },250);
}
function startObserver(){
  if(observer||disposed)return;
  try{
    observer=new MutationObserver(()=>scheduleDeliveryStateCheck());
    observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["aria-busy","aria-disabled","disabled","data-testid"]});
  }catch{}
}
function start(){
  if(armed)return [];
  armed=true;lastDeliveryGate=deliveryGateState();startObserver();scheduleDeliveryStateCheck();return [];
}
function stop(){
  armed=false;clearTimeout(deliveryStateTimer);
  try{observer?.disconnect()}catch{};observer=null;
}

async function postUserText(text){
  if(window.top!==window)return {ok:false,error:"POST_USER_TEXT must target top frame"};
  text=String(text||"").trim();if(!text)return {ok:false,error:"text required"};
  let initial=composer(),draft=textOf(initial).trim();
  if(draft)return {ok:false,waiting:true,reason:"user_draft",error:"Composer contains user text."};
  let block=deliveryBlockReason(initial);
  if(block==="assistant_generating"){
    for(let i=0;i<240&&block==="assistant_generating";i++){await wait(250);block=deliveryBlockReason(composer())}
  }
  if(block)return {ok:false,waiting:true,reason:block,error:"Page is not ready for the Bridge handshake."};
  for(let attempt=0;attempt<3;attempt++){
    let el=composer();if(!el){await wait(400);continue}
    if(textOf(el).trim())return {ok:false,waiting:true,reason:"user_draft",error:"Composer contains user text."};
    setInput(el,text);await wait(80);el=composer()||el;
    const b=sendButton(el,text);
    if(b){
      try{b.click()}catch{}
      for(let i=0;i<24;i++){await wait(125);const cur=composer();if(!cur||!samePayload(textOf(cur),text))return {ok:true,method:"user-click"}}
    }
    el=composer()||el;
    const f=nearestForm(el);if(f&&samePayload(textOf(el),text)){
      try{if(typeof f.requestSubmit==="function")f.requestSubmit();else f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))}catch{}
      for(let i=0;i<24;i++){await wait(125);const cur=composer();if(!cur||!samePayload(textOf(cur),text))return {ok:true,method:"user-requestSubmit"}}
    }
    el=composer()||el;
    if(samePayload(textOf(el),text)){
      try{
        const opts={key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true};
        el.dispatchEvent(new KeyboardEvent("keydown",opts));el.dispatchEvent(new KeyboardEvent("keypress",opts));el.dispatchEvent(new KeyboardEvent("keyup",opts));
      }catch{}
      for(let i=0;i<24;i++){await wait(125);const cur=composer();if(!cur||!samePayload(textOf(cur),text))return {ok:true,method:"user-enter"}}
    }
  }
  return {ok:false,waiting:true,reason:"submit_blocked",error:"Handshake text remains in the composer."};
}

async function post(payload){
  if(window.top!==window)return {ok:false,error:"POST_RESULT must target top frame"};
  if(resultVisibleInUserTurn(payload))return {ok:true,method:"existing-bubble"};
  const existing=composer(),draft=textOf(existing).trim();
  if(draft&&!samePayload(draft,payload))return {ok:false,waiting:true,reason:"user_draft",error:"Composer contains user text; delivery queued."};
  let initialGate=deliveryBlockReason(existing);
  if(initialGate==="assistant_generating"){
    for(let i=0;i<480&&initialGate==="assistant_generating";i++){await wait(250);initialGate=deliveryBlockReason(composer())}
  }
  if(initialGate)return {ok:false,waiting:true,reason:initialGate,error:"Automatic delivery is waiting for the page to become safe."};

  for(let i=0;i<3;i++){
    if(resultVisibleInUserTurn(payload))return {ok:true,method:"existing-bubble"};
    if(pageBroken()){await wait(1000);continue}
    let el=composer();if(!el){await wait(500);continue}
    const gate=deliveryBlockReason(el);if(gate)return {ok:false,waiting:true,reason:gate,error:"Automatic delivery is waiting for the page to become safe."};
    const current=textOf(el);
    if(current.trim()&&!samePayload(current,payload))return {ok:false,waiting:true,reason:"user_draft",error:"Composer contains user text; delivery queued."};
    if(!samePayload(current,payload))setInput(el,payload);
    for(let r=0;r<24;r++){
      if(resultVisibleInUserTurn(payload))return {ok:true,method:"existing-bubble"};
      el=composer()||el;if(sendButton(el,payload))break;await wait(125);
    }
    el=composer()||el;
    if(await clickAttempt(el,payload))return {ok:true,method:"rbt-click-ack"};
    el=composer()||el;
    if(!textOf(el).trim())return {ok:false,waiting:true,submitted:true,reason:"awaiting_conversation_ack",error:"Result submitted; waiting for conversation ACK."};
    if(!samePayload(textOf(el),payload))return {ok:false,waiting:true,reason:"user_draft",error:"Composer changed after submit attempt; Bridge stopped to protect user text."};
    if(await submitAttempt(el,payload))return {ok:true,method:"rbt-requestSubmit-ack"};
    el=composer()||el;
    if(!textOf(el).trim())return {ok:false,waiting:true,submitted:true,reason:"awaiting_conversation_ack",error:"Result submitted; waiting for conversation ACK."};
    if(!samePayload(textOf(el),payload))return {ok:false,waiting:true,reason:"user_draft",error:"Composer changed after submit attempt; Bridge stopped to protect user text."};
    if(await enterAttempt(el,payload))return {ok:true,method:"rbt-enter-ack"};
    el=composer()||el;
    if(!textOf(el).trim())return {ok:false,waiting:true,submitted:true,reason:"awaiting_conversation_ack",error:"Result submitted; waiting for conversation ACK."};
    if(!samePayload(textOf(el),payload))return {ok:false,waiting:true,reason:"user_draft",error:"Composer changed after submit attempt; Bridge stopped to protect user text."};
    await wait(750);
  }
  const cur=composer(),retained=!!cur&&samePayload(textOf(cur),payload);
  return {ok:false,waiting:true,reason:"submit_blocked",bridgeDraftRetained:retained,error:"Automatic submit did not complete; result remains queued for durable retry."};
}

function deliveryProbe(){
  const el=composer();
  const pack=e=>{
    if(!e)return null;
    let r=null;try{r=e.getBoundingClientRect()}catch{}
    return {tag:e.tagName||"",id:e.id||"",testid:e.getAttribute?.("data-testid")||"",role:e.getAttribute?.("role")||"",ariaLabel:e.getAttribute?.("aria-label")||"",title:e.getAttribute?.("title")||"",type:e.getAttribute?.("type")||"",contenteditable:e.getAttribute?.("contenteditable")||"",disabled:!!e.disabled,ariaDisabled:e.getAttribute?.("aria-disabled")||"",visible:!!r&&r.width>0&&r.height>0,textLen:(textOf(e)||"").length};
  };
  let buttons=[];
  try{
    const qs=['[data-testid*="send" i]','button[aria-label*="send" i]','button[title*="send" i]','button[type="submit"]','[role="button"][aria-label*="send" i]'];
    const seen=new Set();
    for(const q of qs)for(const e of document.querySelectorAll(q)){
      if(seen.has(e))continue;seen.add(e);const p=pack(e);if(p?.visible)buttons.push(p);if(buttons.length>=12)break;
    }
  }catch{}
  const chosen=sendButton(),f=nearestForm(el),composerText=textOf(el).trim();
  return {composer:pack(el),composerKind:!composerText?"empty":isBridgeEnvelopeText(composerText)?"bridge_payload":"user_draft",chosenSend:pack(chosen),buttons,form:f?{tag:f.tagName||"",id:f.id||"",action:f.getAttribute?.("action")||"",method:f.getAttribute?.("method")||""}:null,active:pack(document.activeElement),blockReason:deliveryBlockReason(el)};
}

chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="BASELINE"){
    start();reply({ok:true,commands:[],diagnostics:{detector:DETECTOR,commandDiscovery:"semantic-intent-only",deliveryObserver:!!observer},frameHref:location.href});return;
  }
  if(m?.type==="RECONCILE"){
    start();reply({ok:true,commands:[],diagnostics:{detector:DETECTOR,commandDiscovery:"semantic-intent-only",deliveryObserver:!!observer},frameHref:location.href});return;
  }
  if(m?.type==="FIND_CHAT_ARTIFACT"){if(window.top!==window){reply({ok:false,reason:"top_frame_required"});return}reply(findChatArtifact(String(m.filename||"")));return}
  if(m?.type==="CLICK_CHAT_ARTIFACT"){if(window.top!==window){reply({ok:false,reason:"top_frame_required"});return}reply(clickChatArtifact(String(m.filename||"")));return}
  if(m?.type==="POST_RESULT"){
    if(window.top!==window){reply({ok:false,error:"POST_RESULT must target top frame"});return}
    post(String(m.envelope||"")).then(r=>{lastPostMethod=r?.method||"";lastPostError=r?.ok?"":(r?.error||"Submit failed");reply(r)}).catch(e=>{lastPostError=String(e);reply({ok:false,error:String(e)})});return true;
  }
  if(m?.type==="POST_USER_TEXT"){
    postUserText(String(m.text||"")).then(r=>reply(r)).catch(e=>reply({ok:false,error:String(e)}));return true;
  }
  if(m?.type==="STOP"){stop();reply({ok:true});return}
  if(m?.type==="DIAG"){
    lastActivityAt=Date.now();
    reply({ok:true,version:VERSION,armed,frameHref:location.href,topFrame:window.top===window,detector:DETECTOR,commandCount:0,commandIds:[],diagnostics:{commandDiscovery:"semantic-intent-only",legacyCommandParsers:false,deliveryObserver:!!observer,lastActivityAt},lastPostMethod,lastPostError,hasChromeDom:!!chrome?.dom?.openOrClosedShadowRoot,deliveryProbe:deliveryProbe()});return;
  }
});

function dispose(){if(disposed)return;disposed=true;stop()}
globalThis[G]={version:VERSION,dispose};
runtimeSendSafe({type:"CONTENT_READY",url:location.href,topFrame:window.top===window,detector:DETECTOR},"content.ready_failed");
})();
