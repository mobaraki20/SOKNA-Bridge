const ORIGIN=globalThis.__SOKNA_CHAT_ORIGIN_REGISTRY_V1__;
const $=id=>document.getElementById(id);
const msg=m=>new Promise(resolve=>chrome.runtime.sendMessage(m,r=>{const e=chrome.runtime.lastError;resolve(e?{ok:false,error:e.message,runtime_unavailable:true}:(r||{}))}));
let lastDiagnostics=null,originStatus={approved:false,secure:false,origin:""};
const POPSTATE=globalThis.__SOKNA_POPUP_STATE_V1__;
async function activeTab(){const a=await chrome.tabs.query({active:true,currentWindow:true});return a[0]}
function isChat(url){const o=ORIGIN?.normalizeOrigin?.(url)||"";return !!o&&originStatus?.approved===true&&originStatus.origin===o}
function isIG(url){try{const h=new URL(url).hostname;return h==="www.instagram.com"||h==="instagram.com"}catch{return false}}
function isIGPost(url){try{return /^\/(p|reel)\//.test(new URL(url).pathname)}catch{return false}}
function isIGProfile(url){try{const p=new URL(url).pathname.split("/").filter(Boolean);return p.length===1&&!["explore","reels","stories","direct","accounts"].includes(p[0])}catch{return false}}
function show(id,on=true){$(id).classList.toggle("hidden",!on)}function dot(id,state){$(id).className="dot "+state}
function setMsg(id,text,kind=""){const e=$(id);e.textContent=text||"";e.className="msg"+(kind?" "+kind:"")}
function conversationKey(url){return ORIGIN?.conversationKey?.(url)||""}
function diagText(d){return JSON.stringify(d,null,2)}
async function agentHealth(){const r=await msg({type:"AGENT_PING"});if(r?.ok){dot("agentDot","ok");$("agentState").textContent="Agent فعال و قابل دسترس است";return true}dot("agentDot","bad");$("agentState").textContent="Agent در دسترس نیست";return false}
function describeChat(s){return POPSTATE.describeChat(s)}
function recoveryModel(s){return POPSTATE.recoveryModel(s)}
async function paint(){
  $("extensionVersion").textContent="Extension "+String(chrome.runtime.getManifest().version||"");
  const t=await activeTab(),url=t?.url||"";await agentHealth();originStatus=await msg({type:"CHAT_ORIGIN_STATUS",url});show("chatCard",false);show("igCard",false);show("otherCard",false);show("approveChatOrigin",false);
  if(isChat(url)){
    $("pageType").textContent="ChatGPT";show("chatCard");
    const s=await msg({type:"STATUS",tabId:t.id,conversationKey:conversationKey(url)}),d=describeChat(s),recovery=recoveryModel(s);
    dot("chatDot",d.dot);$("chatState").querySelector("span:last-child").textContent=d.text;$("chatSubstate").textContent=d.sub;
    show("deliveryRecovery",recovery.visible);$("deliveryRecoveryId").textContent=recovery.recordId||"—";$("recheckDelivery").dataset.recordId=recovery.recordId||"";
    show("disconnectChat",!!s?.armed);show("connectChat",!s?.armed||s?.status?.transportVerified!==true);
    $("connectChat").textContent=s?.armed?"Verify / Reconnect":"Connect this Chat";
    return;
  }
  if(isIG(url)){
    $("pageType").textContent="Instagram";show("igCard");show("igDownload",isIGPost(url));show("igScan",isIGProfile(url));show("igLimit",isIGProfile(url));
    $("igState").textContent=isIGPost(url)?"پست/Reel شناسایی شد.":isIGProfile(url)?"پروفایل شناسایی شد؛ آماده scan.":"Instagram باز است؛ یک پست یا پروفایل را باز کن.";return
  }
  $("pageType").textContent="SOKNA Bridge";show("otherCard");
  const candidate=originStatus?.secure&&!isIG(url);show("approveChatOrigin",candidate);$("otherOrigin").textContent=candidate?(originStatus.origin||"HTTPS origin"):"—";
}
async function getFullDiagnostics(){
  const t=await activeTab();if(!isChat(t?.url||""))return {ok:false,error:"برای Diagnostic مربوط به Chat، تب ChatGPT را فعال کن."};
  const r=await msg({type:"FULL_DIAGNOSTICS",tabId:t.id,conversationKey:conversationKey(t.url)});if(r?.ok)lastDiagnostics=r;$("diag").textContent=diagText(r);return r
}
$("approveChatOrigin").onclick=async()=>{const t=await activeTab(),origin=ORIGIN?.normalizeOrigin?.(t?.url||"");if(!origin)return setMsg("otherMsg","فقط یک origin امن HTTPS قابل فعال‌سازی است.","err");const pattern=ORIGIN.originPattern(origin);let granted=false;try{granted=await chrome.permissions.request({origins:[pattern]})}catch(e){return setMsg("otherMsg",String(e),"err")}if(!granted)return setMsg("otherMsg","مجوز این origin تأیید نشد.","warn");const r=await msg({type:"REGISTER_CHAT_ORIGIN",tabId:t.id,url:t.url});setMsg("otherMsg",r?.ok?"این origin به‌عنوان ChatGPT Adapter تأیید شد.":r?.error||"فعال‌سازی ناموفق",r?.ok?"ok":"err");await paint()};
$("connectChat").onclick=async()=>{const t=await activeTab();$("connectChat").disabled=true;setMsg("chatMsg","در حال اتصال، ساخت session و اجرای probe واقعی…");const r=await msg({type:"CONNECT_CHAT",tabId:t.id});const ok=!!r?.transport_verified;setMsg("chatMsg",ok?"اتصال end-to-end تأیید شد.":(r?.ok?"اتصال ثبت شد اما Transport هنوز کامل تأیید نشده؛ Diagnostics را ببین.":r?.error||"اتصال ناموفق"),ok?"ok":r?.ok?"warn":"err");$("diag").textContent=diagText(r);$("connectChat").disabled=false;await paint()};
$("disconnectChat").onclick=async()=>{const t=await activeTab();const r=await msg({type:"DISARM",tabId:t.id});setMsg("chatMsg",r?.ok?"اتصال این گفتگو قطع شد.":r?.error||"",r?.ok?"ok":"err");await paint()};
$("recheckDelivery").onclick=async()=>{const t=await activeTab(),recordId=$("recheckDelivery").dataset.recordId||"";$("recheckDelivery").disabled=true;setMsg("chatMsg","در حال بررسی visibility نتیجه؛ بدون ارسال مجدد…");const r=await msg({type:"RECHECK_DELIVERY",tabId:t.id,conversationKey:conversationKey(t.url),recordId});setMsg("chatMsg",r?.ok?"Delivery در گفتگو تأیید شد.":(r?.reason==="delivery_uncertain"?"هنوز visibility نتیجه تأیید نشده؛ RESULT دوباره ارسال نشد.":r?.error||r?.reason||"Re-check ناموفق"),r?.ok?"ok":r?.reason==="delivery_uncertain"?"warn":"err");$("recheckDelivery").disabled=false;await paint()};
$("igDownload").onclick=async()=>{const t=await activeTab();$("igDownload").disabled=true;setMsg("igMsg","در حال جمع‌آوری و دانلود مدیا…");const r=await msg({type:"IG_POPUP_DOWNLOAD",tabId:t.id,url:t.url});setMsg("igMsg",r?.ok?String(r.count||0)+" فایل برای دانلود ارسال شد.":r?.error||"دانلود ناموفق",r?.ok?"ok":"err");$("diag").textContent=diagText(r);$("igDownload").disabled=false};
$("igScan").onclick=async()=>{const t=await activeTab(),limit=Number($("igLimit").value||10);$("igScan").disabled=true;setMsg("igMsg","در حال ایندکس "+limit+" پست…");const r=await msg({type:"IG_POPUP_SCAN",tabId:t.id,url:t.url,limit});setMsg("igMsg",r?.ok?"اسکن ذخیره شد: "+r.scan_id+" — "+r.post_count+" پست.":r?.error||"اسکن ناموفق",r?.ok?"ok":"err");$("diag").textContent=diagText(r);$("igScan").disabled=false};
$("controlCenter").onclick=async()=>{$("diag").textContent=diagText(await msg({type:"OPEN_CONTROL_CENTER"}))};
$("refreshDiagnostics").onclick=async()=>{setMsg("diagMsg","در حال جمع‌آوری Diagnostic کامل…");const r=await getFullDiagnostics();setMsg("diagMsg",r?.ok?"Diagnostic به‌روز شد.":r?.error||"Diagnostic ناموفق",r?.ok?"ok":"err")};
$("copyDiagnostics").onclick=async()=>{const r=lastDiagnostics||await getFullDiagnostics();if(!r?.ok)return setMsg("diagMsg",r?.error||"Diagnostic موجود نیست","err");await navigator.clipboard.writeText(diagText(r));setMsg("diagMsg","Diagnostic کامل کپی شد.","ok")};
$("downloadDiagnostics").onclick=async()=>{const r=lastDiagnostics||await getFullDiagnostics();if(!r?.ok)return setMsg("diagMsg",r?.error||"Diagnostic موجود نیست","err");const blob=new Blob([diagText(r)],{type:"application/json"}),url=URL.createObjectURL(blob);try{await chrome.downloads.download({url,filename:"SOKNA-Bridge-Diagnostics-"+Date.now()+".json",saveAs:true});setMsg("diagMsg","فایل Diagnostic آماده دانلود شد.","ok")}catch(e){setMsg("diagMsg",String(e),"err")}finally{setTimeout(()=>URL.revokeObjectURL(url),5000)}};
$("sendDiagnostics").onclick=async()=>{const t=await activeTab();if(!isChat(t?.url||""))return setMsg("diagMsg","تب ChatGPT را فعال کن.","err");const r=await msg({type:"SEND_DIAGNOSTICS_TO_CHAT",tabId:t.id,conversationKey:conversationKey(t.url)});setMsg("diagMsg",r?.ok?"Diagnostic مستقیماً به این Chat ارسال شد.":r?.error||r?.delivery?.error||"ارسال ناموفق",r?.ok?"ok":"err")};
$("supportBundle").onclick=async()=>{const r=await msg({type:"CREATE_SUPPORT_BUNDLE"});$("diag").textContent=diagText(r);setMsg("diagMsg",r?.ok?"Support Bundle ساخته شد"+(r?.result?.path?"؛ "+r.result.path:""):r?.error||"ساخت Bundle ناموفق",r?.ok?"ok":"err")};
$("openLogs").onclick=async()=>{const r=await msg({type:"OPEN_LOGS"});setMsg("diagMsg",r?.ok?"پوشه Logها باز شد.":r?.error||"باز کردن Logها ناموفق",r?.ok?"ok":"err")};
$("hostTest").onclick=async()=>{$("diag").textContent=diagText(await msg({type:"HOST_PING"}))};$("agentTest").onclick=async()=>{$("diag").textContent=diagText(await msg({type:"AGENT_PING"}))};$("selfTest").onclick=async()=>{await chrome.tabs.create({url:chrome.runtime.getURL("selftest.html")})};
$("refreshActivity").onclick=async()=>{const r=await msg({type:"ACTIVITY_SNAPSHOT",limit:30});$("diag").textContent=diagText(r);const ev=Array.isArray(r?.activity?.events)?[...r.activity.events].reverse():[];$("activity").innerHTML=ev.length?ev.slice(0,20).map(x=>'<div class="event"><b>'+String(x.kind||"event")+'</b> — '+String(x.action||"")+'<br><span class="muted">'+(x.timestamp?new Date(Number(x.timestamp)).toLocaleString():"")+'</span></div>').join(""):'<div class="muted" style="margin-top:8px">رویدادی ثبت نشده.</div>'};
paint().catch(e=>{$("diag").textContent=String(e)});