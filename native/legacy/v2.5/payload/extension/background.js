importScripts("config.js");
const MAX_SEEN = 1000;
const ARMED_KEY = "armed_tabs_v25";

async function sget(area, keys){ return await chrome.storage[area].get(keys); }
async function sset(area, obj){ await chrome.storage[area].set(obj); }
function now(){ return Date.now(); }

async function getArmed(){
  const d=await sget("session",[ARMED_KEY]);
  return d[ARMED_KEY]||{};
}
async function saveArmed(v){ await sset("session",{[ARMED_KEY]:v}); }
async function armTab(tabId, conversationKey){
  const a=await getArmed();
  for(const [tid,rec] of Object.entries(a)){
    if(Number(tid)!==tabId && rec?.conversationKey===conversationKey){
      return {ok:false,error:"This conversation is already controlled by another tab.",ownerTabId:Number(tid)};
    }
  }
  a[String(tabId)]={conversationKey,armedAt:now()};
  await saveArmed(a);
  return {ok:true,armed:true,conversationKey};
}
async function disarmTab(tabId){
  const a=await getArmed(); delete a[String(tabId)]; await saveArmed(a); return {ok:true,armed:false};
}
async function armState(tabId,conversationKey){
  const a=await getArmed(); const rec=a[String(tabId)];
  return {ok:true,armed:!!rec && rec.conversationKey===conversationKey,registered:rec||null};
}
chrome.tabs.onRemoved.addListener(tabId=>{disarmTab(tabId).catch(()=>{});});

async function api(command){
  const c=globalThis.SOKNA_BRIDGE_CONFIG||{};
  const r=await fetch((c.endpoint||"http://127.0.0.1:8765")+"/api",{
    method:"POST",headers:{"Content-Type":"application/json","X-Sokna-Token":c.token||""},body:JSON.stringify(command||{})
  });
  const t=await r.text();
  try{return JSON.parse(t)}catch{return {ok:false,error:t||`HTTP ${r.status}`}}
}
async function getSeen(){ const d=await sget("local",["seen_commands_v25"]); return d.seen_commands_v25||{}; }
async function saveSeen(v){
  const e=Object.entries(v);
  if(e.length>MAX_SEEN){e.sort((a,b)=>(a[1]?.ts||0)-(b[1]?.ts||0));v=Object.fromEntries(e.slice(e.length-MAX_SEEN));}
  await sset("local",{seen_commands_v25:v});
}

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  (async()=>{
    try{
      if(!m)return reply({ok:false,error:"empty message"});
      const tabId=m.tabId ?? sender.tab?.id;
      if(m.type==="SOKNA_ARM") return reply(await armTab(tabId,m.conversationKey));
      if(m.type==="SOKNA_DISARM") return reply(await disarmTab(tabId));
      if(m.type==="SOKNA_ARM_STATE") return reply(await armState(tabId,m.conversationKey));
      if(m.type==="SOKNA_PING") return reply(await api({id:"popup-ping-"+now(),action:"ping",params:{}}));
      if(m.type==="SOKNA_EXEC"){
        if(!m.command?.id)return reply({ok:false,error:"Command id required"});
        const st=await armState(tabId,m.conversationKey);
        if(!st.armed)return reply({ok:false,ignored:true,error:"This tab is not manually armed."});
        const seen=await getSeen(), prior=seen[m.command.id];
        if(prior?.state==="done" && prior.result)return reply({...prior.result,cached:true});
        if(prior?.state==="running" && now()-(prior.ts||0)<600000)return reply({ok:false,duplicate_running:true,error:"Command already running"});
        seen[m.command.id]={state:"running",ts:now()};await saveSeen(seen);
        const result=await api(m.command);
        const seen2=await getSeen();seen2[m.command.id]={state:"done",ts:now(),result};await saveSeen(seen2);
        return reply(result);
      }
      reply({ok:false,error:"unknown message"});
    }catch(e){reply({ok:false,error:String(e)});}
  })(); return true;
});
