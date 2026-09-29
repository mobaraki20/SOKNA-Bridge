(()=>{
"use strict";
const G="__SOKNA_SESSION_GATE_STATE_CORE_V1__";if(globalThis[G])return;
function identity(tabId,url,originCore){const origin=originCore?.normalizeOrigin?.(url)||"",conversationId=originCore?.conversationId?.(url)||"",conversationKey=originCore?.conversationKey?.(url)||"";return {tabId:Number.isInteger(Number(tabId))?Number(tabId):null,origin,conversationId,conversationKey}}
function recordFor(identity,t=Date.now()){return {...identity,bootstrappedAt:t,updatedAt:t}}
function check(record,current){
  if(!record||!current||record.tabId!==current.tabId||!record.origin||record.origin!==current.origin)return {ok:false,migrate:false,reason:"scope_mismatch"};
  if(record.conversationId&&current.conversationId)return {ok:record.conversationId===current.conversationId,migrate:false,reason:record.conversationId===current.conversationId?"same_conversation":"conversation_changed"};
  if(!record.conversationId&&current.conversationId)return {ok:true,migrate:true,reason:"provisional_to_conversation"};
  if(record.conversationId&&!current.conversationId)return {ok:false,migrate:false,reason:"conversation_identity_lost"};
  return {ok:record.conversationKey===current.conversationKey,migrate:false,reason:record.conversationKey===current.conversationKey?"same_provisional":"path_changed"};
}
globalThis[G]=Object.freeze({identity,recordFor,check});
})();
