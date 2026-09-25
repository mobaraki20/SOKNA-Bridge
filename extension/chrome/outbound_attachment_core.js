(()=>{
"use strict";
const G="__SOKNA_OUTBOUND_ATTACHMENT_CORE_V1__";
if(globalThis[G])return;
const SAFE_ID=/^[A-Za-z0-9._-]{1,96}$/;
const SAFE_FILE=/^[^\\/:*?"<>|\x00-\x1F]{1,180}$/;
const SHA=/^[a-f0-9]{64}$/i;
const MAX_ATTACH_BYTES=64*1024*1024;
function fail(code,message=code){const e=new Error(message);e.code=code;throw e}
function normalizeRef(ref){
  const id=String(ref?.id||"").trim().toLowerCase(),sha=String(ref?.sha256||"").trim().toLowerCase();
  const name=String(ref?.name||"").trim(),bytes=Number(ref?.bytes),contentType=String(ref?.content_type||"application/octet-stream").trim()||"application/octet-stream";
  if(!SHA.test(id)||!SHA.test(sha)||id!==sha)fail("ATTACHMENT_REF_INVALID","artifact id/sha256 mismatch");
  if(!SAFE_FILE.test(name)||name==="."||name==="..")fail("ATTACHMENT_FILENAME_INVALID","unsafe artifact filename");
  if(!Number.isSafeInteger(bytes)||bytes<0)fail("ATTACHMENT_SIZE_INVALID","invalid artifact size");
  if(bytes>MAX_ATTACH_BYTES)fail("OUTBOUND_ATTACHMENT_TOO_LARGE",`artifact exceeds ${MAX_ATTACH_BYTES} byte attachment limit`);
  return Object.freeze({id,name,bytes,sha256:sha,content_type:contentType});
}
function decodeBase64(s){
  s=String(s||"");if(!s&&s!=="")fail("ATTACHMENT_CHUNK_INVALID");
  let bin;try{bin=atob(s)}catch{fail("ATTACHMENT_CHUNK_BASE64_INVALID","invalid base64 chunk")}
  const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;
}
function hex(bytes){return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function createTransfer(transferId,ref){
  transferId=String(transferId||"");if(!SAFE_ID.test(transferId))fail("ATTACHMENT_TRANSFER_ID_INVALID");
  ref=normalizeRef(ref);let received=0,nextIndex=0,done=false;const chunks=[];
  function add(index,dataB64){
    if(done)fail("ATTACHMENT_TRANSFER_CLOSED");
    if(index!==nextIndex)fail("ATTACHMENT_CHUNK_ORDER_INVALID",`expected chunk ${nextIndex}, got ${index}`);
    const bytes=decodeBase64(dataB64);if(received+bytes.byteLength>ref.bytes||received+bytes.byteLength>MAX_ATTACH_BYTES)fail("ATTACHMENT_CHUNK_OVERFLOW");
    chunks.push(bytes);received+=bytes.byteLength;nextIndex++;return {received,nextIndex};
  }
  async function finalize(cryptoApi=globalThis.crypto){
    if(done)fail("ATTACHMENT_TRANSFER_CLOSED");done=true;
    if(received!==ref.bytes)fail("ATTACHMENT_SIZE_MISMATCH",`expected ${ref.bytes}, got ${received}`);
    const all=new Uint8Array(received);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength}
    if(!cryptoApi?.subtle?.digest)fail("ATTACHMENT_CRYPTO_UNAVAILABLE");
    const digest=hex(await cryptoApi.subtle.digest("SHA-256",all));if(digest!==ref.sha256)fail("ATTACHMENT_SHA256_MISMATCH","outbound attachment integrity check failed");
    return {bytes:all,ref};
  }
  return Object.freeze({ref,get received(){return received},get nextIndex(){return nextIndex},add,finalize});
}
globalThis[G]=Object.freeze({version:"1",maxAttachBytes:MAX_ATTACH_BYTES,normalizeRef,createTransfer});
})();
