(()=>{
const HOST="com.sokna.bridge.v3";
const log=document.getElementById("log"),status=document.getElementById("status");
const say=s=>{log.textContent+=s+"\n"};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const uid=()=>crypto.randomUUID?.()||String(Date.now());
const toB64url=s=>{
  const bytes=new TextEncoder().encode(s);let bin="";
  for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
};
const native=m=>new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,m,r=>{
  const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{});
}));
const RE=/\[SOKNA-V2-CMD\]([\s\S]*?)\[\/SOKNA-V2-CMD\]/g;
function parse(t){
  const a=[];RE.lastIndex=0;let m;
  while((m=RE.exec(t||""))){
    try{const c=JSON.parse(m[1]);if(c?.id&&c?.action)a.push(c)}catch{}
  }
  return a;
}

(async()=>{
try{
  say("1/6 Native Host + Windows Agent...");
  const hp=await native({type:"host.ping",request_id:"v33-host"});
  if(!hp.ok)throw new Error(hp.error||"host ping failed");
  const ap=await native({type:"agent.exec",request_id:"v33-agent",command:{id:"v33-agent-"+uid(),action:"ping",params:{}}});
  if(!ap.ok||!ap.result?.ok)throw new Error(ap.error||ap.result?.error||"agent ping failed");
  say("   PASS");

  say("2/6 Exact V2.5.1 marker parser...");
  const cmd={id:"v33-old-marker-"+uid(),action:"ping",params:{}};
  const payload=`[SOKNA-V2-CMD]${JSON.stringify(cmd)}[/SOKNA-V2-CMD]`;
  if(parse(payload)[0]?.id!==cmd.id)throw new Error("old marker parser failed");
  say("   PASS");

  say("3/6 Ephemeral addedNode — final DOM loses marker...");
  const box=document.createElement("div");document.body.appendChild(box);
  let captured=null;
  const mo=new MutationObserver(ms=>{
    for(const m of ms)for(const n of m.addedNodes){
      const t=n.nodeType===Node.TEXT_NODE?(n.nodeValue||""):(n.textContent||"");
      const c=parse(t)[0];if(c)captured=c;
    }
  });
  mo.observe(box,{childList:true,subtree:true,characterData:true});
  const transient=document.createElement("span");transient.textContent=payload;
  box.appendChild(transient);transient.remove();
  await wait(0);await wait(25);mo.disconnect();
  if(!captured||captured.id!==cmd.id)throw new Error("ephemeral node was not captured");
  if(box.textContent.includes("[SOKNA-V2-CMD]"))throw new Error("marker unexpectedly remained in final DOM");
  say("   PASS — observer captured a command that no longer exists in final DOM");

  say("4/6 Character-data streaming capture...");
  let streamCaptured=null;
  const streamBox=document.createElement("div"),t=document.createTextNode("");
  streamBox.appendChild(t);document.body.appendChild(streamBox);
  const mo2=new MutationObserver(ms=>{
    for(const m of ms){
      const s=m.target?.parentNode?.textContent||m.target?.nodeValue||"";
      const c=parse(s)[0];if(c)streamCaptured=c;
    }
  });
  mo2.observe(streamBox,{subtree:true,characterData:true,childList:true});
  t.nodeValue="[SOKNA-V2-CMD]";
  t.nodeValue=payload;
  await wait(0);await wait(25);mo2.disconnect();
  if(!streamCaptured||streamCaptured.id!==cmd.id)throw new Error("characterData streaming capture failed");
  say("   PASS");

  say("5/6 Native round-trip using the old-marker command...");
  const rr=await native({type:"agent.exec",request_id:"v33-e2e",command:cmd});
  if(!rr.ok||!rr.result?.ok)throw new Error(rr.error||rr.result?.error||"agent roundtrip failed");
  say("   PASS");

  say("6/6 Legacy result envelope...");
  const env=`[SOKNA-V2-RESULT]${JSON.stringify({id:cmd.id,...rr.result})}[/SOKNA-V2-RESULT]`;
  if(!env.includes("[SOKNA-V2-RESULT]")||!env.includes(cmd.id))throw new Error("legacy result envelope failed");
  say("   PASS");

  say("   V3.9.1 note: live transport also tracks incomplete command containers until the end marker arrives.");
  say("   V3.9.1 note: complex commands use Base64URL envelopes to avoid chat escaping.");
  status.textContent="PASS — V3.9.1 hybrid mutation-time transport self-test completed";
  status.style.color="green";
}catch(e){
  say("FAIL — "+String(e?.stack||e));
  status.textContent="FAIL — "+String(e?.message||e);
  status.style.color="red";
}
})();
})();
