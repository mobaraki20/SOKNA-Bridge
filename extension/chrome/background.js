const HOST="com.sokna.bridge.v3";
const ARMED_KEY="armed_tabs_v3";
const SEEN_KEY="seen_commands_v3";
const STATUS_KEY="status_v3";
const MAX_SEEN=1500;
const RETRY_ALARM="sokna-v39-pending";
const V391_MIGRATION_CUTOFF=1789892342550;
const RETRY_BASE_MS=3000,RETRY_MAX_MS=60000,MAX_POST_ATTEMPTS=8;

const now=()=>Date.now();
const uid=()=>crypto.randomUUID?.()||(`v3-${Date.now()}-${Math.random().toString(16).slice(2)}`);
async function sget(area,keys){return await chrome.storage[area].get(keys)}
async function sset(area,obj){await chrome.storage[area].set(obj)}
async function armedAll(){const d=await sget("session",[ARMED_KEY]);return d[ARMED_KEY]||{}}
async function saveArmed(v){await sset("session",{[ARMED_KEY]:v})}
async function seenAll(){const d=await sget("local",[SEEN_KEY]);return d[SEEN_KEY]||{}}
async function saveSeen(v){
  const e=Object.entries(v);if(e.length>MAX_SEEN){e.sort((a,b)=>(a[1]?.ts||0)-(b[1]?.ts||0));v=Object.fromEntries(e.slice(e.length-MAX_SEEN))}
  await sset("local",{[SEEN_KEY]:v});
}
async function suppressLegacyPending(){
  const seen=await seenAll();let changed=false;
  for(const r of Object.values(seen)){
    const t=r?.acceptedAt||r?.ts||0;
    if(r?.state==="done"&&!r?.posted&&!r?.suppressed&&t&&t<V391_MIGRATION_CUTOFF){
      r.suppressed=true;r.suppressReason="pre-v391-pending";changed=true;
    }
  }
  if(changed)await saveSeen(seen);
}async function statusAll(){const d=await sget("session",[STATUS_KEY]);return d[STATUS_KEY]||{}}
async function getStatus(tabId){const a=await statusAll();return a[String(tabId)]||null}
async function setStatus(tabId,patch){
  const a=await statusAll(),prev=a[String(tabId)]||{};
  const next={version:"3.9.5",state:"Ready",detail:"",actionRequired:false,etaMs:null,etaConfidence:"unknown",...prev,...patch,lastActivityAt:now()};
  a[String(tabId)]=next;await sset("session",{[STATUS_KEY]:a});await paint(tabId,next);return next;
}
async function clearStatus(tabId){const a=await statusAll();delete a[String(tabId)];await sset("session",{[STATUS_KEY]:a})}
function badgeFor(s){
  if(s==="Working"||s==="Posting")return {t:"RUN",c:"#2563eb"};
  if(s==="Waiting")return {t:"WAIT",c:"#d97706"};
  if(s==="Needs Action")return {t:"!",c:"#d97706"};
  if(s==="Error")return {t:"ERR",c:"#b91c1c"};
  return {t:"ON",c:"#16824f"};
}
async function paint(tabId,st){
  const b=badgeFor(st?.state||"Ready");
  try{await chrome.action.setBadgeText({tabId,text:b.t});await chrome.action.setBadgeBackgroundColor({tabId,color:b.c});await chrome.action.setTitle({tabId,title:`SOKNA Bridge V3.9.5 — ${st?.state||"Ready"}${st?.detail?" — "+st.detail:""}`})}catch{}
}
async function clearBadge(tabId){try{await chrome.action.setBadgeText({tabId,text:""});await chrome.action.setTitle({tabId,title:"SOKNA Bridge V3.9.5 — disabled"})}catch{}}
function conv(url){try{const u=new URL(url);return u.origin+u.pathname}catch{return ""}}
function b64urlUtf8(s){
  const bytes=new TextEncoder().encode(String(s));let bin="";for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function resultEnvelope(obj){return `[SOKNA-V2-RESULT]${JSON.stringify(obj)}[/SOKNA-V2-RESULT]`}
function statusEnvelope(obj){return `[SOKNA-V2-STATUS]${JSON.stringify(obj)}[/SOKNA-V2-STATUS]`}
const lastTransportDiagByTab=new Map();
function nativeMessage(msg){return new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,msg,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}))}
async function hostPing(){return await nativeMessage({type:"host.ping",request_id:uid()})}
async function agentExec(command){
  const r=await nativeMessage({type:"agent.exec",request_id:uid(),command});
  if(!r.ok)throw new Error(r.error||"Native host execution failed");return r.result;
}
async function isArmed(tabId,conversationKey=""){
  const a=await armedAll(),r=a[String(tabId)];return {armed:!!r&&(!conversationKey||r.conversationKey===conversationKey),registered:r||null};
}

async function frameList(tabId){
  try{return await chrome.webNavigation.getAllFrames({tabId})||[]}catch{return [{frameId:0,url:""}]}
}
async function messageFrame(tabId,frameId,msg){
  return await chrome.tabs.sendMessage(tabId,msg,{frameId});
}
async function baselineAllFrames(tabId){
  const frames=await frameList(tabId),commands=[],diagnostics=[];
  for(const f of frames){
    try{
      const r=await messageFrame(tabId,f.frameId,{type:"BASELINE"});
      if(r?.ok){
        commands.push(...(r.commands||[]));
        diagnostics.push({frameId:f.frameId,url:f.url||r.frameHref||"",diagnostics:r.diagnostics||{}});
      }
    }catch{}
  }
  const map=new Map();for(const c of commands)if(c?.id)map.set(c.id,c);
  return {ok:true,commands:[...map.values()],frames:diagnostics};
}
async function reconcileAllFrames(tabId){
  const frames=await frameList(tabId);
  for(const f of frames){
    try{
      const rr=await messageFrame(tabId,f.frameId,{type:"RECONCILE"});
      const persisted=await seenAll();
      const fresh=(rr?.commands||[]).filter(c=>c?.id&&!persisted[c.id]);
      for(const c of fresh)await handleCommand(tabId,c);
    }catch{}
  }
}
async function diagAllFrames(tabId){
  const frames=await frameList(tabId),out=[];
  for(const f of frames){
    try{
      const r=await messageFrame(tabId,f.frameId,{type:"DIAG"});
      out.push({frameId:f.frameId,url:f.url||r?.frameHref||"",...r});
    }catch(e){
      out.push({frameId:f.frameId,url:f.url||"",ok:false,error:String(e)});
    }
  }
  return out;
}
async function arm(tabId){
  const tab=await chrome.tabs.get(tabId);if(!tab?.url?.startsWith("https://gpt.arzanai.com/"))return {ok:false,error:"Open gpt.arzanai.com in this tab first."};
  await setStatus(tabId,{state:"Working",detail:"Creating baseline"});
  let base;try{base=await baselineAllFrames(tabId)}catch(e){return {ok:false,error:"Bridge page adapter is not ready. Reload this chat page once. "+String(e)}}
  if(!base?.ok)return {ok:false,error:base?.error||"Baseline failed"};
  const seen=await seenAll();for(const c of (base.commands||[]))seen[c.id]={state:"baseline",ts:now(),conversationKey:conv(tab.url),action:c.action};await saveSeen(seen);
  const a=await armedAll();for(const [tid,r] of Object.entries(a)){if(Number(tid)!==tabId&&r?.conversationKey===conv(tab.url))return {ok:false,error:"This conversation is already armed in another tab."}}
  a[String(tabId)]={conversationKey:conv(tab.url),url:tab.url,armedAt:now(),baselineCount:(base.commands||[]).length,reconcileReady:true};await saveArmed(a);
  await setStatus(tabId,{state:"Ready",detail:"Armed",baselineCount:(base.commands||[]).length,lastError:"",actionRequired:false});
  return {ok:true,armed:true,version:"3.9.5",conversationKey:conv(tab.url),baselineCount:(base.commands||[]).length};
}
async function disarm(tabId){
  try{
    for(const f of await frameList(tabId)){try{await messageFrame(tabId,f.frameId,{type:"STOP"})}catch{}}
  }catch{}
  const a=await armedAll();delete a[String(tabId)];await saveArmed(a);
  await clearStatus(tabId);await clearBadge(tabId);return {ok:true,armed:false}
}
const postFlights=new Map();
async function postPending(tabId,id,rec){
  const key=`${tabId}:${id}`;
  if(postFlights.has(key))return await postFlights.get(key);
  const flight=postPendingInner(tabId,id,rec);
  postFlights.set(key,flight);
  try{return await flight}finally{if(postFlights.get(key)===flight)postFlights.delete(key)}
}
async function postPendingInner(tabId,id,rec){
  const a=await isArmed(tabId);
  let tab=null;try{tab=await chrome.tabs.get(tabId)}catch{}
  if(!a.armed||!tab||conv(tab.url)!==rec.conversationKey){
    return {ok:false,stale:true,error:"Conversation changed; stale result was not posted."};
  }
  if(rec.nextPostAt&&rec.nextPostAt>now())return {ok:false,waiting:true,reason:"backoff"};
  const env=resultEnvelope({id,...rec.result});
  await setStatus(tabId,{state:"Posting",detail:`Sending ${id}`,currentCommandId:id,actionRequired:false});
  let p;try{p=await chrome.tabs.sendMessage(tabId,{type:"POST_RESULT",envelope:env},{frameId:0})}catch(e){p={ok:false,waiting:true,reason:"page_unavailable",error:String(e)}}
  const seen=await seenAll();
  if(seen[id]){
    const attempts=(seen[id].postAttempts||0)+(p?.ok||p?.reason==="awaiting_conversation_ack"?0:1);
    const delay=p?.reason==="awaiting_conversation_ack"?15000:Math.min(RETRY_MAX_MS,RETRY_BASE_MS*Math.pow(2,Math.max(0,attempts-1)));
    seen[id].posted=seen[id].posted||!!p?.ok;seen[id].postMethod=p?.method||"";seen[id].postError=p?.error||"";
    seen[id].postAttempts=attempts;seen[id].waitReason=p?.reason||"";
    seen[id].postedAt=seen[id].posted?(seen[id].postedAt||now()):0;seen[id].nextPostAt=seen[id].posted?0:(now()+delay);
    await saveSeen(seen);
    rec=seen[id];
  }
  if(p?.ok){
    await setStatus(tabId,{state:"Ready",detail:"Armed",lastCompletedCommandId:id,lastPostMethod:p.method||"",currentCommandId:"",lastError:"",actionRequired:false});
    setTimeout(()=>retryPending(tabId).catch(()=>{}),250);
    return {ok:true};
  }
  const exhausted=(rec?.postAttempts||0)>=MAX_POST_ATTEMPTS&&!p?.waiting;
  if(exhausted){
    await setStatus(tabId,{state:"Needs Action",detail:"Queued result needs attention",currentCommandId:id,lastError:p?.error||"Submit failed",actionRequired:true});
  }else{
    await setStatus(tabId,{state:"Waiting",detail:`Queued ${id}: ${p?.reason||"retry"}`,currentCommandId:id,lastError:p?.error||"",actionRequired:false});
    const delay=Math.max(1000,(rec?.nextPostAt||now()+RETRY_BASE_MS)-now());
    setTimeout(()=>retryPending(tabId).catch(()=>{}),delay);
  }
  return {ok:false,waiting:!exhausted,reason:p?.reason||"retry",error:p?.error||"Submit failed"};
}

async function postTransportDiagnostic(tabId,diagnostic){
  const a=await isArmed(tabId);
  if(!a.armed)return {ok:false,ignored:true};

  const last=lastTransportDiagByTab.get(tabId)||0;
  if(now()-last<15000)return {ok:true,throttled:true};
  lastTransportDiagByTab.set(tabId,now());

  const env=statusEnvelope({
    kind:"transport-diagnostic",
    conversationKey:a.registered?.conversationKey||"",
    ts:now(),
    ...diagnostic
  });

  let p;
  try{
    p=await chrome.tabs.sendMessage(tabId,{type:"POST_RESULT",envelope:env},{frameId:0});
  }catch(e){
    p={ok:false,error:String(e)};
  }

  if(p?.ok){
    await setStatus(tabId,{
      state:"Ready",detail:"Armed",lastPostMethod:p.method||"",
      lastError:"",actionRequired:false
    });
    return {ok:true,method:p.method||""};
  }

  await setStatus(tabId,{
    state:"Needs Action",
    detail:"Transport diagnostic could not auto-send",
    lastError:p?.error||"Diagnostic submit failed",
    actionRequired:true
  });
  return {ok:false,error:p?.error||"Diagnostic submit failed"};
}

const commandTails=new Map();
async function handleCommand(tabId,command){
  const key=String(tabId);
  const prev=commandTails.get(key)||Promise.resolve();
  const run=prev.catch(()=>{}).then(()=>handleCommandInner(tabId,command));
  commandTails.set(key,run);
  try{return await run}finally{if(commandTails.get(key)===run)commandTails.delete(key)}
}
async function handleCommandInner(tabId,command){
  const a=await isArmed(tabId);if(!a.armed)return {ok:false,ignored:true};
  let seen=await seenAll();if(seen[command.id])return {ok:true,duplicate:true,state:seen[command.id].state};
  const acceptedAt=now();seen[command.id]={state:"running",ts:acceptedAt,acceptedAt,ackAt:acceptedAt,conversationKey:a.registered.conversationKey,sessionId:a.registered.conversationKey,sequence:acceptedAt,action:command.action,posted:false};await saveSeen(seen);
  await setStatus(tabId,{state:"Working",detail:`Executing ${command.action}`,currentCommandId:command.id,etaMs:null,etaConfidence:"unknown"});
  let result;
  try{result=await agentExec(command)}catch(e){result={ok:false,error:String(e)}}
  seen=await seenAll();seen[command.id]={...(seen[command.id]||{}),state:"done",completedAt:now(),result,posted:false};await saveSeen(seen);
  return await postPending(tabId,command.id,seen[command.id]);
}
async function retryPending(tabId,force=false){
  const a=await isArmed(tabId);if(!a.armed)return;
  const seen=await seenAll(),t=now();
  const p=Object.entries(seen)
    .filter(([id,r])=>r?.state==="done"&&!r?.posted&&!r?.suppressed&&r?.conversationKey===a.registered.conversationKey&&r?.result&&(force||!r.nextPostAt||r.nextPostAt<=t))
    .sort((x,y)=>(x[1].acceptedAt||x[1].ts||0)-(y[1].acceptedAt||y[1].ts||0))[0];
  if(p)await postPending(tabId,p[0],p[1]);
}

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  (async()=>{
    try{
      const tabId=m.tabId??sender.tab?.id;
      if(m.type==="ARM")return reply(await arm(tabId));
      if(m.type==="DISARM")return reply(await disarm(tabId));
      if(m.type==="COMMAND")return reply(await handleCommand(tabId,m.command));
      if(m.type==="TRANSPORT_DIAG")return reply(await postTransportDiagnostic(tabId,m.diagnostic||{}));
      if(m.type==="DELIVERY_READY"){const a=await isArmed(tabId);if(a.armed)retryPending(tabId,true).catch(()=>{});return reply({ok:true,armed:a.armed})}
      if(m.type==="CONTENT_READY"){
        const a=await isArmed(tabId);
        if(a.armed){
          const currentKey=conv(sender.tab?.url||m.url||"");
          if(currentKey&&a.registered?.conversationKey&&currentKey!==a.registered.conversationKey){
            return reply({ok:true,armed:false,reason:"conversation changed"});
          }
          // Critical V3.9.5 fix: a newly loaded content script starts unarmed.
          // Re-send BASELINE immediately to THIS frame so its MutationObserver is restored.
          try{
            const frameId=Number.isInteger(sender.frameId)?sender.frameId:0;
            if(a.registered?.reconcileReady){
              const rr=await messageFrame(tabId,frameId,{type:"RECONCILE"});
              const persisted=await seenAll();
              const fresh=(rr?.commands||[]).filter(c=>c?.id&&!persisted[c.id]);
              for(const c of fresh)await handleCommand(tabId,c);
            }else{
              const br=await messageFrame(tabId,frameId,{type:"BASELINE"});
              const persisted=await seenAll();
              for(const c of(br?.commands||[]))if(c?.id&&!persisted[c.id])persisted[c.id]={state:"baseline",ts:now(),conversationKey:a.registered.conversationKey,action:c.action};
              await saveSeen(persisted);
              const all=await armedAll();
              if(all[String(tabId)]){all[String(tabId)].reconcileReady=true;await saveArmed(all)}
            }
          }catch(e){
            await setStatus(tabId,{state:"Needs Action",detail:"Page adapter re-arm failed",lastError:String(e),actionRequired:true});
            return reply({ok:false,armed:true,error:"re-arm failed: "+String(e)});
          }
          await paint(tabId,await getStatus(tabId)||{state:"Ready",detail:"Armed"});
          retryPending(tabId).catch(()=>{});
        }
        return reply({ok:true,armed:a.armed});
      }
      if(m.type==="STATUS"){
        const a=await isArmed(tabId,m.conversationKey||"");const seen=await seenAll();const pending=Object.values(seen).filter(r=>r?.state==="done"&&!r?.posted&&!r?.suppressed&&(!m.conversationKey||r?.conversationKey===m.conversationKey)).length;const suppressed=Object.values(seen).filter(r=>r?.state==="done"&&!r?.posted&&r?.suppressed).length;
        let pageDiagnostics=await diagAllFrames(tabId);
        if(a.armed && pageDiagnostics.some(x=>x?.ok && x.topFrame && x.armed===false)){
          try{
            await reconcileAllFrames(tabId);
            pageDiagnostics=await diagAllFrames(tabId);
            await setStatus(tabId,{state:"Ready",detail:"Armed",lastError:"",actionRequired:false});
          }catch{}
        }
        return reply({ok:true,version:"3.9.5",armed:a.armed,registered:a.registered,status:await getStatus(tabId),pendingPostCount:pending,suppressedPendingCount:suppressed,pageDiagnostics});
      }
      if(m.type==="HOST_PING")return reply(await hostPing());
      if(m.type==="AGENT_PING")return reply(await agentExec({id:`v3-popup-${now()}`,action:"ping",params:{}}));
      reply({ok:false,error:"unknown message"});
    }catch(e){reply({ok:false,error:String(e)})}
  })();return true;
});

async function ensureRetryAlarm(){
  try{await chrome.alarms.create(RETRY_ALARM,{periodInMinutes:1})}catch{}
}
chrome.alarms.onAlarm.addListener(a=>{
  if(a?.name!==RETRY_ALARM)return;
  armedAll().then(x=>Promise.all(Object.keys(x).map(t=>retryPending(Number(t)).catch(()=>{})))).catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>ensureRetryAlarm().catch(()=>{}));
chrome.runtime.onInstalled.addListener(()=>ensureRetryAlarm().catch(()=>{}));
suppressLegacyPending().catch(()=>{});
ensureRetryAlarm().catch(()=>{});
chrome.tabs.onRemoved.addListener(tabId=>{disarm(tabId).catch(()=>{})});
