(()=>{
"use strict";
if(globalThis.__SOKNA_BROWSER_SITE_CAPTURE_V1__)return;
const CORE=globalThis.__SOKNA_BROWSER_SITE_CAPTURE_CORE_V1__;
if(!CORE)throw new Error("BROWSER_SITE_CAPTURE_CORE_UNAVAILABLE");
if(typeof browserSemanticAction!=="function"||typeof ingestExtensionArtifact!=="function")throw new Error("BROWSER_SITE_CAPTURE_RUNTIME_UNAVAILABLE");
const ACTION="browser.capture.batch";
const SITE_PROGRESS_SCHEMA="sokna-browser-site-capture-progress-v1";
const SITE_RESULT_SCHEMA="sokna-browser-site-capture-result-v1";
const SITE_COLLECTION_SCHEMA="sokna-browser-capture-collection-v1";
const JOB_VIEW_CACHE=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function siteMode(p={}){return !Array.isArray(p.items)&&(p.site_capture===true||!!p.start_url||Array.isArray(p.urls)||!!p.source_collection_id||p.discover===true||p.workers!==undefined)}
function err(code,message,extra={}){return Object.assign(new Error(String(message||code)),{code,...extra})}
function u8FromB64(s){const bin=atob(String(s||"")),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return u8}
function b64FromU8(bytes){let out="";const chunk=0x6000;for(let i=0;i<bytes.length;i+=chunk){const end=Math.min(bytes.length,i+chunk);let s="";for(let j=i;j<end;j++)s+=String.fromCharCode(bytes[j]);out+=btoa(s)}return out}
function utf8B64(text){const bytes=new TextEncoder().encode(String(text||""));return b64FromU8(bytes)}
function decodeUtf8B64(s){return new TextDecoder().decode(u8FromB64(s))}
async function readOutboundBytes(id){
  id=String(id||"").trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(id))throw err("ARTIFACT_COLLECTION_ID_INVALID","A SHA-256 artifact id is required.");
  const info=await agentExec(unifiedLocalCommand("artifact.out.info",{id})),ref=info?.artifact_ref||{},bytes=Number(ref.bytes);
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>256*1024*1024)throw err("ARTIFACT_READ_SIZE_INVALID","Artifact size is outside the browser materialization limit.");
  const chunks=[];let offset=0,total=0;
  while(offset<bytes){
    const part=await agentExec(unifiedLocalCommand("artifact.out.get",{id,offset,limit:524288}));
    const next=Number(part?.next_offset),data=String(part?.data_b64||"");if(!data||!Number.isSafeInteger(next)||next<=offset||next>bytes)throw err("ARTIFACT_READ_CHUNK_INVALID","Artifact chunk is invalid.");
    const u8=u8FromB64(data);chunks.push(u8);total+=u8.byteLength;offset=next;
  }
  const all=new Uint8Array(total);let pos=0;for(const c of chunks){all.set(c,pos);pos+=c.byteLength}
  return {bytes:all,ref};
}
async function readJsonArtifact(id){const x=await readOutboundBytes(id);let value;try{value=JSON.parse(new TextDecoder().decode(x.bytes))}catch{throw err("ARTIFACT_COLLECTION_JSON_INVALID","Artifact JSON is invalid.")};return {value,ref:x.ref}}
function artifactExt(ref={}){const t=String(ref.content_type||"").toLowerCase(),n=String(ref.name||"");const m=n.match(/(\.[A-Za-z0-9]{1,8})$/);if(m)return m[1].toLowerCase();if(t==="image/png")return".png";if(t==="image/jpeg")return".jpg";if(t==="image/webp")return".webp";if(t==="application/json")return".json";return".bin"}
function materializedName(item,index,ref){const raw=String(item?.requested_url||item?.source_href||item?.url||"");return CORE.urlSlug(raw,index+1)+artifactExt(ref)}
async function downloadDataUrl(dataUrl,filename){
  const id=await chrome.downloads.download({url:dataUrl,filename,saveAs:false,conflictAction:"overwrite"});
  let absolute="";try{const rows=await chrome.downloads.search({id});absolute=String(rows?.[0]?.filename||"")}catch{}
  return {download_id:id,filename,absolute_path:absolute};
}
async function downloadBytes(bytes,contentType,filename){return await downloadDataUrl(`data:${contentType||"application/octet-stream"};base64,${b64FromU8(bytes)}`,filename)}
async function downloadText(text,contentType,filename){return await downloadDataUrl(`data:${contentType};base64,${utf8B64(text)}`,filename)}
async function materializeCollection(manifest){
  if(!CORE.recognizedCollection(manifest))return null;
  const folder=CORE.jobFolder(manifest),files=[],errors=[];
  for(let i=0;i<manifest.items.length;i++){
    const item=manifest.items[i]||{},ref=item.artifact_ref||{};if(!/^[a-fA-F0-9]{64}$/.test(String(ref.id||"")))continue;
    const name=materializedName(item,i,ref),dest=`${folder}/${name}`;
    try{const x=await readOutboundBytes(ref.id),d=await downloadBytes(x.bytes,String(ref.content_type||x.ref?.content_type||"application/octet-stream"),dest);files.push({...d,artifact_id:String(ref.id),index:i})}
    catch(e){errors.push({index:i,artifact_id:String(ref.id||""),error:String(e?.message||e)})}
  }
  let manifestDownload=null,csvDownload=null;
  try{manifestDownload=await downloadText(JSON.stringify(manifest,null,2),"application/json",`${folder}/manifest.json`)}catch(e){errors.push({file:"manifest.json",error:String(e?.message||e)})}
  try{csvDownload=await downloadText(CORE.collectionCsv(manifest),"text/csv;charset=utf-8",`${folder}/summary.csv`)}catch(e){errors.push({file:"summary.csv",error:String(e?.message||e)})}
  const anyAbs=files.find(x=>x.absolute_path)?.absolute_path||manifestDownload?.absolute_path||csvDownload?.absolute_path||"";
  const absoluteFolder=anyAbs?anyAbs.replace(/[\\/][^\\/]+$/,""):"";
  return {ok:errors.length===0,schema:"sokna-browser-human-job-view-v1",job_id:CORE.collectionJobId(manifest),folder,absolute_folder:absoluteFolder,file_count:files.length,files,manifest:manifestDownload,summary:csvDownload,errors};
}
const baseIngestExtensionArtifact=ingestExtensionArtifact;
ingestExtensionArtifact=async function(name,contentType,dataB64){
  const out=await baseIngestExtensionArtifact(name,contentType,dataB64);
  if(String(contentType||"").toLowerCase()==="application/json"){
    try{
      const manifest=JSON.parse(decodeUtf8B64(dataB64));
      if(CORE.recognizedCollection(manifest)){
        const view=await materializeCollection(manifest),id=String(out?.artifact_ref?.id||"");if(id&&view)JOB_VIEW_CACHE.set(id,view);
        return {...out,job_view:view};
      }
    }catch(e){return {...out,job_view:{ok:false,error:String(e?.message||e)}}}
  }
  return out;
};
async function compatibleCollectionGet(params={}){
  const id=String(params?.id||"").trim().toLowerCase(),x=await readJsonArtifact(id),manifest=x.value;
  if(!CORE.recognizedCollection(manifest))throw err("ARTIFACT_COLLECTION_SCHEMA_INVALID","Unsupported artifact collection schema.");
  const offset=Math.max(0,Number(params?.offset)||0),limit=Math.max(1,Math.min(20,Number(params?.limit)||10)),total=manifest.items.length,page=manifest.items.slice(offset,offset+limit);
  const isTask=manifest.schema==="sokna-browser-task-collection-v1",captured=Number(manifest.captured??manifest.count??manifest.items.filter(v=>v?.artifact_ref?.id).length),failed=Number(manifest.failed??Math.max(0,total-captured));
  return {ok:true,schema:manifest.schema,collection_ref:x.ref,summary:{requested:Number(manifest.requested??manifest.count??total),attempted:Number(manifest.attempted??manifest.count??total),captured,failed,created_at:Number(manifest.created_at||0),claimed_origin:String(manifest.claimed_origin||""),task_id:String(manifest.task_id||""),capture_id:String(manifest.capture_id||"")},offset,limit,total,has_more:offset+page.length<total,items:page,job_view:JOB_VIEW_CACHE.get(id)||null,legacy_task_schema:isTask};
}
if(typeof artifactCollectionGet==="function"){
  const baseArtifactCollectionGet=artifactCollectionGet;
  artifactCollectionGet=async function(params={}){try{const r=await baseArtifactCollectionGet(params);return {...r,job_view:JOB_VIEW_CACHE.get(String(params?.id||"").toLowerCase())||r?.job_view||null}}catch(e){if(String(e?.code||"")!=="ARTIFACT_COLLECTION_SCHEMA_INVALID"&&!/Unsupported artifact collection schema/i.test(String(e?.message||e)))throw e;return await compatibleCollectionGet(params)}};
}
function patchContract(){
  const base=globalThis.__SOKNA_ACTION_CONTRACTS_V1__;if(!base)return;
  const old=base.describe?.(ACTION)||{},D="https://json-schema.org/draft/2020-12/schema",B={type:"boolean"};
  const siteProps={
    capture_id:{type:"string",pattern:"^[A-Za-z0-9._-]{1,96}$"},site_capture:B,start_url:{type:"string",minLength:1},urls:{type:"array",minItems:1,maxItems:100,items:{type:"string",minLength:1}},source_collection_id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},discover:B,max_pages:{type:"integer",minimum:1,maximum:500},workers:{type:"integer",minimum:1,maximum:5},full_page:B,settle_ms:{type:"integer",minimum:0,maximum:10000},timeout_ms:{type:"integer",minimum:1000,maximum:60000},continue_on_error:B,include_query:B,allow_session_mutating:B,job_label:{type:"string",maxLength:120},
    items:old?.inputSchema?.properties?.items||{type:"array",minItems:1,maxItems:100,items:{type:"object"}},stop_on_error:B
  };
  const contract=Object.freeze({...old,name:ACTION,description:"Capture a bounded page list or an entire approved same-origin site in one local job. Site mode discovers links or consumes supplied URLs, uses 1..5 reusable worker tabs, captures full-page evidence including synthetic error evidence, continues on page failures by default, and materializes a human-readable job folder while retaining content-addressed artifacts.",inputSchema:{$schema:D,type:"object",additionalProperties:false,required:["capture_id"],anyOf:[{required:["items"]},{required:["start_url"]},{required:["urls"]},{required:["source_collection_id"]}],properties:siteProps},_meta:{...(old._meta||{}),"sokna/idempotency":"id_guarded","sokna/errors":[...new Set([...(old._meta?.["sokna/errors"]||[]),"BROWSER_SITE_ORIGIN_PERMISSION_REQUIRED","BROWSER_SITE_PLAN_MISMATCH","BROWSER_SITE_NO_URLS"])]}});
  const contracts=Object.freeze({...base.contracts,[ACTION]:Object.freeze({...contract,name:undefined})});
  function describe(name){name=String(name||"");if(name===ACTION)return contract;return base.describe(name)}
  function list(effective=[]){const names=[...new Set((effective||[]).map(String).filter(Boolean))].sort();return names.map(name=>{const t=describe(name);return {name,action:name,contracted:!!t,owner:t?._meta?.["sokna/owner"]||"legacy",read_only:t?.annotations?.readOnlyHint??null,idempotent:t?.annotations?.idempotentHint??null}})}
  function tools(effective=[]){return list(effective).filter(x=>x.contracted).map(x=>describe(x.name))}
  globalThis.__SOKNA_ACTION_CONTRACTS_V1__=Object.freeze({...base,version:Math.max(5,Number(base.version)||0),contracts,describe,list,tools});
}
patchContract();
async function waitTabCompleteSafe(tabId,timeoutMs){
  const deadline=Date.now()+timeoutMs;let last=null;
  while(Date.now()<deadline){try{last=await chrome.tabs.get(tabId);if(String(last?.status||"")==="complete")return last}catch(e){throw err("BROWSER_TAB_MISSING",String(e))}await sleep(150)}
  throw err("BROWSER_NAVIGATION_TIMEOUT","Timed out waiting for page navigation.",{tab_id:tabId,last_url:String(last?.url||"")});
}
async function captureRawTab(tabId,fullPage=true){
  const target={tabId:Number(tabId)};let attached=false;
  try{
    await debugAttach(target);attached=true;await debugSend(target,"Page.enable",{});
    const metrics=await debugSend(target,"Page.getLayoutMetrics",{}),box=fullPage?(metrics.cssContentSize||metrics.contentSize||{}):(metrics.cssVisualViewport||metrics.visualViewport||{});
    const x=fullPage?0:Number(box.pageX)||0,y=fullPage?0:Number(box.pageY)||0,width=fullPage?Number(box.width):Number(box.clientWidth||box.width),height=fullPage?Number(box.height):Number(box.clientHeight||box.height);
    if(!(width>0&&height>0))throw err("BROWSER_CAPTURE_GEOMETRY_INVALID","Screenshot geometry is empty.");
    if(width>16384||height>16384||width*height>250000000)throw err("BROWSER_CAPTURE_TOO_LARGE","Screenshot dimensions exceed safety limits.",{width,height});
    const shot=await debugSend(target,"Page.captureScreenshot",{format:"png",clip:{x:Math.max(0,x),y:Math.max(0,y),width,height,scale:1},captureBeyondViewport:true});if(!shot?.data)throw err("BROWSER_CAPTURE_EMPTY","CDP returned an empty screenshot.");return {data_b64:String(shot.data),width,height}
  }finally{if(attached)await debugDetach(target)}
}
async function syntheticEvidence(tabId,requestedUrl,errorText,fullPage){
  const u=chrome.runtime.getURL("browser_capture_error.html")+"?url="+encodeURIComponent(String(requestedUrl||""))+"&error="+encodeURIComponent(String(errorText||"Capture failed"));
  await chrome.tabs.update(tabId,{url:u});await waitTabCompleteSafe(tabId,10000);await sleep(80);return await captureRawTab(tabId,fullPage)
}
async function discoverLinks(tabId,origin,includeQuery){
  const rows=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:(wantedOrigin,keepQuery)=>{
    const out=[],seen=new Set();for(const a of document.querySelectorAll("a[href]")){try{const u=new URL(a.href,location.href);if(!["http:","https:"].includes(u.protocol)||u.origin.toLowerCase()!==wantedOrigin.toLowerCase())continue;u.hash="";if(!keepQuery)u.search="";const s=u.href;if(!seen.has(s)){seen.add(s);out.push(s)}}catch{}}
    return {url:location.href,title:document.title,links:out};
  },args:[origin,includeQuery===true]});
  return rows?.[0]?.result||{url:"",title:"",links:[]};
}
async function urlsFromSourceArtifact(id){
  if(!id)return[];const x=await readJsonArtifact(id),v=x.value;
  if(Array.isArray(v))return v.map(String);
  if(Array.isArray(v?.urls))return v.urls.map(String);
  if(Array.isArray(v?.items))return v.items.map(x=>String(x?.requested_url||x?.source_href||x?.url||x?.final_url||"")).filter(Boolean);
  throw err("BROWSER_SITE_URL_SOURCE_INVALID","source_collection_id must contain a JSON array, {urls:[...]}, or collection items with URLs.")
}
async function captureSite(command,conversationKey,p={}){
  const captureId=String(p.capture_id||"").trim();if(!CORE.SAFE_ID.test(captureId))throw err("BROWSER_CAPTURE_ID_INVALID","capture_id must be a safe id.");
  const cfg=CORE.compactConfig(p),sourceUrls=[...(Array.isArray(p.urls)?p.urls:[]),...(await urlsFromSourceArtifact(String(p.source_collection_id||"")))].map(String).filter(Boolean);
  let seed=String(p.start_url||sourceUrls[0]||"").trim();
  if(!seed){try{seed=String((await claimedBrowserTarget(conversationKey)).tab.url||"")}catch{}}
  const origin=BROWSER_TARGET.normalizeOrigin(seed);if(!origin)throw err("BROWSER_SITE_NO_URLS","start_url, urls, source_collection_id, or a claimed browser target is required.");
  const pattern=BROWSER_TARGET.originPattern(origin),approved=await approvedBrowserOrigins(),permitted=await chrome.permissions.contains({origins:[pattern]});
  if(!approved.includes(origin)||!permitted)throw err("BROWSER_SITE_ORIGIN_PERMISSION_REQUIRED","Approve the site origin from the Bridge popup before capture.",{origin});
  const normalized=[];const pushNorm=raw=>{const u=CORE.normalizeUrl(raw,seed,origin,{includeQuery:cfg.include_query});if(u&&!normalized.includes(u))normalized.push(u)};pushNorm(seed);for(const u of sourceUrls)pushNorm(u);
  if(!normalized.length)throw err("BROWSER_SITE_NO_URLS","No valid same-origin URLs were supplied.");
  const discover=p.discover!==undefined?cfg.discover:sourceUrls.length===0;
  const plan={capture_id:captureId,origin,seed,source_collection_id:String(p.source_collection_id||""),urls:normalized,discover,max_pages:cfg.max_pages,workers:cfg.workers,full_page:cfg.full_page,settle_ms:cfg.settle_ms,timeout_ms:cfg.timeout_ms,continue_on_error:cfg.continue_on_error,include_query:cfg.include_query,allow_session_mutating:cfg.allow_session_mutating};
  const planSha=await sha256Text(JSON.stringify(plan)),all=await captureProgressAll(),old=all[captureId];
  if(old&&String(old.plan_sha256||"")!==planSha)throw err("BROWSER_SITE_PLAN_MISMATCH","capture_id already belongs to a different site-capture plan.");
  if(old?.collection_ref?.id){return {ok:true,schema:SITE_RESULT_SCHEMA,capture_id:captureId,resumed:true,origin,workers:Number(old.workers||cfg.workers),requested:Number(old.requested||0),attempted:Number(old.attempted||0),captured:Number(old.captured||0),page_errors:Number(old.page_errors||0),collection_ref:old.collection_ref,job_view:old.job_view||JOB_VIEW_CACHE.get(String(old.collection_ref.id))||null}}
  const queue=[],seen=new Set();
  const restored=Array.isArray(old?.discovered_urls)?old.discovered_urls:[];for(const u of [...restored,...normalized]){const n=CORE.normalizeUrl(u,seed,origin,{includeQuery:cfg.include_query});if(n&&!seen.has(n)&&queue.length<cfg.max_pages){seen.add(n);queue.push({index:queue.length,url:n})}}
  const records=Array.isArray(old?.items)?old.items.slice():[],startedAt=Number(old?.started_at||Date.now());let cursor=0,active=0,aborted=false;
  const persist=async state=>{const attempted=records.filter(Boolean).length,captured=records.filter(x=>x?.artifact_ref?.id).length,pageErrors=records.filter(x=>x&&x.ok===false).length;all[captureId]={schema:SITE_PROGRESS_SCHEMA,capture_id:captureId,plan_sha256:planSha,origin,started_at:startedAt,updated_at:Date.now(),workers:cfg.workers,requested:queue.length,discovered_urls:queue.map(x=>x.url),items:records,attempted,captured,page_errors:pageErrors,state};await saveCaptureProgress(all)};
  await persist("running");
  function enqueue(raw,base){if(queue.length>=cfg.max_pages)return false;const n=CORE.normalizeUrl(raw,base||seed,origin,{includeQuery:cfg.include_query});if(!n||seen.has(n))return false;seen.add(n);queue.push({index:queue.length,url:n});return true}
  async function processOne(tabId,item){
    const requestedUrl=item.url,index=item.index,started=Date.now(),unsafe=CORE.isSessionMutatingUrl(requestedUrl)&&!cfg.allow_session_mutating;
    let tab=null,finalUrl=requestedUrl,title="",shot=null,errorText="",code="",synthetic=false,status="ok",discovered=[];
    try{
      if(unsafe){status="unsafe-synthetic";synthetic=true;errorText="Navigation was not executed because the URL appears to mutate the authenticated session (for example logout/delete).";shot=await syntheticEvidence(tabId,requestedUrl,errorText,cfg.full_page)}
      else{
        await chrome.tabs.update(tabId,{url:requestedUrl});tab=await waitTabCompleteSafe(tabId,cfg.timeout_ms);if(cfg.settle_ms)await sleep(cfg.settle_ms);tab=await chrome.tabs.get(tabId);finalUrl=String(tab.url||requestedUrl);title=String(tab.title||"");
        const restricted=/^(chrome-error|chrome|edge|about|data|file):/i.test(finalUrl);if(restricted&&finalUrl!==requestedUrl){status="navigation-error";errorText=`Browser landed on restricted/error URL: ${finalUrl}`}
        try{shot=await captureRawTab(tabId,cfg.full_page)}catch(e){status="capture-error";code=String(e?.code||"BROWSER_CAPTURE_FAILED");errorText=String(e?.message||e);synthetic=true;shot=await syntheticEvidence(tabId,requestedUrl,errorText,cfg.full_page)}
        if(discover&&status==="ok"&&BROWSER_TARGET.normalizeOrigin(finalUrl)===origin){try{const d=await discoverLinks(tabId,origin,cfg.include_query);title=String(d.title||title);finalUrl=String(d.url||finalUrl);discovered=Array.isArray(d.links)?d.links:[]}catch(e){if(!errorText)errorText="Link discovery warning: "+String(e?.message||e)}}
        if(status==="ok"&&finalUrl!==requestedUrl)status="redirected";
      }
    }catch(e){status="navigation-error";code=String(e?.code||"BROWSER_NAVIGATION_FAILED");errorText=String(e?.message||e);try{tab=await chrome.tabs.get(tabId);finalUrl=String(tab?.url||requestedUrl);title=String(tab?.title||"")}catch{};try{synthetic=true;shot=await syntheticEvidence(tabId,requestedUrl,errorText,cfg.full_page)}catch(se){errorText+=(errorText?" | ":"")+"Synthetic evidence failed: "+String(se?.message||se);shot=null}}
    let artifactRef=null;
    if(shot?.data_b64){const name=CORE.urlSlug(requestedUrl,index+1)+(synthetic?"-error":"")+".png",ing=await ingestExtensionArtifact(name,"image/png",shot.data_b64);artifactRef=ing?.artifact_ref||null}
    for(const u of discovered)enqueue(u,finalUrl||requestedUrl);
    const ok=status==="ok"||status==="redirected";
    return {index,id:String(index+1).padStart(3,"0"),state:artifactRef?"succeeded":"failed",ok,status,requested_url:requestedUrl,url:finalUrl||requestedUrl,final_url:finalUrl||requestedUrl,title,capture:cfg.full_page?"full_page":"viewport",synthetic_error_page:synthetic,session_mutation_blocked:unsafe,started_at:started,completed_at:Date.now(),code,error:errorText,artifact_ref:artifactRef||undefined};
  }
  const workerCount=Math.max(1,Math.min(5,cfg.workers));
  const tabs=[];try{for(let i=0;i<workerCount;i++){const t=await chrome.tabs.create({url:"about:blank",active:false});if(!Number.isInteger(t?.id))throw err("BROWSER_TAB_OPEN_FAILED","Chrome did not return a worker tab id.");tabs.push(t.id)}
    async function worker(tabId){for(;;){if(aborted)return;if(cursor>=queue.length){if(active===0)return;await sleep(80);continue}const item=queue[cursor++];if(records[item.index]&&["succeeded","failed"].includes(String(records[item.index].state||"")))continue;active++;try{records[item.index]=await processOne(tabId,item);if(records[item.index]?.ok===false&&!cfg.continue_on_error)aborted=true;await persist("running")}finally{active--}}}
    await Promise.all(tabs.map(worker));
  }finally{await Promise.all(tabs.map(id=>chrome.tabs.remove(id).catch(()=>{})))}
  const attempted=records.filter(Boolean).length,captured=records.filter(x=>x?.artifact_ref?.id).length,pageErrors=records.filter(x=>x&&x.ok===false).length;
  const manifest={schema:SITE_COLLECTION_SCHEMA,version:3,kind:"site-capture",capture_id:captureId,command_id:String(command.id||""),conversation_key:String(conversationKey||""),claimed_origin:origin,created_at:Date.now(),started_at:startedAt,requested:queue.length,attempted,captured,failed:pageErrors,stopped_early:aborted,workers:workerCount,discover,max_pages:cfg.max_pages,full_page:cfg.full_page,job_label:String(p.job_label||""),items:records.filter(Boolean)};
  const ingested=await ingestExtensionArtifact(("browser-site-collection-"+captureId+".json").slice(0,170),"application/json",utf8B64(JSON.stringify(manifest))),collectionRef=ingested?.artifact_ref||null,view=ingested?.job_view||null;
  all[captureId]={...(all[captureId]||{}),updated_at:Date.now(),state:"completed",attempted,captured,page_errors:pageErrors,requested:queue.length,items:records,discovered_urls:queue.map(x=>x.url),collection_ref:collectionRef,job_view:view};await saveCaptureProgress(all);
  return {ok:true,schema:SITE_RESULT_SCHEMA,capture_id:captureId,resumed:!!old,origin,workers:workerCount,requested:queue.length,attempted,captured,page_errors:pageErrors,stopped_early:aborted,collection_ref:collectionRef,job_view:view};
}
const baseBrowserSemanticAction=browserSemanticAction;
browserSemanticAction=async function(command,conversationKey){
  const action=String(command?.action||""),p=command?.params||{};
  if(action==="browser.tab.open"){
    const url=String(p.url||""),origin=BROWSER_TARGET.normalizeOrigin(url);if(!origin)throw err("BROWSER_URL_INVALID","HTTP/HTTPS url required.");
    const approved=await approvedBrowserOrigins(),pattern=BROWSER_TARGET.originPattern(origin);if(!approved.includes(origin)||!await chrome.permissions.contains({origins:[pattern]}))throw err("BROWSER_ORIGIN_PERMISSION_REQUIRED","Approve this Browser origin from the popup first.");
    const tab=await chrome.tabs.create({url,active:false});if(!Number.isInteger(tab?.id))throw err("BROWSER_TAB_OPEN_FAILED","Chrome did not return a tab id.");
    await waitTabCompleteSafe(tab.id,30000);
    const autoClaim=p.claim!==false,target=autoClaim?await claimBrowserTab(conversationKey,tab.id):null;return {ok:true,opened:tab.id,url,claimed:autoClaim,target};
  }
  if(action===ACTION&&siteMode(p))return await captureSite(command,conversationKey,p);
  const r=await baseBrowserSemanticAction(command,conversationKey),id=String(r?.collection_ref?.id||"");return id&&JOB_VIEW_CACHE.has(id)?{...r,job_view:JOB_VIEW_CACHE.get(id)}:r;
};
if(typeof extensionBootstrap==="function"){
  const baseExtensionBootstrap=extensionBootstrap;
  extensionBootstrap=async function(command,tabId=null){const r=await baseExtensionBootstrap(command,tabId),policy=r?.extension_policy||{},delivery=policy.delivery||{};return {...r,extension_policy:{...policy,delivery:{...delivery,ack_contract:"user-message-shell-or-exact-envelope-type+id-v4",body_fallback_positive_ack:true,uncertain_auto_resubmit:false},browser_site_capture:{schema:"sokna-browser-site-capture-policy-v1",max_workers:5,max_pages:500,full_page:true,error_evidence:"synthetic-fallback",human_job_view:"Downloads/SOKNA-Bridge/Jobs"}}}}
}
globalThis.__SOKNA_BROWSER_SITE_CAPTURE_V1__=Object.freeze({schema:"sokna-browser-site-capture-v1",version:1,action:ACTION,max_workers:5,max_pages:500});
})();
