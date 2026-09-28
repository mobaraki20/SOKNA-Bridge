importScripts("protocol.js","agent_job_core.js","chat_artifact_core.js");
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const JOBCORE=globalThis.__SOKNA_AGENT_JOB_CORE_V1__;
const CHATART=globalThis.__SOKNA_CHAT_ARTIFACT_CORE_V1__;
const HOST="com.sokna.bridge.v3";
const VERSION="3.11.0";
const VALID_COMMAND_ID=/^[A-Za-z0-9._-]{1,96}$/;
const ARMED_KEY="armed_tabs_v3";
const SEEN_KEY="seen_commands_v3";
const STATUS_KEY="status_v3";
const MAX_SEEN=1500;
const RETRY_ALARM="sokna-v3100-pending";
const RETRY_TAB_PREFIX="sokna-v3100-pending-tab:";
const JOB_WATCH_KEY="job_watches_v1";
const JOB_WATCH_DIAG_KEY="job_watch_diag_v1";
const JOB_ALARM_PREFIX="sokna-v3105-job:";
const JOB_MAX_AGE_MS=2*60*60*1000;
const CHAT_TRANSFER_KEY="chat_artifact_transfers_v1";
const CHAT_TRANSFER_DIAG_KEY="chat_artifact_transfer_diag_v1";
const CHAT_TRANSFER_ALARM="sokna-v3109-chat-transfer";
const CHAT_TRANSFER_MAX_AGE_MS=30*60*1000;
const IG_SCANS_KEY="instagram_scans_v1";
const IG_MAX_SCANS=8;
const IG_SCAN_MAX_POSTS=100;
const V391_MIGRATION_CUTOFF=1789892342550;
const RETRY_BASE_MS=3000,RETRY_MAX_MS=60000,MAX_POST_ATTEMPTS=8;

const now=()=>Date.now();
const uid=()=>crypto.randomUUID?.()||(`v3-${Date.now()}-${Math.random().toString(16).slice(2)}`);
async function sget(area,keys){return await chrome.storage[area].get(keys)}
async function sset(area,obj){await chrome.storage[area].set(obj)}
async function armedAll(){const d=await sget("session",[ARMED_KEY]);return d[ARMED_KEY]||{}}
async function saveArmed(v){await sset("session",{[ARMED_KEY]:v})}
async function seenAll(){const d=await sget("local",[SEEN_KEY]);return d[SEEN_KEY]||{}}
async function saveSeen(v){
  const e=Object.entries(v);if(e.length>MAX_SEEN){e.sort((a,b)=>(a[1]?.ts||0)-(b[1]?.ts||0));v=Object.fromEntries(e.slice(e.length-MAX_SEEN))}
  await sset("local",{[SEEN_KEY]:v});
}
async function suppressLegacyPending(){
  const seen=await seenAll();let changed=false;
  for(const r of Object.values(seen)){
    const t=r?.acceptedAt||r?.ts||0;
    if(r?.state==="done"&&!r?.posted&&!r?.suppressed&&t&&t<V391_MIGRATION_CUTOFF){
      r.suppressed=true;r.suppressReason="pre-v391-pending";changed=true;
    }
  }
  if(changed)await saveSeen(seen);
}async function statusAll(){const d=await sget("session",[STATUS_KEY]);return d[STATUS_KEY]||{}}
async function getStatus(tabId){const a=await statusAll();return a[String(tabId)]||null}
async function setStatus(tabId,patch){
  const a=await statusAll(),prev=a[String(tabId)]||{};
  const next={version:VERSION,state:"Ready",detail:"",actionRequired:false,etaMs:null,etaConfidence:"unknown",...prev,...patch,lastActivityAt:now()};
  a[String(tabId)]=next;await sset("session",{[STATUS_KEY]:a});await paint(tabId,next);return next;
}
async function clearStatus(tabId){const a=await statusAll();delete a[String(tabId)];await sset("session",{[STATUS_KEY]:a})}
async function jobWatchesAll(){const d=await sget("local",[JOB_WATCH_KEY]);return d[JOB_WATCH_KEY]||{}}
async function saveJobWatches(v){await sset("local",{[JOB_WATCH_KEY]:v})}
async function jobWatchDiag(){const d=await sget("local",[JOB_WATCH_DIAG_KEY]);return d[JOB_WATCH_DIAG_KEY]||{}}
async function saveJobWatchDiag(patch){const prev=await jobWatchDiag();const next={...prev,...patch};await sset("local",{[JOB_WATCH_DIAG_KEY]:next});return next}
async function chatTransfersAll(){const d=await sget("local",[CHAT_TRANSFER_KEY]);return d[CHAT_TRANSFER_KEY]||{}}
async function saveChatTransfers(v){await sset("local",{[CHAT_TRANSFER_KEY]:v})}
async function chatTransferDiag(){const d=await sget("local",[CHAT_TRANSFER_DIAG_KEY]);return d[CHAT_TRANSFER_DIAG_KEY]||{}}
async function saveChatTransferDiag(patch){const prev=await chatTransferDiag();const next={...prev,...patch};await sset("local",{[CHAT_TRANSFER_DIAG_KEY]:next});return next}
function badgeFor(s){
  if(s==="Working"||s==="Posting")return {t:"RUN",c:"#2563eb"};
  if(s==="Waiting")return {t:"WAIT",c:"#d97706"};
  if(s==="Needs Action")return {t:"!",c:"#d97706"};
  if(s==="Error")return {t:"ERR",c:"#b91c1c"};
  return {t:"ON",c:"#16824f"};
}
async function paint(tabId,st){
  const b=badgeFor(st?.state||"Ready");
  try{await chrome.action.setBadgeText({tabId,text:b.t});await chrome.action.setBadgeBackgroundColor({tabId,color:b.c});await chrome.action.setTitle({tabId,title:`SOKNA Bridge V${VERSION} — ${st?.state||"Ready"}${st?.detail?" — "+st.detail:""}`})}catch{}
}
async function clearBadge(tabId){try{await chrome.action.setBadgeText({tabId,text:""});await chrome.action.setTitle({tabId,title:`SOKNA Bridge V${VERSION} — disabled`})}catch{}}
function conv(url){try{const u=new URL(url);return u.origin+u.pathname}catch{return ""}}
function b64urlUtf8(s){
  const bytes=new TextEncoder().encode(String(s));let bin="";for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function resultEnvelope(obj){return `[SOKNA-V2-RESULT]${JSON.stringify(obj)}[/SOKNA-V2-RESULT]`}
function statusEnvelope(obj){return `[SOKNA-V2-STATUS]${JSON.stringify(obj)}[/SOKNA-V2-STATUS]`}
const lastTransportDiagByTab=new Map();
function nativeMessage(msg){return new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,msg,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}))}
async function hostPing(){return await nativeMessage({type:"host.ping",request_id:uid()})}
async function agentExec(command){
  const r=await nativeMessage({type:"agent.exec",request_id:uid(),command});
  if(!r.ok)throw new Error(r.error||"Native host execution failed");return r.result;
}
async function isArmed(tabId,conversationKey=""){
  const a=await armedAll(),r=a[String(tabId)];return {armed:!!r&&(!conversationKey||r.conversationKey===conversationKey),registered:r||null};
}
const retryAlarmName=tabId=>`${RETRY_TAB_PREFIX}${tabId}`;
async function scheduleRetryAlarm(tabId,whenMs){
  try{await chrome.alarms.create(retryAlarmName(tabId),{when:Math.max(now()+1000,Number(whenMs)||now()+RETRY_BASE_MS)})}catch{}
}
async function clearRetryAlarm(tabId){try{await chrome.alarms.clear(retryAlarmName(tabId))}catch{}}

async function frameList(tabId){
  try{return await chrome.webNavigation.getAllFrames({tabId})||[]}catch{return [{frameId:0,url:""}]}
}
async function messageFrame(tabId,frameId,msg){
  return await chrome.tabs.sendMessage(tabId,msg,{frameId});
}
async function baselineAllFrames(tabId){
  const frames=await frameList(tabId),commands=[],diagnostics=[];
  for(const f of frames){
    try{
      const r=await messageFrame(tabId,f.frameId,{type:"BASELINE"});
      if(r?.ok){
        commands.push(...(r.commands||[]));
        diagnostics.push({frameId:f.frameId,url:f.url||r.frameHref||"",diagnostics:r.diagnostics||{}});
      }
    }catch{}
  }
  const map=new Map();for(const c of commands)if(c?.id)map.set(c.id,c);
  return {ok:true,commands:[...map.values()],frames:diagnostics};
}
async function reconcileAllFrames(tabId){
  const frames=await frameList(tabId);
  for(const f of frames){
    try{
      const rr=await messageFrame(tabId,f.frameId,{type:"RECONCILE"});
      const persisted=await seenAll();
      const fresh=(rr?.commands||[]).filter(c=>c?.id&&!persisted[c.id]);
      for(const c of fresh)await handleCommand(tabId,c);
    }catch{}
  }
}
async function diagAllFrames(tabId){
  const frames=await frameList(tabId),out=[];
  for(const f of frames){
    try{
      const r=await messageFrame(tabId,f.frameId,{type:"DIAG"});
      out.push({frameId:f.frameId,url:f.url||r?.frameHref||"",...r});
    }catch(e){
      out.push({frameId:f.frameId,url:f.url||"",ok:false,error:String(e)});
    }
  }
  return out;
}
function isSupportedChatUrl(url){try{const u=new URL(String(url||""));return u.protocol==="https:"&&(u.hostname==="chatgpt.com"||u.hostname==="gpt.arzanai.com")}catch{return false}}
function unifiedLocalCommand(action,params={}){
  const id=uid();return {protocolVersion:"2",messageId:id,correlationId:id,parentId:"",kind:"command",action,schemaVersion:"2",timestamp:now(),id,params}
}
async function arm(tabId){
  const tab=await chrome.tabs.get(tabId);if(!isSupportedChatUrl(tab?.url))return {ok:false,error:"Open chatgpt.com in this tab first."};
  await setStatus(tabId,{state:"Working",detail:"Creating baseline"});
  let base;try{base=await baselineAllFrames(tabId)}catch(e){return {ok:false,error:"Bridge page adapter is not ready. Reload this chat page once. "+String(e)}}
  if(!base?.ok)return {ok:false,error:base?.error||"Baseline failed"};
  const seen=await seenAll();for(const c of (base.commands||[]))seen[c.id]={state:"baseline",ts:now(),conversationKey:conv(tab.url),action:c.action};await saveSeen(seen);
  const a=await armedAll();for(const [tid,r] of Object.entries(a)){if(Number(tid)!==tabId&&r?.conversationKey===conv(tab.url))return {ok:false,error:"This conversation is already armed in another tab."}}
  a[String(tabId)]={conversationKey:conv(tab.url),url:tab.url,armedAt:now(),baselineCount:(base.commands||[]).length,reconcileReady:true};await saveArmed(a);
  await setStatus(tabId,{state:"Ready",detail:"Armed",baselineCount:(base.commands||[]).length,lastError:"",actionRequired:false});
  retryPending(tabId).catch(()=>{});
  return {ok:true,armed:true,version:VERSION,conversationKey:conv(tab.url),baselineCount:(base.commands||[]).length};
}
async function disarm(tabId){
  try{
    for(const f of await frameList(tabId)){try{await messageFrame(tabId,f.frameId,{type:"STOP"})}catch{}}
  }catch{}
  const a=await armedAll();delete a[String(tabId)];await saveArmed(a);
  await clearRetryAlarm(tabId);await clearStatus(tabId);await clearBadge(tabId);return {ok:true,armed:false}
}

async function connectChat(tabId){
  const tab=await chrome.tabs.get(tabId);if(!isSupportedChatUrl(tab?.url))return {ok:false,error:"Open ChatGPT first."};
  const armed=await arm(tabId);if(!armed?.ok)return armed;
  let boot=await agentExec(unifiedLocalCommand("bridge.bootstrap",{}));
  let session=boot?.active_session||null;
  if(boot?.ready!==true){
    const sid=("chat-"+tabId+"-"+Date.now().toString(36)).slice(0,90);
    const opened=await agentExec(unifiedLocalCommand("session.open",{id:sid,project:"SOKNA Bridge",workspace:"",phase:"connected",summary:"Connected from browser extension"}));
    session=opened?.session||session;
    boot=await agentExec(unifiedLocalCommand("bridge.bootstrap",{}));
  }
  const actions=[
    "bridge.bootstrap","workspace.list","file.read","file.write","process.run","git.status",
    "browser.audit.run","instagram.profile.scan","instagram.scan.search","instagram.scan.get","instagram.media.download"
  ];
  const text=[
    "SOKNA Bridge has been connected to this Chat by the user.",
    "The local Agent and work-session handshake are ready.",
    "When local execution is needed, emit one standalone semantic command block in this exact form:",
    '[SOKNA-INTENT]{"intent":"exec","action":"bridge.bootstrap","params":{}}[/SOKNA-INTENT]',
    "Read the returned bootstrap before mutations and treat it as the source of truth for capabilities, routes, workspaces and session state.",
    "For Instagram research, use instagram.profile.scan, instagram.scan.search, instagram.scan.get and instagram.media.download through the same semantic exec form.",
    "Do not invent local results. Wait for the Bridge result before continuing.",
    "Advertised examples: "+actions.join(", ")+"."
  ].join("\n");
  let posted;
  try{posted=await chrome.tabs.sendMessage(tabId,{type:"POST_USER_TEXT",text},{frameId:0})}
  catch(e){posted={ok:false,error:String(e)}}
  await setStatus(tabId,{state:posted?.ok?"Ready":"Needs Action",detail:posted?.ok?"Connected to ChatGPT":"Connected; bootstrap note could not be posted",lastError:posted?.ok?"":String(posted?.error||""),actionRequired:!posted?.ok});
  return {ok:true,armed:true,connected:true,bootstrap_ready:boot?.ready===true,session_id:String(session?.id||boot?.active_session?.id||""),handshake_posted:!!posted?.ok,handshake:posted};
}

const postFlights=new Map();
async function postPending(tabId,id,rec){
  const key=`${tabId}:${id}`;
  if(postFlights.has(key))return await postFlights.get(key);
  const flight=postPendingInner(tabId,id,rec);
  postFlights.set(key,flight);
  try{return await flight}finally{if(postFlights.get(key)===flight)postFlights.delete(key)}
}
async function postPendingInner(tabId,id,rec){
  const a=await isArmed(tabId);
  let tab=null;try{tab=await chrome.tabs.get(tabId)}catch{}
  if(!a.armed||!tab||conv(tab.url)!==rec.conversationKey){
    return {ok:false,stale:true,error:"Conversation changed; stale result was not posted."};
  }
  if(rec.nextPostAt&&rec.nextPostAt>now()){await scheduleRetryAlarm(tabId,rec.nextPostAt);return {ok:false,waiting:true,reason:"backoff"}};
  const isStatusEvent=rec.kind==="transport-nack"||rec.kind==="status-event";
  const env=isStatusEvent?statusEnvelope({eventId:id,...rec.result}):resultEnvelope({id,...rec.result});
  await setStatus(tabId,{state:"Posting",detail:`Sending ${id}`,currentCommandId:id,actionRequired:false});
  let p;try{p=await chrome.tabs.sendMessage(tabId,{type:"POST_RESULT",envelope:env},{frameId:0})}catch(e){p={ok:false,waiting:true,reason:"page_unavailable",error:String(e)}}
  const seen=await seenAll();
  if(seen[id]){
    const attempts=(seen[id].postAttempts||0)+(p?.ok||p?.reason==="awaiting_conversation_ack"?0:1);
    const delay=p?.reason==="awaiting_conversation_ack"?15000:Math.min(RETRY_MAX_MS,RETRY_BASE_MS*Math.pow(2,Math.max(0,attempts-1)));
    seen[id].posted=seen[id].posted||!!p?.ok;seen[id].postMethod=p?.method||"";seen[id].postError=p?.error||"";
    seen[id].postAttempts=attempts;seen[id].waitReason=p?.reason||"";
    seen[id].postedAt=seen[id].posted?(seen[id].postedAt||now()):0;seen[id].nextPostAt=seen[id].posted?0:(now()+delay);
    await saveSeen(seen);
    rec=seen[id];
    if(rec.posted)await clearRetryAlarm(tabId);else await scheduleRetryAlarm(tabId,rec.nextPostAt);
  }
  if(p?.ok){
    await setStatus(tabId,{state:"Ready",detail:"Armed",...(isStatusEvent?{}:{lastCompletedCommandId:id}),lastPostMethod:p.method||"",currentCommandId:"",lastError:"",actionRequired:false});
    setTimeout(()=>retryPending(tabId).catch(()=>{}),250);
    return {ok:true};
  }
  const exhausted=(rec?.postAttempts||0)>=MAX_POST_ATTEMPTS&&!p?.waiting;
  if(exhausted){
    await setStatus(tabId,{state:"Needs Action",detail:"Queued result needs attention",currentCommandId:id,lastError:p?.error||"Submit failed",actionRequired:true});
  }else{
    await setStatus(tabId,{state:"Waiting",detail:`Queued ${id}: ${p?.reason||"retry"}`,currentCommandId:id,lastError:p?.error||"",actionRequired:false});
    const delay=Math.max(1000,(rec?.nextPostAt||now()+RETRY_BASE_MS)-now());
    setTimeout(()=>retryPending(tabId).catch(()=>{}),delay);
  }
  return {ok:false,waiting:!exhausted,reason:p?.reason||"retry",error:p?.error||"Submit failed"};
}

async function postTransportDiagnostic(tabId,diagnostic){
  const a=await isArmed(tabId);
  if(!a.armed)return {ok:false,ignored:true};

  const last=lastTransportDiagByTab.get(tabId)||0;
  if(now()-last<15000)return {ok:true,throttled:true};
  lastTransportDiagByTab.set(tabId,now());

  const env=statusEnvelope({
    kind:"transport-diagnostic",
    conversationKey:a.registered?.conversationKey||"",
    ts:now(),
    ...diagnostic
  });

  let p;
  try{
    p=await chrome.tabs.sendMessage(tabId,{type:"POST_RESULT",envelope:env},{frameId:0});
  }catch(e){
    p={ok:false,error:String(e)};
  }

  if(p?.ok){
    await setStatus(tabId,{
      state:"Ready",detail:"Armed",lastPostMethod:p.method||"",
      lastError:"",actionRequired:false
    });
    return {ok:true,method:p.method||""};
  }

  await setStatus(tabId,{
    state:"Needs Action",
    detail:"Transport diagnostic could not auto-send",
    lastError:p?.error||"Diagnostic submit failed",
    actionRequired:true
  });
  return {ok:false,error:p?.error||"Diagnostic submit failed"};
}

async function queueStatusEvent(tabId,conversationKey,key,parentCommandId,result){
  const id=`__event__:${key}`;
  let seen=await seenAll();
  if(!seen[id])seen[id]={state:"done",kind:"status-event",ts:now(),acceptedAt:now(),conversationKey:String(conversationKey||""),parentCommandId:String(parentCommandId||""),posted:false,result};
  await saveSeen(seen);
  let delivery={ok:false,reason:"no_tab"};
  if(Number.isInteger(tabId)){try{delivery=await retryPending(tabId)||{ok:false,reason:"no_eligible"}}catch(e){delivery={ok:false,reason:"retry_error",error:String(e)}}}
  return {ok:true,queued:true,id,delivery};
}
const jobAlarmName=id=>`${JOB_ALARM_PREFIX}${id}`;
async function scheduleJobPoll(id,delay=5000){try{await chrome.alarms.create(jobAlarmName(id),{when:now()+Math.max(1000,delay)})}catch{}}
async function registerJobWatch(tabId,parentCommandId,result,conversationKey){
  const jobId=String(result?.job_id||"");if(!jobId)return;
  const watches=await jobWatchesAll();
  if(!watches[jobId])watches[jobId]={jobId,parentCommandId,tabId,conversationKey,createdAt:now(),attempts:0};
  await saveJobWatches(watches);await saveJobWatchDiag({lastRegisteredAt:now(),lastRegisteredJobId:jobId,lastWatchError:""});await scheduleJobPoll(jobId,4000);
}
async function pollJobWatch(jobId){
  const watches=await jobWatchesAll(),w=watches[jobId];if(!w)return;
  await saveJobWatchDiag({lastPollAt:now(),lastPolledJobId:jobId});
  if(now()-Number(w.createdAt||0)>JOB_MAX_AGE_MS){
    const q=await queueStatusEvent(Number(w.tabId),w.conversationKey,`job:${jobId}`,w.parentCommandId,{kind:"job-terminal",commandId:w.parentCommandId,jobId,status:"watch_timeout",ok:false,error:"job watch timed out"});
    delete watches[jobId];await saveJobWatches(watches);await saveJobWatchDiag({lastTerminalAt:now(),lastTerminalJobId:jobId,lastTerminalStatus:"watch_timeout",lastQueueAt:now(),lastQueueOk:!!q?.ok,lastQueueDeliveryOk:!!q?.delivery?.ok,lastWatchError:""});return;
  }
  try{
    const r=await agentExec({id:`job-watch-${now()}-${uid().slice(0,8)}`,action:"job.get",params:{id:jobId}});
    const status=String(r?.job?.status||"");await saveJobWatchDiag({lastPollStatus:status,lastWatchError:""});
    if(JOBCORE.terminalJobStatus(status)){
      const summary=JOBCORE.summarizeJob(r);summary.commandId=w.parentCommandId;
      const q=await queueStatusEvent(Number(w.tabId),w.conversationKey,`job:${jobId}`,w.parentCommandId,summary);
      delete watches[jobId];await saveJobWatches(watches);await saveJobWatchDiag({lastTerminalAt:now(),lastTerminalJobId:jobId,lastTerminalStatus:status,lastQueueAt:now(),lastQueueOk:!!q?.ok,lastQueueDeliveryOk:!!q?.delivery?.ok,lastWatchError:""});return;
    }
    w.attempts=0;watches[jobId]=w;await saveJobWatches(watches);await scheduleJobPoll(jobId,5000);
  }catch(e){
    w.attempts=Number(w.attempts||0)+1;watches[jobId]=w;await saveJobWatches(watches);await saveJobWatchDiag({lastWatchError:String(e),lastWatchErrorAt:now()});
    await scheduleJobPoll(jobId,Math.min(60000,5000*Math.pow(2,Math.min(4,w.attempts))));
  }
}
async function resumeJobWatches(){const watches=await jobWatchesAll();for(const id of Object.keys(watches))await scheduleJobPoll(id,1500)}

const chatTransferFinalizing=new Set();
const chatTransferAlarmName=id=>`${CHAT_TRANSFER_ALARM}:${id}`;
async function scheduleChatTransferPoll(id,delay=2000){try{await chrome.alarms.create(chatTransferAlarmName(id),{when:now()+Math.max(1000,delay)})}catch{}}
async function findChatArtifactWithRetry(tabId,filename,timeoutMs=15000){
  const deadline=now()+timeoutMs;let last={ok:false,reason:"attachment_not_found"};
  while(now()<deadline){
    try{last=await messageFrame(tabId,0,{type:"FIND_CHAT_ARTIFACT",filename});if(last?.ok)return last}catch(e){last={ok:false,reason:"page_unavailable",error:String(e)}}
    await new Promise(r=>setTimeout(r,400));
  }
  return last;
}
function compactArtifactApply(r){
  return {ok:!!r?.ok,artifact_id:String(r?.artifact_id||""),artifact_sha256:String(r?.artifact_sha256||""),payload_sha256:String(r?.payload_sha256||""),base_head:String(r?.base_head||""),branch:String(r?.branch||""),applied:!!r?.applied,files:Array.isArray(r?.files)?r.files.slice(0,80):[]};
}
function chatAgentIs26(ping){return /^2\.6(?:\.|$)/.test(String(ping?.version||ping?.agent||""))}
async function registerChatArtifactApply(tabId,command,conversationKey){
  const p=command?.params||{},filename=String(p.filename||""),sha=CHATART.normalizeSha(p.expected_sha256),workspace=String(p.workspace||"");
  if(!CHATART.safeFilename(filename)||!filename.toLowerCase().endsWith(".zip"))throw new Error("CHAT_ARTIFACT_FILENAME_INVALID");
  if(!sha)throw new Error("CHAT_ARTIFACT_EXPECTED_SHA256_REQUIRED");
  if(!workspace)throw new Error("CHAT_ARTIFACT_WORKSPACE_REQUIRED");
  const found=await findChatArtifactWithRetry(tabId,filename);if(!found?.ok)throw new Error(`CHAT_ARTIFACT_${String(found?.reason||"NOT_FOUND").toUpperCase()}`);
  const transferId=`chat-${command.id}`,transfers=await chatTransfersAll(),clickIssuedAt=now();
  transfers[transferId]={transferId,parentCommandId:command.id,tabId,conversationKey,filename,expectedSha256:sha,workspace,createdAt:clickIssuedAt,clickIssuedAt,status:"starting",artifactId:String(p.artifact_id||"")};
  await saveChatTransfers(transfers);await saveChatTransferDiag({lastRegisteredAt:now(),lastRegisteredTransferId:transferId,lastTransferError:""});
  const clicked=await messageFrame(tabId,0,{type:"CLICK_CHAT_ARTIFACT",filename});
  if(!clicked?.ok){const cur=await chatTransfersAll();delete cur[transferId];await saveChatTransfers(cur);throw new Error(`CHAT_ARTIFACT_CLICK_FAILED:${clicked?.reason||clicked?.error||"unknown"}`)}
  const cur=await chatTransfersAll();if(cur[transferId]){cur[transferId].status="waiting_download";cur[transferId].clickedAt=now();await saveChatTransfers(cur)}await scheduleChatTransferPoll(transferId,1500);
  return {ok:true,status:"queued",transfer_id:transferId,filename,expected_sha256:sha,transport:"chat-page-click+agent-verified"};
}
async function terminalizeChatTransfer(t,ok,error="",apply=null){
  const summary=CHATART.terminalSummary(t,ok,error,apply?compactArtifactApply(apply):null);
  const q=await queueStatusEvent(Number(t.tabId),t.conversationKey,`artifact:${t.transferId}`,t.parentCommandId,summary);
  if(q?.ok){const transfers=await chatTransfersAll();delete transfers[t.transferId];await saveChatTransfers(transfers);try{await chrome.alarms.clear(chatTransferAlarmName(t.transferId))}catch{}}
  await saveChatTransferDiag({lastTerminalAt:now(),lastTerminalTransferId:t.transferId,lastTerminalStatus:ok?"applied":"failed",lastTransferError:String(error||""),lastQueueAt:now(),lastQueueOk:!!q?.ok,lastQueueDeliveryOk:!!q?.delivery?.ok});
  return q;
}
function isWaitingArtifactError(e){const s=String(e||"");return /ARTIFACT_NOT_FOUND|CHAT_ARTIFACT_DOWNLOAD_NOT_READY|SOURCE_NOT_FOUND/i.test(s)}
async function pollChatTransfer(transferId){
  if(chatTransferFinalizing.has(transferId))return;chatTransferFinalizing.add(transferId);
  try{
    const transfers=await chatTransfersAll(),t=transfers[transferId];if(!t)return;
    if(now()-Number(t.createdAt||0)>CHAT_TRANSFER_MAX_AGE_MS){await terminalizeChatTransfer(t,false,"chat artifact transfer timed out");return}
    let artifactPath=String(t.artifactPath||"");
    try{
      if(!artifactPath){
        const ping=await agentExec({id:`chat-ping-${uid().slice(0,12)}`,action:"ping",params:{}});t.agent26=chatAgentIs26(ping);transfers[transferId]=t;await saveChatTransfers(transfers);
        if(t.agent26){
          const imported=await agentExec({id:`chat-import-${uid().slice(0,12)}`,action:"artifact.chat.import.download",params:{workspace:t.workspace,filename:t.filename,expected_sha256:t.expectedSha256,artifact_id:t.artifactId||undefined,cleanup_source:true}});
          artifactPath=String(imported?.path||"");if(!artifactPath)throw new Error("CHAT_ARTIFACT_IMPORT_PATH_MISSING");
          t.artifactPath=artifactPath;t.status="downloaded";transfers[transferId]=t;await saveChatTransfers(transfers);await saveChatTransferDiag({lastCompletedDownloadAt:now(),lastCompletedTransferId:transferId,lastTransferError:""});
        }else{
          const inspect=await agentExec({id:`chat-inspect-${uid().slice(0,12)}`,action:"artifact.inspect",params:{workspace:t.workspace,path:t.filename,expected_sha256:t.expectedSha256}});
          if(!inspect?.ok)throw new Error("CHAT_ARTIFACT_INSPECT_FAILED");artifactPath=t.filename;t.artifactPath=artifactPath;t.status="downloaded";transfers[transferId]=t;await saveChatTransfers(transfers);await saveChatTransferDiag({lastCompletedDownloadAt:now(),lastCompletedTransferId:transferId,lastTransferError:""});
        }
      }else if(typeof t.agent26!=="boolean"){
        const ping=await agentExec({id:`chat-ping-resume-${uid().slice(0,10)}`,action:"ping",params:{}});t.agent26=chatAgentIs26(ping);transfers[transferId]=t;await saveChatTransfers(transfers);
      }
      if(t.agent26){
        const inspect=await agentExec({id:`chat-inspect2-${uid().slice(0,12)}`,action:"artifact.inspect",params:{workspace:t.workspace,path:artifactPath,expected_sha256:t.expectedSha256}});if(!inspect?.ok)throw new Error("CHAT_ARTIFACT_INSPECT_FAILED");
      }
      const apply=await agentExec({id:`chat-apply-${uid().slice(0,12)}`,action:"artifact.apply",params:{workspace:t.workspace,path:artifactPath,expected_sha256:t.expectedSha256}});
      if(!apply?.ok)throw new Error("CHAT_ARTIFACT_APPLY_FAILED");await terminalizeChatTransfer(t,true,"",apply);
    }catch(e){
      if(isWaitingArtifactError(e)){t.status="waiting_download";t.lastWaitAt=now();transfers[transferId]=t;await saveChatTransfers(transfers);await saveChatTransferDiag({lastPollAt:now(),lastPolledTransferId:transferId,lastTransferError:""});await scheduleChatTransferPoll(transferId,2000);return}
      await terminalizeChatTransfer(t,false,String(e));
    }
  }finally{chatTransferFinalizing.delete(transferId)}
}
async function resumeChatTransfers(){const transfers=await chatTransfersAll();for(const id of Object.keys(transfers))await scheduleChatTransferPoll(id,1200)}

async function igScansAll(){const d=await sget("local",[IG_SCANS_KEY]);return d[IG_SCANS_KEY]||{}}
async function saveIgScans(v){await sset("local",{[IG_SCANS_KEY]:v})}
function igProfileUrl(p={}){
  const raw=String(p.url||p.profile_url||"").trim(),user=String(p.username||"").trim().replace(/^@/,"");
  if(raw){
    const u=new URL(raw);if(u.hostname!=="www.instagram.com"&&u.hostname!=="instagram.com")throw new Error("INSTAGRAM_URL_REQUIRED");
    return "https://www.instagram.com"+u.pathname.replace(/\/+$/,"")+"/";
  }
  if(!/^[A-Za-z0-9._]{1,60}$/.test(user))throw new Error("INSTAGRAM_USERNAME_OR_URL_REQUIRED");
  return "https://www.instagram.com/"+user+"/";
}
async function waitTabComplete(tabId,timeoutMs=25000){
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
    const t=await chrome.tabs.get(tabId);if(t?.status==="complete"){await new Promise(r=>setTimeout(r,650));return t}
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error("INSTAGRAM_PAGE_TIMEOUT");
}
async function igTabMessage(tabId,msg,retries=8){
  let last=null;
  for(let i=0;i<retries;i++){
    try{const r=await chrome.tabs.sendMessage(tabId,msg);if(r)return r}catch(e){last=e}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error("INSTAGRAM_ADAPTER_UNAVAILABLE:"+String(last||"no response"));
}
function igPostSummary(p,index){
  const media=Array.isArray(p?.media)?p.media:[];
  return {
    index,url:String(p?.url||""),shortcode:String(p?.shortcode||""),type:String(p?.type||""),
    datetime:String(p?.datetime||""),caption:String(p?.caption||"").slice(0,2200),
    mentions:Array.isArray(p?.mentions)?p.mentions.slice(0,40):[],
    hashtags:Array.isArray(p?.hashtags)?p.hashtags.slice(0,40):[],
    media:media.slice(0,10).map(x=>({type:String(x?.type||""),alt:String(x?.alt||"").slice(0,1200),url:String(x?.url||"")}))
  };
}
async function instagramPostInspect(params={}){
  const url=String(params.url||"").trim();if(!/^https:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(url))throw new Error("INSTAGRAM_POST_URL_REQUIRED");
  const tab=await chrome.tabs.create({url,active:false});
  try{await waitTabComplete(tab.id);const snap=await igTabMessage(tab.id,{type:"IG_POST_SNAPSHOT"});if(!snap?.ok)throw new Error(snap?.error||"INSTAGRAM_POST_INSPECT_FAILED");return igPostSummary(snap,0)}
  finally{try{await chrome.tabs.remove(tab.id)}catch{}}
}
async function instagramProfileScan(params={}){
  const profileUrl=igProfileUrl(params),limit=Math.min(Math.max(Number(params.limit)||10,1),IG_SCAN_MAX_POSTS);
  const tab=await chrome.tabs.create({url:profileUrl,active:false});
  const posts=[];
  try{
    await waitTabComplete(tab.id);
    const links=await igTabMessage(tab.id,{type:"IG_PROFILE_LINKS",limit});
    if(!links?.ok)throw new Error(links?.error||"INSTAGRAM_PROFILE_LINKS_FAILED");
    const cards=Array.isArray(links.cards)?links.cards.slice(0,limit):[];
    for(let i=0;i<cards.length;i++){
      const card=cards[i]||{};
      try{
        await chrome.tabs.update(tab.id,{url:String(card.url||"")});await waitTabComplete(tab.id);
        const snap=await igTabMessage(tab.id,{type:"IG_POST_SNAPSHOT"});
        posts.push({...igPostSummary(snap,i),grid_alt:String(card.alt||"").slice(0,1200),grid_thumbnail:String(card.thumbnail||"")});
      }catch(e){
        posts.push({index:i,url:String(card.url||""),shortcode:String(card.shortcode||""),type:String(card.type||""),datetime:"",caption:"",mentions:[],hashtags:[],media:[],grid_alt:String(card.alt||"").slice(0,1200),grid_thumbnail:String(card.thumbnail||""),error:String(e)});
      }
    }
    const id="ig-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
    const scans=await igScansAll();
    scans[id]={schema:"sokna-instagram-scan-v1",id,profile_url:profileUrl,profile:String(links.profile||""),created_at:Date.now(),post_count:posts.length,posts};
    const ordered=Object.values(scans).sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0));
    const keep=Object.fromEntries(ordered.slice(0,IG_MAX_SCANS).map(x=>[x.id,x]));await saveIgScans(keep);
    return {ok:true,schema:"sokna-instagram-scan-result-v1",scan_id:id,profile:String(links.profile||""),profile_url:profileUrl,requested:limit,post_count:posts.length,stored_locally:true,next:"Use instagram.scan.search or instagram.scan.get"};
  }finally{try{await chrome.tabs.remove(tab.id)}catch{}}
}
async function getIgScan(id){
  const scans=await igScansAll(),scan=scans[String(id||"")];if(!scan)throw new Error("INSTAGRAM_SCAN_NOT_FOUND");return scan
}
function igHay(p){
  const media=(Array.isArray(p.media)?p.media:[]).map(x=>String(x.alt||"")).join("\n");
  return [p.caption,p.visible_text,p.grid_alt,media,(p.mentions||[]).join(" "),(p.hashtags||[]).join(" ")].map(x=>String(x||"")).join("\n").toLocaleLowerCase();
}
async function instagramScanGet(params={}){
  const scan=await getIgScan(params.scan_id),offset=Math.max(Number(params.offset)||0,0),limit=Math.min(Math.max(Number(params.limit)||8,1),15);
  const posts=scan.posts.slice(offset,offset+limit).map((p,i)=>igPostSummary(p,offset+i));
  return {ok:true,scan_id:scan.id,profile:scan.profile,profile_url:scan.profile_url,post_count:scan.post_count,offset,limit,has_more:offset+posts.length<scan.post_count,posts};
}
async function instagramScanSearch(params={}){
  const scan=await getIgScan(params.scan_id),q=String(params.query||"").trim().toLocaleLowerCase();if(!q)throw new Error("INSTAGRAM_SEARCH_QUERY_REQUIRED");
  const terms=q.split(/\s+/).filter(Boolean),limit=Math.min(Math.max(Number(params.limit)||12,1),25),out=[];
  for(const p of scan.posts){
    const hay=igHay(p);if(!terms.every(t=>hay.includes(t)))continue;
    out.push({index:p.index,url:p.url,shortcode:p.shortcode,type:p.type,datetime:p.datetime,caption:String(p.caption||"").slice(0,1400),mentions:p.mentions||[],hashtags:p.hashtags||[],media:(p.media||[]).slice(0,8).map(x=>({type:x.type,alt:String(x.alt||"").slice(0,800)}))});
    if(out.length>=limit)break;
  }
  return {ok:true,scan_id:scan.id,profile:scan.profile,query:q,count:out.length,results:out,search_basis:"caption+visible_text+hashtags+mentions+instagram_alt_text"};
}
function igExt(m){
  try{const p=new URL(String(m?.url||"")).pathname.toLowerCase(),x=p.match(/\.([a-z0-9]{2,5})$/)?.[1];if(x&&["jpg","jpeg","png","webp","mp4","mov"].includes(x))return x==="jpeg"?"jpg":x}catch{}
  return String(m?.type||"")==="video"?"mp4":"jpg"
}
async function instagramMediaDownload(params={}){
  let posts=[];
  if(params.scan_id){
    const scan=await getIgScan(params.scan_id),indexes=Array.isArray(params.indexes)?params.indexes.map(Number):[];
    if(indexes.length)posts=scan.posts.filter(p=>indexes.includes(Number(p.index)));
    else if(Array.isArray(params.post_urls))posts=scan.posts.filter(p=>params.post_urls.includes(p.url));
    else throw new Error("INSTAGRAM_DOWNLOAD_SELECTION_REQUIRED");
  }else if(params.url){posts=[await instagramPostInspect({url:params.url})]}
  else throw new Error("INSTAGRAM_SCAN_OR_POST_REQUIRED");
  const folder=String(params.folder||"SOKNA-Instagram").replace(/[\\:*?"<>|]/g,"_").replace(/^\/+|\/+$/g,"")||"SOKNA-Instagram";
  const downloads=[];
  for(const p of posts.slice(0,30)){
    const media=Array.isArray(p.media)?p.media:[];
    for(let i=0;i<media.length;i++){
      const m=media[i],url=String(m.url||"");if(!url)continue;
      const base=(p.shortcode||("post-"+p.index)).replace(/[^A-Za-z0-9._-]/g,"_"),filename=folder+"/"+base+"-"+String(i+1).padStart(2,"0")+"."+igExt(m);
      try{const id=await chrome.downloads.download({url,filename,saveAs:false,conflictAction:"uniquify"});downloads.push({download_id:id,post_url:p.url,type:m.type,filename})}
      catch(e){downloads.push({post_url:p.url,type:m.type,filename,error:String(e)})}
    }
  }
  return {ok:true,count:downloads.filter(x=>x.download_id).length,requested_media:downloads.length,downloads,folder};
}


async function queueTransportNack(t,d){
  const a=await isArmed(t);if(!a.armed)return{ok:false,ignored:true};
  const cid=String(d.commandId||"");
  // Chat-visible NACKs must be correlated to a syntactically valid command id.
  // Uncorrelated scanner noise stays in Health/diagnostics and must never become a user-visible STATUS.
  if(!VALID_COMMAND_ID.test(cid))return{ok:true,ignored:true,uncorrelated:true};
  const ref=cid;
  const k=`__nack__:${ref}:${d.reason||"rejected"}`;
  let s=await seenAll();if(s[k]?.posted)return{ok:true,duplicate:true};
  if(!s[k])s[k]={state:"done",kind:"transport-nack",ts:now(),conversationKey:a.registered.conversationKey,posted:false,result:{kind:"transport-nack",commandId:d.commandId||"",transportRef:d.transportRef||"",reason:d.reason||"rejected",executed:false,retryable:true,source:d.source||"",error:d.error||"",payloadBytes:d.payloadBytes??null,maxBytes:d.maxBytes??null}};
  await saveSeen(s);return await postPending(t,k,s[k]);
}
const commandTails=new Map();
async function handleCommand(tabId,command){
  const key=String(tabId);
  const prev=commandTails.get(key)||Promise.resolve();
  const run=prev.catch(()=>{}).then(()=>handleCommandInner(tabId,command));
  commandTails.set(key,run);
  try{return await run}finally{if(commandTails.get(key)===run)commandTails.delete(key)}
}
async function handleCommandInner(tabId,command){
  const a=await isArmed(tabId);if(!a.armed)return {ok:false,ignored:true};
  let seen=await seenAll();if(seen[command.id])return {ok:true,duplicate:true,state:seen[command.id].state};
  const acceptedAt=now();seen[command.id]={state:"running",ts:acceptedAt,acceptedAt,ackAt:acceptedAt,conversationKey:a.registered.conversationKey,sessionId:a.registered.conversationKey,sequence:acceptedAt,action:command.action,posted:false};await saveSeen(seen);
  await setStatus(tabId,{state:"Working",detail:`Executing ${command.action}`,currentCommandId:command.id,etaMs:null,etaConfidence:"unknown"});
  let result;
  try{
    if(command.action==="artifact.chat.apply")result=await registerChatArtifactApply(tabId,command,a.registered.conversationKey);
    else if(command.action==="instagram.profile.scan")result=await instagramProfileScan(command.params||{});
    else if(command.action==="instagram.post.inspect")result=await instagramPostInspect(command.params||{});
    else if(command.action==="instagram.scan.get")result=await instagramScanGet(command.params||{});
    else if(command.action==="instagram.scan.search")result=await instagramScanSearch(command.params||{});
    else if(command.action==="instagram.media.download")result=await instagramMediaDownload(command.params||{});
    else result=await agentExec(command);
  }catch(e){result={ok:false,error:String(e)}}
  for(const submitted of JOBCORE.findSubmittedJobs(command.action,result)){try{await registerJobWatch(tabId,command.id,submitted,a.registered.conversationKey)}catch{}}
  seen=await seenAll();seen[command.id]={...(seen[command.id]||{}),state:"done",completedAt:now(),result,posted:false};await saveSeen(seen);
  return await postPending(tabId,command.id,seen[command.id]);
}
function classifyPending(seen,registered,t=now(),force=false){
  const retryEligible=[],deferred=[],stale=[],suppressed=[];
  const conversationKey=registered?.conversationKey||"",armedAt=registered?.armedAt||0;
  for(const [id,r] of Object.entries(seen||{})){
    if(r?.state!=="done"||r?.posted)continue;
    if(r?.suppressed){suppressed.push([id,r,"suppressed"]);continue}
    if(!conversationKey||r?.conversationKey!==conversationKey){stale.push([id,r,"different_conversation"]);continue}
    if(!r?.result){stale.push([id,r,"missing_result"]);continue}
    if(r?.kind==="transport-nack"&&(r?.ts||0)<armedAt){stale.push([id,r,"pre_arm_nack"]);continue}
    if(JOBCORE.shouldBlockStatusEvent(id,r,seen,conversationKey)){deferred.push([id,r,"result_first_barrier"]);continue}
    if(!force&&r?.nextPostAt&&r.nextPostAt>t){deferred.push([id,r,"backoff"]);continue}
    retryEligible.push([id,r,"retry_eligible"]);
  }
  const byAge=(x,y)=>(x[1].acceptedAt||x[1].ts||0)-(y[1].acceptedAt||y[1].ts||0);
  retryEligible.sort(byAge);deferred.sort(byAge);stale.sort(byAge);suppressed.sort(byAge);
  return {retryEligible,deferred,stale,suppressed};
}
async function retryPending(tabId,force=false){
  const a=await isArmed(tabId);if(!a.armed)return {ok:false,reason:"not_armed"};
  const seen=await seenAll(),c=classifyPending(seen,a.registered,now(),force);
  const p=c.retryEligible[0];
  if(p)return await postPending(tabId,p[0],p[1]);
  return {ok:false,reason:c.deferred.length?c.deferred[0][2]:"no_eligible"};
}

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  (async()=>{
    try{
      const tabId=m.tabId??sender.tab?.id;
      if(m.type==="CONNECT_CHAT")return reply(await connectChat(tabId));
      if(m.type==="ARM")return reply(await arm(tabId));
      if(m.type==="DISARM")return reply(await disarm(tabId));
      if(m.type==="COMMAND")return reply(await handleCommand(tabId,m.command));
      if(m.type==="TRANSPORT_DIAG"){
        const d=m.diagnostic||{};await setStatus(tabId,{lastTransportDiagnostic:d});
        const hard=new Set(["contract_budget_exceeded","contract_payload_budget_exceeded","invalid_base64url","invalid_json","invalid_compact_command","invalid_outer_id","outer_id_mismatch","carrier_parse_failed","carrier_incomplete"]);
        const correlated=VALID_COMMAND_ID.test(String(d.commandId||""));
        if(d.final===true&&hard.has(d.reason)&&correlated)return reply(await queueTransportNack(tabId,d));
        return reply({ok:true,recorded:true,uncorrelated:d.final===true&&hard.has(d.reason)&&!correlated});
      }
      if(m.type==="DELIVERY_READY"){const a=await isArmed(tabId);if(a.armed)retryPending(tabId,!!m.force).catch(()=>{});return reply({ok:true,armed:a.armed})}
      if(m.type==="CONTENT_READY"){
        const a=await isArmed(tabId);
        if(a.armed){
          const currentKey=conv(sender.tab?.url||m.url||"");
          if(currentKey&&a.registered?.conversationKey&&currentKey!==a.registered.conversationKey){
            return reply({ok:true,armed:false,reason:"conversation changed"});
          }
          // Critical re-arm fix: a newly loaded content script starts unarmed.
          // Re-send BASELINE immediately to THIS frame so its MutationObserver is restored.
          try{
            const frameId=Number.isInteger(sender.frameId)?sender.frameId:0;
            if(a.registered?.reconcileReady){
              const rr=await messageFrame(tabId,frameId,{type:"RECONCILE"});
              const persisted=await seenAll();
              const fresh=(rr?.commands||[]).filter(c=>c?.id&&!persisted[c.id]);
              for(const c of fresh)await handleCommand(tabId,c);
            }else{
              const br=await messageFrame(tabId,frameId,{type:"BASELINE"});
              const persisted=await seenAll();
              for(const c of(br?.commands||[]))if(c?.id&&!persisted[c.id])persisted[c.id]={state:"baseline",ts:now(),conversationKey:a.registered.conversationKey,action:c.action};
              await saveSeen(persisted);
              const all=await armedAll();
              if(all[String(tabId)]){all[String(tabId)].reconcileReady=true;await saveArmed(all)}
            }
          }catch(e){
            await setStatus(tabId,{state:"Needs Action",detail:"Page adapter re-arm failed",lastError:String(e),actionRequired:true});
            return reply({ok:false,armed:true,error:"re-arm failed: "+String(e)});
          }
          await paint(tabId,await getStatus(tabId)||{state:"Ready",detail:"Armed"});
          retryPending(tabId).catch(()=>{});
        }
        return reply({ok:true,armed:a.armed});
      }
      if(m.type==="STATUS"){
        const a=await isArmed(tabId,m.conversationKey||"");const seen=await seenAll();
        const registered=a.registered||{conversationKey:m.conversationKey||"",armedAt:0};
        const pending=classifyPending(seen,registered,now(),false);
        let pageDiagnostics=await diagAllFrames(tabId);
        if(a.armed && pageDiagnostics.some(x=>x?.ok && x.topFrame && x.armed===false)){
          try{
            await reconcileAllFrames(tabId);
            pageDiagnostics=await diagAllFrames(tabId);
            await setStatus(tabId,{state:"Ready",detail:"Armed",lastError:"",actionRequired:false});
          }catch{}
        }
        const status=await getStatus(tabId);
        const jobWatches=await jobWatchesAll();const jobWatchIds=Object.keys(jobWatches);const jobWatchCount=jobWatchIds.length;const jobDiag=await jobWatchDiag();
        const chatTransfers=await chatTransfersAll();const chatTransferIds=Object.keys(chatTransfers);const chatDiag=await chatTransferDiag();
        const top=pageDiagnostics.find(x=>x?.ok&&x.topFrame);
        const activePostCount=status?.state==="Posting"&&status?.currentCommandId?1:0;
        const currentRec=(status?.currentCommandId&&seen[status.currentCommandId])||pending.retryEligible[0]?.[1]||pending.deferred[0]?.[1]||null;
        const nextRetryAt=Number(currentRec?.nextPostAt||0);
        const probe=top?.deliveryProbe||{};
        const health={
          runtimeVersion:VERSION,armed:a.armed,conversationKeySuffix:(registered?.conversationKey||"").slice(-12),
          state:status?.state||"Ready",currentCommandId:status?.currentCommandId||"",
          pendingRetryEligibleCount:pending.retryEligible.length,deferredPendingCount:pending.deferred.length,
          staleUnpostedCount:pending.stale.length,suppressedCount:pending.suppressed.length,activePostCount,
          waitReason:currentRec?.waitReason||"",postAttempts:Number(currentRec?.postAttempts||0),
          nextRetryAt,nextRetryInMs:nextRetryAt?Math.max(0,nextRetryAt-now()):0,
          sendControlReady:!!probe.chosenSend&&!probe.chosenSend.disabled&&probe.chosenSend.ariaDisabled!=="true",
          composerTextLen:Number(probe.composer?.textLen||0),composerKind:probe.composerKind||"",
          lastErrorCode:status?.lastError?"runtime_error":"",
          lastTransportDiagnosticCode:status?.lastTransportDiagnostic?.reason||status?.lastTransportDiagnostic?.kind||"",
          pageAdapterState:top?(top.armed===a.armed?"ready":"arm_mismatch"):"unavailable",jobWatchCount,jobWatchIds:jobWatchIds.slice(0,8),
          lastJobWatchRegisteredAt:Number(jobDiag.lastRegisteredAt||0),lastJobWatchRegisteredId:String(jobDiag.lastRegisteredJobId||""),
          lastJobPollAt:Number(jobDiag.lastPollAt||0),lastJobPollStatus:String(jobDiag.lastPollStatus||""),lastJobWatchError:String(jobDiag.lastWatchError||""),
          lastTerminalEventAt:Number(jobDiag.lastTerminalAt||0),lastTerminalJobId:String(jobDiag.lastTerminalJobId||""),lastTerminalJobStatus:String(jobDiag.lastTerminalStatus||""),
          lastTerminalQueueAt:Number(jobDiag.lastQueueAt||0),lastTerminalQueueOk:!!jobDiag.lastQueueOk,lastTerminalDeliveryOk:!!jobDiag.lastQueueDeliveryOk,
          chatArtifactTransferCount:chatTransferIds.length,chatArtifactTransferIds:chatTransferIds.slice(0,8),
          lastChatArtifactRegisteredAt:Number(chatDiag.lastRegisteredAt||0),lastChatArtifactTransferId:String(chatDiag.lastRegisteredTransferId||""),
          lastChatArtifactCompletedAt:Number(chatDiag.lastCompletedDownloadAt||0),
          lastChatArtifactTerminalAt:Number(chatDiag.lastTerminalAt||0),lastChatArtifactTerminalStatus:String(chatDiag.lastTerminalStatus||""),
          lastChatArtifactError:String(chatDiag.lastTransferError||""),lastChatArtifactDeliveryOk:!!chatDiag.lastQueueDeliveryOk
        };
        return reply({ok:true,version:VERSION,armed:a.armed,registered:a.registered,status,
          pendingPostCount:health.pendingRetryEligibleCount,pendingRetryEligibleCount:health.pendingRetryEligibleCount,
          deferredPendingCount:health.deferredPendingCount,staleUnpostedCount:health.staleUnpostedCount,
          suppressedPendingCount:health.suppressedCount,activePostCount,health,pageDiagnostics});
      }
      if(m.type==="IG_POPUP_DOWNLOAD")return reply(await instagramMediaDownload({url:String(m.url||"")}));
      if(m.type==="IG_POPUP_SCAN")return reply(await instagramProfileScan({url:String(m.url||""),limit:Number(m.limit)||10}));
      if(m.type==="OPEN_CONTROL_CENTER")return reply(await nativeMessage({type:"control.open",request_id:uid()}));
      if(m.type==="HOST_PING")return reply(await hostPing());
      if(m.type==="AGENT_PING")return reply(await agentExec(unifiedLocalCommand("ping",{})));
      reply({ok:false,error:"unknown message"});
    }catch(e){reply({ok:false,error:String(e)})}
  })();return true;
});

async function ensureRetryAlarm(){
  try{await chrome.alarms.create(RETRY_ALARM,{periodInMinutes:1})}catch{}
}
chrome.alarms.onAlarm.addListener(a=>{
  if(a?.name===RETRY_ALARM){
    armedAll().then(x=>Promise.all(Object.keys(x).map(t=>retryPending(Number(t)).catch(()=>{})))).catch(()=>{});
    return;
  }
  if(a?.name?.startsWith(RETRY_TAB_PREFIX)){
    const tabId=Number(a.name.slice(RETRY_TAB_PREFIX.length));
    if(Number.isInteger(tabId))retryPending(tabId).catch(()=>{});
    return;
  }
  if(a?.name?.startsWith(JOB_ALARM_PREFIX)){
    const jobId=a.name.slice(JOB_ALARM_PREFIX.length);if(jobId)pollJobWatch(jobId).catch(()=>{});
    return;
  }
  if(a?.name?.startsWith(CHAT_TRANSFER_ALARM+":")){const id=a.name.slice((CHAT_TRANSFER_ALARM+":").length);if(id)pollChatTransfer(id).catch(()=>{});}
});
chrome.runtime.onStartup.addListener(()=>{ensureRetryAlarm().catch(()=>{});resumeJobWatches().catch(()=>{});resumeChatTransfers().catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>{ensureRetryAlarm().catch(()=>{});resumeJobWatches().catch(()=>{});resumeChatTransfers().catch(()=>{})});
suppressLegacyPending().catch(()=>{});
ensureRetryAlarm().catch(()=>{});
resumeJobWatches().catch(()=>{});
resumeChatTransfers().catch(()=>{});
chrome.tabs.onRemoved.addListener(tabId=>{disarm(tabId).catch(()=>{})});
