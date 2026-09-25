(()=>{
"use strict";
importScripts("protocol.js");
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const event=chrome.runtime.onMessage;
const originalAdd=event.addListener.bind(event);
const ID=/^[A-Za-z0-9._-]{1,96}$/;
function idOf(m){const id=String(m?.command?.id||m?.command?.correlationId||"");return ID.test(id)?id:""}
function rejection(m,error){
  const cid=idOf(m);
  return {
    type:"TRANSPORT_DIAG",
    diagnostic:{
      kind:"background-command-rejected",
      final:!!cid,
      reason:"invalid_compact_command",
      version:"unified-background-gate-v1",
      commandId:cid,
      source:String(m?.source||m?.detector||"background-gate"),
      error:String(error||"UNIFIED_ENVELOPE_INVALID"),
      executed:false,
      retryable:false
    }
  };
}
function wrapListener(listener){
  return function(m,sender,reply){
    if(m?.type==="COMMAND"){
      if(!m?.semantic)return listener(rejection(m,"SEMANTIC_ROUTE_REQUIRED"),sender,reply);
      const v=PROTO?.validateEnvelope?.(m.command,{kind:"command"})||{ok:false,error:"PROTOCOL_VALIDATOR_UNAVAILABLE"};
      if(!v.ok)return listener(rejection(m,"UNIFIED_ENVELOPE_INVALID:"+String(v.error||"UNKNOWN")),sender,reply);
    }
    return listener(m,sender,reply);
  };
}
try{
  event.addListener=function(listener){return originalAdd(wrapListener(listener))};
}catch(e){
  throw new Error("BACKGROUND_FAIL_CLOSED_GATE_INSTALL_FAILED:"+String(e));
}
importScripts("background.js");
})();
