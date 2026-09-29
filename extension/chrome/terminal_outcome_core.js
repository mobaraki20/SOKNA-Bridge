(()=>{
"use strict";
const ID=/^[A-Za-z0-9._-]{1,96}$/;
const CODE=/^[A-Z][A-Z0-9_]{2,63}$/;
function commandId(d){const id=String(d?.commandId||"");return ID.test(id)?id:""}
function code(d){
  const explicit=String(d?.code||"").trim();if(CODE.test(explicit))return explicit;
  const head=String(d?.error||"").split(":",1)[0].trim();if(CODE.test(head))return head;
  const reason=String(d?.reason||"").trim().toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"");
  return CODE.test(reason)?reason:"COMMAND_REJECTED";
}
function recoveryAction(d,c=code(d)){
  const explicit=String(d?.recovery_action||"").trim();if(explicit)return explicit;
  if(c==="BOOTSTRAP_REQUIRED")return "bridge.bootstrap";
  if(c==="SESSION_NOT_READY")return "session.resume";
  if(c==="BOOTSTRAP_UNAVAILABLE")return "bridge.diagnostics.get";
  return "";
}
function isTerminalCommandRejection(d){
  if(!d||d.final!==true||d.executed!==false||!commandId(d))return false;
  const kind=String(d.kind||"");
  return kind.includes("command-rejected")||kind==="semantic-command-rejected"||kind==="command-terminal";
}
function terminalEvent(d){
  const cid=commandId(d),c=code(d),reason=String(d?.reason||"rejected");
  return {kind:"command-terminal",status:"rejected",final:true,commandId:cid,correlationId:cid,code:c,reason,executed:false,retryable:!!d?.retryable,recovery_action:recoveryAction(d,c),source:String(d?.source||""),error:String(d?.error||""),transportRef:String(d?.transportRef||""),payloadBytes:d?.payloadBytes??null,maxBytes:d?.maxBytes??null};
}
function response(d,extra={}){
  const cid=commandId(d),c=code(d);
  return {ok:false,rejected:true,final:true,executed:false,commandId:cid,code:c,reason:String(d?.reason||"rejected"),retryable:!!d?.retryable,recovery_action:recoveryAction(d,c),...extra};
}
globalThis.__SOKNA_TERMINAL_OUTCOME_CORE_V1__=Object.freeze({commandId,code,recoveryAction,isTerminalCommandRejection,terminalEvent,response});
})();
