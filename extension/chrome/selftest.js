(()=>{
"use strict";
const HOST="com.sokna.bridge.v3",PROTO=globalThis.__SOKNA_PROTOCOL_V1__,CORE=globalThis.__SOKNA_SEMANTIC_CORE_V1__;
const log=document.getElementById("log"),status=document.getElementById("status"),say=s=>{log.textContent+=s+"\n"},uid=p=>p+"-"+(crypto.randomUUID?.()||Date.now());
const native=m=>new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,m,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}));
const command=(action,params={})=>PROTO.commandEnvelope({id:uid("selftest"),action,params});
async function step(name,fn){say(name+"…");const r=await fn();say("  "+(r==="skip"?"SKIP":"PASS"))}
async function chatTab(){const a=await chrome.tabs.query({});const approved=[];for(const t of a){if(!/^https:\/\//i.test(String(t.url||"")))continue;try{const s=await chrome.runtime.sendMessage({type:"CHAT_ORIGIN_STATUS",url:t.url});if(s?.approved)approved.push(t)}catch{}}return approved.find(x=>x.active)||approved[0]||null}
(async()=>{try{
  if(!PROTO||!CORE)throw new Error("Current semantic protocol modules are unavailable");
  await step("1/8 Protocol v2 envelope validation",async()=>{const c=command("ping",{});if(!PROTO.validateEnvelope(c,{kind:"command"})?.ok)throw new Error("valid command rejected");if(PROTO.validateEnvelope({...c,protocolVersion:"1"},{kind:"command"})?.ok)throw new Error("unsupported protocol accepted");if(PROTO.bytes("سلام")<=4)throw new Error("UTF-8 byte accounting failed")});
  await step("2/8 Semantic compiler",async()=>{const r=CORE.compile({intent:"exec",action:"ping",params:{}},()=>uid("semantic"));if(!r?.ok||r.command?.action!=="ping"||r.route!=="control")throw new Error(r?.message||r?.code||"semantic compile failed")});
  await step("3/8 Native Messaging host",async()=>{const r=await native({type:"host.ping",request_id:uid("host")});if(!r?.ok)throw new Error(r?.error||"host ping failed")});
  await step("4/8 Windows Agent round-trip",async()=>{const r=await native({type:"agent.exec",request_id:uid("agent"),command:command("ping",{})});if(!r?.ok||!r.result?.ok)throw new Error(r?.error||r?.result?.error||"agent ping failed")});
  await step("5/8 Agent capability discovery",async()=>{const r=await native({type:"agent.exec",request_id:uid("caps"),command:command("agent.capabilities",{})});const a=r?.result?.capabilities?.actions||r?.result?.actions||[];if(!r?.ok||!r.result?.ok||!Array.isArray(a)||!a.includes("workspace.list"))throw new Error(r?.error||"capabilities missing")});
  await step("6/8 Native bootstrap/session",async()=>{const r=await native({type:"agent.exec",request_id:uid("bootstrap"),command:command("bridge.bootstrap",{})});if(!r?.ok||!r.result?.ok||String(r.result?.protocol_version||"")!=="2")throw new Error(r?.error||r?.result?.error||"bootstrap failed")});
  await step("7/8 Semantic adapter health",async()=>{const t=await chatTab();if(!t){say("  No ChatGPT tab is open.");return"skip"}const r=await chrome.tabs.sendMessage(t.id,{type:"SEMANTIC_DIAG"},{frameId:0});if(!r?.ok||!r.semantic?.loaded||!r.semantic?.observer_active)throw new Error(r?.error||"semantic adapter unavailable")});
  await step("8/8 Connected-chat end-to-end probe",async()=>{const t=await chatTab();if(!t){say("  No ChatGPT tab is open.");return"skip"}const r=await chrome.tabs.sendMessage(t.id,{type:"SEMANTIC_E2E_PROBE"},{frameId:0});if(!r?.ok||!r?.background_reachable||!r?.agent_ok)throw new Error(r?.error||"end-to-end probe failed")});
  status.textContent="PASS — Core / Native Host / Agent / Semantic Adapter بررسی شدند";status.style.background="#e7f6ec";status.style.color="#11643d";
  say("\nبرای سبز کامل Connected، Popup علاوه بر این موارد Session و Delivery را نیز probe می‌کند.");
}catch(e){say("FAIL - "+String(e?.stack||e));status.textContent="FAIL — "+String(e?.message||e);status.style.background="#fde8e7";status.style.color="#8a1c1c"}})();
})();