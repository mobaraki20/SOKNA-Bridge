import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const coreSrc=fs.readFileSync(new URL("../../extension/chrome/semantic_core.js",import.meta.url),"utf8");
const intentSrc=fs.readFileSync(new URL("../../extension/chrome/semantic_intent.js",import.meta.url),"utf8");
const START="[SOKNA-INTENT]",END="[/SOKNA-INTENT]",PROBE_START="[SOKNA-PROBE]",PROBE_END="[/SOKNA-PROBE]";
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
function domEl(tag="DIV",text="",cls=""){
  let own=String(text||"");
  const attrs={};
  const e={
    tagName:tag.toUpperCase(),className:cls,children:[],parentElement:null,
    get innerText(){return this.children.length?this.children.map(x=>x.innerText).join("\n"):own},
    set innerText(v){own=String(v||"")},
    get textContent(){return this.innerText},
    set textContent(v){own=String(v||"")},
    getAttribute(k){return attrs[k]||""},
    setAttribute(k,v){attrs[k]=String(v)},
    querySelector(){return null},
    querySelectorAll(){const out=[];const walk=n=>{for(const c of n.children||[]){out.push(c);walk(c)}};walk(this);return out},
    contains(n){let cur=n;while(cur){if(cur===this)return true;cur=cur.parentElement}return false}
  };
  return e;
}
function append(parent,child){child.parentElement=parent;parent.children.push(child);return child}
function genericTurn(main,text,cls="turn"){
  const shell=append(main,domEl("DIV","",cls));
  const body=append(shell,domEl("P",text,"markdown"));
  return {shell,body};
}
function runtime(){
  const assistant=[],turns=[],sent=[],listeners=[],storage={},observers=[],main=domEl("MAIN","","conversation-main");
  let rejectCommand=false;
  const body=domEl("BODY","");append(body,main);
  const document={
    querySelector(sel){if(sel==="main,[role=\'main\']")return main;return null},
    querySelectorAll(sel){
      if(sel==='[data-message-author-role="assistant"]')return [...assistant];
      if(sel==='[data-testid^="conversation-turn-"]')return [...turns];
      return [];
    },
    body,documentElement:body
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
  return {ctx,assistant,turns,main,sent,storage,message,addGeneric:(text,cls="turn")=>genericTurn(main,text,cls),setReject:v=>{rejectCommand=v},mutate:async()=>{for(const o of observers)o.cb();await new Promise(r=>setTimeout(r,90))}};
}
function command(id,action="ping",bridgeNonce=""){const spec={id,intent:"exec",action,params:{}};if(bridgeNonce)spec.bridge_nonce=bridgeNonce;return START+JSON.stringify(spec)+END}
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

{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  const challenge="probe-runtime-001";
  const armed=await r.message({type:"SEMANTIC_SET_CHALLENGE",challenge});
  assert.equal(armed.ok,true);
  r.addGeneric("Bridge handshake "+challenge);
  r.addGeneric(PROBE_START+challenge+PROBE_END);
  await r.mutate();
  const d=await r.message({type:"SEMANTIC_DIAG"});
  assert.equal(d.semantic.probe_verified,true,"challenge response must prove intake without turn selectors");
  assert.equal(d.semantic.selector_ready,true);
  assert.equal(d.semantic.selector_mode,"challenge-shell");
  assert.ok(r.sent.some(x=>x?.type==="SEMANTIC_INTAKE_PROVEN"&&x.challenge===challenge),"verified probe must notify background");

  r.addGeneric(command("generic-no-nonce-must-not-run"));
  await r.mutate();
  assert.equal(commands(r).length,0,"selectorless marker without the active nonce must fail closed");

  r.addGeneric("UI notice inserted between conversation turns");
  r.addGeneric(command("generic-wrong-nonce","ping","wrong-nonce"));
  await r.mutate();
  assert.equal(commands(r).length,0,"selectorless marker with a stale/wrong nonce must fail closed");

  r.addGeneric("another unrelated sibling that would break parity-based inference");
  r.addGeneric(command("generic-assistant-ok","ping",challenge));
  await r.mutate();
  assert.equal(commands(r).length,1,"active nonce must allow selectorless dispatch independently of DOM sibling parity");
  assert.equal(commands(r)[0].command.id,"generic-assistant-ok");
  assert.equal(commands(r)[0].semantic.nonceBound,true);
  assert.equal(commands(r)[0].semantic.provenance,"challenge-nonce");
  assert.equal(commands(r)[0].semantic.messageIdentity.includes("node-"),true);
}
{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  const challenge="probe-runtime-002";await r.message({type:"SEMANTIC_SET_CHALLENGE",challenge});
  r.addGeneric("Bridge handshake "+challenge);
  r.addGeneric(PROBE_START+"wrong-challenge"+PROBE_END);
  await r.mutate();
  const d=await r.message({type:"SEMANTIC_DIAG"});
  assert.equal(d.semantic.probe_verified,false,"wrong challenge must not verify intake");
  r.addGeneric(command("unproven-must-not-run"));
  await r.mutate();
  assert.equal(commands(r).length,0,"marker-first discovery must not execute before provenance is proved");
}
{
  const r=runtime();
  r.addGeneric(command("historical-generic","ping","old-connection-nonce"));
  await r.message({type:"SEMANTIC_BASELINE"});
  const challenge="probe-runtime-003";await r.message({type:"SEMANTIC_SET_CHALLENGE",challenge});
  r.addGeneric("Bridge handshake "+challenge);
  r.addGeneric(PROBE_START+challenge+PROBE_END);
  await r.mutate();
  r.addGeneric("ordinary user follow-up");
  r.addGeneric(command("fresh-generic","ping",challenge));
  await r.mutate();
  const ids=commands(r).map(x=>x.command.id);
  assert.deepEqual(ids,["fresh-generic"],"historical generic markers present at baseline must never execute after proof");
}

{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  const challenge="probe-runtime-direct-004";await r.message({type:"SEMANTIC_SET_CHALLENGE",challenge});
  r.assistant.push(node("direct-before-proof",command("direct-before-proof","ping",challenge)));
  await r.mutate();
  assert.equal(commands(r).length,0,"active challenge must block even explicit assistant-role commands until intake proof completes");

  r.addGeneric("Bridge handshake "+challenge);
  r.addGeneric(PROBE_START+challenge+PROBE_END);
  await r.mutate();

  r.assistant.push(node("direct-no-nonce",command("direct-no-nonce")));
  await r.mutate();
  assert.equal(commands(r).length,0,"explicit assistant-role command must still carry the active connection nonce after proof");

  r.assistant.push(node("direct-after-proof",command("direct-after-proof","ping",challenge)));
  await r.mutate();
  assert.equal(commands(r).length,1,"explicit assistant-role command with completed proof and active nonce must dispatch");
  assert.equal(commands(r)[0].command.id,"direct-after-proof");
  assert.equal(commands(r)[0].semantic.nonceBound,true);
}

{
  const r=runtime();await r.message({type:"SEMANTIC_BASELINE"});
  const challenge="probe-restored-session-005";
  const restored=await r.message({type:"SEMANTIC_RESTORE_PROOF",proof:{challenge,verifiedAt:Date.now()-1000,evidence:"challenge-response",selectorMode:"challenge-shell",probeSignature:"DIV|c=turn"}});
  assert.equal(restored.ok,true,"persisted semantic proof must restore after content reload");
  let d=await r.message({type:"SEMANTIC_DIAG"});
  assert.equal(d.semantic.probe_verified,true);
  assert.equal(d.semantic.selector_mode,"restored-session-proof");

  const same=await r.message({type:"SEMANTIC_SET_CHALLENGE",challenge});
  assert.equal(same.ok,true);
  d=await r.message({type:"SEMANTIC_DIAG"});
  assert.equal(d.semantic.probe_verified,true,"re-applying the same verified challenge must not destroy restored proof");

  r.addGeneric(command("restored-proof-command","ping",challenge));
  await r.mutate();
  assert.equal(commands(r).length,1,"restored proof plus active nonce must allow selectorless command after reload");
  assert.equal(commands(r)[0].command.id,"restored-proof-command");
  assert.equal(commands(r)[0].semantic.provenance,"challenge-nonce");

  r.addGeneric(command("restored-proof-missing-nonce"));
  await r.mutate();
  assert.equal(commands(r).length,1,"restored proof must still require the active nonce");
}

console.log("SEMANTIC_RUNTIME_E2E_PASS");
