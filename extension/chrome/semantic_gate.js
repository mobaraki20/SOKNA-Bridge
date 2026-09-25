(()=>{
"use strict";
const G="__SOKNA_SEMANTIC_GATE_V1__";
if(globalThis[G])return;
const VALID=/^[A-Za-z0-9._-]{1,96}$/;
const runtime=chrome?.runtime;
if(!runtime?.sendMessage){globalThis[G]={version:"2",installed:false,reason:"runtime_unavailable"};return}
const original=runtime.sendMessage.bind(runtime);
function commandId(m){const id=String(m?.command?.id||"");return VALID.test(id)?id:""}
function envelopeError(c){
  if(!c||typeof c!=="object"||Array.isArray(c))return "ENVELOPE_OBJECT_REQUIRED";
  if(String(c.protocolVersion||"")!=="2")return "PROTOCOL_VERSION_UNSUPPORTED";
  if(String(c.schemaVersion||"")!=="2")return "SCHEMA_VERSION_UNSUPPORTED";
  if(String(c.kind||"")!=="command")return "KIND_MISMATCH";
  if(!VALID.test(String(c.messageId||"")))return "MESSAGE_ID_INVALID";
  if(!VALID.test(String(c.correlationId||"")))return "CORRELATION_ID_INVALID";
  if(String(c.id||"")!==String(c.correlationId||""))return "COMMAND_ID_CORRELATION_MISMATCH";
  if(c.parentId&&!VALID.test(String(c.parentId)))return "PARENT_ID_INVALID";
  if(!String(c.action||""))return "ACTION_REQUIRED";
  if(!c.params||typeof c.params!=="object"||Array.isArray(c.params))return "PARAMS_OBJECT_REQUIRED";
  if(!Number.isFinite(Number(c.timestamp))||Number(c.timestamp)<=0)return "TIMESTAMP_INVALID";
  return "";
}
function blockedDiagnostic(m,error){
  const id=commandId(m);
  return {type:"TRANSPORT_DIAG",diagnostic:{kind:"semantic-command-rejected",final:!!id,reason:"invalid_compact_command",version:"semantic-gate-v2",commandId:id,source:String(m?.source||m?.detector||"command"),error:String(error||"SEMANTIC_ROUTE_REQUIRED"),executed:false,retryable:false}};
}
function reject(m,error,cb){
  const p=Promise.resolve(original(blockedDiagnostic(m,error))).then(()=>({ok:false,blocked:true,executed:false,error:String(error)}));
  if(cb){p.then(cb,()=>cb({ok:false,blocked:true,executed:false,error:String(error)}));return}
  return p;
}
function wrapped(...args){
  const m=args[0];
  if(m?.type==="COMMAND"){
    const cb=typeof args.at(-1)==="function"?args.at(-1):null;
    if(!m?.semantic)return reject(m,"SEMANTIC_ROUTE_REQUIRED",cb);
    const err=envelopeError(m.command);
    if(err)return reject(m,"UNIFIED_ENVELOPE_INVALID:"+err,cb);
  }
  return original(...args);
}
let installed=false;
try{runtime.sendMessage=wrapped;installed=runtime.sendMessage===wrapped}catch{}
if(!installed){
  try{Object.defineProperty(runtime,"sendMessage",{value:wrapped,writable:false,configurable:false});installed=runtime.sendMessage===wrapped}catch{}
}
globalThis[G]=Object.freeze({version:"2",installed,envelopeError});
if(!installed){try{original({type:"TRANSPORT_DIAG",diagnostic:{kind:"semantic-gate-install-failed",final:false,reason:"invalid_compact_command",version:"semantic-gate-v2",error:"SEMANTIC_GATE_INSTALL_FAILED",executed:false}})}catch{}}
})();
