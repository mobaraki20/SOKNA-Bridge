(()=>{
"use strict";
if(globalThis.__SOKNA_BROWSER_TASK_PRESETS_V1__)return;
const ACTION="browser.task.run",CORE=globalThis.__SOKNA_BROWSER_TASK_PRESET_CORE_V1__;
if(!CORE)throw new Error("BROWSER_TASK_PRESET_CORE_UNAVAILABLE");
function taskError(code,message){const e=new Error(String(message||code));e.code=code;return e}
async function ensurePresetTarget(conversationKey,params={}){
  const startUrl=String(params.start_url||"").trim(),timeoutMs=Math.min(60000,Math.max(1000,Number(params.timeout_ms)||30000));
  let target=null;
  try{target=await claimedBrowserTarget(conversationKey)}catch(e){if(!startUrl||!["BROWSER_TARGET_REQUIRED","BROWSER_TARGET_STALE"].includes(String(e?.code||"")))throw e}
  if(target){
    if(!startUrl)return target;
    const requestedOrigin=BROWSER_TARGET.normalizeOrigin(startUrl);if(!requestedOrigin)throw taskError("BROWSER_TASK_URL_INVALID","start_url must be HTTP/HTTPS");
    if(requestedOrigin!==target.record.origin)throw taskError("BROWSER_TASK_ORIGIN_CHANGE_FORBIDDEN","start_url must stay on the claimed origin");
    if(String(target.tab.url||"")!==startUrl){await chrome.tabs.update(target.tab.id,{url:startUrl});await waitBrowserTabComplete(target.tab.id,timeoutMs);target=await claimedBrowserTarget(conversationKey)}
    return target
  }
  const origin=BROWSER_TARGET.normalizeOrigin(startUrl);if(!origin)throw taskError("BROWSER_TASK_URL_INVALID","start_url must be HTTP/HTTPS");
  const pattern=BROWSER_TARGET.originPattern(origin),approved=await approvedBrowserOrigins();
  if(!approved.includes(origin)||!await chrome.permissions.contains({origins:[pattern]}))throw taskError("BROWSER_ORIGIN_PERMISSION_REQUIRED","Approve the Browser origin before running the task.");
  const tab=await chrome.tabs.create({url:startUrl,active:false});if(!Number.isInteger(tab?.id))throw taskError("BROWSER_TAB_OPEN_FAILED","Chrome did not return a tab id");
  await waitBrowserTabComplete(tab.id,timeoutMs);
  const record=await claimBrowserTab(conversationKey,tab.id),fresh=await chrome.tabs.get(tab.id);return {record,tab:fresh}
}
function presetAwareContract(){
  const base=globalThis.__SOKNA_ACTION_CONTRACTS_V1__?.describe?.(ACTION)||{},D="https://json-schema.org/draft/2020-12/schema";
  return Object.freeze({...base,name:ACTION,description:"Execute a bounded local browser task. Supports full step plans or compact presets so normal multi-step work fits in one Chat command and executes locally with checkpoint/resume.",inputSchema:{$schema:D,type:"object",additionalProperties:false,required:["task_id"],anyOf:[{required:["steps"]},{required:["preset"]}],properties:{task_id:{type:"string",pattern:"^[A-Za-z0-9._-]{1,96}$"},preset:{enum:[CORE.PRESET],type:"string"},start_url:{type:"string"},credential_ref:{type:"string",pattern:"^[A-Za-z0-9._-]{1,96}$"},username_selector:{type:"string",minLength:1,maxLength:1000},password_selector:{type:"string",minLength:1,maxLength:1000},submit_selector:{type:"string",minLength:1,maxLength:1000},count:{type:"integer",minimum:1,maximum:20},full_page:{type:"boolean"},settle_ms:{type:"integer",minimum:0,maximum:10000},timeout_ms:{type:"integer",minimum:1000,maximum:60000},max_steps:{type:"integer",minimum:1,maximum:100},max_retries_per_step:{type:"integer",minimum:0,maximum:3},stop_on_error:{type:"boolean"},steps:{type:"array",minItems:1,maxItems:50,items:{type:"object",required:["op"],additionalProperties:true}}}},_meta:{...(base._meta||{}),"sokna/idempotency":"task_id_guarded","sokna/errors":[...new Set([...(base._meta?.["sokna/errors"]||[]),"BROWSER_TASK_PRESET_UNSUPPORTED","BROWSER_ORIGIN_PERMISSION_REQUIRED","BROWSER_TAB_OPEN_FAILED"])]}})
}
function patchRegistry(){
  const base=globalThis.__SOKNA_ACTION_CONTRACTS_V1__;if(!base)return;
  const contract=presetAwareContract(),contracts=Object.freeze({...base.contracts,[ACTION]:Object.freeze({...contract,name:undefined})});
  function describe(name){name=String(name||"");if(name===ACTION)return contract;return base.describe(name)}
  function list(effective=[]){const names=[...new Set((effective||[]).map(String).filter(Boolean))].sort();return names.map(name=>{const t=describe(name);return {name,action:name,contracted:!!t,owner:t?._meta?.["sokna/owner"]||"legacy",read_only:t?.annotations?.readOnlyHint??null,idempotent:t?.annotations?.idempotentHint??null}})}
  function tools(effective=[]){return list(effective).filter(x=>x.contracted).map(x=>describe(x.name))}
  globalThis.__SOKNA_ACTION_CONTRACTS_V1__=Object.freeze({...base,version:Math.max(4,Number(base.version)||0),contracts,describe,list,tools})
}
patchRegistry();
if(typeof browserSemanticAction!=="function")throw new Error("BROWSER_TASK_PRESET_RUNTIME_HOOK_UNAVAILABLE");
const baseBrowserSemanticAction=browserSemanticAction;
browserSemanticAction=async function(command,conversationKey){
  if(String(command?.action||"")!==ACTION||!String(command?.params?.preset||""))return await baseBrowserSemanticAction(command,conversationKey);
  await ensurePresetTarget(conversationKey,command.params||{});
  const expanded=CORE.expand(command.params||{});return await baseBrowserSemanticAction({...command,params:expanded},conversationKey)
};
globalThis.__SOKNA_BROWSER_TASK_PRESETS_V1__=Object.freeze({schema:"sokna-browser-task-presets-v1",version:1,action:ACTION,preset:CORE.PRESET});
})();
