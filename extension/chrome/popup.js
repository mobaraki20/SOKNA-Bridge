const $=id=>document.getElementById(id);
const HOST="com.sokna.bridge.v3";
const msg=m=>new Promise(resolve=>chrome.runtime.sendMessage(m,r=>resolve(r||{})));
async function activeTab(){const a=await chrome.tabs.query({active:true,currentWindow:true});return a[0]}
function isChat(url){try{const h=new URL(url).hostname;return h==="chatgpt.com"||h==="gpt.arzanai.com"}catch{return false}}
function isIG(url){try{const h=new URL(url).hostname;return h==="www.instagram.com"||h==="instagram.com"}catch{return false}}
function isIGPost(url){try{return /^\/(p|reel)\//.test(new URL(url).pathname)}catch{return false}}
function isIGProfile(url){try{const p=new URL(url).pathname.split("/").filter(Boolean);return p.length===1&&!["explore","reels","stories","direct","accounts"].includes(p[0])}catch{return false}}
function show(id,on=true){$(id).classList.toggle("hidden",!on)}
function setMsg(id,text,ok=null){const e=$(id);e.textContent=text||"";e.className="msg"+(ok===true?" ok":ok===false?" err":"")}
function dot(id,state){$(id).className="dot "+state}
async function agentHealth(){
  const r=await msg({type:"AGENT_PING"});if(r&&r.ok){dot("agentDot","ok");$("agentState").textContent="Agent فعال و قابل دسترس است";return true}
  dot("agentDot","bad");$("agentState").textContent="Agent در دسترس نیست";return false
}
function conversationKey(url){try{const u=new URL(url);return u.origin+u.pathname}catch{return""}}
async function paint(){
  const t=await activeTab(),url=t&&t.url?t.url:"";
  await agentHealth();show("chatCard",false);show("igCard",false);show("otherCard",false);
  if(isChat(url)){
    $("pageType").textContent="ChatGPT";show("chatCard");
    const s=await msg({type:"STATUS",tabId:t.id,conversationKey:conversationKey(url)});
    if(s&&s.armed){dot("chatDot","ok");$("chatState").querySelector("span:last-child").textContent="این گفتگو به Bridge متصل است";show("connectChat",false);show("disconnectChat",true)}
    else{dot("chatDot","warn");$("chatState").querySelector("span:last-child").textContent="این گفتگو هنوز متصل نیست";show("connectChat",true);show("disconnectChat",false)}
    return;
  }
  if(isIG(url)){
    $("pageType").textContent="Instagram";show("igCard");
    show("igDownload",isIGPost(url));show("igScan",isIGProfile(url));show("igLimit",isIGProfile(url));
    $("igState").textContent=isIGPost(url)?"پست/Reel شناسایی شد.":isIGProfile(url)?"پروفایل شناسایی شد.":"Instagram باز است؛ یک پست یا پروفایل را باز کن.";
    return;
  }
  $("pageType").textContent="SOKNA Bridge";show("otherCard");
}
$("connectChat").onclick=async()=>{
  const t=await activeTab();$("connectChat").disabled=true;setMsg("chatMsg","در حال اتصال و ساخت session…");
  const r=await msg({type:"CONNECT_CHAT",tabId:t.id});
  const tx=r&&r.ok?(r.handshake_posted?"Bridge به این Chat معرفی شد.":"Bridge متصل شد؛ پیام معرفی خودکار ارسال نشد."):(r&&r.error?r.error:"اتصال ناموفق");
  setMsg("chatMsg",tx,!!(r&&r.ok));$("diag").textContent=JSON.stringify(r,null,2);$("connectChat").disabled=false;await paint();
};
$("disconnectChat").onclick=async()=>{const t=await activeTab();const r=await msg({type:"DISARM",tabId:t.id});setMsg("chatMsg",r&&r.ok?"اتصال این گفتگو قطع شد.":(r&&r.error)||"",!!(r&&r.ok));await paint()};
$("igDownload").onclick=async()=>{
  const t=await activeTab();$("igDownload").disabled=true;setMsg("igMsg","در حال جمع‌آوری و دانلود مدیا…");
  const r=await msg({type:"IG_POPUP_DOWNLOAD",tabId:t.id,url:t.url});
  setMsg("igMsg",r&&r.ok?String(r.count||0)+" فایل برای دانلود ارسال شد.":(r&&r.error)||"دانلود ناموفق",!!(r&&r.ok));$("diag").textContent=JSON.stringify(r,null,2);$("igDownload").disabled=false;
};
$("igScan").onclick=async()=>{
  const t=await activeTab(),limit=Number($("igLimit").value||10);$("igScan").disabled=true;setMsg("igMsg","در حال ایندکس "+limit+" پست…");
  const r=await msg({type:"IG_POPUP_SCAN",tabId:t.id,url:t.url,limit});
  setMsg("igMsg",r&&r.ok?"اسکن ذخیره شد: "+r.scan_id+" — "+r.post_count+" پست. حالا در ChatGPT می‌توانی درباره‌اش سؤال کنی.":(r&&r.error)||"اسکن ناموفق",!!(r&&r.ok));$("diag").textContent=JSON.stringify(r,null,2);$("igScan").disabled=false;
};
$("controlCenter").onclick=async()=>{const r=await msg({type:"OPEN_CONTROL_CENTER"});$("diag").textContent=JSON.stringify(r,null,2)};
$("hostTest").onclick=async()=>{$("diag").textContent=JSON.stringify(await msg({type:"HOST_PING"}),null,2)};
$("agentTest").onclick=async()=>{$("diag").textContent=JSON.stringify(await msg({type:"AGENT_PING"}),null,2)};
$("selfTest").onclick=async()=>{await chrome.tabs.create({url:chrome.runtime.getURL("selftest.html")})};
$("refreshActivity").onclick=async()=>{
  const r=await msg({type:"ACTIVITY_SNAPSHOT",limit:30});$("diag").textContent=JSON.stringify(r,null,2);
  const ev=Array.isArray(r&&r.activity&&r.activity.events)?[...r.activity.events].reverse():[];
  $("activity").innerHTML=ev.length?ev.slice(0,20).map(x=>'<div class="event"><b>'+String(x.kind||"event")+'</b> — '+String(x.action||"")+'<br><span class="muted">'+(x.timestamp?new Date(Number(x.timestamp)).toLocaleString():"")+'</span></div>').join(""):'<div class="muted" style="margin-top:8px">رویدادی ثبت نشده.</div>';
};
paint().catch(e=>{$("diag").textContent=String(e)});
