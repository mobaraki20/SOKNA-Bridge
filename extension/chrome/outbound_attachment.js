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
  const c=composer(),f=c?.closest?.("form");
  const candidates=all.map((x,index)=>({
    index,
    inComposerForm:!!f&&f.contains(x),
    accept:String(x.getAttribute("accept")||""),
    capture:String(x.getAttribute("capture")||""),
    multiple:!!x.multiple,
    name:String(x.getAttribute("name")||""),
    id:String(x.id||""),
    testid:String(x.getAttribute("data-testid")||""),
    ariaLabel:String(x.getAttribute("aria-label")||"")
  }));
  try{
    const index=Core.selectInputCandidate(candidates);
    const chosen=all[index];if(chosen)return chosen;
    throw Object.assign(new Error("Selected attachment input disappeared"),{code:"ATTACHMENT_INPUT_RACE"});
  }catch(e){
    if(e?.code)throw e;
    throw Object.assign(new Error(String(e?.message||e)),{code:"ATTACHMENT_INPUT_AMBIGUOUS"});
  }
}
function setFiles(input,file,append=false){
  if(typeof DataTransfer!=="function")throw Object.assign(new Error("DataTransfer is unavailable"),{code:"ATTACHMENT_DATATRANSFER_UNAVAILABLE"});
  const dt=new DataTransfer();
  if(append){for(const existing of [...(input.files||[])])dt.items.add(existing)}
  dt.items.add(file);
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"files")?.set;
  if(setter)setter.call(input,dt.files);else input.files=dt.files;
  // Validate that the browser accepted the synthetic FileList before notifying
  // the page. Current ChatGPT consumes/clears the input synchronously from the
  // input/change handler after it stages the attachment, so checking files only
  // after dispatch produces a false ATTACHMENT_INPUT_REJECTED even though the
  // attachment is already present in the composer.
  const selectedBeforeDispatch=[...(input.files||[])].find(x=>x.name===file.name&&x.size===file.size);
  if(!selectedBeforeDispatch)throw Object.assign(new Error("Composer file input rejected the selected file before dispatch"),{code:"ATTACHMENT_INPUT_REJECTED"});
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
  return selectedBeforeDispatch;
}
function begin(m){
  if(!topOnly())return {ok:false,code:"ATTACHMENT_TOP_FRAME_REQUIRED"};
  if(assistantGenerating())return {ok:false,code:"ATTACHMENT_ASSISTANT_BUSY",error:"assistant is still generating",retryable:true};
  if(composerText())return {ok:false,code:"ATTACHMENT_USER_DRAFT_PRESENT",error:"composer contains user text"};
  const id=String(m?.transferId||"");if(transfers.has(id))return {ok:false,code:"ATTACHMENT_TRANSFER_EXISTS"};
  try{
    const input=fileInput();
    if(m?.append!==true&&(input.files?.length||0)>0)return {ok:false,code:"ATTACHMENT_EXISTING_FILES_PRESENT",error:"composer already contains file attachments"};
    const t=Core.createTransfer(id,m?.artifactRef);transfers.set(id,t);return {ok:true,transferId:id,filename:t.ref.name,bytes:t.ref.bytes,maxBytes:Core.maxAttachBytes}
  }
  catch(e){return {ok:false,code:e?.code||"ATTACHMENT_BEGIN_FAILED",error:String(e?.message||e)}}
}
function chunk(m){
  const id=String(m?.transferId||""),t=transfers.get(id);if(!t)return {ok:false,code:"ATTACHMENT_TRANSFER_NOT_FOUND"};
  try{return {ok:true,transferId:id,...t.add(Number(m?.index),m?.dataB64)}}catch(e){transfers.delete(id);return {ok:false,code:e?.code||"ATTACHMENT_CHUNK_FAILED",error:String(e?.message||e)}}
}
async function commit(m){
  const id=String(m?.transferId||""),t=transfers.get(id);if(!t)return {ok:false,code:"ATTACHMENT_TRANSFER_NOT_FOUND"};
  if(assistantGenerating())return {ok:false,code:"ATTACHMENT_ASSISTANT_BUSY",error:"assistant is still generating",retryable:true};
  transfers.delete(id);
  try{
    if(composerText())throw Object.assign(new Error("composer contains user text"),{code:"ATTACHMENT_USER_DRAFT_PRESENT"});
    const fin=await t.finalize(),input=fileInput();
    const file=new File([fin.bytes],fin.ref.name,{type:fin.ref.content_type,lastModified:Date.now()});setFiles(input,file,m?.append===true);
    if(m?.submit===false)return {ok:true,status:"staged_in_composer",transferId:id,filename:file.name,bytes:file.size,sha256:fin.ref.sha256,contentType:file.type||fin.ref.content_type,method:"staged"};
    const note=String(m?.note||"").trim()||`SOKNA Bridge artifact: ${fin.ref.name}\nSHA-256: ${fin.ref.sha256}`;
    const submitted=await DOM.submitEnvelope(note);
    if(!submitted?.ok)throw Object.assign(new Error(submitted?.error||"attachment submit failed"),{code:"ATTACHMENT_SUBMIT_FAILED"});
    return {ok:true,status:"submitted_to_conversation",transferId:id,filename:file.name,bytes:file.size,sha256:fin.ref.sha256,contentType:file.type||fin.ref.content_type,method:submitted.method||""};
  }catch(e){return {ok:false,code:e?.code||"ATTACHMENT_COMMIT_FAILED",error:String(e?.message||e)}}
}
function abort(m){const id=String(m?.transferId||"");const existed=transfers.delete(id);return {ok:true,transferId:id,aborted:existed}}
function ready(){
  if(!topOnly())return {ok:false,code:"ATTACHMENT_TOP_FRAME_REQUIRED"};
  if(assistantGenerating())return {ok:false,code:"ATTACHMENT_ASSISTANT_BUSY",error:"assistant is still generating",retryable:true};
  if(composerText())return {ok:false,code:"ATTACHMENT_USER_DRAFT_PRESENT",error:"composer contains user text"};
  try{
    const fileCount=[...document.querySelectorAll('input[type="file"]')].reduce((n,x)=>n+(x.files?.length||0),0);
    if(fileCount>0)return {ok:false,code:"ATTACHMENT_EXISTING_FILES_PRESENT",error:"composer still contains file attachments",retryable:true,fileCount};
    const busy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-testid*="upload" i]')].some(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0});
    if(busy)return {ok:false,code:"ATTACHMENT_UPLOAD_BUSY",error:"composer attachment upload is still active",retryable:true};
  }catch{}
  return {ok:true,status:"ready"};
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="OUTBOUND_ATTACHMENT_BEGIN"){reply(begin(m));return}
  if(m?.type==="OUTBOUND_ATTACHMENT_CHUNK"){reply(chunk(m));return}
  if(m?.type==="OUTBOUND_ATTACHMENT_COMMIT"){commit(m).then(reply,e=>reply({ok:false,code:"ATTACHMENT_COMMIT_FAILED",error:String(e)}));return true}
  if(m?.type==="OUTBOUND_ATTACHMENT_ABORT"){reply(abort(m));return}
  if(m?.type==="OUTBOUND_ATTACHMENT_READY"){reply(ready());return}
});
})();