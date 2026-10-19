(()=>{
"use strict";
const G="__SOKNA_MESSAGE_SENDER_BOUNDARY_V1__";
if(globalThis[G])return;
const PRIVILEGED=new Set(["REGISTER_CHAT_ORIGIN","REGISTER_BROWSER_ORIGIN","CONNECT_CHAT","ARM","DISARM"]);
function validate(message,sender){
  const tabId=sender?.tab?.id;
  if(!Number.isInteger(tabId))return {ok:true,kind:"extension_ui"};
  // A content-script sender must never nominate another tab as its own.
  if(message?.tabId!==undefined&&message.tabId!==tabId)
    return {ok:false,code:"SENDER_TAB_MISMATCH",error:"Content-script message target does not match its actual sender tab."};
  // Only an extension UI/background context may approve new site access or arm tabs.
  if(PRIVILEGED.has(String(message?.type||"")))
    return {ok:false,code:"EXTENSION_UI_REQUIRED",error:"This action requires an extension-owned UI context."};
  return {ok:true,kind:"content_script",tabId};
}
globalThis[G]=Object.freeze({validate});
})();
