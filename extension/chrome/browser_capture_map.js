(()=>{
"use strict";
if(globalThis.__SOKNA_BROWSER_CAPTURE_MAP_RUNTIME_V1__)return;
const MAPS=globalThis.__SOKNA_BROWSER_CAPTURE_MAPS_V1__;
const T=globalThis.__SOKNA_BROWSER_TARGET_CORE_V1__;
if(!MAPS||!T||typeof browserSemanticAction!=="function"||typeof ingestExtensionArtifact!=="function")throw new Error("BROWSER_CAPTURE_MAP_RUNTIME_UNAVAILABLE");
const ACTION="browser.capture.batch",SCHEMA="sokna-browser-capture-map-collection-v1",RESULT_SCHEMA="sokna-browser-capture-map-result-v1";
const STORE="browser_capture_map_runs_v1",VIEW_CACHE=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SAFE_ID=/^[A-Za-z0-9._-]{1,96}$/;
function E(code,msg,extra={}){return Object.assign(new Error(msg||code),{code,...extra})}
function b64FromU8(bytes){let out="",chunk=0x6000;for(let i=0;i<bytes.length;i+=chunk){let s="",end=Math.min(bytes.length,i+chunk);for(let j=i;j<end;j++)s+=String.fromCharCode(bytes[j]);out+=btoa(s)}return out}
function utf8B64(s){return b64FromU8(new TextEncoder().encode(String(s||"")))}
function slug(s){return String(s||"page").normalize("NFKD").replace(/[^\w.-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"page"}
function folderStamp(ms){const d=new Date(ms||Date.now()),p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`}
function jobFolder(id,started){return `SOKNA-Bridge/Jobs/${folderStamp(started)}_${id}`}
function outputName(entry,suffix=""){let path="home";try{const u=new URL(entry.url),p=u.pathname.split("/").filter(Boolean);path=p.length?p.slice(-2).join("-"):"home";if(u.search)path+="-query"}catch{};return `${entry.id}__${slug(path)}${suffix}.png`}
async function waitTab(tabId,timeout=30000){const end=Date.now()+timeout;let t=null;while(Date.now()<end){t=await chrome.tabs.get(tabId);if(String(t.status)==="complete")return t;await sleep(120)}throw E("BROWSER_NAVIGATION_TIMEOUT","Timed out waiting for page.",{tab_id:tabId,url:String(t?.url||"")})}
async function shot(tabId,full=true){const target={tabId:Number(tabId)};let attached=false;try{await debugAttach(target);attached=true;await debugSend(target,"Page.enable",{});const m=await debugSend(target,"Page.getLayoutMetrics",{}),b=full?(m.cssContentSize||m.contentSize||{}):(m.cssVisualViewport||m.visualViewport||{}),width=Number(full?b.width:(b.clientWidth||b.width)),height=Number(full?b.height:(b.clientHeight||b.height)),x=full?0:Number(b.pageX)||0,y=full?0:Number(b.pageY)||0;if(!(width>0&&height>0))throw E("BROWSER_CAPTURE_GEOMETRY_INVALID","Empty screenshot geometry.");if(width>16384||height>16384||width*height>250000000)throw E("BROWSER_CAPTURE_TOO_LARGE","Screenshot exceeds safety limits.",{width,height});const r=await debugSend(target,"Page.captureScreenshot",{format:"png",clip:{x:Math.max(0,x),y:Math.max(0,y),width,height,scale:1},captureBeyondViewport:true});if(!r?.data)throw E("BROWSER_CAPTURE_EMPTY","Empty screenshot.");return {data_b64:String(r.data),width,height}}finally{if(attached)await debugDetach(target)}}
async function synthetic(tabId,requested,errorText,full){const u=chrome.runtime.getURL("browser_capture_error.html")+"?url="+encodeURIComponent(requested)+"&error="+encodeURIComponent(errorText);await chrome.tabs.update(tabId,{url:u});await waitTab(tabId,10000);await sleep(100);return await shot(tabId,full)}
async function pageInfo(tabId){try{const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:()=>{const nav=performance.getEntriesByType?.("navigation")?.[0];return {title:document.title,url:location.href,response_status:Number(nav?.responseStatus||0),text:String(document.body?.innerText||"").slice(0,4000)};}});return r?.[0]?.result||{}}catch{return {}}}
function norm(s){return String(s||"").replace(/\s+/g," ").trim().toLowerCase()}
async function clickText(tabId,labels,{exact=false}={}){labels=(Array.isArray(labels)?labels:[labels]).map(norm).filter(Boolean);if(!labels.length)return {ok:false,reason:"no-label"};try{const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:(labels,exact)=>{const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const txt=e=>String(e.innerText||e.textContent||e.getAttribute?.("aria-label")||e.getAttribute?.("title")||"").replace(/\s+/g," ").trim().toLowerCase();const destructive=/حذف|پاک|delete|remove|تسویه نهایی|نهایی|ثبت نهایی|ارسال|send|ذخیره|save|برگشت هزینه|restore|repair|install|update now/i;const nodes=[...document.querySelectorAll('button,a,[role="button"],[role="tab"],summary,[data-action],label')].filter(visible);let best=null;for(const label of labels){for(const e of nodes){const t=txt(e);if(!t||destructive.test(t))continue;const ok=exact?t===label:(t===label||t.includes(label)||label.includes(t));if(ok){best=e;break}}if(best)break}if(!best)return {ok:false,reason:"label-not-found",labels};best.scrollIntoView?.({block:"center",inline:"center"});best.click();return {ok:true,text:txt(best),tag:best.tagName||""}},args:[labels,exact]});return r?.[0]?.result||{ok:false,reason:"script-no-result"}}catch(e){return {ok:false,reason:"script-error",error:String(e)}}}
async function typeSearch(tabId,q){try{const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:q=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const all=[...document.querySelectorAll('input[type="search"],input[placeholder*="جستجو"],input[aria-label*="جستجو"],input[placeholder*="search" i],input[aria-label*="search" i],[contenteditable="true"][role="textbox"]')].filter(vis);const e=all[0];if(!e)return {ok:false,reason:"search-input-not-found"};e.focus();if("value"in e){const p=Object.getPrototypeOf(e),set=Object.getOwnPropertyDescriptor(p,"value")?.set;set?set.call(e,q):(e.value=q)}else e.textContent=q;e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:q}));e.dispatchEvent(new Event("change",{bubbles:true}));return {ok:true,tag:e.tagName||""}},args:[q]});return r?.[0]?.result||{ok:false}}catch(e){return {ok:false,error:String(e)}}}
async function selectFirst(tabId,kind="row"){try{const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:kind=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>10&&r.height>10};const bad=/حذف|delete|remove|خروج|logout|تسویه|پرداخت|ثبت|ذخیره|save|ارسال|send/i;let nodes=[];if(kind==="table")nodes=[...document.querySelectorAll('button,[role="button"],.table-card,.table-item,[data-table-id]')].filter(e=>vis(e)&&/میز/.test(e.innerText||e.textContent||"")&&!bad.test(e.innerText||e.textContent||""));else nodes=[...document.querySelectorAll('tbody tr,[role="row"],.list-group-item,.card,[data-row-id]')].filter(e=>vis(e)&&!bad.test(e.innerText||e.textContent||""));const e=nodes.find(x=>(x.innerText||x.textContent||"").trim().length>0);if(!e)return {ok:false,reason:"selectable-row-not-found"};e.scrollIntoView?.({block:"center"});e.click();return {ok:true,text:String(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,240)}} ,args:[kind]});return r?.[0]?.result||{ok:false}}catch(e){return {ok:false,error:String(e)}}}
async function themeToggle(tabId){try{const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:()=>{const vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const nodes=[...document.querySelectorAll('button,[role="button"],[data-theme],[aria-label],[title]')].filter(vis);const e=nodes.find(x=>/تم|پوسته|theme|dark|تاریک|روشن|light/i.test(`${x.innerText||""} ${x.getAttribute("aria-label")||""} ${x.getAttribute("title")||""} ${x.getAttribute("data-theme")||""}`));if(!e)return {ok:false,reason:"theme-control-not-found"};e.click();return {ok:true,text:String(e.innerText||e.getAttribute("aria-label")||e.title||"")}},args:[]});return r?.[0]?.result||{ok:false}}catch(e){return {ok:false,error:String(e)}}}
const H={
S01:[["searchOpen",["جستجو","search","neo"]],["type","میز"]],S02:[["click",["بیشتر"]]],S03:[["theme"]],
H01:[["selectTable"]],H03:[["click",["جمع اقلام"]]],H04:[["click",["افزودن سفارش","افزودن"]]],H05:[["click",["تسویه"]]],H06:[["click",["تخفیف"]]],H07:[["click",["تسویه"]],["click",["حساب مشتری","مشتری"]]],H08:[["click",["تغییر میز"]]],H09:[["click",["افزودن سفارش","افزودن"]],["safetyUnreached","unsaved-change dialog requires a harmless draft mutation that is not safely generic"]],
O01:[["selectTable"]],
SC04:[["click",["طرح‌ها"]]],SC05:[["click",["قوانین"]]],SC06:[["click",["اختصاص‌ها"]]],SC07:[["click",["استثناها"]]],
OP01:[["click",["کالای انبار جدید","کالای جدید"]]],OP02:[["selectRow"],["click",["اصلاح دستی موجودی","اصلاح دستی"]]],OP03:[["click",["شروع شمارش"]]],OP04:[["selectRow"]],OP07:[["click",["ثبت نیاز تأمین","ثبت نیاز"]]],OP08:[["click",["ثبت تحویل خرید","تحویل خرید"]]],OP10:[["click",["ثبت هزینه"]]],OP12:[["click",["برگشت هزینه"]]],
F01:[["selectRow"]],F02:[["selectRow"],["click",["تسویه"]]],F03:[["selectRow"],["click",["تخفیف"]]],F04:[["selectRow"],["click",["تسویه"]],["click",["مشتری","مشترک"]]],F06:[["selectRow"]],
CU01:[["selectRow"]],CU02:[["click",["مشتری جدید"]]],CU03:[["selectRow"],["click",["ثبت پرداخت"]]],
R01:[["click",["امروز"]]],R02:[["click",["۷ روز","7 روز"]]],R03:[["click",["۳۰ روز","30 روز"]]],
C01:[["click",["ویرایش"]]],C02:[["click",["آیتم جدید"]]],C03:[["click",["ویرایش"]],["click",["انتخاب تصویر","تصویر","رسانه"]]],C06:[["click",["دسته‌بندی جدید","دسته جدید","ویرایش دسته","ویرایش"]]],C09:[["click",["منوی جدید","منو جدید","ویرایش منو","ویرایش"]]],
G04:[["click",["فعال"]]],G05:[["click",["استفاده‌شده","استفاده شده"]]],G06:[["click",["بدون استفاده"]]],G07:[["click",["آرشیو"]]],G08:[["click",["انتخاب تصویر"]]],G09:[["click",["افزودن تصویر"]]],
IN01:[["selectRow"]],IN03:[["click",["پیش‌نمایش قالب چاپ","پیش نمایش قالب چاپ"]]],IN04:[["click",["تنظیم مقصد چاپ","مقصد چاپ"]]],
A01:[["click",["حساب جدید","ویرایش"]]],A02:[["click",["حساب جدید","ویرایش"]]],A04:[["click",["پرسنل جدید","افزودن پرسنل","ویرایش"]]],A09:[["click",["میز جدید","افزودن میز","ویرایش"]]],A10:[["click",["ساخت گروهی میز"]]]
};
const CONDITIONAL=new Set(["H02","P01","OP08","OP12","F06","G08","IN01"]);
function interactionRequiresHandler(e){
  const a=norm(e?.action||"");
  if(!a)return false;
  return /(^|\b)(open|click|select|toggle|type|switch|expand|choose|pick|edit)\b/i.test(a)||/(\u0628\u0627\u0632 \u06a9\u0646|\u0628\u0627\u0632\u06a9\u0631\u062f\u0646|\u06a9\u0644\u06cc\u06a9|\u0627\u0646\u062a\u062e\u0627\u0628|\u0648\u06cc\u0631\u0627\u06cc\u0634|\u062a\u063a\u06cc\u06cc\u0631 \u062a\u0645|\u062c\u0633\u062a\u062c\u0648)/i.test(a);
}
async function stateFingerprint(tabId){
  try{
    const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:()=>{
      const visible=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0};
      const flags=[...document.querySelectorAll('[aria-expanded="true"],[aria-selected="true"],dialog[open],[role="dialog"],[aria-modal="true"]')].filter(visible).slice(0,50).map(e=>`${e.tagName}:${e.id||""}:${e.getAttribute("role")||""}:${String(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,240)}`);
      const values=[...document.querySelectorAll("input,textarea,select")].filter(visible).slice(0,50).map(e=>`${e.tagName}:${e.type||""}:${e.value||""}:${e.getAttribute("aria-expanded")||""}:${e.getAttribute("aria-selected")||""}`);
      const active=document.activeElement;
      return {href:location.href,htmlClass:document.documentElement.className||"",bodyClass:document.body?.className||"",theme:document.documentElement.getAttribute("data-theme")||document.body?.getAttribute("data-theme")||"",active:active?`${active.tagName}:${active.id||""}:${active.getAttribute?.("aria-label")||""}`:"",flags,values,text:String(document.body?.innerText||"").replace(/\s+/g," ").trim().slice(0,12000)};
    }});
    return JSON.stringify(r?.[0]?.result||{});
  }catch{return ""}
}
async function applyState(tabId,e){
  const ops=H[e.id]||[],details=[];let reached=true,noData=false,revert=null;
  if(!ops.length){
    if(interactionRequiresHandler(e))return {reached:false,noData:CONDITIONAL.has(e.id),details:[{op:"state-contract",result:{ok:false,reason:"state-handler-missing"}}],revert:null};
    return {reached:true,noData:false,details,revert:null};
  }
  for(const op of ops){
    const before=op[0]==="safetyUnreached"?"":await stateFingerprint(tabId);
    let r={ok:false};
    if(op[0]==="click")r=await clickText(tabId,op[1]);
    else if(op[0]==="searchOpen"){r=await clickText(tabId,op[1]);if(!r.ok)r={ok:true,reason:"search-opener-optional"}}
    else if(op[0]==="type")r=await typeSearch(tabId,op[1]);
    else if(op[0]==="selectRow")r=await selectFirst(tabId,"row");
    else if(op[0]==="selectTable")r=await selectFirst(tabId,"table");
    else if(op[0]==="theme"){r=await themeToggle(tabId);if(r.ok)revert=async()=>{await themeToggle(tabId);await sleep(150)}}
    else if(op[0]==="safetyUnreached"){r={ok:false,reason:op[1],safety:true}}
    if(r.ok&&op[0]!=="searchOpen"){
      await sleep(450);
      const after=await stateFingerprint(tabId);
      if(before&&after&&before===after)r={...r,ok:false,reason:"state-unchanged"};
    }
    details.push({op:op[0],result:r});
    if(!r.ok){reached=false;if(CONDITIONAL.has(e.id))noData=true;break}
    await sleep(250);
  }
  return {reached,noData,details,revert};
}
async function waitDownload(id,timeout=12000){const end=Date.now()+timeout;let row=null;while(Date.now()<end){try{const a=await chrome.downloads.search({id});row=a?.[0]||null;if(row?.state==="complete")break}catch{}await sleep(100)}return row||{}}
async function saveDataUrl(dataUrl,filename){const id=await chrome.downloads.download({url:dataUrl,filename,saveAs:false,conflictAction:"overwrite"}),row=await waitDownload(id);return {download_id:id,filename,absolute_path:String(row.filename||""),state:String(row.state||"")}}
async function saveB64(b64,type,filename){return await saveDataUrl(`data:${type};base64,${b64}`,filename)}
async function saveText(text,type,filename){return await saveDataUrl(`data:${type};base64,${utf8B64(text)}`,filename)}
function csv(manifest){const esc=v=>{const s=String(v??"").replace(/\r?\n/g," ");return /[",]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};const rows=[["id","status","state_reached","requested_url","final_url","title","http_status","screenshot","error"]];for(const x of manifest.items)rows.push([x.id,x.status,x.state_reached,x.requested_url,x.final_url,x.title,x.http_status,x.artifact_ref?.name||"",x.error||""]);return rows.map(r=>r.map(esc).join(",")).join("\r\n")+"\r\n"}
async function captureEntry(tabId,e,cfg,folder,index){
  let finalUrl=e.url,title="",status="ok",error="",httpStatus=0,syntheticPage=false,state={reached:true,noData:false,details:[],revert:null},s=null;
  const started=Date.now();
  try{
    await chrome.tabs.update(tabId,{url:e.url});let t=await waitTab(tabId,cfg.timeout_ms);if(cfg.settle_ms)await sleep(cfg.settle_ms);t=await chrome.tabs.get(tabId);finalUrl=String(t.url||e.url);title=String(t.title||"");
    if(T.normalizeOrigin(finalUrl)!==T.normalizeOrigin(e.url)){status="redirected"}
    const info=await pageInfo(tabId);if(info.title)title=info.title;if(info.url)finalUrl=info.url;httpStatus=Number(info.response_status||0);
    state=await applyState(tabId,e);if(cfg.settle_ms)await sleep(Math.min(500,cfg.settle_ms));
    if(state.noData)status="no-data";else if(!state.reached)status="state-unreached";
    s=await shot(tabId,cfg.full_page);
  }catch(ex){
    status="capture-error";error=String(ex?.message||ex);
    try{s=await shot(tabId,cfg.full_page)}catch{try{syntheticPage=true;s=await synthetic(tabId,e.url,error,cfg.full_page)}catch(se){error+=(error?" | ":"")+String(se?.message||se)}}
  }
  let artifactRef=null,download=null;
  if(s?.data_b64){
    const suffix=status==="no-data"?"_NO_DATA":status==="state-unreached"?"_UNREACHED":status==="capture-error"?"_ERROR":"";
    const name=outputName(e,suffix),ing=await ingestExtensionArtifact(name,"image/png",s.data_b64);artifactRef=ing?.artifact_ref||null;
    try{download=await saveB64(s.data_b64,"image/png",`${folder}/${name}`)}catch(ex){error+=(error?" | ":"")+"human-copy: "+String(ex?.message||ex)}
  }
  if(state.revert)try{await state.revert()}catch{}
  return {index,id:e.id,title_requested:e.title,instruction:e.action,state:artifactRef?"succeeded":"failed",ok:status==="ok"||status==="redirected"||status==="no-data",status,state_reached:!!state.reached,no_data:!!state.noData,requested_url:e.url,url:finalUrl,final_url:finalUrl,title,http_status:httpStatus,capture:cfg.full_page?"full_page":"viewport",synthetic_error_page:syntheticPage,started_at:started,completed_at:Date.now(),error,state_details:state.details,artifact_ref:artifactRef||undefined,human_file:download||undefined};
}
async function readJsonArtifact(id){id=String(id||"").toLowerCase();const info=await agentExec(unifiedLocalCommand("artifact.out.info",{id})),bytes=Number(info?.artifact_ref?.bytes||0),chunks=[];let off=0,total=0;while(off<bytes){let part=null;for(let tries=0;tries<3;tries++){part=await agentExec(unifiedLocalCommand("artifact.out.get",{id,offset:off,limit:524288}));if(part?.data_b64&&Number(part?.next_offset)>off)break;await sleep(120*(tries+1))}if(!part?.data_b64||Number(part?.next_offset)<=off)throw E("ARTIFACT_READ_CHUNK_INVALID","Artifact chunk is invalid.");const bin=atob(part.data_b64),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);chunks.push(u8);total+=u8.length;off=Number(part.next_offset)}const all=new Uint8Array(total);let pos=0;for(const c of chunks){all.set(c,pos);pos+=c.length}return JSON.parse(new TextDecoder().decode(all))}
if(typeof artifactCollectionGet==="function"){
  const baseCollectionGet=artifactCollectionGet;
  artifactCollectionGet=async function(p={}){try{return await baseCollectionGet(p)}catch(ex){if(!/Unsupported artifact collection schema|ARTIFACT_COLLECTION_SCHEMA_INVALID/i.test(String(ex?.message||ex)))throw ex;const m=await readJsonArtifact(String(p.id||""));if(m?.schema!==SCHEMA||!Array.isArray(m.items))throw ex;const offset=Math.max(0,Number(p.offset)||0),limit=Math.max(1,Math.min(20,Number(p.limit)||10)),page=m.items.slice(offset,offset+limit);return {ok:true,schema:m.schema,summary:{requested:m.requested,attempted:m.attempted,captured:m.captured,failed:m.failed,created_at:m.created_at,capture_id:m.capture_id,map_preset:m.map_preset},offset,limit,total:m.items.length,has_more:offset+page.length<m.items.length,items:page,job_view:VIEW_CACHE.get(String(p.id||"").toLowerCase())||m.job_view||null}}}
}
function patchContract(){
  const base=globalThis.__SOKNA_ACTION_CONTRACTS_V1__;if(!base)return;const old=base.describe?.(ACTION);if(!old)return;
  const props={...(old.inputSchema?.properties||{}),map_preset:{type:"string",enum:["local18080-ui-audit-v1"]},map_artifact_ref:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},map_workers:{type:"integer",minimum:1,maximum:5}};
  const input={...(old.inputSchema||{}),properties:props,anyOf:[...(old.inputSchema?.anyOf||[]),{required:["map_preset"]},{required:["map_artifact_ref"]}]};
  const contract=Object.freeze({...old,inputSchema:input,description:String(old.description||"")+" Map mode executes the bundled named UI audit capture map, preserving duplicate URLs as distinct requested UI states and recording state-unreached/no-data evidence without destructive mutations."});
  const contracts=Object.freeze({...base.contracts,[ACTION]:Object.freeze({...contract,name:undefined})});
  const describe=name=>String(name||"")===ACTION?contract:base.describe(name);
  globalThis.__SOKNA_ACTION_CONTRACTS_V1__=Object.freeze({...base,contracts,describe,tools(e=[]){return base.list(e).filter(x=>x.contracted).map(x=>describe(x.name))}});
}
patchContract();
async function runMap(command,conversationKey,p){
  const preset=String(p.map_preset||"");
  let entries=MAPS.get(preset),mapSource=entries?"bundled":"",mapRef=String(p.map_artifact_ref||"").toLowerCase();
  if(!entries&&mapRef){
    const imported=await readJsonArtifact(mapRef),raw=Array.isArray(imported)?imported:(Array.isArray(imported?.entries)?imported.entries:null);
    if(!raw||!raw.length||raw.length>500)throw E("BROWSER_CAPTURE_MAP_ARTIFACT_INVALID","Map artifact must contain 1..500 entries.");
    entries=raw.map((x,i)=>({id:String(x?.id||x?.code||`state-${i+1}`),title:String(x?.title||x?.name||x?.id||""),url:String(x?.url||""),action:String(x?.action||x?.instruction||"")}));
    if(entries.some(x=>!SAFE_ID.test(x.id)||!/^https?:\/\//i.test(x.url)))throw E("BROWSER_CAPTURE_MAP_ARTIFACT_INVALID","Map artifact entries require safe ids and absolute http(s) URLs.");
    const firstOrigin=T.normalizeOrigin(entries[0].url);
    if(entries.some(x=>T.normalizeOrigin(x.url)!==firstOrigin))throw E("BROWSER_CAPTURE_MAP_CROSS_ORIGIN","A capture map must use one approved origin.");
    mapSource="artifact";
  }
  if(!entries)throw E("BROWSER_CAPTURE_MAP_UNKNOWN","Unknown capture map preset or missing map artifact.");
  const mapName=preset||`artifact:${mapRef.slice(0,12)}`;
  const id=String(p.capture_id||"").trim();if(!SAFE_ID.test(id))throw E("BROWSER_CAPTURE_ID_INVALID","capture_id must be a safe id.");
  const origin=T.normalizeOrigin(entries[0]?.url||"");const approved=await approvedBrowserOrigins(),pattern=T.originPattern(origin);if(!approved.includes(origin)||!await chrome.permissions.contains({origins:[pattern]}))throw E("BROWSER_SITE_ORIGIN_PERMISSION_REQUIRED","Approve the site origin from the Bridge popup before capture.",{origin});
  const oldStore=await chrome.storage.local.get([STORE]),runs=oldStore[STORE]||{},prior=runs[id];if(prior?.state==="completed"&&prior?.result)return {...prior.result,resumed:true};
  const cfg={workers:Math.max(1,Math.min(5,Number(p.map_workers||p.workers||5))),full_page:p.full_page!==false,settle_ms:Math.max(0,Math.min(10000,Number(p.settle_ms??600))),timeout_ms:Math.max(1000,Math.min(60000,Number(p.timeout_ms??30000)))},started=Date.now(),folder=jobFolder(id,started),records=new Array(entries.length);
  const preIds=new Set(["S00","S01","S02","S03"]),lastIds=new Set(["Z90","Z91"]),allIndexed=entries.map((e,i)=>({e,i})),pre=allIndexed.filter(x=>preIds.has(x.e.id)),middle=allIndexed.filter(x=>!preIds.has(x.e.id)&&!lastIds.has(x.e.id)),tail=allIndexed.filter(x=>lastIds.has(x.e.id));
  let cursor=0;const tabs=[];
  async function worker(tabId){for(;;){const n=cursor++;if(n>=middle.length)return;const x=middle[n];records[x.i]=await captureEntry(tabId,x.e,cfg,folder,x.i)}}
  try{
    for(let i=0;i<cfg.workers;i++){const t=await chrome.tabs.create({url:"about:blank",active:false});if(!Number.isInteger(t?.id))throw E("BROWSER_TAB_OPEN_FAILED","Worker tab id missing.");tabs.push(t.id)}
    const preTab=tabs[0];for(const x of pre)records[x.i]=await captureEntry(preTab,x.e,cfg,folder,x.i);
    await Promise.all(tabs.map(worker));
    const tailTab=tabs[0];for(const x of tail)records[x.i]=await captureEntry(tailTab,x.e,cfg,folder,x.i);
  }finally{await Promise.all(tabs.map(t=>chrome.tabs.remove(t).catch(()=>{})))}
  const items=records.filter(Boolean),captured=items.filter(x=>x.artifact_ref?.id).length,failed=items.filter(x=>x.status==="capture-error").length,stateUnreached=items.filter(x=>x.status==="state-unreached").length,noData=items.filter(x=>x.status==="no-data").length;
  const manifest={schema:SCHEMA,version:1,kind:"capture-map",capture_id:id,map_preset:mapName,map_source:mapSource,map_artifact_ref:mapRef||undefined,command_id:String(command.id||""),conversation_key:String(conversationKey||""),claimed_origin:origin,created_at:Date.now(),started_at:started,requested:entries.length,attempted:items.length,captured,failed,state_unreached:stateUnreached,no_data:noData,workers:cfg.workers,full_page:cfg.full_page,items};
  const ing=await ingestExtensionArtifact(`browser-capture-map-${id}.json`,"application/json",utf8B64(JSON.stringify(manifest))),ref=ing?.artifact_ref||null;
  let md=null,sd=null;try{md=await saveText(JSON.stringify(manifest,null,2),"application/json",`${folder}/manifest.json`)}catch{};try{sd=await saveText(csv(manifest),"text/csv;charset=utf-8",`${folder}/summary.csv`)}catch{};
  const abs=(items.find(x=>x.human_file?.absolute_path)?.human_file?.absolute_path||md?.absolute_path||sd?.absolute_path||"").replace(/[\\/][^\\/]+$/,"");
  const view={ok:true,schema:"sokna-browser-human-job-view-v1",job_id:id,folder,absolute_folder:abs,file_count:items.filter(x=>x.human_file).length,manifest:md,summary:sd};
  if(ref?.id)VIEW_CACHE.set(String(ref.id).toLowerCase(),view);
  const result={ok:true,schema:RESULT_SCHEMA,capture_id:id,map_preset:mapName,map_source:mapSource,map_artifact_ref:mapRef||undefined,resumed:false,origin,workers:cfg.workers,requested:entries.length,attempted:items.length,captured,failed,state_unreached:stateUnreached,no_data:noData,collection_ref:ref,job_view:view};
  runs[id]={state:"completed",result,updated_at:Date.now()};await chrome.storage.local.set({[STORE]:runs});return result;
}
const base=browserSemanticAction;
browserSemanticAction=async function(command,conversationKey){const p=command?.params||{};if(String(command?.action||"")===ACTION&&(p.map_preset||p.map_artifact_ref))return await runMap(command,conversationKey,p);return await base(command,conversationKey)};
globalThis.__SOKNA_BROWSER_CAPTURE_MAP_RUNTIME_V1__=Object.freeze({schema:"sokna-browser-capture-map-runtime-v1",version:1,preset:"local18080-ui-audit-v1",states:MAPS.get("local18080-ui-audit-v1")?.length||0,max_workers:5,supports_artifact_map:true});
})();
