(()=>{
"use strict";
const G="__SOKNA_BROWSER_TASK_CORE_V1__";if(globalThis[G])return;
const SAFE_ID=/^[A-Za-z0-9._-]{1,96}$/;
const VAR_ID=/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const OPS=new Set(["snapshot","fill_many","click","wait","navigate","find_links","capture","foreach_capture"]);
const CREDENTIAL_FIELDS=new Set(["username","secret","password"]);
function fail(code,message){const e=new Error(String(message||code));e.code=code;throw e}
function safeNum(v,d,min,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.trunc(n))):d}
function targetOf(raw){
  const out={};
  if(raw?.ref)out.ref=String(raw.ref);
  if(raw?.selector)out.selector=String(raw.selector);
  if(!out.ref&&!out.selector)fail("BROWSER_TASK_TARGET_REQUIRED","ref or selector required");
  if(out.ref?.length>160||out.selector?.length>1000)fail("BROWSER_TASK_TARGET_TOO_LARGE","target exceeds size limit");
  return out
}
function valueOf(raw){
  const hasValue=Object.prototype.hasOwnProperty.call(raw||{},"value"),cred=String(raw?.credential_ref||"").trim();
  if(hasValue&&cred)fail("BROWSER_TASK_VALUE_AMBIGUOUS","value and credential_ref cannot be combined");
  if(!hasValue&&!cred)fail("BROWSER_TASK_VALUE_REQUIRED","value or credential_ref required");
  if(cred){
    if(!SAFE_ID.test(cred))fail("BROWSER_TASK_CREDENTIAL_REF_INVALID","credential_ref invalid");
    const field=String(raw?.credential_field||"secret");if(!CREDENTIAL_FIELDS.has(field))fail("BROWSER_TASK_CREDENTIAL_FIELD_INVALID","credential_field invalid");
    return {credential_ref:cred,credential_field:field}
  }
  const value=String(raw.value??"");if(value.length>65536)fail("BROWSER_TASK_VALUE_TOO_LARGE","value exceeds size limit");
  return {value}
}
function normalizeStep(raw,index){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("BROWSER_TASK_STEP_INVALID",`step ${index+1} must be an object`);
  const op=String(raw.op||"").trim();if(!OPS.has(op))fail("BROWSER_TASK_OP_UNSUPPORTED",`unsupported task op: ${op}`);
  const id=String(raw.id||`s${String(index+1).padStart(3,"0")}`);if(!SAFE_ID.test(id))fail("BROWSER_TASK_STEP_ID_INVALID",`invalid step id: ${id}`);
  const s={id,op};
  if(op==="snapshot"){
    if(raw.save_as){const x=String(raw.save_as);if(!VAR_ID.test(x))fail("BROWSER_TASK_VAR_INVALID","save_as invalid");s.save_as=x}
  }else if(op==="fill_many"){
    const fields=Array.isArray(raw.fields)?raw.fields:[];if(fields.length<1||fields.length>20)fail("BROWSER_TASK_FILL_COUNT_INVALID","fill_many requires 1..20 fields");
    s.fields=fields.map(f=>({...targetOf(f),...valueOf(f)}));
  }else if(op==="click"){
    Object.assign(s,targetOf(raw));
  }else if(op==="wait"){
    if(raw.selector)s.selector=String(raw.selector);
    if(raw.text)s.text=String(raw.text).slice(0,2000);
    if(raw.settled===true)s.settled=true;
    if(!s.selector&&!s.text&&!s.settled)fail("BROWSER_TASK_WAIT_INPUT_REQUIRED","wait requires selector, text, or settled");
    s.timeout_ms=safeNum(raw.timeout_ms,30000,50,60000);
  }else if(op==="navigate"){
    const url=String(raw.url||"").trim(),from=String(raw.from||"").trim();if((!url&&!from)||(url&&from))fail("BROWSER_TASK_NAV_INPUT_INVALID","navigate requires exactly one of url or from");
    if(url)s.url=url;if(from){if(!VAR_ID.test(from))fail("BROWSER_TASK_VAR_INVALID","navigate from invalid");s.from=from}
    s.timeout_ms=safeNum(raw.timeout_ms,30000,1000,60000);
  }else if(op==="find_links"){
    const save=String(raw.save_as||"").trim();if(!VAR_ID.test(save))fail("BROWSER_TASK_VAR_INVALID","find_links save_as required");
    s.save_as=save;s.limit=safeNum(raw.limit,3,1,20);s.same_origin=raw.same_origin!==false;s.visible_only=raw.visible_only!==false;s.exclude_current=raw.exclude_current!==false;
    if(raw.name_contains)s.name_contains=String(raw.name_contains).slice(0,200);
  }else if(op==="capture"){
    s.full_page=raw.full_page===true;s.label=String(raw.label||id).replace(/[^A-Za-z0-9._-]/g,"_").slice(0,80)||id;
    s.settle_ms=safeNum(raw.settle_ms,0,0,10000);
  }else if(op==="foreach_capture"){
    const source=String(raw.source||"").trim();if(!VAR_ID.test(source))fail("BROWSER_TASK_VAR_INVALID","foreach_capture source required");
    s.source=source;s.max_items=safeNum(raw.max_items,20,1,20);s.full_page=raw.full_page===true;s.settle_ms=safeNum(raw.settle_ms,500,0,10000);s.timeout_ms=safeNum(raw.timeout_ms,30000,1000,60000);
  }
  return s
}
function validatePlan(params={}){
  const task_id=String(params.task_id||"").trim();if(!SAFE_ID.test(task_id))fail("BROWSER_TASK_ID_INVALID","task_id must match [A-Za-z0-9._-]{1,96}");
  const raw=Array.isArray(params.steps)?params.steps:[];if(raw.length<1||raw.length>50)fail("BROWSER_TASK_STEP_COUNT_INVALID","steps must contain 1..50 entries");
  const steps=raw.map(normalizeStep),ids=new Set();for(const s of steps){if(ids.has(s.id))fail("BROWSER_TASK_STEP_ID_DUPLICATE",`duplicate step id: ${s.id}`);ids.add(s.id)}
  return {task_id,max_steps:safeNum(params.max_steps,50,1,100),max_retries_per_step:safeNum(params.max_retries_per_step,2,0,3),stop_on_error:params.stop_on_error!==false,steps}
}
function replaySafe(step){return String(step?.op||"")!=="click"}
function canonicalPlan(plan){return JSON.stringify({task_id:plan.task_id,max_steps:plan.max_steps,max_retries_per_step:plan.max_retries_per_step,stop_on_error:plan.stop_on_error,steps:plan.steps})}
function normalizedHref(raw,current){
  try{const u=new URL(String(raw||""),String(current||""));if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return"";u.hash="";return u.href}catch{return""}
}
function filterLinks(rawLinks=[],opts={}){
  const current=String(opts.current_url||""),origin=String(opts.origin||"").toLowerCase(),same=opts.same_origin!==false,exclude=opts.exclude_current!==false,needle=String(opts.name_contains||"").trim().toLowerCase(),limit=safeNum(opts.limit,3,1,20),currentNorm=normalizedHref(current,current),seen=new Set(),out=[];
  for(const item of Array.isArray(rawLinks)?rawLinks:[]){
    if(opts.visible_only!==false&&item?.visible===false)continue;
    const href=normalizedHref(item?.href,current);if(!href||seen.has(href))continue;
    let u;try{u=new URL(href)}catch{continue}
    if(same&&origin&&u.origin.toLowerCase()!==origin)continue;
    if(exclude&&currentNorm&&href===currentNorm)continue;
    const name=String(item?.name||item?.text||"").trim();if(needle&&!name.toLowerCase().includes(needle))continue;
    seen.add(href);out.push({href,name,index:Number(item?.index)||out.length});if(out.length>=limit)break;
  }
  return out
}
function interruptedDecision(step,state){
  if(state!=="executing")return {resume:"normal"};
  return replaySafe(step)?{resume:"retry_safe"}:{resume:"unknown",code:"BROWSER_TASK_STEP_OUTCOME_UNKNOWN"}
}
globalThis[G]=Object.freeze({schema:"sokna-browser-task-core-v1",version:1,SAFE_ID,OPS,validatePlan,replaySafe,canonicalPlan,filterLinks,interruptedDecision});
})();
