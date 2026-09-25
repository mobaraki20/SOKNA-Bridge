const out=document.getElementById("out"),box=document.getElementById("state");
const activityEl=document.getElementById("activity"),activitySummary=document.getElementById("activitySummary"),credentialList=document.getElementById("credentialList");
const NATIVE_HOST="com.sokna.bridge.v3";
async function tab(){const [t]=await chrome.tabs.query({active:true,currentWindow:true});return t}
function conv(t){try{const u=new URL(t.url);return u.origin+u.pathname}catch{return ""}}
const msg=m=>new Promise(resolve=>chrome.runtime.sendMessage(m,r=>resolve(r||{})));
const native=m=>new Promise(resolve=>chrome.runtime.sendNativeMessage(NATIVE_HOST,m,r=>{const e=chrome.runtime.lastError;if(e)resolve({ok:false,error:e.message});else resolve(r||{})}));
const requestId=()=>crypto.randomUUID?.()||`popup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function when(ms){if(!ms)return "";try{return new Date(Number(ms)).toLocaleString()}catch{return ""}}
async function paint(){const t=await tab();if(!t){box.textContent="No active tab";return}const r=await msg({type:"STATUS",tabId:t.id,conversationKey:conv(t)});if(r.armed){const s=r.status?.state||"Ready";box.textContent=`● ENABLED — ${s}`;box.style.background=s==="Needs Action"?"#fff0d4":s==="Error"?"#ffe2e2":"#dff5e9";box.style.color=s==="Error"?"#8a1c1c":"#11643d"}else{box.textContent="○ Disabled on this tab";box.style.background="#eee";box.style.color="#444"}}
function renderActivity(a){
  const jobs=Array.isArray(a?.jobs)?a.jobs:[],events=Array.isArray(a?.events)?a.events:[],owned=Array.isArray(a?.owned_processes)?a.owned_processes:[];
  activitySummary.textContent=`${jobs.length} jobs · ${events.length} events · ${owned.length} owned processes`;
  let html='<div class="section-title">Jobs</div>';
  if(!jobs.length)html+='<div class="empty">No durable jobs recorded.</div>';
  for(const j of jobs.slice(0,20)){
    const state=esc(j.status||"unknown"),meta=[j.workspace,j.path,j.worker_pid?`PID ${j.worker_pid}`:"",when(j.finished_at||j.started_at||j.created_at)].filter(Boolean).map(esc).join(" · ");
    html+=`<div class="item"><strong>${esc(j.id||"job")}</strong><span class="state-pill">${state}</span><div class="meta">${meta}</div>${j.error?`<div class="meta">Error: ${esc(typeof j.error==='string'?j.error:JSON.stringify(j.error))}</div>`:""}</div>`;
  }
  html+='<div class="section-title">Recent events</div>';
  if(!events.length)html+='<div class="empty">No activity events yet.</div>';
  for(const e of [...events].reverse().slice(0,30)){
    const ref=e.job_id||e.command_id||e.correlation_id||"";
    html+=`<div class="item"><strong>${esc(e.kind||"event")}</strong>${e.state?`<span class="state-pill">${esc(e.state)}</span>`:""}<div class="meta">${esc(ref)}${ref&&e.action?" · ":""}${esc(e.action||"")}${e.worker_pid?` · PID ${esc(e.worker_pid)}`:""}${e.timestamp?` · ${esc(when(e.timestamp))}`:""}</div>${e.error?`<div class="meta">${esc(e.error)}</div>`:""}</div>`;
  }
  activityEl.innerHTML=html;
}
async function refreshActivity(){
  const r=await msg({type:"ACTIVITY_SNAPSHOT",limit:80});
  if(!r.ok){activitySummary.textContent="Activity unavailable";activityEl.innerHTML=`<div class="error">${esc(r.error||"Unable to read agent activity")}</div>`;return}
  renderActivity(r.activity||{});
}
function renderCredentials(items){
  if(!Array.isArray(items)||!items.length){credentialList.innerHTML='<div class="empty">No saved test credentials.</div>';return}
  credentialList.innerHTML=items.map(x=>`<div class="cred-row"><div class="cred-main"><div class="cred-id">${esc(x.id)}</div><div class="cred-user">${esc(x.username||"(no username)")}</div></div><button type="button" data-delete="${esc(x.id)}">Delete</button></div>`).join("");
  credentialList.querySelectorAll("button[data-delete]").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.delete||"";b.disabled=true;
    const r=await native({type:"credential.delete",request_id:requestId(),command:{id}});
    out.textContent=JSON.stringify(r,null,2);
    await refreshCredentials();
  }));
}
async function refreshCredentials(){
  credentialList.innerHTML='<div class="empty">Loading credentials…</div>';
  const r=await native({type:"credential.list",request_id:requestId()});
  if(!r.ok){credentialList.innerHTML=`<div class="error">${esc(r.error||"Credential store unavailable")}</div>`;return}
  renderCredentials(r.result?.credentials||[]);
}
async function saveCredential(){
  const id=document.getElementById("credId").value.trim(),username=document.getElementById("credUser").value,secret=document.getElementById("credSecret").value;
  if(!/^[A-Za-z0-9._-]{1,96}$/.test(id)){out.textContent="Credential ID must use letters, numbers, dot, underscore or dash.";return}
  if(!secret){out.textContent="Password / Secret is required.";return}
  const button=document.getElementById("saveCredential");button.disabled=true;
  try{
    const r=await native({type:"credential.store",request_id:requestId(),command:{id,username,secret}});
    document.getElementById("credSecret").value="";
    out.textContent=JSON.stringify(r,null,2);
    if(r.ok)await refreshCredentials();
  }finally{button.disabled=false}
}
document.getElementById("enable").onclick=async()=>{const t=await tab();const r=await msg({type:"ARM",tabId:t.id});out.textContent=JSON.stringify(r,null,2);await paint();await refreshActivity()};
document.getElementById("disable").onclick=async()=>{const t=await tab();out.textContent=JSON.stringify(await msg({type:"DISARM",tabId:t.id}),null,2);await paint()};
document.getElementById("host").onclick=async()=>{out.textContent=JSON.stringify(await msg({type:"HOST_PING"}),null,2)};
document.getElementById("agent").onclick=async()=>{out.textContent=JSON.stringify(await msg({type:"AGENT_PING"}),null,2)};
document.getElementById("status").onclick=async()=>{const t=await tab();const r=await msg({type:"STATUS",tabId:t.id,conversationKey:conv(t)});out.textContent=JSON.stringify({ok:r.ok,health:r.health},null,2);await paint();await refreshActivity()};
document.getElementById("details").onclick=async()=>{const t=await tab();out.textContent=JSON.stringify(await msg({type:"STATUS",tabId:t.id,conversationKey:conv(t)}),null,2);await paint()};
document.getElementById("refreshActivity").onclick=()=>refreshActivity().catch(e=>{activityEl.innerHTML=`<div class="error">${esc(e)}</div>`});
document.getElementById("saveCredential").onclick=()=>saveCredential().catch(e=>{out.textContent=String(e)});
document.getElementById("refreshCredentials").onclick=()=>refreshCredentials().catch(e=>{credentialList.innerHTML=`<div class="error">${esc(e)}</div>`});
document.getElementById("selftest").onclick=async()=>{const u=chrome.runtime.getURL("selftest.html");await chrome.tabs.create({url:u});};
Promise.all([paint(),refreshActivity(),refreshCredentials()]).catch(()=>{});
const activityTimer=setInterval(()=>refreshActivity().catch(()=>{}),2000);
window.addEventListener("unload",()=>clearInterval(activityTimer));
