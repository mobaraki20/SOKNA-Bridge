(()=>{
"use strict";
const Core=globalThis.__SOKNA_OUTBOUND_ATTACHMENT_CORE_V1__;
const DOM=globalThis.__SOKNA_V33_DOM_CORE__;
if(!Core||!DOM)return;
const transfers=new Map();
function topOnly(){return window.top===window}
function composer(){try{return DOM.composer?.()||null}catch{return null}}
function composerText(){try{return String(DOM.textOf?.(composer())||"").trim()}catch{return""}}
function assistantGenerating(){try{return [...document.querySelectorAll('[data-testid="stop-button"],button[aria-label*="stop" i],button[title*="stop" i]')].some(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0})}catch{return false}}
function fileInput(){
  const all=[...document.querySelectorAll('input[type="file"]')].filter(x=>!x.disabled&&x.getAttribute("aria-disabled")!=="true");
  if(!all.length)throw Object.assign(new Error("No file input is available in the active composer"),{code:"ATTACHMENT_INPUT_MISSING"});
  const c=composer(),f=c?.closest?.("form");
  if(f){const inside=all.filter(x=>f.contains(x));if(inside.length===1)return inside[0];if(inside.length>1)throw Object.assign(new Error("Multiple file inputs exist in the active composer"),{code:"ATTACHMENT_INPUT_AMBIGUOUS"})}
  if(all.length===1)return all[0];
  throw Object.assign(new Error("Multiple file inputs exist and none can be uniquely tied to the active composer"),{code:"ATTACHMENT_INPUT_AMBIGUOUS"});
}
function setFiles(input,file){
  if(typeof DataTransfer!=="function")throw Object.assign(new Error("DataTransfer is unavailable"),{code:"ATTACHMENT_DATATRANSFER_UNAVAILABLE"});
  const dt=new DataTransfer();dt.items.add(file);
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"files")?.set;
  if(setter)setter.call(input,dt.files);else input.files=dt.files;
  input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
  const selected=input.files?.[0];
  if(!selected||selected.name!==file.name||selected.size!==file.size)throw Object.assign(new Error("Composer did not accept the selected file"),{code:"ATTACHMENT_INPUT_REJECTED"});
  return selected;
}
function begin(m){
  if(!topOnly())return {ok:false,code:"ATTACHMENT_TOP_FRAME_REQUIRED"};
  if(assistantGenerating())return {ok:false,code:"ATTACHMENT_ASSISTANT_BUSY",error:"assistant is still generating"};
  if(composerText())return {ok:false,code:"ATTACHMENT_USER_DRAFT_PRESENT",error:"composer contains user text"};
  const id=String(m?.transferId||"");if(transfers.has(id))return {ok:false,code:"ATTACHMENT_TRANSFER_EXISTS"};
  try{const t=Core.createTransfer(id,m?.artifactRef);transfers.set(id,t);return {ok:true,transferId:id,filename:t.ref.name,bytes:t.ref.bytes,maxBytes:Core.maxAttachBytes}}
  catch(e){return {ok:false,code:e?.code||"ATTACHMENT_BEGIN_FAILED",error:String(e?.message||e)}}
}
function chunk(m){
  const id=String(m?.transferId||""),t=transfers.get(id);if(!t)return {ok:false,code:"ATTACHMENT_TRANSFER_NOT_FOUND"};
  try{return {ok:true,transferId:id,...t.add(Number(m?.index),m?.dataB64)}}catch(e){transfers.delete(id);return {ok:false,code:e?.code||"ATTACHMENT_CHUNK_FAILED",error:String(e?.message||e)}}
}
async function commit(m){
  const id=String(m?.transferId||""),t=transfers.get(id);if(!t)return {ok:false,code:"ATTACHMENT_TRANSFER_NOT_FOUND"};
  transfers.delete(id);
  try{
    if(assistantGenerating())throw Object.assign(new Error("assistant is still generating"),{code:"ATTACHMENT_ASSISTANT_BUSY"});
    if(composerText())throw Object.assign(new Error("composer contains user text"),{code:"ATTACHMENT_USER_DRAFT_PRESENT"});
    const fin=await t.finalize(),input=fileInput();
    const file=new File([fin.bytes],fin.ref.name,{type:fin.ref.content_type,lastModified:Date.now()});setFiles(input,file);
    const note=`SOKNA Bridge artifact: ${fin.ref.name}\nSHA-256: ${fin.ref.sha256}`;
    const submitted=await DOM.submitEnvelope(note);
    if(!submitted?.ok)throw Object.assign(new Error(submitted?.error||"attachment submit failed"),{code:"ATTACHMENT_SUBMIT_FAILED"});
    return {ok:true,status:"submitted_to_conversation",transferId:id,filename:file.name,bytes:file.size,sha256:fin.ref.sha256,contentType:file.type||fin.ref.content_type,method:submitted.method||""};
  }catch(e){return {ok:false,code:e?.code||"ATTACHMENT_COMMIT_FAILED",error:String(e?.message||e)}}
}
function abort(m){const id=String(m?.transferId||"");const existed=transfers.delete(id);return {ok:true,transferId:id,aborted:existed}}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="OUTBOUND_ATTACHMENT_BEGIN"){reply(begin(m));return}
  if(m?.type==="OUTBOUND_ATTACHMENT_CHUNK"){reply(chunk(m));return}
  if(m?.type==="OUTBOUND_ATTACHMENT_COMMIT"){commit(m).then(reply,e=>reply({ok:false,code:"ATTACHMENT_COMMIT_FAILED",error:String(e)}));return true}
  if(m?.type==="OUTBOUND_ATTACHMENT_ABORT"){reply(abort(m));return}
});
})();
