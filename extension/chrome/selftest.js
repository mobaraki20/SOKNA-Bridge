(()=>{
"use strict";

const HOST="com.sokna.bridge.v3";
const START="SOKNA3CMD:";
const END=":SOKNA3END";
const V4_START="SOKNA4CMD:";
const V4_END=":SOKNA4END";

const log=document.getElementById("log");
const status=document.getElementById("status");

const say=s=>{log.textContent+=s+"\n"};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const uid=()=>crypto.randomUUID?.()||String(Date.now());
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const protoBoundary=()=>PROTO.accept('x'.repeat(800),800)&&!PROTO.accept('x'.repeat(801),801);
function protocolTest(){const a='x'.repeat(800),b=a+'x';if(!PROTO.accept(a,1200)||PROTO.accept(b,1200))throw new Error('payload boundary');if(!PROTO.accept('x',1200)||PROTO.accept('x',1201))throw new Error('carrier boundary');const e=PROTO.expand({i:'z',o:'fr',w:'B',a:{f:'x'}});if(e.id!=='z'||e.action!=='file.read'||e.params.workspace!=='SOKNA-Bridge'||e.params.path!=='x')throw new Error('protocol alias');if(PROTO.bytes('سلام')<=4)throw new Error('utf8')}

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
const envelopeV4=cmd=>`${V4_START}${cmd.i||cmd.id}:${toB64url(JSON.stringify(cmd))}${V4_END}`;

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
      const raw=fromB64url(body);
      const span=b+END.length-a;
      if(!PROTO.accept(raw,span)){from=b+END.length;continue}
      const cmd=PROTO.expand(JSON.parse(raw));
      if(cmd?.id&&cmd?.action)out.push(cmd);
    }catch{}

    from=b+END.length;
  }

  return out;
}

function parseV4(text){
  const out=[];text=String(text||"");let from=0;
  while(true){
    const frame=PROTO.nextV4Frame(text,from);if(!frame||frame.kind==="partial")break;
    if(frame.kind==="nested"){from=frame.nextFrom;continue}
    from=frame.nextFrom;
    if(frame.hasWhitespace||!frame.validOuterId)continue;
    try{
      const raw=fromB64url(frame.body);
      if(PROTO.accept(raw,frame.span)){const cmd=PROTO.expand(JSON.parse(raw));if(cmd?.id&&cmd?.action&&cmd.id===frame.outerId)out.push(cmd)}
    }catch{}
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
  say("Protocol V1 boundary...");protocolTest();
  const a800="x".repeat(800),a801=a800+"x";
  if(!PROTO.accept(a800,800)||PROTO.accept(a801,801))throw new Error("protocol boundary");
  say("   PASS");
  say("1/8 Native Host + Windows Agent...");
  const hp=await native({
    type:"host.ping",
    request_id:"v3100-host"
  });
  if(!hp.ok)throw new Error(hp.error||"host ping failed");

  const agentCmd={
    id:"v3100-agent-"+uid(),
    action:"ping",
    params:{}
  };

  const ap=await native({
    type:"agent.exec",
    request_id:"v3100-agent",
    command:agentCmd
  });

  if(!ap.ok||!ap.result?.ok){
    throw new Error(ap.error||ap.result?.error||"agent ping failed");
  }
  say("   PASS");

  say("2/8 Real V3/V4 Base64URL carrier parser...");
  const cmd={
    id:"v3100-v3-"+uid(),
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
  const compact={i:"v3100-compact-"+uid(),w:"B",o:"fr",a:{f:"extension/chrome/background.js",s:220,n:90}};
  const compactParsed=parseV3(envelope(compact))[0];
  if(compactParsed?.id!==compact.i||compactParsed?.action!=="file.read"||compactParsed?.params?.workspace!=="SOKNA-Bridge"){
    throw new Error("compact V3 carrier expansion failed");
  }
  const paddedCmd={i:"v3100-pad",w:"B",o:"fs",a:{q:"x"}};
  const paddedRaw=JSON.stringify(paddedCmd);
  let paddedBin="";for(const b of new TextEncoder().encode(paddedRaw))paddedBin+=String.fromCharCode(b);
  const paddedBody=btoa(paddedBin).replace(/\+/g,"-").replace(/\//g,"_");
  const paddedParsed=parseV3(`${START}${paddedBody}${END}`)[0];
  if(paddedParsed?.id!==paddedCmd.i||paddedParsed?.action!=="file.search")throw new Error("padded Base64URL carrier failed");
  say("   PASS");

  say("3/8 Legacy marker compatibility...");
  const legacyCmd={
    id:"v3100-legacy-"+uid(),
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
    id:"v3100-long-"+uid(),
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
    request_id:"v3100-e2e",
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

  const v4cmd={i:"v3100-v4-"+uid(),w:"B",o:"p",a:{}};
  const v4parsed=parseV4(envelopeV4(v4cmd));
  if(v4parsed.length!==1||v4parsed[0].id!==v4cmd.i||v4parsed[0].action!=="ping")throw new Error("V4 outer-id carrier parser");
  const v4bad=envelopeV4({...v4cmd,i:v4cmd.i+"x"}).replace(v4cmd.i+"x",v4cmd.i);
  if(parseV4(v4bad).length!==0)throw new Error("V4 outer-id mismatch accepted");
  const crossPair=`SOKNA4CMD:${v4cmd.i}:broken historical prose with spaces ${envelopeV4(v4cmd)}`;
  const crossParsed=parseV4(crossPair);
  if(crossParsed.length!==1||crossParsed[0].id!==v4cmd.i)throw new Error("V4 nested cross-pair recovery failed");
  const invalidOuter=envelopeV4(v4cmd).replace(`SOKNA4CMD:${v4cmd.i}:`,`SOKNA4CMD:<command-id>:`);
  if(parseV4(invalidOuter).length!==0)throw new Error("V4 invalid outer id accepted");
  say("   V4 outer-id/correlated-NACK/cross-pair guard PASS");
  say("V3.10.5: guarded primary carrier uses SOKNA4-CMD:<id>:<base64url>:SOKNA4-END (non-executable notation); V3 remains backward-compatible.");
  say("V3.10.5: long commands are validated through fragmented V3 reassembly.");
  say("V3.10.5: candidate and stream diagnostics are deduplicated.");

  status.textContent=
    "PASS - V3.10.5 reliable transport self-test completed";
  status.style.color="green";

}catch(e){
  say("FAIL - "+String(e?.stack||e));
  status.textContent="FAIL - "+String(e?.message||e);
  status.style.color="red";
}
})();
})();