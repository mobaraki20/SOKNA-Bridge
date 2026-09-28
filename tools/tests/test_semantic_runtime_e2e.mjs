import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const coreSrc=fs.readFileSync(new URL("../../extension/chrome/semantic_core.js",import.meta.url),"utf8");
const intentSrc=fs.readFileSync(new URL("../../extension/chrome/semantic_intent.js",import.meta.url),"utf8");
const START="[SOKNA-INTENT]",END="[/SOKNA-INTENT]";
const sleep=()=>new Promise(r=>setTimeout(r,0));

function node(id,text){
  return {innerText:text,textContent:text,className:"",getAttribute:(k)=>k==="data-message-id"?id:(k==="data-message-author-role"?"assistant":""),querySelector:()=>null,querySelectorAll:()=>[]};
}
function turn(id,text,label){
  const body={innerText:text,textContent:text,className:"markdown",getAttribute:()=>"",querySelector:()=>null,querySelectorAll:()=>[]};
  return {
    innerText:text,textContent:text,className:"",
    getAttribute(k){if(k==="data-testid")return "conversation-turn-"+id;if(k==="aria-label")return label||"";return""},
    querySelector(){return null},
    querySelectorAll(){return [body]}
  };
}
function runtime(){
  const assistant=[],turns=[],sent=[],listeners=[],storage={},observers=[];
  let rejectCommand=false;
  const document={
    querySelectorAll(sel){
      if(sel==='[data-message-author-role="assistant"]')return [...assistant];
      if(sel==='[data-testid^="conversation-turn-"]')return [...turns];
      return [];
    },
    body:{innerText:"",textContent:""},documentElement:{textContent:""}
  };
  class MO{constructor(cb){this.cb=cb;observers.push(this)}observe(){}disconnect(){}}
  const local={
    async get(keys){const out={};for(const k of keys||[])out[k]=storage[k];return out},
    async set(obj){Object.assign(storage,obj)}
  };
  const chrome={runtime:{
    onMessage:{addListener(fn){listeners.push(fn)}},
    async sendMessage(m){sent.push(m);if(rejectCommand&&m?.type==="COMMAND")throw new Error("mock runtime unavailable");return {ok:true,agent_ok:true,agent_version:"2.7.1"}}
  },storage:{local}};
  const ctx={console,TextEncoder,Date,Set,Map,WeakMap,Math,JSON,Promise,setTimeout,clearTimeout,MutationObserver:MO,document,chrome,location:{href:"https://chatgpt.com/c/test"},window:null,globalThis:null};
  ctx.window=ctx;ctx.top=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);vm.runInContext(coreSrc,ctx);vm.runInContext(intentSrc,ctx);
  async function message(m){
    const fn=listeners.at(-1);assert.ok(fn,"semantic listener missing");
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const reply=x=>{settled=true;resolve(x)};
      try{const asyncFlag=fn(m,{},reply);if(asyncFlag!==true&&!settled)resolve(undefined)}catch(e){reject(e)}
    });
  }
  return {ctx,assistant,turns,sent,storage,message,setReject:v=>{rejectCommand=v},mutate:async()=>{for(const o of observers)o.cb();await new Promise(r=>setTimeout(r,90))}};
}
function command(id,action="ping"){return START+JSON.stringify({id,intent:"exec",action,params:{}})+END}
function commands(r){return r.sent.filter(x=>x?.type==="COMMAND")}

{
  const r=runtime();
  await r.message({type:"SEMANTIC_BASELINE"});
  // SEM-E2E-01/09/10: user messages are never returned by the assistant-only selector.
  r.ctx.document.body.innerText="USER: "+command("user-example");
  await r.mutate();
  assert.equal(commands(r).length,0,"user/documentation marker must not dispatch");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.assistant.push(node("a1",command("unique-1")));
  await r.mutate();
  assert.equal(commands(r).length,1,"unique assistant command must dispatch exactly once");
  assert.equal(commands(r)[0].command.id,"unique-1");
  await r.mutate();
  assert.equal(commands(r).length,1,"same message node must not re-dispatch");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.turns.push(turn("fallback-assistant",command("fallback-1"),"ChatGPT said:"));
  await r.mutate();
  assert.equal(commands(r).length,1,"role-evidence fallback must detect an assistant turn when the legacy role attribute is absent");
  assert.equal(commands(r)[0].command.id,"fallback-1");
  const d=await r.message({type:"SEMANTIC_DIAG"});
  assert.equal(d.semantic.selector_ready,true);
  assert.equal(d.semantic.selector_mode,"role-evidence-fallback");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.turns.push(turn("fallback-user",command("must-not-run"),"You said:"));
  await r.mutate();
  assert.equal(commands(r).length,0,"fallback role detection must never execute a user turn");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.assistant.push(node("a1",command("dup-1")));await r.mutate();
  r.assistant.push(node("a2",command("dup-1")));await r.mutate();
  assert.equal(commands(r).length,2,"exact duplicate in a distinct assistant message must reach background for explicit duplicate status");
  assert.equal(commands(r)[1].command.id,"dup-1");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.assistant.push(node("race-1",command("reconcile-1")));
  await r.message({type:"SEMANTIC_RECONCILE"});
  assert.equal(commands(r).length,1,"command present before RECONCILE must execute/recover exactly once");
  assert.equal(commands(r)[0].semantic.trigger,"reconcile");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.assistant.push(node("doc-1","Documentation mentions "+START+" but has no local closing token."));
  r.assistant.push(node("cmd-1",command("after-unmatched")));
  await r.mutate();
  assert.equal(commands(r).length,1,"unmatched marker in one message must not consume a later message");
  assert.equal(commands(r)[0].command.id,"after-unmatched");
  assert.equal(r.sent.filter(x=>x?.type==="TRANSPORT_DIAG"&&x.diagnostic?.reason==="invalid_json").length,0);
}
{
  const r=runtime();
  r.assistant.push(node("history-1",command("historical")));
  await r.message({type:"SEMANTIC_BASELINE"});
  assert.equal(commands(r).length,0,"baseline must not execute historical assistant commands");
  r.assistant.push(node("new-1",command("new-after-baseline")));
  await r.mutate();
  assert.equal(commands(r).length,1);
  assert.equal(commands(r)[0].command.id,"new-after-baseline");
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});r.setReject(true);
  r.assistant.push(node("fail-1",command("send-fails")));await r.mutate();
  const entries=r.storage.semantic_fallback_diagnostics_v2||[];
  assert.ok(entries.some(x=>x.event==="semantic.dispatch_failed"),"runtime.sendMessage rejection must persist a diagnostic");
  const d=await r.message({type:"SEMANTIC_DIAG"});
  assert.equal(d.semantic.last_dispatch_ok,false);
  assert.match(d.semantic.last_send_error,/mock runtime unavailable/);
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  r.assistant.push(node("prose","Here is an example: "+command("embedded")+" do not run it."));
  await r.mutate();
  assert.equal(commands(r).length,0,"non-standalone assistant documentation must not execute");
}

console.log("SEMANTIC_RUNTIME_E2E_PASS");
