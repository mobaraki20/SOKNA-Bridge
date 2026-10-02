(()=>{
"use strict";
const G="__SOKNA_BROWSER_TASK_PRESET_CORE_V1__";if(globalThis[G])return;
const SAFE_ID=/^[A-Za-z0-9._-]{1,96}$/;
const PRESET="login_capture_links";
function fail(code,message){const e=new Error(String(message||code));e.code=code;throw e}
function num(v,d,min,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.trunc(n))):d}
function selector(v,name){const s=String(v||"").trim();if(!s||s.length>1000)fail("BROWSER_TASK_PRESET_SELECTOR_INVALID",`${name} selector required`);return s}
function expand(params={}){
  const preset=String(params.preset||"").trim();if(!preset)return null;
  if(preset!==PRESET)fail("BROWSER_TASK_PRESET_UNSUPPORTED",`unsupported browser task preset: ${preset}`);
  const task_id=String(params.task_id||"").trim();if(!SAFE_ID.test(task_id))fail("BROWSER_TASK_ID_INVALID","task_id invalid");
  const credential_ref=String(params.credential_ref||"").trim();if(!SAFE_ID.test(credential_ref))fail("BROWSER_TASK_CREDENTIAL_REF_INVALID","credential_ref invalid");
  const username_selector=selector(params.username_selector,"username"),password_selector=selector(params.password_selector,"password"),submit_selector=selector(params.submit_selector,"submit");
  const count=num(params.count,3,1,20),settle_ms=num(params.settle_ms,500,0,10000),timeout_ms=num(params.timeout_ms,30000,1000,60000),max_steps=num(params.max_steps,Math.max(20,count*3+8),1,100);
  return {
    task_id,max_steps,max_retries_per_step:num(params.max_retries_per_step,1,0,3),stop_on_error:params.stop_on_error!==false,
    steps:[
      {id:"login-fill",op:"fill_many",fields:[
        {selector:username_selector,credential_ref,credential_field:"username"},
        {selector:password_selector,credential_ref,credential_field:"secret"}
      ]},
      {id:"login-submit",op:"click",selector:submit_selector},
      {id:"login-settle",op:"wait",settled:true,timeout_ms},
      {id:"links",op:"find_links",save_as:"links",limit:count,same_origin:true,visible_only:true,exclude_current:true},
      {id:"capture-links",op:"foreach_capture",source:"links",max_items:count,full_page:params.full_page===true,settle_ms,timeout_ms}
    ]
  }
}
globalThis[G]=Object.freeze({schema:"sokna-browser-task-preset-core-v1",version:1,PRESET,expand});
})();
