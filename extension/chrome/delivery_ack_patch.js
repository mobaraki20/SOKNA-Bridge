(()=>{
"use strict";
if(globalThis.__SOKNA_DELIVERY_ACK_PATCH_V1__)return;
if(typeof postPending!=="function"||typeof seenAll!=="function"||typeof saveSeen!=="function")throw new Error("DELIVERY_ACK_PATCH_RUNTIME_UNAVAILABLE");
const basePostPending=postPending;
function escapeRe(s){return String(s||"").replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&")}
async function visibleBodyIdentity(tabId,envelope,rec,id){
  const isStatus=rec?.kind==="transport-nack"||rec?.kind==="status-event";
  const expectedId=isStatus?String(id||""):String(resultIdOf(id,rec)||"");
  if(!expectedId)return {visible:false,reason:"missing-id"};
  const tag=isStatus?"SOKNA-V2-STATUS":"SOKNA-V2-RESULT",field=isStatus?"eventId":"id";
  try{
    const rows=await chrome.scripting.executeScript({target:{tabId:Number(tabId),frameIds:[0]},func:(payload,tagName,fieldName,wantedId)=>{
      const norm=s=>String(s||"").replace(/[\u200B-\u200D\uFEFF]/g,"").replace(/\u00A0/g," ");
      const visible=el=>{if(!el)return false;try{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0}catch{return false}};
      const textOf=el=>el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement?String(el.value||""):String(el?.innerText||el?.textContent||"");
      let composer=null;for(const q of ['[data-testid="prompt-textarea"]','#prompt-textarea','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="plaintext-only"][role="textbox"]','[contenteditable="true"]']){try{const a=[...document.querySelectorAll(q)].filter(visible);if(a.length){composer=a[a.length-1];break}}catch{}}
      if(composer&&norm(textOf(composer)).trim()===norm(payload).trim())return {visible:false,reason:"payload-still-in-composer"};
      const body=norm(document.body?.innerText||document.body?.textContent||""),marker="["+tagName+"]";
      let pos=0;while((pos=body.indexOf(marker,pos))>=0){const head=body.slice(pos,Math.min(body.length,pos+32768));const fieldPattern=new RegExp('"'+String(fieldName).replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&")+'"\\s*:\\s*"'+String(wantedId).replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&")+'"');if(fieldPattern.test(head))return {visible:true,reason:"body-type-id"};const raw=head.indexOf(wantedId);if(raw>=0&&raw<4096)return {visible:true,reason:"body-type-id-near-header"};pos+=marker.length}
      return {visible:false,reason:"body-type-id-not-found"};
    },args:[String(envelope||""),tag,field,expectedId]});
    return rows?.[0]?.result||{visible:false,reason:"no-result"};
  }catch(e){return {visible:false,reason:"script-failed",error:String(e?.message||e)}}
}
async function acknowledgeFallback(tabId,id,rec){
  const isStatus=rec?.kind==="transport-nack"||rec?.kind==="status-event";
  const envelope=isStatus?statusEnvelope({eventId:id,...rec.result}):resultEnvelope({id:resultIdOf(id,rec),...rec.result});
  const witness=await visibleBodyIdentity(tabId,envelope,rec,id);if(!witness?.visible)return null;
  let seen=await seenAll(),current=DELIVERY.normalize(seen[id]||rec,now());
  current=DELIVERY.markAcknowledged(current,"body-type-id-fallback",now());seen[id]={...(seen[id]||{}),...current,postError:""};await saveSeen(seen);
  await clearRetryAlarm(tabId);await appendTrace(tabId,"chat.delivery_completed",{record_id:id,kind:current.kind||"result",method:"body-type-id-fallback",witness:String(witness.reason||"")});
  await clearDeliveryStatus(tabId,id,{uiState:"Ready",detail:"Connected — End-to-End Verified",transportVerified:true,lastError:"",actionRequired:false});
  await setStatus(tabId,{...(isStatus?{}:{lastCompletedCommandId:resultIdOf(id,current)}),lastPostMethod:"body-type-id-fallback"});
  setTimeout(()=>retryPending(tabId).catch(()=>{}),250);
  return {ok:true,method:"body-type-id-fallback",presentation_ack:true};
}
postPending=async function(tabId,id,rec,force=false){
  const result=await basePostPending(tabId,id,rec,force);
  if(result?.ok)return result;
  if(!(result?.submitted===true||String(result?.reason||"")==="awaiting_conversation_ack"))return result;
  const seen=await seenAll(),latest=seen[id]||rec;if(!latest?.result)return result;
  const fallback=await acknowledgeFallback(tabId,id,latest);return fallback||result;
};
globalThis.__SOKNA_DELIVERY_ACK_PATCH_V1__=Object.freeze({schema:"sokna-delivery-ack-patch-v1",version:1});
})();
