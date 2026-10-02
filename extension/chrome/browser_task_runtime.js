(()=>{
"use strict";
const CORE=globalThis.__SOKNA_BROWSER_TASK_CORE_V1__;if(!CORE)throw new Error("BROWSER_TASK_CORE_UNAVAILABLE");
const TASK_ACTION="browser.task.run",TASK_PROGRESS_KEY="browser_task_progress_v1";

function taskError(code,message,details={}){const e=new Error(String(message||code));e.code=code;Object.assign(e,details);return e}
async function taskProgressAll(){const d=await chrome.storage.local.get([TASK_PROGRESS_KEY]);return d[TASK_PROGRESS_KEY]||{}}
async function saveTaskProgress(all){
  const entries=Object.entries(all||{}).sort((a,b)=>Number(a[1]?.updated_at||0)-Number(b[1]?.updated_at||0));
  const trimmed=entries.length>40?Object.fromEntries(entries.slice(entries.length-40)):Object.fromEntries(entries);
  await chrome.storage.local.set({[TASK_PROGRESS_KEY]:trimmed});
}
function compactStepResult(step,r){
  if(step.op==="snapshot")return {url:String(r?.url||""),title:String(r?.title||""),ref_count:Number(r?.refCount||0)};
  if(step.op==="find_links")return {count:Array.isArray(r)?r.length:0};
  if(step.op==="capture")return {artifact_id:String(r?.artifact_ref?.id||""),url:String(r?.target?.url||"")};
  if(step.op==="foreach_capture")return {captured:Number(r?.captured||0)};
  return {ok:true}
}
function valueFromVar(vars,name){
  const v=vars?.[name];
  if(typeof v==="string")return v;
  if(v&&typeof v==="object"&&!Array.isArray(v)&&typeof v.href==="string")return v.href;
  throw taskError("BROWSER_TASK_VAR_VALUE_INVALID",`variable ${name} is not a URL value`)
}
function incOps(ctx,count=1){ctx.opCount+=count;if(ctx.opCount>ctx.plan.max_steps)throw taskError("BROWSER_TASK_MAX_STEPS_EXCEEDED",`task exceeded max_steps=${ctx.plan.max_steps}`)}
async function settlePage(conversationKey,timeoutMs=30000){
  try{return await sendClaimedBrowserPage(conversationKey,"browser.page.wait",{settled:true,timeoutMs})}
  catch(e){if(String(e?.code||"")!=="BROWSER_WAIT_TIMEOUT")throw e;throw taskError("BROWSER_TASK_PAGE_NOT_SETTLED",String(e?.message||e))}
}
async function navigateExact(conversationKey,rawUrl,timeoutMs=30000){
  const target=await claimedBrowserTarget(conversationKey);let url;
  try{url=new URL(String(rawUrl||""),String(target.tab.url||"")).href}catch{throw taskError("BROWSER_TASK_URL_INVALID","navigation URL is invalid")}
  const origin=BROWSER_TARGET.normalizeOrigin(url);if(!origin||origin!==target.record.origin)throw taskError("BROWSER_TASK_ORIGIN_CHANGE_FORBIDDEN","task navigation must stay on the claimed origin",{url});
  await chrome.tabs.update(target.tab.id,{url});const tab=await waitBrowserTabComplete(target.tab.id,timeoutMs);
  const afterOrigin=BROWSER_TARGET.normalizeOrigin(tab?.url||"");if(afterOrigin!==target.record.origin)throw taskError("BROWSER_TASK_ORIGIN_CHANGED","navigation escaped the claimed origin");
  await claimedBrowserTarget(conversationKey);return tab
}
async function extractVisibleLinks(conversationKey){
  const target=await claimedBrowserTarget(conversationKey);
  const results=await chrome.scripting.executeScript({target:{tabId:target.tab.id,frameIds:[0]},func:()=>{
    const visible=e=>{if(!e?.getClientRects||e.getClientRects().length===0)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&Number.parseFloat(s.opacity||"1")!==0&&r.width>0&&r.height>0};
    return [...document.querySelectorAll("a[href]")].slice(0,500).map((a,index)=>({index,href:a.href||"",name:String(a.innerText||a.textContent||a.getAttribute("aria-label")||a.title||"").trim().slice(0,200),visible:visible(a)}));
  }});
  const list=Array.isArray(results)&&results[0]?.result?results[0].result:[];
  return {target,links:Array.isArray(list)?list:[]}
}
async function captureOne(ctx,step,label){
  if(step.settle_ms>0)await new Promise(r=>setTimeout(r,step.settle_ms));
  incOps(ctx);const shot=await captureClaimedBrowserScreenshot(ctx.conversationKey,`${ctx.plan.task_id}-${label}`,{full_page:step.full_page===true});
  const ref=shot?.artifact_ref;if(!ref?.id)throw taskError("BROWSER_TASK_CAPTURE_REF_MISSING","screenshot did not return an artifact_ref");
  const item={step_id:step.id,label,url:String(shot?.target?.url||""),title:String(shot?.target?.title||""),capture:String(shot?.capture||""),artifact_ref:ref};ctx.artifacts.push(item);return shot
}
async function executeStep(ctx,step,state){
  switch(step.op){
    case "snapshot":{
      incOps(ctx);const r=await sendClaimedBrowserPage(ctx.conversationKey,"browser.page.snapshot",{});
      if(step.save_as)ctx.vars[step.save_as]={url:String(r?.url||""),title:String(r?.title||""),ref_count:Number(r?.refCount||0)};return r
    }
    case "fill_many":{
      for(const f of step.fields){incOps(ctx);await sendClaimedBrowserPage(ctx.conversationKey,"browser.page.fill",f)}return {ok:true,filled:step.fields.length}
    }
    case "click":{
      const before=await claimedBrowserTarget(ctx.conversationKey),beforeUrl=String(before.tab.url||"");
      incOps(ctx);const r=await sendClaimedBrowserPage(ctx.conversationKey,"browser.page.click",{ref:step.ref,selector:step.selector});
      // Browser-Use-style page-change guard: give a click-triggered navigation a short window
      // to start, then wait for the exact claimed tab to become complete before the next step.
      const detectUntil=Date.now()+1500;let navigationObserved=false;
      while(Date.now()<detectUntil){const tab=await chrome.tabs.get(before.tab.id);if(String(tab?.url||"")!==beforeUrl||String(tab?.status||"")==="loading"){navigationObserved=true;break}await new Promise(resolve=>setTimeout(resolve,100))}
      if(navigationObserved)await waitBrowserTabComplete(before.tab.id,30000);
      return r
    }
    case "wait":{
      incOps(ctx);return await sendClaimedBrowserPage(ctx.conversationKey,"browser.page.wait",{selector:step.selector,text:step.text,settled:step.settled===true,timeoutMs:step.timeout_ms})
    }
    case "navigate":{
      incOps(ctx);const url=step.url||valueFromVar(ctx.vars,step.from);return await navigateExact(ctx.conversationKey,url,step.timeout_ms)
    }
    case "find_links":{
      incOps(ctx);const x=await extractVisibleLinks(ctx.conversationKey),links=CORE.filterLinks(x.links,{current_url:String(x.target.tab.url||""),origin:x.target.record.origin,limit:step.limit,same_origin:step.same_origin,visible_only:step.visible_only,exclude_current:step.exclude_current,name_contains:step.name_contains});
      ctx.vars[step.save_as]=links;return links
    }
    case "capture":return await captureOne(ctx,step,step.label||step.id);
    case "foreach_capture":{
      const list=ctx.vars[step.source];if(!Array.isArray(list))throw taskError("BROWSER_TASK_SOURCE_NOT_LIST",`variable ${step.source} is not a list`);
      const items=list.slice(0,step.max_items),itemStates=Array.isArray(state.items)?state.items:[];let captured=0;
      for(let i=0;i<items.length;i++){
        if(itemStates[i]?.state==="completed"){captured++;continue}
        const link=items[i],href=typeof link==="string"?link:String(link?.href||"");if(!href)throw taskError("BROWSER_TASK_LINK_INVALID",`item ${i+1} has no href`);
        itemStates[i]={index:i,state:"executing",href,started_at:Date.now()};state.items=itemStates;ctx.progress.updated_at=Date.now();await saveTaskProgress(ctx.all);
        incOps(ctx);const tab=await navigateExact(ctx.conversationKey,href,step.timeout_ms);
        if(step.settle_ms>0){await new Promise(r=>setTimeout(r,step.settle_ms));incOps(ctx);await settlePage(ctx.conversationKey,step.timeout_ms)}
        const shot=await captureOne(ctx,{...step,id:step.id,settle_ms:0},`${step.id}-${String(i+1).padStart(2,"0")}`);
        const artifactItem={step_id:step.id,item_index:i,source_href:href,url:String(shot?.target?.url||tab?.url||""),title:String(shot?.target?.title||tab?.title||""),capture:String(shot?.capture||""),artifact_ref:shot.artifact_ref};
        // captureOne already appended; enrich the matching last item instead of duplicating it.
        Object.assign(ctx.artifacts[ctx.artifacts.length-1],artifactItem);
        itemStates[i]={index:i,state:"completed",href,artifact_id:String(shot.artifact_ref.id),completed_at:Date.now()};state.items=itemStates;captured++;ctx.progress.updated_at=Date.now();ctx.progress.artifacts=ctx.artifacts;ctx.progress.op_count=ctx.opCount;await saveTaskProgress(ctx.all);
      }
      return {ok:true,captured,items:itemStates.map(x=>({index:x.index,state:x.state,href:x.href,artifact_id:x.artifact_id||""}))}
    }
    default:throw taskError("BROWSER_TASK_OP_UNSUPPORTED",`unsupported op ${step.op}`)
  }
}
async function buildTaskCollection(ctx){
  if(!ctx.artifacts.length)return null;
  const target=await claimedBrowserTarget(ctx.conversationKey),manifest={schema:"sokna-browser-task-collection-v1",task_id:ctx.plan.task_id,plan_sha256:ctx.planSha,created_at:Date.now(),claimed_origin:target.record.origin,count:ctx.artifacts.length,items:ctx.artifacts};
  const name=("browser-task-collection-"+ctx.plan.task_id+".json").slice(0,170),ingested=await ingestExtensionArtifact(name,"application/json",utf8ToB64(JSON.stringify(manifest)));return ingested.artifact_ref
}
async function runBrowserTask(command,conversationKey){
  const plan=CORE.validatePlan(command?.params||{}),planSha=await sha256Text(CORE.canonicalPlan(plan)),target=await claimedBrowserTarget(conversationKey),all=await taskProgressAll(),old=all[plan.task_id];
  if(old&&String(old.plan_sha256||"")!==planSha)throw taskError("BROWSER_TASK_PLAN_MISMATCH","task_id already belongs to a different task plan");
  if(old&&String(old.conversation_key||"")!==String(conversationKey||""))throw taskError("BROWSER_TASK_SCOPE_MISMATCH","task_id belongs to another conversation");
  if(old?.state==="completed"&&old?.final_result)return {...old.final_result,resumed:true};
  const progress=old||{schema:"sokna-browser-task-progress-v1",task_id:plan.task_id,plan_sha256:planSha,conversation_key:String(conversationKey||""),claimed_origin:target.record.origin,state:"running",started_at:Date.now(),updated_at:Date.now(),steps:[],vars:{},artifacts:[],op_count:0};all[plan.task_id]=progress;
  const ctx={plan,planSha,conversationKey,all,progress,vars:progress.vars&&typeof progress.vars==="object"?progress.vars:{},artifacts:Array.isArray(progress.artifacts)?progress.artifacts:[],opCount:Number(progress.op_count||0),resumed:!!old};
  progress.state="running";progress.updated_at=Date.now();await saveTaskProgress(all);
  for(let i=0;i<plan.steps.length;i++){
    const step=plan.steps[i];let state=progress.steps[i]||{id:step.id,op:step.op,state:"pending",attempts:0};progress.steps[i]=state;
    if(state.state==="completed")continue;
    const maxAttemptsForStep=1+(CORE.replaySafe(step)?plan.max_retries_per_step:0);
    if(state.state==="failed"&&(!CORE.replaySafe(step)||Number(state.attempts||0)>=maxAttemptsForStep)){
      progress.state="failed";progress.updated_at=Date.now();await saveTaskProgress(all);
      throw taskError(String(state.error_code||"BROWSER_TASK_STEP_FAILED"),String(state.error||`step ${step.id} previously failed`),{step_id:step.id});
    }
    const decision=CORE.interruptedDecision(step,state.state);
    if(decision.resume==="unknown"){progress.state="blocked";progress.updated_at=Date.now();await saveTaskProgress(all);throw taskError(decision.code,`step ${step.id} was interrupted after a non-replay-safe action began`,{step_id:step.id})}
    let lastError=null,maxAttempts=maxAttemptsForStep;
    for(let attempt=Number(state.attempts||0);attempt<maxAttempts;attempt++){
      state={...state,state:"executing",attempts:attempt+1,started_at:Date.now()};if(state.items)state.items=progress.steps[i].items;progress.steps[i]=state;progress.updated_at=Date.now();progress.vars=ctx.vars;progress.artifacts=ctx.artifacts;progress.op_count=ctx.opCount;await saveTaskProgress(all);
      try{
        const r=await executeStep(ctx,step,state);state={...state,state:"completed",completed_at:Date.now(),result:compactStepResult(step,r)};progress.steps[i]=state;progress.vars=ctx.vars;progress.artifacts=ctx.artifacts;progress.op_count=ctx.opCount;progress.updated_at=Date.now();await saveTaskProgress(all);lastError=null;break
      }catch(e){lastError=e;state={...state,state:"failed",failed_at:Date.now(),error_code:String(e?.code||"BROWSER_TASK_STEP_FAILED"),error:String(e?.message||e)};progress.steps[i]=state;progress.op_count=ctx.opCount;progress.updated_at=Date.now();await saveTaskProgress(all);if(!CORE.replaySafe(step)||attempt+1>=maxAttempts)break}
    }
    if(lastError){progress.state="failed";progress.updated_at=Date.now();await saveTaskProgress(all);if(plan.stop_on_error)throw lastError}
  }
  const collectionRef=await buildTaskCollection(ctx),tab=await chrome.tabs.get(target.tab.id),final={ok:true,schema:"sokna-browser-task-result-v1",task_id:plan.task_id,resumed:ctx.resumed,plan_sha256:planSha,steps_total:plan.steps.length,steps_completed:progress.steps.filter(x=>x?.state==="completed").length,local_operations:ctx.opCount,final_url:String(tab?.url||""),final_title:String(tab?.title||""),artifact_count:ctx.artifacts.length,artifacts:ctx.artifacts.map(x=>({step_id:x.step_id,item_index:x.item_index??null,url:x.url,title:x.title,capture:x.capture,artifact_ref:x.artifact_ref})),collection_ref:collectionRef};
  progress.state="completed";progress.completed_at=Date.now();progress.updated_at=Date.now();progress.final_result=final;progress.collection_ref=collectionRef;progress.vars=ctx.vars;progress.artifacts=ctx.artifacts;progress.op_count=ctx.opCount;await saveTaskProgress(all);return final
}

function taskContract(){
  const D="https://json-schema.org/draft/2020-12/schema";
  return Object.freeze({name:TASK_ACTION,description:"Execute a bounded multi-step browser task locally in the exact claimed tab, with checkpoint/resume, credential refs, same-origin navigation and artifact capture. Normal substeps do not round-trip through Chat.",inputSchema:{$schema:D,type:"object",additionalProperties:false,required:["task_id","steps"],properties:{task_id:{type:"string",pattern:"^[A-Za-z0-9._-]{1,96}$"},max_steps:{type:"integer",minimum:1,maximum:100},max_retries_per_step:{type:"integer",minimum:0,maximum:3},stop_on_error:{type:"boolean"},steps:{type:"array",minItems:1,maxItems:50,items:{type:"object",required:["op"],additionalProperties:true,properties:{id:{type:"string"},op:{type:"string",enum:[...CORE.OPS]}}}}}},outputSchema:{$schema:D,type:"object",required:["ok"],properties:{ok:{type:"boolean"}},additionalProperties:true},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},_meta:{"sokna/owner":"chat-adapter","sokna/idempotency":"task_id_guarded","sokna/requiredCapabilities":[],"sokna/errors":["BROWSER_TASK_PLAN_MISMATCH","BROWSER_TASK_SCOPE_MISMATCH","BROWSER_TASK_STEP_OUTCOME_UNKNOWN","BROWSER_TASK_MAX_STEPS_EXCEEDED","BROWSER_TASK_ORIGIN_CHANGE_FORBIDDEN"]}})
}
function extendRegistry(){
  const base=globalThis.__SOKNA_ACTION_CONTRACTS_V1__;if(!base)return;
  const contract=taskContract(),contracts=Object.freeze({...base.contracts,[TASK_ACTION]:Object.freeze({...contract,name:undefined})});
  function describe(name){name=String(name||"");if(name===TASK_ACTION)return contract;return base.describe(name)}
  function list(effective=[]){const names=[...new Set((effective||[]).map(String).filter(Boolean))].sort();return names.map(name=>{const t=describe(name);return {name,action:name,contracted:!!t,owner:t?._meta?.["sokna/owner"]||"legacy",read_only:t?.annotations?.readOnlyHint??null,idempotent:t?.annotations?.idempotentHint??null}})}
  function tools(effective=[]){return list(effective).filter(x=>x.contracted).map(x=>describe(x.name))}
  globalThis.__SOKNA_ACTION_CONTRACTS_V1__=Object.freeze({...base,version:Math.max(3,Number(base.version)||0),contracts,describe,list,tools})
}

if(!(globalThis.__SOKNA_EXTENSION_ACTIONS_V1__||[]).includes(TASK_ACTION))globalThis.__SOKNA_EXTENSION_ACTIONS_V1__=Object.freeze([...(globalThis.__SOKNA_EXTENSION_ACTIONS_V1__||[]),TASK_ACTION]);
extendRegistry();
if(typeof extensionOwnedLedgerActions==="undefined"||typeof browserSemanticAction!=="function")throw new Error("BROWSER_TASK_RUNTIME_HOOKS_UNAVAILABLE");
extensionOwnedLedgerActions.add(TASK_ACTION);
const baseBrowserSemanticAction=browserSemanticAction;
browserSemanticAction=async function(command,conversationKey){if(String(command?.action||"")===TASK_ACTION)return await runBrowserTask(command,conversationKey);return await baseBrowserSemanticAction(command,conversationKey)};
globalThis.__SOKNA_BROWSER_TASK_RUNTIME_V1__=Object.freeze({schema:"sokna-browser-task-runtime-v1",version:1,action:TASK_ACTION});
})();
