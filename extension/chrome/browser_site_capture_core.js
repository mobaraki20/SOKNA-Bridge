(()=>{
"use strict";
const G="__SOKNA_BROWSER_SITE_CAPTURE_CORE_V1__";if(globalThis[G])return;
const SAFE_ID=/^[A-Za-z0-9._-]{1,96}$/;
const COLLECTION_SCHEMAS=new Set(["sokna-browser-capture-collection-v1","sokna-browser-task-collection-v1"]);
function boundedInt(v,d,min,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.trunc(n))):d}
function safeId(v,fallback="capture"){const s=String(v||"").trim();if(SAFE_ID.test(s))return s;const x=s.replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,96);return SAFE_ID.test(x)?x:fallback}
function normalizeUrl(raw,base,origin,{includeQuery=false}={}){
  try{
    const u=new URL(String(raw||""),String(base||""));
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return"";
    if(origin&&u.origin.toLowerCase()!==String(origin).toLowerCase())return"";
    u.hash="";if(!includeQuery)u.search="";
    return u.href;
  }catch{return""}
}
function urlSlug(raw,index=0){
  let s="page";
  try{
    const u=new URL(String(raw||""));
    const parts=u.pathname.split("/").filter(Boolean);
    s=parts.length?parts.slice(-2).join("-"):"home";
    if(u.search)s+="-query";
  }catch{}
  s=s.replace(/\.[A-Za-z0-9]{1,8}$/g,"").replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,72)||"page";
  return String(Math.max(1,Number(index)||1)).padStart(3,"0")+"-"+s
}
function isSessionMutatingUrl(raw){
  try{
    const u=new URL(String(raw||"")),x=(u.pathname+"?"+u.searchParams.toString()).toLowerCase();
    return /(^|[\/_?&=.-])(logout|log-out|signout|sign-out|delete|destroy|remove-account|reset-session)([\/_?&=.-]|$)/.test(x)
  }catch{return false}
}
function recognizedCollection(m){return !!m&&COLLECTION_SCHEMAS.has(String(m.schema||""))&&Array.isArray(m.items)}
function collectionJobId(m){if(!recognizedCollection(m))return"";return safeId(m.task_id||m.capture_id||"capture")}
function collectionCreatedAt(m){const n=Number(m?.created_at||m?.started_at||0);return Number.isFinite(n)&&n>0?n:Date.now()}
function folderStamp(ms){const d=new Date(Number(ms)||Date.now()),p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`}
function jobFolder(m){return `SOKNA-Bridge/Jobs/${folderStamp(collectionCreatedAt(m))}_${collectionJobId(m)}`}
function csvCell(v){const s=String(v??"").replace(/\r?\n/g," ");return /[",]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function collectionCsv(m){
  const rows=[["index","status","requested_url","final_url","title","screenshot","error"]];
  for(let i=0;i<(m?.items||[]).length;i++){
    const x=m.items[i]||{},ref=x.artifact_ref||{},status=String(x.status||x.state||(x.ok===false?"error":"ok"));
    rows.push([Number.isFinite(Number(x.index))?Number(x.index)+1:Number.isFinite(Number(x.item_index))?Number(x.item_index)+1:i+1,status,x.requested_url||x.source_href||x.url||"",x.final_url||x.url||"",x.title||"",ref.name||"",x.error||""])
  }
  return rows.map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n"
}
function compactConfig(p={}){
  return {workers:boundedInt(p.workers,1,1,5),max_pages:boundedInt(p.max_pages,200,1,500),full_page:p.full_page!==false,discover:p.discover!==false,continue_on_error:p.continue_on_error!==false,settle_ms:boundedInt(p.settle_ms,500,0,10000),timeout_ms:boundedInt(p.timeout_ms,30000,1000,60000),include_query:p.include_query===true,allow_session_mutating:p.allow_session_mutating===true};
}
globalThis[G]=Object.freeze({schema:"sokna-browser-site-capture-core-v1",version:1,SAFE_ID,COLLECTION_SCHEMAS,boundedInt,safeId,normalizeUrl,urlSlug,isSessionMutatingUrl,recognizedCollection,collectionJobId,collectionCreatedAt,folderStamp,jobFolder,csvCell,collectionCsv,compactConfig});
})();
