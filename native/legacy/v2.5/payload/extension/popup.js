const out=document.getElementById("out");
async function active(){const [t]=await chrome.tabs.query({active:true,currentWindow:true});return t}
function allowedUrl(tab){return !!tab?.url && /^https?:\/\//i.test(tab.url)}
async function inject(tab){
  if(!allowedUrl(tab)) throw new Error("This browser page cannot be controlled. Open the web chat in a normal http/https tab.");
  try{
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});
  }catch(e){
    const msg=String(e?.message||e);
    if(!/already|__SOKNA_V25__/i.test(msg)) throw e;
  }
}
async function info(tab){return await new Promise(resolve=>chrome.tabs.sendMessage(tab.id,{type:"SOKNA_CONTENT_INFO"},r=>resolve(r||null)))}
async function refresh(tab){return await new Promise(resolve=>chrome.tabs.sendMessage(tab.id,{type:"SOKNA_REFRESH_ARM"},r=>resolve(r||{})))}
document.getElementById("ping").onclick=()=>chrome.runtime.sendMessage({type:"SOKNA_PING"},r=>out.textContent=JSON.stringify(r,null,2));
document.getElementById("enable").onclick=async()=>{
  try{
    const t=await active();if(!t)throw new Error("No active tab.");
    await inject(t);
    const i=await info(t);if(!i?.conversationKey)throw new Error("Bridge could not initialize on this tab.");
    chrome.runtime.sendMessage({type:"SOKNA_ARM",tabId:t.id,conversationKey:i.conversationKey},async r=>{
      if(r?.ok)await refresh(t);
      out.textContent=r?.ok?"Enabled only on this tab. Existing commands were baselined and will not run.":"Error: "+(r?.error||"unknown");
    });
  }catch(e){out.textContent="Error: "+String(e?.message||e)}
};
document.getElementById("disable").onclick=async()=>{
  const t=await active();if(!t)return;
  chrome.runtime.sendMessage({type:"SOKNA_DISARM",tabId:t.id},async r=>{
    try{await refresh(t)}catch{}
    out.textContent="Disabled on this tab.";
  });
};
document.getElementById("status").onclick=async()=>{
  try{
    const t=await active();if(!t)throw new Error("No active tab.");
    let i=null;try{i=await info(t)}catch{}
    out.textContent=JSON.stringify(i||{ok:true,armed:false,note:"Not enabled on this tab. Click Enable on this tab."},null,2);
  }catch(e){out.textContent="Error: "+String(e?.message||e)}
};
