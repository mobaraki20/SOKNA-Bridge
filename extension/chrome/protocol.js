(()=>{
'use strict';
const E=new TextEncoder();
const ID_RE=/^[A-Za-z0-9._-]{1,96}$/;
const PROTOCOL_VERSION='2',SCHEMA_VERSION='2';
const KINDS=new Set(['command','ack','event','result','nack']);
function bytes(s){return E.encode(String(s)).byteLength}
function validCommandId(id){return ID_RE.test(String(id||''))}
function commandEnvelope({id,action,params={},parentId='',timestamp=Date.now()}={}){
  id=String(id||'');action=String(action||'');parentId=String(parentId||'');
  if(!validCommandId(id))throw new Error('INVALID_COMMAND_ID');
  if(!action)throw new Error('ACTION_REQUIRED');
  if(parentId&&!validCommandId(parentId))throw new Error('INVALID_PARENT_ID');
  if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('PARAMS_OBJECT_REQUIRED');
  return {protocolVersion:PROTOCOL_VERSION,messageId:id,correlationId:id,parentId,kind:'command',action,schemaVersion:SCHEMA_VERSION,timestamp:Number(timestamp)||Date.now(),id,params};
}
function validateEnvelope(x,{kind=''}={}){
  if(!x||typeof x!=='object'||Array.isArray(x))return {ok:false,error:'ENVELOPE_OBJECT_REQUIRED'};
  if(String(x.protocolVersion||'')!==PROTOCOL_VERSION)return {ok:false,error:'PROTOCOL_VERSION_UNSUPPORTED'};
  if(String(x.schemaVersion||'')!==SCHEMA_VERSION)return {ok:false,error:'SCHEMA_VERSION_UNSUPPORTED'};
  if(!KINDS.has(String(x.kind||'')))return {ok:false,error:'KIND_INVALID'};
  if(kind&&String(x.kind)!==kind)return {ok:false,error:'KIND_MISMATCH'};
  if(!validCommandId(x.messageId))return {ok:false,error:'MESSAGE_ID_INVALID'};
  if(!validCommandId(x.correlationId))return {ok:false,error:'CORRELATION_ID_INVALID'};
  if(x.parentId&&!validCommandId(x.parentId))return {ok:false,error:'PARENT_ID_INVALID'};
  if(!Number.isFinite(Number(x.timestamp))||Number(x.timestamp)<=0)return {ok:false,error:'TIMESTAMP_INVALID'};
  if(x.kind==='command'){
    if(String(x.id||'')!==String(x.correlationId||''))return {ok:false,error:'COMMAND_ID_CORRELATION_MISMATCH'};
    if(!String(x.action||''))return {ok:false,error:'ACTION_REQUIRED'};
    if(!x.params||typeof x.params!=='object'||Array.isArray(x.params))return {ok:false,error:'PARAMS_OBJECT_REQUIRED'};
  }
  return {ok:true};
}
function nack({messageId,correlationId,parentId='',action='',error='REJECTED',detail='',retryable=false}={}){
  const mid=String(messageId||'');const cid=String(correlationId||'');
  if(!validCommandId(mid)||!validCommandId(cid))throw new Error('NACK_ID_INVALID');
  return {protocolVersion:PROTOCOL_VERSION,messageId:mid,correlationId:cid,parentId:String(parentId||''),kind:'nack',action:String(action||''),schemaVersion:SCHEMA_VERSION,timestamp:Date.now(),executed:false,retryable:!!retryable,error:String(error||'REJECTED'),detail:String(detail||'')};
}
const api=Object.freeze({v:2,protocolVersion:PROTOCOL_VERSION,schemaVersion:SCHEMA_VERSION,maxControlBytes:800,maxExpandedCommandBytes:4096,bytes,validCommandId,commandEnvelope,validateEnvelope,nack});
globalThis.__SOKNA_PROTOCOL_V1__=api;
})();
