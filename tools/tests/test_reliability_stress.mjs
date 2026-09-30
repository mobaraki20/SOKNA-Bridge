import fs from "node:fs";import vm from "node:vm";import assert from "node:assert/strict";
function load(path,key,extras={}){const src=fs.readFileSync(path,"utf8"),ctx={globalThis:null,Date,Number,String,Math,Object,Set,URL,JSON,RegExp,...extras};ctx.globalThis=ctx;vm.runInNewContext(src,ctx,{filename:path});return ctx[key]}
const T=load("extension/chrome/terminal_outcome_core.js","__SOKNA_TERMINAL_OUTCOME_CORE_V1__");
const R=load("extension/chrome/runtime_state_core.js","__SOKNA_RUNTIME_STATE_CORE_V1__");
const D=load("extension/chrome/delivery_state_core.js","__SOKNA_DELIVERY_STATE_CORE_V1__");
const O=load("extension/chrome/origin_registry_core.js","__SOKNA_CHAT_ORIGIN_REGISTRY_V1__");
const G=(()=>{const ctx={globalThis:null,Date,Number,String,Math,Object,Set,URL,JSON};ctx.globalThis=ctx;vm.runInNewContext(fs.readFileSync("extension/chrome/origin_registry_core.js","utf8"),ctx);vm.runInNewContext(fs.readFileSync("extension/chrome/session_gate_state_core.js","utf8"),ctx);return ctx.__SOKNA_SESSION_GATE_STATE_CORE_V1__})();
for(let i=0;i<20;i++){const id="reject-"+i,d={kind:"background-command-rejected",final:true,executed:false,commandId:id,reason:"session_gate_rejected",code:"BOOTSTRAP_REQUIRED",retryable:true};assert.equal(T.isTerminalCommandRejection(d),true);assert.equal(T.response(d).executed,false)}
let ui={state:"Ready"};
for(let i=0;i<100;i++){
 const id="cmd-"+i;ui={...ui,...R.executionStart(ui,id,"ping",i)};
 const old="delivery-"+Math.max(0,i-1);ui={...ui,...R.deliveryUpdate(ui,{recordId:old,commandId:"cmd-"+Math.max(0,i-1),deliveryState:"submitted_awaiting_ack",uiState:"Waiting",detail:"pending"})};
 assert.equal(ui.currentCommandId,id);assert.equal(ui.state,"Working");
 ui={...ui,...R.executionFinish(ui,id,true,"",i+1)};assert.equal(ui.currentCommandId,"");
}
for(let i=0;i<100;i++){let rec={state:"done",posted:false,acceptedAt:1000+i,result:{ok:true}};rec=D.markSubmitted(rec,2000+i);const out=D.pollResult(rec,true,3000+i);assert.equal(out.state,"acknowledged");assert.equal(out.record.posted,true)}
for(let i=0;i<20;i++){const a=G.identity(i,"https://chatgpt.com/",O),rec=G.recordFor(a,1),b=G.identity(i,"https://chatgpt.com/c/reload-"+i,O),x=G.check(rec,b);assert.equal(x.ok,true);assert.equal(x.migrate,true);assert.equal(G.check({...rec,...b},b).ok,true)}
const profiles=["https://chatgpt.com/c/a","https://gpt.arzanai.com/c/b","https://custom-chat.example/c/c"];for(const u of profiles){assert.ok(O.normalizeOrigin(u));assert.ok(O.conversationKey(u).includes("/c/"))}
const content=fs.readFileSync("extension/chrome/content.js","utf8"),start=content.indexOf("function parseBridgeEnvelope(text){"),end=content.indexOf("async function waitForResultVisible",start);assert.ok(start>=0&&end>start);
const fnSource=content.slice(start,end)+"\nglobalThis.__ack=resultVisibleInUserTurn;";
for(let i=0;i<20;i++){const id="long-"+i,full=`[SOKNA-V2-RESULT]{"id":"${id}","ok":true,"data":"${"x".repeat(50000)}"}[/SOKNA-V2-RESULT]`,visible=full.slice(0,600),shell={innerText:visible,textContent:visible,getAttribute:k=>k==="data-message-author-role"?"user":(k==="data-testid"?"conversation-turn-user-"+i:""),querySelector:()=>null};const ctx={globalThis:null,Date,JSON,RegExp,String,document:{body:{innerText:visible,textContent:visible},querySelectorAll:s=>s.includes("user")||s.includes("conversation-turn")?[shell]:[]},composer:()=>({value:""}),textOf:e=>String(e?.value||e?.innerText||e?.textContent||""),samePayload:(a,b)=>String(a).trim()===String(b).trim()};ctx.globalThis=ctx;vm.runInNewContext(fnSource,ctx);assert.equal(ctx.__ack(full),true)}
console.log(JSON.stringify({ok:true,commands:100,deliveries:100,reloads:20,long_results:20,rejections:20,origin_profiles:3}));
