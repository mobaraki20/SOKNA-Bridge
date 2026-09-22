const out=document.getElementById("out"),box=document.getElementById("state");
async function tab(){const [t]=await chrome.tabs.query({active:true,currentWindow:true});return t}
function conv(t){try{const u=new URL(t.url);return u.origin+u.pathname}catch{return ""}}
const msg=m=>new Promise(resolve=>chrome.runtime.sendMessage(m,r=>resolve(r||{})));
async function paint(){const t=await tab();if(!t){box.textContent="No active tab";return}const r=await msg({type:"STATUS",tabId:t.id,conversationKey:conv(t)});if(r.armed){const s=r.status?.state||"Ready";box.textContent=`● ENABLED — ${s}`;box.style.background=s==="Needs Action"?"#fff0d4":s==="Error"?"#ffe2e2":"#dff5e9";box.style.color=s==="Error"?"#8a1c1c":"#11643d"}else{box.textContent="○ Disabled on this tab";box.style.background="#eee";box.style.color="#444"}}
document.getElementById("enable").onclick=async()=>{const t=await tab();const r=await msg({type:"ARM",tabId:t.id});out.textContent=JSON.stringify(r,null,2);await paint()};
document.getElementById("disable").onclick=async()=>{const t=await tab();out.textContent=JSON.stringify(await msg({type:"DISARM",tabId:t.id}),null,2);await paint()};
document.getElementById("host").onclick=async()=>{out.textContent=JSON.stringify(await msg({type:"HOST_PING"}),null,2)};
document.getElementById("agent").onclick=async()=>{out.textContent=JSON.stringify(await msg({type:"AGENT_PING"}),null,2)};
document.getElementById("status").onclick=async()=>{const t=await tab();const r=await msg({type:"STATUS",tabId:t.id,conversationKey:conv(t)});out.textContent=JSON.stringify({ok:r.ok,health:r.health},null,2);await paint()};
document.getElementById("details").onclick=async()=>{const t=await tab();out.textContent=JSON.stringify(await msg({type:"STATUS",tabId:t.id,conversationKey:conv(t)}),null,2);await paint()};paint().catch(()=>{});

document.getElementById("selftest").onclick=async()=>{const u=chrome.runtime.getURL("selftest.html");await chrome.tabs.create({url:u});};
