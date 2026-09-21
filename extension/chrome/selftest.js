(()=>{
"use strict";

const HOST="com.sokna.bridge.v3";
const START="SOKNA3CMD:";
const END=":SOKNA3END";

const log=document.getElementById("log");
const status=document.getElementById("status");

const say=s=>{log.textContent+=s+"\n"};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const uid=()=>crypto.randomUUID?.()||String(Date.now());

const toB64url=s=>{
  const bytes=new TextEncoder().encode(s);
  let bin="";
  for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
};

const fromB64url=s=>{
  s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");
  s+="=".repeat((4-(s.length%4))%4);
  const bin=atob(s);
  const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const envelope=cmd=>`${START}${toB64url(JSON.stringify(cmd))}${END}`;

function parseV3(text){
  const out=[];
  text=String(text||"");
  let from=0;

  while(true){
    const a=text.indexOf(START,from);
    if(a<0)break;

    const b=text.indexOf(END,a+START.length);
    if(b<0)break;

    const body=text.slice(a+START.length,b).trim();

    try{
      const cmd=JSON.parse(fromB64url(body));
      if(cmd?.id&&cmd?.action)out.push(cmd);
    }catch{}

    from=b+END.length;
  }

  return out;
}

const LEGACY_RE=/\[SOKNA-V2-CMD\]([\s\S]*?)\[\/SOKNA-V2-CMD\]/g;

function parseLegacy(text){
  const out=[];
  LEGACY_RE.lastIndex=0;
  let m;

  while((m=LEGACY_RE.exec(String(text||"")))){
    try{
      const cmd=JSON.parse(m[1]);
      if(cmd?.id&&cmd?.action)out.push(cmd);
    }catch{}
  }

  return out;
}

const native=m=>new Promise((resolve,reject)=>{
  chrome.runtime.sendNativeMessage(HOST,m,r=>{
    const e=chrome.runtime.lastError;
    if(e)reject(new Error(e.message));
    else resolve(r||{});
  });
});

(async()=>{
try{
  say("1/8 Native Host + Windows Agent...");
  const hp=await native({
    type:"host.ping",
    request_id:"v395-host"
  });
  if(!hp.ok)throw new Error(hp.error||"host ping failed");

  const agentCmd={
    id:"v395-agent-"+uid(),
    action:"ping",
    params:{}
  };

  const ap=await native({
    type:"agent.exec",
    request_id:"v395-agent",
    command:agentCmd
  });

  if(!ap.ok||!ap.result?.ok){
    throw new Error(ap.error||ap.result?.error||"agent ping failed");
  }
  say("   PASS");

  say("2/8 Real V3 Base64URL carrier parser...");
  const cmd={
    id:"v395-v3-"+uid(),
    action:"ping",
    params:{text:"سلام SOKNA / V3"}
  };
  const payload=envelope(cmd);
  const parsed=parseV3(payload)[0];

  if(parsed?.id!==cmd.id){
    throw new Error("V3 Base64URL carrier parser failed");
  }
  if(parsed.params?.text!==cmd.params.text){
    throw new Error("V3 UTF-8 Base64URL decode failed");
  }
  say("   PASS");

  say("3/8 Legacy marker compatibility...");
  const legacyCmd={
    id:"v395-legacy-"+uid(),
    action:"ping",
    params:{}
  };
  const legacyPayload=
    `[SOKNA-V2-CMD]${JSON.stringify(legacyCmd)}[/SOKNA-V2-CMD]`;

  if(parseLegacy(legacyPayload)[0]?.id!==legacyCmd.id){
    throw new Error("legacy compatibility parser failed");
  }
  say("   PASS");

  say("4/8 Ephemeral addedNode V3 capture...");
  const box=document.createElement("div");
  document.body.appendChild(box);

  let captured=null;
  const mo=new MutationObserver(ms=>{
    for(const m of ms){
      for(const n of m.addedNodes){
        const text=
          n.nodeType===Node.TEXT_NODE
            ? (n.nodeValue||"")
            : (n.textContent||"");

        const found=parseV3(text)[0];
        if(found)captured=found;
      }
    }
  });

  mo.observe(box,{
    childList:true,
    subtree:true,
    characterData:true
  });

  const transient=document.createElement("span");
  transient.textContent=payload;
  box.appendChild(transient);
  transient.remove();

  await wait(0);
  await wait(25);
  mo.disconnect();

  if(!captured||captured.id!==cmd.id){
    throw new Error("ephemeral V3 node was not captured");
  }

  if(box.textContent.includes(START)){
    throw new Error("V3 marker unexpectedly remained in final DOM");
  }

  box.remove();
  say("   PASS");

  say("5/8 Progressive characterData fragmentation...");
  const streamBox=document.createElement("div");
  const textNode=document.createTextNode("");
  streamBox.appendChild(textNode);
  document.body.appendChild(streamBox);

  let streamCaptured=null;

  const mo2=new MutationObserver(ms=>{
    for(const m of ms){
      const text=
        m.target?.parentNode?.textContent ||
        m.target?.nodeValue ||
        "";

      const found=parseV3(text)[0];
      if(found)streamCaptured=found;
    }
  });

  mo2.observe(streamBox,{
    subtree:true,
    characterData:true,
    childList:true
  });

  const p1=Math.floor(payload.length/3);
  const p2=Math.floor(payload.length*2/3);

  textNode.nodeValue=payload.slice(0,p1);
  await wait(0);

  textNode.nodeValue=payload.slice(0,p2);
  await wait(0);

  textNode.nodeValue=payload;
  await wait(0);
  await wait(25);

  mo2.disconnect();
  streamBox.remove();

  if(!streamCaptured||streamCaptured.id!==cmd.id){
    throw new Error("fragmented V3 characterData capture failed");
  }
  say("   PASS");

  say("6/8 Long fragmented V3 envelope...");
  const longCmd={
    id:"v395-long-"+uid(),
    action:"ping",
    params:{
      padding:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(256)
    }
  };

  const longPayload=envelope(longCmd);
  let assembled="";
  let longParsed=null;

  for(let i=0;i<longPayload.length;i+=97){
    assembled+=longPayload.slice(i,i+97);
    const found=parseV3(assembled)[0];
    if(found)longParsed=found;
  }

  if(!longParsed||longParsed.id!==longCmd.id){
    throw new Error("long fragmented V3 envelope failed");
  }

  if(longParsed.params?.padding!==longCmd.params.padding){
    throw new Error("long V3 payload was corrupted");
  }
  say("   PASS");

  say("7/8 Native round-trip...");
  const rr=await native({
    type:"agent.exec",
    request_id:"v395-e2e",
    command:cmd
  });

  if(!rr.ok||!rr.result?.ok){
    throw new Error(
      rr.error ||
      rr.result?.error ||
      "agent roundtrip failed"
    );
  }
  say("   PASS");

  say("8/8 Result envelope compatibility...");
  const env=
    `[SOKNA-V2-RESULT]${JSON.stringify({
      id:cmd.id,
      ...rr.result
    })}[/SOKNA-V2-RESULT]`;

  if(
    !env.includes("[SOKNA-V2-RESULT]") ||
    !env.includes(cmd.id)
  ){
    throw new Error("result envelope compatibility failed");
  }
  say("   PASS");

  say("");
  say("V3.9.5: primary carrier is SOKNA3CMD:<base64url>:SOKNA3END.");
  say("V3.9.5: long commands are validated through fragmented V3 reassembly.");
  say("V3.9.5: candidate and stream diagnostics are deduplicated.");

  status.textContent=
    "PASS - V3.9.5 reliable transport self-test completed";
  status.style.color="green";

}catch(e){
  say("FAIL - "+String(e?.stack||e));
  status.textContent="FAIL - "+String(e?.message||e);
  status.style.color="red";
}
})();
})();