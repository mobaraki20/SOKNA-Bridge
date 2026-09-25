(()=>{
"use strict";
const G="__SOKNA_SEMANTIC_GATE_V1__";
if(globalThis[G])return;
const VALID=/^[A-Za-z0-9._-]{1,96}$/;
const runtime=chrome?.runtime;
if(!runtime?.sendMessage){globalThis[G]={version:"1",installed:false,reason:"runtime_unavailable"};return}
const original=runtime.sendMessage.bind(runtime);
function commandId(m){const id=String(m?.command?.id||"");return VALID.test(id)?id:""}
function blockedDiagnostic(m){
  const id=commandId(m);
  return {type:"TRANSPORT_DIAG",diagnostic:{kind:"semantic-route-required",final:!!id,reason:"SEMANTIC_ROUTE_REQUIRED",version:"semantic-gate-v1",commandId:id,source:String(m?.source||m?.detector||"legacy-command"),error:"Executable commands must use the semantic compiler path.",executed:false,retryable:true}};
}
function wrapped(...args){
  const m=args[0];
  if(m?.type==="COMMAND"&&!m?.semantic){
    const cb=typeof args.at(-1)==="function"?args.at(-1):null;
    const p=Promise.resolve(original(blockedDiagnostic(m))).then(()=>({ok:false,blocked:true,executed:false,error:"SEMANTIC_ROUTE_REQUIRED"}));
    if(cb){p.then(cb,()=>cb({ok:false,blocked:true,executed:false,error:"SEMANTIC_ROUTE_REQUIRED"}));return}
    return p;
  }
  return original(...args);
}
let installed=false;
try{runtime.sendMessage=wrapped;installed=runtime.sendMessage===wrapped}catch{}
if(!installed){
  try{Object.defineProperty(runtime,"sendMessage",{value:wrapped,writable:false,configurable:false});installed=runtime.sendMessage===wrapped}catch{}
}
globalThis[G]=Object.freeze({version:"1",installed});
if(!installed){try{original({type:"TRANSPORT_DIAG",diagnostic:{kind:"semantic-gate-install-failed",final:false,reason:"SEMANTIC_GATE_INSTALL_FAILED",version:"semantic-gate-v1",executed:false}})}catch{}}
})();
