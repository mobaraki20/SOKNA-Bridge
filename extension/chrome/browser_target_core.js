(()=>{
"use strict";
const G="__SOKNA_BROWSER_TARGET_CORE_V1__";if(globalThis[G])return;
const WEB_SCHEMES=new Set(["http:","https:"]);
const TASK_ACTION="browser.task.run";
function normalizeOrigin(input){
  try{
    const u=new URL(String(input||""));
    if(!WEB_SCHEMES.has(u.protocol)||u.username||u.password||!u.hostname)return"";
    return u.origin.toLowerCase();
  }catch{return""}
}
function originPattern(input){const o=normalizeOrigin(input);return o?o+"/*":""}
function normalizeApproved(values){return [...new Set((values||[]).map(normalizeOrigin).filter(Boolean))].sort()}
function targetRecord({conversationKey="",tabId=0,url="",title="",claimedAt=Date.now()}={}){
  const origin=normalizeOrigin(url),id=Number(tabId),conversation_key=String(conversationKey||"").trim();
  if(!conversation_key)throw new Error("BROWSER_CONVERSATION_REQUIRED");
  if(!Number.isInteger(id)||id<=0)throw new Error("BROWSER_TARGET_TAB_INVALID");
  if(!origin)throw new Error("BROWSER_TARGET_ORIGIN_INVALID");
  return Object.freeze({schema:"sokna-browser-target-v1",conversation_key,tab_id:id,origin,url:String(url),title:String(title||""),claimed_at:Number(claimedAt)||Date.now()});
}
function validateRecord(record,conversationKey="",tab=null){
  if(!record||record.schema!=="sokna-browser-target-v1")return {ok:false,code:"BROWSER_TARGET_INVALID"};
  if(String(record.conversation_key||"")!==String(conversationKey||""))return {ok:false,code:"BROWSER_TARGET_SCOPE_MISMATCH"};
  if(!Number.isInteger(Number(record.tab_id))||Number(record.tab_id)<=0)return {ok:false,code:"BROWSER_TARGET_TAB_INVALID"};
  if(tab){
    if(Number(tab.id)!==Number(record.tab_id))return {ok:false,code:"BROWSER_TARGET_TAB_MISMATCH"};
    const origin=normalizeOrigin(tab.url||"");
    if(!origin||origin!==record.origin)return {ok:false,code:"BROWSER_TARGET_ORIGIN_CHANGED"};
  }
  return {ok:true,record};
}
const PAGE_ACTIONS=Object.freeze([
  "browser.page.snapshot","browser.page.text","browser.page.click","browser.page.fill",
  "browser.page.scroll","browser.page.wait","browser.page.screenshot",TASK_ACTION
]);
function isPageAction(action){return PAGE_ACTIONS.includes(String(action||""))}
globalThis[G]=Object.freeze({schema:"sokna-browser-target-core-v1",normalizeOrigin,originPattern,normalizeApproved,targetRecord,validateRecord,PAGE_ACTIONS,isPageAction});

// R12 service-worker preload: keep the stable background_bootstrap.js manifest entry while
// extending only the browser-task capability. In Node/tests this block is inert.
if(typeof importScripts==="function"&&typeof chrome==="object"){
  importScripts("browser_task_core.js","browser_task_preset_core.js");
  const cap=globalThis.__SOKNA_CAPABILITY_GATE_V1__;
  if(cap?.create&&!globalThis.__SOKNA_R12_TASK_CAPABILITY_PATCHED__){
    globalThis.__SOKNA_R12_TASK_CAPABILITY_PATCHED__=true;
    globalThis.__SOKNA_CAPABILITY_GATE_V1__=Object.freeze({...cap,create(options={}){
      const extensionActions=[...new Set([...(options.extensionActions||[]),TASK_ACTION])];
      return cap.create({...options,extensionActions})
    }});
  }
  if(typeof queueMicrotask==="function")queueMicrotask(()=>{
    if(!globalThis.__SOKNA_BROWSER_TASK_RUNTIME_V1__)importScripts("browser_task_runtime.js");
    if(!globalThis.__SOKNA_BROWSER_TASK_PRESETS_V1__)importScripts("browser_task_presets.js");
  });
}
})();
