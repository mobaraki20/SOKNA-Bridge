(()=>{
"use strict";
const G="__SOKNA_SEMANTIC_INTENT_V1__";
try{globalThis[G]?.dispose?.()}catch{}
const Core=globalThis.__SOKNA_SEMANTIC_CORE_V1__;
const START="[SOKNA-INTENT]",END="[/SOKNA-INTENT]";
const seen=new Set();
let armed=false,disposed=false,observer=null,scanTimer=0;
function hash(s){s=String(s||"");let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")}
function idFor(raw){return `sem-${hash(raw)}`}
function diag(raw,reason,error,commandId="",extra={}){
  const cid=/^[A-Za-z0-9._-]{1,96}$/.test(String(commandId||""))?String(commandId):idFor(raw);
  chrome.runtime.sendMessage({type:"TRANSPORT_DIAG",diagnostic:{kind:"semantic-command-rejected",final:true,reason,version:"semantic-v1",error:String(error||reason),source:"semantic-intent",commandId:cid,transportRef:`semantic-${hash(raw)}`,...extra}}).catch(()=>{});
}
function parse(text,emit){
  text=String(text||"");let from=0;
  while(true){
    const a=text.indexOf(START,from);if(a<0)break;
    const b=text.indexOf(END,a+START.length);if(b<0)break;
    const raw=text.slice(a+START.length,b).trim(),ref=hash(raw);
    from=b+END.length;
    if(!raw||seen.has(ref))continue;
    seen.add(ref);
    if(!emit)continue;
    let spec;try{spec=JSON.parse(raw)}catch(e){diag(raw,"invalid_json",e);continue}
    const compiled=Core?.compile?.(spec,()=>idFor(raw));
    if(!compiled?.ok){
      const reason=compiled?.code==="ARTIFACT_ROUTE_REQUIRED"?"contract_payload_budget_exceeded":"invalid_compact_command";
      diag(raw,reason,compiled?.message||compiled?.code||"semantic compile failed",String(spec?.id||compiled?.commandId||idFor(raw)),{semanticCode:compiled?.code||"SCHEMA_INVALID",canonicalRoute:compiled?.canonical_route||""});
      continue;
    }
    chrome.runtime.sendMessage({type:"COMMAND",command:compiled.command,detector:"semantic-v1",source:`semantic:${compiled.route}`,semantic:{intent:compiled.intent,route:compiled.route,bytes:compiled.bytes}}).catch(()=>{});
  }
}
function bodyText(){try{return document.body?.innerText||document.body?.textContent||document.documentElement?.textContent||""}catch{return""}}
function seed(){parse(bodyText(),false)}
function scan(){if(!armed||disposed)return;parse(bodyText(),true)}
function schedule(){clearTimeout(scanTimer);scanTimer=setTimeout(scan,40)}
function startObserver(){if(observer||disposed)return;try{observer=new MutationObserver(schedule);observer.observe(document,{subtree:true,childList:true,characterData:true})}catch{}}
chrome.runtime.onMessage.addListener((m)=>{
  if(m?.type==="BASELINE"){seed();armed=true;startObserver();return}
  if(m?.type==="RECONCILE"){seed();armed=true;startObserver();return}
  if(m?.type==="STOP"){armed=false;return}
});
startObserver();
function dispose(){disposed=true;armed=false;clearTimeout(scanTimer);try{observer?.disconnect()}catch{};observer=null}
globalThis[G]={version:"1",dispose};
})();
