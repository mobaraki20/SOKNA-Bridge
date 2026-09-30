importScripts("protocol.js","agent_job_core.js","chat_artifact_core.js","delivery_state_core.js","terminal_outcome_core.js","runtime_state_core.js","origin_registry_core.js");
const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;
const JOBCORE=globalThis.__SOKNA_AGENT_JOB_CORE_V1__;
const CHATART=globalThis.__SOKNA_CHAT_ARTIFACT_CORE_V1__;
const DELIVERY=globalThis.__SOKNA_DELIVERY_STATE_CORE_V1__;
const TERMINAL=globalThis.__SOKNA_TERMINAL_OUTCOME_CORE_V1__;
const RUNTIME=globalThis.__SOKNA_RUNTIME_STATE_CORE_V1__;
const ORIGIN=globalThis.__SOKNA_CHAT_ORIGIN_REGISTRY_V1__;
const BROWSER_TARGET=globalThis.__SOKNA_BROWSER_TARGET_CORE_V1__;
const SESSION_GATE=globalThis.__SOKNA_SESSION_GATE_RUNTIME_V1__;
const HOST="com.sokna.bridge.v3";
const VERSION="3.12.8";
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
const IG_APPROVALS_KEY="instagram_approvals_v1";
const IG_MAX_APPROVALS=20;
const TRANSPORT_TRACE_KEY="transport_trace_v2";
const SEMANTIC_FALLBACK_KEY="semantic_fallback_diagnostics_v2";
const CONTENT_FALLBACK_KEY="content_fallback_diagnostics_v1";
const CHAT_ORIGINS_KEY="approved_chat_origins_v1";
const BROWSER_ORIGINS_KEY="approved_browser_origins_v1";
const BROWSER_TARGETS_KEY="browser_targets_v1";
const BROWSER_PAGE_FILE="browser_page.js";
const CHAT_SCRIPT_FILES=["protocol.js","semantic_gate.js","semantic_core.js","semantic_intent.js","chat_artifact_core.js","outbound_attachment_core.js","dom_core.js","outbound_attachment.js","content.js"];
const TRACE_MAX=300;
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
async function setExecutionStart(tabId,id,action){const prev=await getStatus(tabId)||{};return await setStatus(tabId,RUNTIME.executionStart(prev,id,action,now()))}
async function setExecutionFinish(tabId,id,ok,error=""){const prev=await getStatus(tabId)||{};return await setStatus(tabId,RUNTIME.executionFinish(prev,id,ok,error,now()))}
async function setDeliveryStatus(tabId,recordId,rec,uiState,detail,patch={}){const prev=await getStatus(tabId)||{};return await setStatus(tabId,RUNTIME.deliveryUpdate(prev,{recordId,commandId:deliveryCommandId(recordId,rec),deliveryState:String(rec?.deliveryState||patch.deliveryState||""),uiState,detail,lastError:String(patch.lastError||""),actionRequired:!!patch.actionRequired,transportVerified:patch.transportVerified}))}
async function clearDeliveryStatus(tabId,recordId,patch={}){const prev=await getStatus(tabId)||{};return await setStatus(tabId,RUNTIME.deliveryClear(prev,recordId,patch))}
async function setConnectionStatus(tabId,patch={}){const prev=await getStatus(tabId)||{};return await setStatus(tabId,RUNTIME.connectionUpdate(prev,patch))}
async function jobWatchesAll(){const d=await sget("local",[JOB_WATCH_KEY]);return d[JOB_WATCH_KEY]||{}}
async function saveJobWatches(v){await sset("local",{[JOB_WATCH_KEY]:v})}
async function jobWatchDiag(){const d=await sget("local",[JOB_WATCH_DIAG_KEY]);return d[JOB_WATCH_DIAG_KEY]||{}}
async function saveJobWatchDiag(patch){const prev=await jobWatchDiag();const next={...prev,...patch};await sset("local",{[JOB_WATCH_DIAG_KEY]:next});return next}
async function chatTransfersAll(){const d=await sget("local",[CHAT_TRANSFER_KEY]);return d[CHAT_TRANSFER_KEY]||{}}
async function saveChatTransfers(v){await sset("local",{[CHAT_TRANSFER_KEY]:v})}
async function chatTransferDiag(){const d=await sget("local",[CHAT_TRANSFER_DIAG_KEY]);return d[CHAT_TRANSFER_DIAG_KEY]||{}}
async function saveChatTransferDiag(patch){const prev=await chatTransferDiag();const next={...prev,...patch};await sset("local",{[CHAT_TRANSFER_DIAG_KEY]:next});return next}
async function transportTraceAll(){const d=await sget("local",[TRANSPORT_TRACE_KEY]);return Array.isArray(d[TRANSPORT_TRACE_KEY])?d[TRANSPORT_TRACE_KEY]:[]}
async function appendTrace(tabId,event,extra={}){
  const a=await transportTraceAll();
  a.push({ts:now(),tabId:Number.isInteger(Number(tabId))?Number(tabId):null,event:String(event||""),...extra});
  await sset("local",{[TRANSPORT_TRACE_KEY]:a.slice(-TRACE_MAX)});
}
async function semanticFallbackAll(){const d=await sget("local",[SEMANTIC_FALLBACK_KEY]);return Array.isArray(d[SEMANTIC_FALLBACK_KEY])?d[SEMANTIC_FALLBACK_KEY]:[]}
async function contentFallbackAll(){const d=await sget("local",[CONTENT_FALLBACK_KEY]);return Array.isArray(d[CONTENT_FALLBACK_KEY])?d[CONTENT_FALLBACK_KEY]:[]}
async function semanticTop(tabId,type,extra={}){
  return await chrome.tabs.sendMessage(tabId,{type,...extra},{frameId:0});
}
function extensionActions(){
  const x=globalThis.__SOKNA_EXTENSION_ACTIONS_V1__;
  return Array.isArray(x)?[...new Set(x.map(String).filter(Boolean))]:[
    "artifact.chat.apply","job.list","job.events","bridge.activity","bridge.actions.list","bridge.action.describe","bridge.command.get","bridge.command.list","artifact.out.publish","artifact.out.get","artifact.out.info","artifact.out.list","artifact.out.attach",
    "browser.audit.run","browser.backend.status","browser.tabs.list","browser.tab.open","browser.tab.claim","browser.tab.release","browser.page.snapshot","browser.page.text","browser.page.click","browser.page.fill","browser.page.scroll","browser.page.wait","browser.page.screenshot","bridge.bootstrap","bridge.diagnostics.get","session.open","session.resume","session.checkpoint","session.close","session.list",
    "instagram.adapter.status","instagram.profile.scan","instagram.post.inspect","instagram.scan.get","instagram.scan.search","instagram.media.download","instagram.media.attach",
    "instagram.research.plan","instagram.candidates.get","instagram.candidates.attach","instagram.selection.confirm","instagram.selection.reject","instagram.export"
  ];
}
function agentActionsFromBootstrap(b){
  const a=b?.agent_capabilities?.capabilities?.actions||b?.agent_capabilities?.actions||[];
  return Array.isArray(a)?a.map(String).filter(Boolean):[];
}
function bootstrapNextAction(b){
  if(b?.ready===true)return {action:null,reason:"active_session_ready",params:{}};
  const sessions=Array.isArray(b?.recent_sessions)?b.recent_sessions:[];
  const resumable=sessions.find(x=>String(x?.state||"").toLowerCase()!=="closed");
  if(resumable?.id)return {action:"session.resume",reason:"resumable_session_available",params:{id:String(resumable.id)}};
  return {action:"session.open",reason:"no_ready_session",params:{project:"SOKNA Bridge",phase:"connected"}};
}
async function extensionBootstrap(command,tabId=null){
  const b=await agentExec(command),agent_actions=agentActionsFromBootstrap(b),extension_actions=extensionActions();
  const effective_actions=[...new Set([...agent_actions,...extension_actions])].sort(),recovery_actions=[...(globalThis.__SOKNA_RECOVERY_ACTIONS_V1__||[])].map(String).sort();
  const armed=Number.isInteger(tabId)?await isArmed(tabId):{armed:false,registered:null},challenge=String(armed?.registered?.intakeChallenge||"");
  const origins=await approvedChatOrigins();
  const extension_policy={
    schema:"sokna-extension-bootstrap-policy-v1",
    protocol:{version:String(PROTO?.protocolVersion||"2"),schema_version:String(PROTO?.schemaVersion||"2"),max_control_bytes:Number(PROTO?.maxControlBytes||800),max_expanded_command_bytes:Number(PROTO?.maxExpandedCommandBytes||4096)},
    command:{idempotency_scope:"conversation+command_id",terminal_outcome_required:true,rejection_requires_visible_nack:true},
    semantic:{transport:"SOKNA-INTENT",nonce_required:!!challenge,nonce_source:challenge?"connection-handshake":"none",route_policy:"semantic-compiler"},
    delivery:{ack_contract:"user-message-shell+envelope-type+id-v3",body_fallback_positive_ack:false,uncertain_auto_resubmit:false},
    artifact:{control_payload_max_bytes:Number(b?.control_plane_max_bytes||PROTO?.maxControlBytes||800),artifact_chunk_max_bytes:Number(b?.artifact_chunk_max_bytes||0),large_bytes_route:"Artifact Plane by ref/hash"},
    recovery_actions,
    origins:{policy:"explicit-https-user-approval",approved:origins,current:armed?.registered?.url?ORIGIN.normalizeOrigin(armed.registered.url):""},
    next_action:bootstrapNextAction(b)
  };
  return {...b,capabilities:{agent_actions,extension_actions,effective_actions},effective_actions,extension_policy};
}
async function connectionProbe(tabId){
  const out={semantic:{ok:false},message_intake:{ready:false},background:true,agent:{ok:false},session:{ready:false},delivery:{ready:false},verified:false};
  try{out.semantic=await semanticTop(tabId,"SEMANTIC_E2E_PROBE")}catch(e){out.semantic={ok:false,error:String(e)}}
  const semState=out.semantic?.semantic||{};out.message_intake={ready:!!semState.selector_ready&&(!semState.challenge_set||!!semState.probe_verified),selector_mode:String(semState.selector_mode||""),assistant_message_count:Number(semState.assistant_message_count||0),role_candidate_count:Number(semState.role_candidate_count||0),unknown_role_candidate_count:Number(semState.unknown_role_candidate_count||0),last_role_evidence:String(semState.last_role_evidence||""),challenge_set:!!semState.challenge_set,probe_verified:!!semState.probe_verified,probe_verified_at:Number(semState.probe_verified_at||0),provenance_mode:String(semState.provenance_mode||""),marker_witness_count:Number(semState.marker_witness_count||0),untrusted_marker_count:Number(semState.untrusted_marker_count||0)};
  try{
    const boot=await agentExec(unifiedLocalCommand("bridge.bootstrap",{}));
    out.agent={ok:!!boot?.agent_ready,version:String(boot?.agent_capabilities?.version||boot?.agent_capabilities?.agent||"")};
    out.session={ready:boot?.ready===true,id:String(boot?.active_session?.id||"")};
  }catch(e){out.agent={ok:false,error:String(e)}}
  try{
    const ds=await diagAllFrames(tabId),top=ds.find(x=>x?.ok&&x.topFrame);
    out.delivery={ready:!!top&&top.armed===true&&!!top.deliveryProbe?.composer,frame:top||null};
  }catch(e){out.delivery={ready:false,error:String(e)}}
  out.verified=!!out.semantic?.ok&&!!out.semantic?.background_reachable&&!!out.semantic?.agent_ok&&!!out.message_intake?.ready&&!!out.agent?.ok&&!!out.session?.ready&&!!out.delivery?.ready;
  return out;
}
async function fullDiagnostics(tabId,conversationKey="",mode="full"){
  const bounded=mode==="bounded",armed=await isArmed(tabId,conversationKey),status=await getStatus(tabId),pageDiagnostics=await diagAllFrames(tabId);
  let semantic={ok:false,error:"semantic adapter unavailable"};try{semantic=await semanticTop(tabId,"SEMANTIC_DIAG")}catch(e){semantic={ok:false,error:String(e)}}
  let host={ok:false},agent={ok:false},bootstrap={ok:false};
  try{host=await hostPing()}catch(e){host={ok:false,error:String(e)}}
  try{agent=await agentExec(unifiedLocalCommand("ping",{}))}catch(e){agent={ok:false,error:String(e)}}
  try{bootstrap=await extensionBootstrap(unifiedLocalCommand("bridge.bootstrap",{}),tabId)}catch(e){bootstrap={ok:false,error:String(e)}}
  const traces=(await transportTraceAll()).filter(x=>!Number.isInteger(tabId)||x.tabId===tabId).slice(bounded?-24:-80);
  const fallback=(await semanticFallbackAll()).slice(bounded?-12:-40),contentFallback=(await contentFallbackAll()).slice(bounded?-12:-40);
  const extensionVersion=chrome.runtime.getManifest?.().version||VERSION;
  return {
    ok:true,schema:"sokna-bridge-diagnostics-v1",generated_at:new Date().toISOString(),
    extension:{manifest_version:extensionVersion,background_version:VERSION,content_version:String(pageDiagnostics.find(x=>x?.ok&&x.topFrame)?.version||""),semantic_version:String(semantic?.semantic?.version||"")},
    chat:{tab_id:tabId,armed:armed.armed,conversation_key:armed.registered?.conversationKey||conversationKey||"",status:status||null,page_diagnostics:bounded?pageDiagnostics.filter(x=>x?.topFrame).slice(0,1):pageDiagnostics},
    semantic_transport:{adapter:semantic?.semantic||null,fallback_diagnostics:fallback,content_fallback_diagnostics:contentFallback,trace:traces},
    delivery:{top_frame:pageDiagnostics.find(x=>x?.ok&&x.topFrame)||null},
    agent:{host_ok:!!host?.ok,ping:agent,bootstrap_ready:bootstrap?.ready===true,active_session:bootstrap?.active_session||null,capabilities:bootstrap?.capabilities||null},
    browser:{approved_origins:await approvedBrowserOrigins(),targets:Object.values(await browserTargetsAll()).map(x=>({conversation_key:String(x?.conversation_key||""),tab_id:Number(x?.tab_id)||null,origin:String(x?.origin||""),claimed_at:Number(x?.claimed_at)||0})),backend:"sokna-extension-adapted",top_frame_only:true},
    instagram:{scan_count:Object.keys(await igScansAll()).length,approval_count:Object.keys(await igApprovalsAll()).length},
    recent_errors:traces.filter(x=>/failed|rejected|error|duplicate/.test(String(x.event||""))).slice(bounded?-12:-30),bounded
  };
}

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
function conv(url){return ORIGIN?.conversationKey?.(url)||""}
async function approvedChatOrigins(){const d=await sget("local",[CHAT_ORIGINS_KEY]);return ORIGIN.normalizeList(d[CHAT_ORIGINS_KEY]||[])}
async function saveApprovedChatOrigins(values){const list=ORIGIN.normalizeList(values);await sset("local",{[CHAT_ORIGINS_KEY]:list});return list}
async function isSupportedChatUrl(url){const origin=ORIGIN.normalizeOrigin(url);if(!origin)return false;return (await approvedChatOrigins()).includes(origin)}
async function registerChatOrigin(tabId,url){
  const origin=ORIGIN.normalizeOrigin(url);if(!origin)return {ok:false,code:"CHAT_ORIGIN_INVALID",error:"Only an explicit HTTPS origin can be enabled."};
  const pattern=ORIGIN.originPattern(origin),permitted=await chrome.permissions.contains({origins:[pattern]});
  if(!permitted)return {ok:false,code:"CHAT_ORIGIN_PERMISSION_REQUIRED",origin,pattern,error:"Approve this HTTPS origin from the extension popup first."};
  const list=await approvedChatOrigins();if(!list.includes(origin)){list.push(origin);await saveApprovedChatOrigins(list)}
  if(!ORIGIN.isBuiltin(origin)){
    const id=ORIGIN.scriptId(origin);try{const old=await chrome.scripting.getRegisteredContentScripts({ids:[id]});if(old?.length)await chrome.scripting.unregisterContentScripts({ids:[id]})}catch{}
    await chrome.scripting.registerContentScripts([{id,matches:[pattern],js:CHAT_SCRIPT_FILES,runAt:"document_start",allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:true}]);
    if(Number.isInteger(tabId)){try{await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:CHAT_SCRIPT_FILES})}catch(e){return {ok:false,code:"CHAT_ORIGIN_INJECTION_FAILED",origin,error:String(e)}}}
  }
  return {ok:true,origin,approved:true,builtin:ORIGIN.isBuiltin(origin),conversationKey:conv(url)};
}
async function chatOriginStatus(url){const origin=ORIGIN.normalizeOrigin(url),approved=await approvedChatOrigins();return {ok:true,origin,secure:!!origin,approved:!!origin&&approved.includes(origin),builtin:ORIGIN.isBuiltin(origin),approved_origins:approved,conversationKey:conv(url)}}
async function rehydrateApprovedChatOrigins(){for(const origin of await approvedChatOrigins()){if(ORIGIN.isBuiltin(origin))continue;const pattern=ORIGIN.originPattern(origin);if(!await chrome.permissions.contains({origins:[pattern]}))continue;const id=ORIGIN.scriptId(origin);try{const old=await chrome.scripting.getRegisteredContentScripts({ids:[id]});if(!old?.length)await chrome.scripting.registerContentScripts([{id,matches:[pattern],js:CHAT_SCRIPT_FILES,runAt:"document_start",allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:true}])}catch{}}}
async function approvedBrowserOrigins(){const d=await sget("local",[BROWSER_ORIGINS_KEY]);return BROWSER_TARGET.normalizeApproved(d[BROWSER_ORIGINS_KEY]||[])}
async function saveApprovedBrowserOrigins(values){const list=BROWSER_TARGET.normalizeApproved(values);await sset("local",{[BROWSER_ORIGINS_KEY]:list});return list}
async function browserTargetsAll(){const d=await sget("local",[BROWSER_TARGETS_KEY]);return d[BROWSER_TARGETS_KEY]||{}}
async function saveBrowserTargets(v){await sset("local",{[BROWSER_TARGETS_KEY]:v})}
async function browserOriginStatus(url){
  const origin=BROWSER_TARGET.normalizeOrigin(url),approved=await approvedBrowserOrigins(),pattern=BROWSER_TARGET.originPattern(origin);
  const permitted=!!pattern&&await chrome.permissions.contains({origins:[pattern]});
  return {ok:true,origin,web:!!origin,approved:!!origin&&approved.includes(origin)&&permitted,permission_granted:permitted,pattern,approved_origins:approved}
}
async function registerBrowserOrigin(tabId,url){
  const origin=BROWSER_TARGET.normalizeOrigin(url);if(!origin)return {ok:false,code:"BROWSER_ORIGIN_INVALID",error:"Only explicit HTTP/HTTPS origins can be enabled for Browser tools."};
  const pattern=BROWSER_TARGET.originPattern(origin),permitted=await chrome.permissions.contains({origins:[pattern]});
  if(!permitted)return {ok:false,code:"BROWSER_ORIGIN_PERMISSION_REQUIRED",origin,pattern,error:"Approve this site from the extension popup first."};
  const list=await approvedBrowserOrigins();if(!list.includes(origin)){list.push(origin);await saveApprovedBrowserOrigins(list)}
  if(Number.isInteger(tabId)){try{await ensureBrowserPage(tabId)}catch(e){return {ok:false,code:"BROWSER_PAGE_INJECTION_FAILED",origin,error:String(e?.message||e)}}}
  return {ok:true,origin,approved:true,tab_id:Number.isInteger(tabId)?tabId:null}
}
async function browserTabApproved(tab){
  const origin=BROWSER_TARGET.normalizeOrigin(tab?.url||"");if(!origin)return false;
  const approved=await approvedBrowserOrigins();if(!approved.includes(origin))return false;
  return await chrome.permissions.contains({origins:[BROWSER_TARGET.originPattern(origin)]})
}
async function browserTabsList(){
  const tabs=await chrome.tabs.query({}),out=[];
  for(const t of tabs){if(!Number.isInteger(t?.id)||!await browserTabApproved(t))continue;out.push({id:t.id,title:String(t.title||""),url:String(t.url||""),active:!!t.active,window_id:Number.isInteger(t.windowId)?t.windowId:null})}
  return {ok:true,tabs:out,scope:"approved_browser_origins_only"}
}
async function ensureBrowserPage(tabId){
  const tab=await chrome.tabs.get(tabId);if(!await browserTabApproved(tab))throw Object.assign(new Error("Browser origin is not approved for this tab."),{code:"BROWSER_ORIGIN_PERMISSION_REQUIRED"});
  try{const pong=await chrome.tabs.sendMessage(tabId,{type:"SOKNA_BROWSER_PAGE",action:"ping",args:{}},{frameId:0});if(pong?.ok)return tab}catch{}
  await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:[BROWSER_PAGE_FILE]});
  const pong=await chrome.tabs.sendMessage(tabId,{type:"SOKNA_BROWSER_PAGE",action:"ping",args:{}},{frameId:0});
  if(!pong?.ok)throw Object.assign(new Error(pong?.error||"Browser page engine did not initialize."),{code:pong?.code||"BROWSER_PAGE_NOT_READY"});
  return tab
}
async function claimBrowserTab(conversationKey,tabId){
  if(!String(conversationKey||""))throw Object.assign(new Error("Connected Chat conversation is required."),{code:"BROWSER_CONVERSATION_REQUIRED"});
  if(!Number.isInteger(Number(tabId))||Number(tabId)<=0)throw Object.assign(new Error("Positive tab_id required."),{code:"BROWSER_TARGET_TAB_INVALID"});
  const tab=await ensureBrowserPage(Number(tabId)),rec=BROWSER_TARGET.targetRecord({conversationKey,tabId:Number(tabId),url:String(tab.url||""),title:String(tab.title||""),claimedAt:now()});
  const all=await browserTargetsAll();all[String(conversationKey)]=rec;await saveBrowserTargets(all);return rec
}
async function releaseBrowserTab(conversationKey){
  const all=await browserTargetsAll(),had=!!all[String(conversationKey)];delete all[String(conversationKey)];await saveBrowserTargets(all);return {ok:true,released:had}
}
async function claimedBrowserTarget(conversationKey){
  const all=await browserTargetsAll(),rec=all[String(conversationKey)];if(!rec)throw Object.assign(new Error("Claim a browser tab first."),{code:"BROWSER_TARGET_REQUIRED"});
  let tab;try{tab=await chrome.tabs.get(Number(rec.tab_id))}catch{delete all[String(conversationKey)];await saveBrowserTargets(all);throw Object.assign(new Error("Claimed browser tab no longer exists."),{code:"BROWSER_TARGET_STALE"})}
  const check=BROWSER_TARGET.validateRecord(rec,String(conversationKey),tab);
  if(!check.ok){delete all[String(conversationKey)];await saveBrowserTargets(all);throw Object.assign(new Error(check.code),{code:check.code})}
  if(!await browserTabApproved(tab)){delete all[String(conversationKey)];await saveBrowserTargets(all);throw Object.assign(new Error("Browser origin permission is no longer available."),{code:"BROWSER_ORIGIN_PERMISSION_REQUIRED"})}
  await ensureBrowserPage(tab.id);return {record:rec,tab}
}
function browserPageActionName(action){
  const m={"browser.page.snapshot":"snapshot","browser.page.text":"text","browser.page.click":"click","browser.page.fill":"fill","browser.page.scroll":"scroll","browser.page.wait":"wait"};
  return m[String(action||"")]||""
}
async function sendClaimedBrowserPage(conversationKey,action,params={}){
  const target=await claimedBrowserTarget(conversationKey),pageAction=browserPageActionName(action);if(!pageAction)throw Object.assign(new Error("Unsupported Browser page action."),{code:"BROWSER_PAGE_ACTION_UNSUPPORTED"});
  const r=await chrome.tabs.sendMessage(target.tab.id,{type:"SOKNA_BROWSER_PAGE",action:pageAction,args:params},{frameId:0});
  if(!r?.ok)throw Object.assign(new Error(r?.error||"Browser page action failed."),{code:r?.code||"BROWSER_PAGE_FAILED"});
  return {ok:true,target:{tab_id:target.tab.id,origin:target.record.origin,url:String(target.tab.url||""),title:String(target.tab.title||"")},result:r.result}
}
function debugAttach(target){return new Promise((resolve,reject)=>chrome.debugger.attach(target,"1.3",()=>{const e=chrome.runtime.lastError;e?reject(Object.assign(new Error(e.message),{code:"BROWSER_DEBUGGER_ATTACH_FAILED"})):resolve()}))}
function debugDetach(target){return new Promise(resolve=>chrome.debugger.detach(target,()=>resolve()))}
function debugSend(target,method,params={}){return new Promise((resolve,reject)=>chrome.debugger.sendCommand(target,method,params,r=>{const e=chrome.runtime.lastError;e?reject(Object.assign(new Error(e.message),{code:"BROWSER_CDP_FAILED"})):resolve(r||{})}))}
async function ingestExtensionArtifact(name,contentType,dataB64){
  const r=await nativeMessage({type:"artifact.out.ingest",request_id:uid(),params:{name,content_type:contentType,data_b64:dataB64}});
  if(!r?.ok)throw Object.assign(new Error(r?.error||"Artifact ingest failed."),{code:"ARTIFACT_INGEST_FAILED"});
  return r.result||{}
}
async function captureClaimedBrowserScreenshot(conversationKey,commandId,params={}){
  const target=await claimedBrowserTarget(conversationKey),debugTarget={tabId:target.tab.id};let attached=false;
  try{
    await debugAttach(debugTarget);attached=true;await debugSend(debugTarget,"Page.enable",{});
    const metrics=await debugSend(debugTarget,"Page.getLayoutMetrics",{}),full=params.full_page===true;
    const box=full?(metrics.cssContentSize||metrics.contentSize||{}):(metrics.cssVisualViewport||metrics.visualViewport||{});
    const x=full?0:Number(box.pageX)||0,y=full?0:Number(box.pageY)||0;
    const width=full?Number(box.width):Number(box.clientWidth||box.width),height=full?Number(box.height):Number(box.clientHeight||box.height);
    if(!(width>0&&height>0))throw Object.assign(new Error("Screenshot geometry is empty."),{code:"BROWSER_CAPTURE_GEOMETRY_INVALID"});
    if(width>16384||height>16384||width*height>250000000)throw Object.assign(new Error("Screenshot dimensions exceed safety limits."),{code:"BROWSER_CAPTURE_TOO_LARGE"});
    const shot=await debugSend(debugTarget,"Page.captureScreenshot",{format:"png",clip:{x:Math.max(0,x),y:Math.max(0,y),width,height,scale:1},captureBeyondViewport:true});
    const data=String(shot?.data||"");if(!data)throw Object.assign(new Error("CDP returned empty screenshot."),{code:"BROWSER_CAPTURE_EMPTY"});
    const name="browser-"+String(commandId||uid()).replace(/[^A-Za-z0-9._-]/g,"_")+".png",artifact=await ingestExtensionArtifact(name,"image/png",data);
    return {ok:true,target:{tab_id:target.tab.id,origin:target.record.origin,url:String(target.tab.url||""),title:String(target.tab.title||"")},capture:full?"full_page":"viewport",artifact_ref:artifact.artifact_ref}
  }finally{if(attached)await debugDetach(debugTarget)}
}
async function browserSemanticAction(command,conversationKey){
  const action=String(command?.action||""),p=command?.params||{};
  if(action==="browser.backend.status")return {ok:true,schema:"sokna-browser-backend-status-v1",backend:"sokna-extension-adapted",engine:"stable-ref-dom+cdp-screenshot",target_gate:"conversation+exact-tab+approved-origin",top_frame_only:true,high_risk_tools_exposed:false};
  if(action==="browser.tabs.list")return await browserTabsList();
  if(action==="browser.tab.claim")return {ok:true,claimed:true,target:await claimBrowserTab(conversationKey,Number(p.tab_id))};
  if(action==="browser.tab.release")return await releaseBrowserTab(conversationKey);
  if(action==="browser.tab.open"){
    const url=String(p.url||""),origin=BROWSER_TARGET.normalizeOrigin(url);if(!origin)throw Object.assign(new Error("HTTP/HTTPS url required."),{code:"BROWSER_URL_INVALID"});
    const approved=await approvedBrowserOrigins(),pattern=BROWSER_TARGET.originPattern(origin);if(!approved.includes(origin)||!await chrome.permissions.contains({origins:[pattern]}))throw Object.assign(new Error("Approve this Browser origin from the popup first."),{code:"BROWSER_ORIGIN_PERMISSION_REQUIRED"});
    const tab=await chrome.tabs.create({url});if(!Number.isInteger(tab?.id))throw Object.assign(new Error("Chrome did not return a tab id."),{code:"BROWSER_TAB_OPEN_FAILED"});
    const autoClaim=p.claim!==false,target=autoClaim?await claimBrowserTab(conversationKey,tab.id):null;return {ok:true,opened:tab.id,url,claimed:autoClaim,target}
  }
  if(action==="browser.page.screenshot")return await captureClaimedBrowserScreenshot(conversationKey,command.id,p);
  if(BROWSER_TARGET.isPageAction(action))return await sendClaimedBrowserPage(conversationKey,action,p);
  throw Object.assign(new Error("Unknown Browser action."),{code:"BROWSER_ACTION_UNKNOWN"})
}

function b64urlUtf8(s){
  const bytes=new TextEncoder().encode(String(s));let bin="";for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function resultEnvelope(obj){return `[SOKNA-V2-RESULT]${JSON.stringify(obj)}[/SOKNA-V2-RESULT]`}
function stateHash(s){s=String(s||"");let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")}
function commandStorageKey(conversationKey,id){return `__cmd__:${stateHash(conversationKey)}:${String(id||"")}`}
function resultIdOf(recordKey,rec){return String(rec?.commandId||recordKey||"")}
function deliveryCommandId(recordKey,rec){return String(rec?.parentCommandId||rec?.commandId||recordKey||"")}
function statusEnvelope(obj){return `[SOKNA-V2-STATUS]${JSON.stringify(obj)}[/SOKNA-V2-STATUS]`}
const lastTransportDiagByTab=new Map();
function nativeMessage(msg){return new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,msg,r=>{const e=chrome.runtime.lastError;if(e)reject(new Error(e.message));else resolve(r||{})}))}
async function hostPing(){return await nativeMessage({type:"host.ping",request_id:uid()})}
async function agentExec(command){
  const r=await nativeMessage({type:"agent.exec",request_id:uid(),command});
  if(!r.ok)throw new Error(r.error||"Native host execution failed");return r.result;
}
function actionContracts(){return globalThis.__SOKNA_ACTION_CONTRACTS_V1__}
async function bridgeActionsList(){
  const reg=actionContracts();if(!reg)throw new Error("ACTION_CONTRACT_REGISTRY_UNAVAILABLE");
  const cap=await agentExec(unifiedLocalCommand("agent.capabilities",{}));
  const agentActions=Array.isArray(cap?.capabilities?.actions)?cap.capabilities.actions:[];
  const extensionActions=Array.isArray(globalThis.__SOKNA_EXTENSION_ACTIONS_V1__)?globalThis.__SOKNA_EXTENSION_ACTIONS_V1__:[];
  const effective=[...new Set([...agentActions,...extensionActions])].sort();
  const actions=reg.list(effective);
  return {ok:true,schema:reg.schema,version:reg.version,actions,contracted_count:actions.filter(x=>x.contracted).length,uncontracted_count:actions.filter(x=>!x.contracted).length};
}
function bridgeActionDescribe(params={}){
  const reg=actionContracts();if(!reg)throw new Error("ACTION_CONTRACT_REGISTRY_UNAVAILABLE");
  const action=String(params?.action||"").trim();if(!action)throw new Error("bridge.action.describe requires action");
  const contract=reg.describe(action);
  if(!contract)return {ok:false,code:"ACTION_CONTRACT_NOT_MIGRATED",action,contracted:false};
  return {ok:true,action,contracted:true,contract};
}
const extensionOwnedLedgerActions=new Set([
  "artifact.chat.apply","bridge.actions.list","bridge.action.describe","bridge.diagnostics.get",
  "browser.backend.status","browser.tabs.list","browser.tab.open","browser.tab.claim","browser.tab.release",
  "browser.page.snapshot","browser.page.text","browser.page.click","browser.page.fill","browser.page.scroll","browser.page.wait","browser.page.screenshot",
  "instagram.adapter.status","instagram.profile.scan","instagram.post.inspect","instagram.scan.get","instagram.scan.search",
  "instagram.media.download","instagram.media.attach","instagram.research.plan","instagram.candidates.get","instagram.candidates.attach",
  "instagram.selection.confirm","instagram.selection.reject","instagram.export"
]);
async function extensionLedgerMessage(type,command,result=null,error=""){
  const msg={type,request_id:uid(),command};
  if(result!==null)msg.result=result;
  if(error)msg.error=String(error);
  const r=await nativeMessage(msg);if(!r?.ok)throw new Error(r?.error||"EXTENSION_LEDGER_FAILED");
  return r?.result||{};
}
function recoveredLedgerResult(x){
  const state=String(x?.state||"");
  if(state==="succeeded")return x?.result??{ok:true};
  return {ok:false,error:String(x?.error||("COMMAND_"+state.toUpperCase()))};
}
async function recoverBrokerCommand(conversationKey,id){
  const q=unifiedLocalCommand("bridge.command.get",{id},id);q.conversationKey=String(conversationKey||"");
  const r=await agentExec(q);return r?.command||null;
}
function durableRecordResult(rec){
  const state=String(rec?.state||"");
  if(state==="succeeded")return rec?.result??{ok:true};
  if(state==="failed"||state==="outcome_unknown")return {ok:false,error:String(rec?.error||("COMMAND_"+state.toUpperCase()))};
  return null;
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
      const persisted=await seenAll(),armed=await isArmed(tabId),conversationKey=String(armed?.registered?.conversationKey||"");
      const fresh=(rr?.commands||[]).filter(c=>{if(!c?.id)return false;const k=commandStorageKey(conversationKey,c.id);return !persisted[k]&&!(persisted[c.id]?.conversationKey===conversationKey)});
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
function unifiedLocalCommand(action,params={}){
  const id=uid();return {protocolVersion:"2",messageId:id,correlationId:id,parentId:"",kind:"command",action,schemaVersion:"2",timestamp:now(),id,params}
}
async function arm(tabId){
  const tab=await chrome.tabs.get(tabId);if(!await isSupportedChatUrl(tab?.url))return {ok:false,error:"This HTTPS ChatGPT origin is not approved for SOKNA Bridge."};
  await setStatus(tabId,{state:"Working",detail:"Preparing page adapters"});
  let base,sem;
  try{base=await baselineAllFrames(tabId);sem=await semanticTop(tabId,"SEMANTIC_BASELINE")}
  catch(e){await appendTrace(tabId,"semantic.arm_failed",{error:String(e)});return {ok:false,error:"Bridge page adapter is not ready. Reload this chat page once. "+String(e)}}
  if(!base?.ok||!sem?.ok)return {ok:false,error:base?.error||sem?.error||"Baseline failed"};
  const a=await armedAll();for(const [tid,r] of Object.entries(a)){if(Number(tid)!==tabId&&r?.conversationKey===conv(tab.url))return {ok:false,error:"This conversation is already armed in another tab."}}
  a[String(tabId)]={conversationKey:conv(tab.url),url:tab.url,armedAt:now(),baselineCount:Number(sem?.baseline_count||0),reconcileReady:true};await saveArmed(a);
  await setStatus(tabId,{state:"Waiting",detail:"Connected — Transport Unverified",baselineCount:Number(sem?.baseline_count||0),lastError:"",actionRequired:false,transportVerified:false});
  await appendTrace(tabId,"semantic.armed",{conversationKey:conv(tab.url),baselineCount:Number(sem?.baseline_count||0)});
  return {ok:true,armed:true,version:VERSION,conversationKey:conv(tab.url),baselineCount:Number(sem?.baseline_count||0),transport_verified:false};
}
async function migrateArmedConversationIfProvisional(tabId,url){
  const all=await armedAll(),r=all[String(tabId)];if(!r)return null;
  const oldUrl=String(r.url||""),oldOrigin=ORIGIN.normalizeOrigin(oldUrl),newOrigin=ORIGIN.normalizeOrigin(url),oldId=ORIGIN.conversationId(oldUrl),newId=ORIGIN.conversationId(url);
  if(newOrigin&&!oldId&&newId){
    const oldKey=String(r.conversationKey||""),newKey=conv(url);r.url=url;r.conversationKey=newKey;
    if(r.intakeProof&&String(r.intakeProof.conversationKey||"")===oldKey)r.intakeProof={...r.intakeProof,conversationKey:newKey};
    all[String(tabId)]=r;await saveArmed(all);await SESSION_GATE?.markTab?.(tabId,url);await appendTrace(tabId,"conversation.identity_migrated",{from:oldKey,to:newKey});return r;
  }
  return r;
}
async function disarm(tabId){
  try{
    for(const f of await frameList(tabId)){try{await messageFrame(tabId,f.frameId,{type:"STOP"})}catch{}}
  }catch{}
  const a=await armedAll();delete a[String(tabId)];await saveArmed(a);
  await SESSION_GATE?.clearTab?.(tabId);await clearRetryAlarm(tabId);await clearStatus(tabId);await clearBadge(tabId);return {ok:true,armed:false}
}

async function connectChat(tabId){
  const tab=await chrome.tabs.get(tabId);if(!await isSupportedChatUrl(tab?.url))return {ok:false,error:"This HTTPS ChatGPT origin is not approved for SOKNA Bridge."};
  const armed=await arm(tabId);if(!armed?.ok)return armed;
  let boot=await agentExec(unifiedLocalCommand("bridge.bootstrap",{}));
  let session=boot?.active_session||null;
  if(boot?.ready!==true){
    const sid=("chat-"+tabId+"-"+Date.now().toString(36)).slice(0,90);
    const opened=await agentExec(unifiedLocalCommand("session.open",{id:sid,project:"SOKNA Bridge",workspace:"",phase:"connected",summary:"Connected from browser extension"}));
    session=opened?.session||session;
    boot=await agentExec(unifiedLocalCommand("bridge.bootstrap",{}));
  }
  await SESSION_GATE?.markTab?.(tabId,tab.url);
  const challenge=("probe-"+uid()).slice(0,96);
  try{
    const sc=await semanticTop(tabId,"SEMANTIC_SET_CHALLENGE",{challenge});
    if(!sc?.ok)return {ok:false,error:sc?.error||"Semantic intake challenge could not be armed."};
    const all=await armedAll();if(all[String(tabId)]){all[String(tabId)].intakeChallenge=challenge;all[String(tabId)].intakeChallengeAt=now();delete all[String(tabId)].intakeProof;await saveArmed(all)}
  }catch(e){return {ok:false,error:"Semantic intake challenge failed: "+String(e)}}
  const actions=[
    "bridge.bootstrap","bridge.diagnostics.get","workspace.list","file.read","file.write","process.run","git.status",
    "browser.audit.run","instagram.profile.scan","instagram.scan.search","instagram.scan.get","instagram.media.attach","instagram.media.download"
  ];
  const text=[
    "SOKNA Bridge is connected to this Chat by the user.",
    "The local Agent and work session are available through the Bridge extension.",
    "Before any command, complete the Bridge intake proof with exactly one standalone response and no code fence.",
    "Construct the probe opening token by concatenating: [ + SOKNA-PROBE + ]",
    "Construct the probe closing token by concatenating: [ + /SOKNA-PROBE + ]",
    "Place this exact challenge between those constructed tokens: "+challenge,
    "Do not copy an executable probe or command marker from this user message; construct tokens only in your response.",
    "After that proof, for local execution emit one standalone Bridge semantic command as the entire assistant message.",
    "Command opening token is constructed from: [ + SOKNA-INTENT + ]",
    "Command closing token is constructed from: [ + /SOKNA-INTENT + ]",
    "Every command JSON MUST include this exact top-level bridge_nonce for this connection: "+challenge,
    'The body is one JSON object such as {"id":"unique-attempt-id","intent":"exec","action":"bridge.bootstrap","params":{},"bridge_nonce":"'+challenge+'"}.' ,
    "Never reuse a bridge_nonce from an older connection or another chat.",
    "Always use a unique id for a new attempt. Wait for STATUS/RESULT before continuing.",
    "Use bridge.diagnostics.get for bounded diagnostics when transport is healthy.",
    "Advertised examples: "+actions.join(", ")+"."
  ].join("\n");
  let posted;
  try{posted=await chrome.tabs.sendMessage(tabId,{type:"POST_USER_TEXT",text},{frameId:0})}catch(e){posted={ok:false,error:String(e)}}
  const probe=await connectionProbe(tabId);
  const state=probe.verified?"Ready":(probe.agent?.ok?"Waiting":"Needs Action");
  const detail=probe.verified?"Connected — End-to-End Verified":(!probe.semantic?.ok?"Connected — Transport Unverified":(!probe.message_intake?.ready?"Connected — Message Intake Unverified":(!probe.agent?.ok?"Connected — Agent Unreachable":"Connected — Delivery Unavailable")));
  await setStatus(tabId,{state,detail,lastError:probe.verified?"":String(probe.semantic?.error||probe.agent?.error||probe.delivery?.error||""),actionRequired:state==="Needs Action",transportVerified:probe.verified,connectionProbe:probe});
  await appendTrace(tabId,probe.verified?"connection.verified":"connection.unverified",{detail,handshake_posted:!!posted?.ok});
  return {ok:true,armed:true,connected:true,bootstrap_ready:boot?.ready===true,session_id:String(session?.id||boot?.active_session?.id||""),handshake_posted:!!posted?.ok,handshake:posted,transport_verified:probe.verified,probe};
}

const postFlights=new Map();
async function postPending(tabId,id,rec,force=false){
  const key=`${tabId}:${id}`;
  if(postFlights.has(key))return await postFlights.get(key);
  const flight=postPendingInner(tabId,id,rec,force);
  postFlights.set(key,flight);
  try{return await flight}finally{if(postFlights.get(key)===flight)postFlights.delete(key)}
}
async function postPendingInner(tabId,id,rec,force=false){
  const a=await isArmed(tabId);
  let tab=null;try{tab=await chrome.tabs.get(tabId)}catch{}
  if(!a.armed||!tab||conv(tab.url)!==rec.conversationKey){
    return {ok:false,stale:true,error:"Conversation changed; stale result was not posted."};
  }

  let seen=await seenAll();
  rec=DELIVERY.normalize(seen[id]||rec,now());
  if(seen[id]&&(!seen[id].deliveryState||seen[id].deliveryState!==rec.deliveryState||seen[id].submitted!==rec.submitted)){
    seen[id]=rec;await saveSeen(seen);
  }

  const mode=DELIVERY.mode(rec,now(),force);
  if(mode==="none")return {ok:true,duplicate:true,reason:"already_acknowledged"};
  if(mode==="deferred"){
    if(rec.nextPostAt)await scheduleRetryAlarm(tabId,rec.nextPostAt);
    return {ok:false,waiting:true,reason:"backoff"};
  }
  if(mode==="uncertain"){
    await setDeliveryStatus(tabId,id,rec,"Needs Action",`Delivery uncertain for ${id}`,{lastError:"Conversation ACK was not observed before the safety deadline. Result will not be re-submitted automatically.",actionRequired:true});
    return {ok:false,waiting:false,reason:"delivery_uncertain"};
  }

  const isStatusEvent=rec.kind==="transport-nack"||rec.kind==="status-event";
  const env=isStatusEvent?statusEnvelope({eventId:id,...rec.result}):resultEnvelope({id:resultIdOf(id,rec),...rec.result});

  if(mode==="ack_poll"){
    await appendTrace(tabId,"chat.delivery_ack_poll",{record_id:id,kind:rec.kind||"result",command_id:String(rec.parentCommandId||id),ack_poll:Number(rec.ackPolls||0)+1});
    let p;try{p=await chrome.tabs.sendMessage(tabId,{type:"CHECK_RESULT_VISIBLE",envelope:env},{frameId:0})}catch(e){p={ok:false,visible:false,error:String(e)}}
    const outcome=DELIVERY.pollResult(rec,!!p?.visible||!!p?.ok,now());
    seen=await seenAll();
    if(seen[id]){seen[id]={...seen[id],...outcome.record,postError:p?.error||""};await saveSeen(seen);rec=seen[id]}else rec=outcome.record;

    if(outcome.state==="acknowledged"){
      await clearRetryAlarm(tabId);
      await appendTrace(tabId,"chat.delivery_completed",{record_id:id,kind:rec.kind||"result",method:"conversation-ack"});
      await clearDeliveryStatus(tabId,id,{uiState:"Ready",detail:"Connected — End-to-End Verified",transportVerified:true,lastError:"",actionRequired:false});
      await setStatus(tabId,{...(isStatusEvent?{}:{lastCompletedCommandId:resultIdOf(id,rec)}),lastPostMethod:"conversation-ack"});
      setTimeout(()=>retryPending(tabId).catch(()=>{}),250);
      return {ok:true,method:"conversation-ack"};
    }
    if(outcome.state==="delivery_uncertain"){
      await appendTrace(tabId,"chat.delivery_uncertain",{record_id:id,kind:rec.kind||"result",command_id:String(rec.parentCommandId||id),ack_polls:Number(rec.ackPolls||0),submitted_at:Number(rec.submittedAt||0)});
      await setDeliveryStatus(tabId,id,rec,"Needs Action",`Delivery uncertain for ${id}`,{lastError:"Conversation ACK was not observed before the safety deadline. Result was submitted once and will not be sent again automatically.",actionRequired:true});
      setTimeout(()=>retryPending(tabId).catch(()=>{}),250);
      return {ok:false,waiting:false,reason:"delivery_uncertain"};
    }
    await setDeliveryStatus(tabId,id,rec,"Waiting",`Submitted ${id}; waiting for conversation ACK`,{lastError:"",actionRequired:false});
    if(rec.nextPostAt)await scheduleRetryAlarm(tabId,rec.nextPostAt);
    const delay=Math.max(500,(rec.nextPostAt||now()+DELIVERY.ACK_POLL_MS)-now());
    setTimeout(()=>retryPending(tabId).catch(()=>{}),delay);
    return {ok:false,waiting:true,submitted:true,reason:"awaiting_conversation_ack"};
  }

  await appendTrace(tabId,"chat.delivery_started",{record_id:id,kind:rec.kind||"result",command_id:String(rec.parentCommandId||id)});
  await setDeliveryStatus(tabId,id,rec,"Posting",`Sending ${id}`,{lastError:"",actionRequired:false,deliveryState:"queued"});
  let p;try{p=await chrome.tabs.sendMessage(tabId,{type:"POST_RESULT",envelope:env},{frameId:0})}catch(e){p={ok:false,waiting:true,reason:"page_unavailable",error:String(e)}}

  seen=await seenAll();
  if(seen[id]){
    let next=DELIVERY.normalize(seen[id],now());
    if(p?.ok){
      next=DELIVERY.markAcknowledged(next,p?.method||"posted",now());
    }else if(p?.submitted===true||p?.reason==="awaiting_conversation_ack"){
      next=DELIVERY.markSubmitted(next,now());
      next={...next,postMethod:p?.method||"submitted",postError:p?.error||""};
    }else{
      const attempts=(next.postAttempts||0)+1;
      const delay=Math.min(RETRY_MAX_MS,RETRY_BASE_MS*Math.pow(2,Math.max(0,attempts-1)));
      next={...next,postAttempts:attempts,waitReason:p?.reason||"",postError:p?.error||"",postMethod:p?.method||"",nextPostAt:now()+delay};
    }
    seen[id]=next;await saveSeen(seen);rec=next;
    if(rec.posted)await clearRetryAlarm(tabId);else if(rec.nextPostAt)await scheduleRetryAlarm(tabId,rec.nextPostAt);
  }

  if(p?.ok){
    await appendTrace(tabId,"chat.delivery_completed",{record_id:id,kind:rec.kind||"result",method:String(p.method||"")});
    await clearDeliveryStatus(tabId,id,{uiState:"Ready",detail:"Connected — End-to-End Verified",transportVerified:true,lastError:"",actionRequired:false});
    await setStatus(tabId,{...(isStatusEvent?{}:{lastCompletedCommandId:resultIdOf(id,rec)}),lastPostMethod:p.method||""});
    setTimeout(()=>retryPending(tabId).catch(()=>{}),250);
    return {ok:true};
  }
  if(rec?.deliveryState==="submitted_awaiting_ack"){
    await appendTrace(tabId,"chat.delivery_submitted",{record_id:id,kind:rec.kind||"result",command_id:String(rec.parentCommandId||id),ack_deadline_at:Number(rec.ackDeadlineAt||0)});
    await setDeliveryStatus(tabId,id,rec,"Waiting",`Submitted ${id}; waiting for conversation ACK`,{lastError:"",actionRequired:false});
    const delay=Math.max(500,(rec.nextPostAt||now()+DELIVERY.ACK_POLL_MS)-now());
    setTimeout(()=>retryPending(tabId).catch(()=>{}),delay);
    return {ok:false,waiting:true,submitted:true,reason:"awaiting_conversation_ack"};
  }

  await appendTrace(tabId,"chat.delivery_failed",{record_id:id,kind:rec.kind||"result",reason:String(p?.reason||"retry"),error:String(p?.error||"Submit failed")});
  const exhausted=(rec?.postAttempts||0)>=MAX_POST_ATTEMPTS&&!p?.waiting;
  if(exhausted){
    await setDeliveryStatus(tabId,id,rec,"Needs Action","Queued result needs attention",{lastError:p?.error||"Submit failed",actionRequired:true});
  }else{
    await setDeliveryStatus(tabId,id,rec,"Waiting",`Queued ${id}: ${p?.reason||"retry"}`,{lastError:p?.error||"",actionRequired:false});
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
function igPrivatePost(p,index){
  const media=Array.isArray(p?.media)?p.media:[];
  return {
    index,url:String(p?.url||""),shortcode:String(p?.shortcode||""),type:String(p?.type||""),
    datetime:String(p?.datetime||""),caption:String(p?.caption||"").slice(0,12000),
    visible_text:String(p?.visible_text||"").slice(0,16000),
    mentions:Array.isArray(p?.mentions)?p.mentions.slice(0,80):[],
    hashtags:Array.isArray(p?.hashtags)?p.hashtags.slice(0,80):[],
    media:media.slice(0,30).map(x=>({type:String(x?.type||""),alt:String(x?.alt||"").slice(0,1600),url:String(x?.url||""),width:Number(x?.width)||0,height:Number(x?.height)||0}))
  };
}
function igPostSummary(p,index){
  const media=Array.isArray(p?.media)?p.media:[];
  return {
    index,url:String(p?.url||""),shortcode:String(p?.shortcode||""),type:String(p?.type||""),
    datetime:String(p?.datetime||""),caption:String(p?.caption||"").slice(0,2200),
    mentions:Array.isArray(p?.mentions)?p.mentions.slice(0,40):[],
    hashtags:Array.isArray(p?.hashtags)?p.hashtags.slice(0,40):[],
    media:media.slice(0,10).map(x=>({type:String(x?.type||""),alt:String(x?.alt||"").slice(0,1200),width:Number(x?.width)||0,height:Number(x?.height)||0}))
  };
}
async function inspectInstagramPostPrivate(url){
  url=String(url||"").trim();if(!/^https:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(url))throw new Error("INSTAGRAM_POST_URL_REQUIRED");
  const tab=await chrome.tabs.create({url,active:false});
  try{await waitTabComplete(tab.id);const ready=await igTabMessage(tab.id,{type:"IG_READY"});if(!ready?.ok)throw new Error("INSTAGRAM_ADAPTER_NOT_READY:"+String(ready?.reason||ready?.error||"unknown"));const snap=await igTabMessage(tab.id,{type:"IG_POST_SNAPSHOT"});if(!snap?.ok)throw new Error(snap?.error||"INSTAGRAM_POST_INSPECT_FAILED");return igPrivatePost(snap,0)}
  finally{try{await chrome.tabs.remove(tab.id)}catch{}}
}
async function instagramPostInspect(params={}){return igPostSummary(await inspectInstagramPostPrivate(params.url),0)}
async function instagramProfileScan(params={}){
  const profileUrl=igProfileUrl(params),limit=Math.min(Math.max(Number(params.limit)||10,1),IG_SCAN_MAX_POSTS);
  const tab=await chrome.tabs.create({url:profileUrl,active:false});
  const posts=[];
  try{
    await waitTabComplete(tab.id);
    const ready=await igTabMessage(tab.id,{type:"IG_READY"});if(!ready?.ok)throw new Error("INSTAGRAM_ADAPTER_NOT_READY:"+String(ready?.reason||ready?.error||"unknown"));
    const links=await igTabMessage(tab.id,{type:"IG_PROFILE_LINKS",limit});
    if(!links?.ok)throw new Error(links?.error||"INSTAGRAM_PROFILE_LINKS_FAILED");
    const cards=Array.isArray(links.cards)?links.cards.slice(0,limit):[];
    for(let i=0;i<cards.length;i++){
      const card=cards[i]||{};
      try{
        await chrome.tabs.update(tab.id,{url:String(card.url||"")});await waitTabComplete(tab.id);
        const snap=await igTabMessage(tab.id,{type:"IG_POST_SNAPSHOT"});
        posts.push({...igPrivatePost(snap,i),grid_alt:String(card.alt||"").slice(0,1200),grid_thumbnail:String(card.thumbnail||"")});
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
  }else if(params.url){posts=[await inspectInstagramPostPrivate(params.url)]}
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




async function igApprovalsAll(){const d=await sget("local",[IG_APPROVALS_KEY]);return d[IG_APPROVALS_KEY]||{}}
async function saveIgApprovals(v){const ordered=Object.values(v).sort((a,b)=>Number(b.updated_at||b.created_at||0)-Number(a.updated_at||a.created_at||0));await sset("local",{[IG_APPROVALS_KEY]:Object.fromEntries(ordered.slice(0,IG_MAX_APPROVALS).map(x=>[x.id,x]))})}
async function getIgApproval(id){const a=await igApprovalsAll(),x=a[String(id||"")];if(!x)throw new Error("INSTAGRAM_APPROVAL_NOT_FOUND");return x}
function igCandidatePublic(x){return {id:x.id,post_index:x.post_index,media_index:x.media_index,post_url:x.post_url,type:x.type,alt:String(x.alt||"").slice(0,1000),caption_excerpt:String(x.caption_excerpt||"").slice(0,900),width:Number(x.width)||0,height:Number(x.height)||0,metadata_score:Number(x.metadata_score)||0}}
async function instagramAdapterStatus(params={}){
  const url=igProfileUrl(params),tab=await chrome.tabs.create({url,active:false});
  try{await waitTabComplete(tab.id);const r=await igTabMessage(tab.id,{type:"IG_READY"});return {ok:!!r?.ok,schema:"sokna-instagram-adapter-status-v1",url,ready:!!r?.ready,logged_in:r?.logged_in??null,reason:String(r?.reason||""),profile:String(r?.profile||"")}}
  finally{try{await chrome.tabs.remove(tab.id)}catch{}}
}
function igCriteriaText(params){const c=params?.criteria&&typeof params.criteria==="object"?params.criteria:{};return [params?.query,c?.query,c?.subject,c?.topic].map(x=>String(x||"").trim()).filter(Boolean).join(" ").toLocaleLowerCase()}
async function instagramResearchPlan(params={}){
  const scan=await getIgScan(params.scan_id),criteria=params?.criteria&&typeof params.criteria==="object"?params.criteria:{},mediaType=String(criteria.media_type||params.media_type||"image").toLowerCase();
  const q=igCriteriaText(params),terms=q.split(/\s+/).filter(Boolean),candidates=[];
  for(const p of scan.posts){
    const caption=String(p.caption||""),captionLower=caption.toLocaleLowerCase(),media=Array.isArray(p.media)?p.media:[];
    for(let i=0;i<media.length;i++){
      const m=media[i],type=String(m.type||"");
      if(mediaType==="image"&&type!=="image")continue;if(mediaType==="video"&&type!=="video")continue;
      const alt=String(m.alt||""),hay=(caption+"\n"+alt+"\n"+(p.hashtags||[]).join(" ")+"\n"+(p.mentions||[]).join(" ")).toLocaleLowerCase();
      const matches=terms.length?terms.filter(t=>hay.includes(t)).length:0;
      if(terms.length&&matches===0&&params.strict_text_filter===true)continue;
      const id="igc-"+String(p.index)+"-"+String(i);
      candidates.push({id,post_index:Number(p.index),media_index:i,post_url:String(p.url||""),type,alt,caption_excerpt:caption.slice(0,1200),width:Number(m.width)||0,height:Number(m.height)||0,metadata_score:terms.length?matches/terms.length:0});
      if(candidates.length>=120)break;
    }
    if(candidates.length>=120)break;
  }
  candidates.sort((a,b)=>b.metadata_score-a.metadata_score||a.post_index-b.post_index||a.media_index-b.media_index);
  const id="approval-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8),nowTs=now();
  const identitySensitive=!!criteria.identity_sensitive||/person|singer|artist|owner|primary person|فرد|خواننده|صاحب|شخص/.test(String(criteria.subject||params.subject||"").toLowerCase());
  const approval={schema:"sokna-approval-request-v1",id,kind:"instagram-selection",status:"pending",scan_id:scan.id,created_at:nowTs,updated_at:nowTs,criteria:{...criteria,media_type:mediaType,query:q},identity_sensitive:identitySensitive,summary:String(candidates.length)+" media candidates found; visual/identity-sensitive selection requires user approval before export.",candidate_count:candidates.length,candidates,approved_ids:[],rejected_ids:[],allowed_decisions:["approve_all","approve_selected","reject","modify_criteria"]};
  const all=await igApprovalsAll();all[id]=approval;await saveIgApprovals(all);
  return {ok:true,schema:"sokna-instagram-research-plan-v1",scan_id:scan.id,approval_required:true,approval_id:id,candidate_count:candidates.length,identity_sensitive:identitySensitive,selection_policy:identitySensitive?"Do not infer real-person identity from face alone; ask the user to confirm ambiguous candidates.":"User approval required before export.",candidates:candidates.slice(0,12).map(igCandidatePublic),next:["instagram.candidates.get","instagram.candidates.attach","instagram.selection.confirm"]};
}
async function instagramCandidatesGet(params={}){
  const a=await getIgApproval(params.approval_id),offset=Math.max(Number(params.offset)||0,0),limit=Math.min(Math.max(Number(params.limit)||12,1),30),items=a.candidates.slice(offset,offset+limit).map(igCandidatePublic);
  return {ok:true,approval_id:a.id,status:a.status,scan_id:a.scan_id,candidate_count:a.candidates.length,offset,limit,has_more:offset+items.length<a.candidates.length,identity_sensitive:!!a.identity_sensitive,candidates:items,approved_ids:a.approved_ids||[],rejected_ids:a.rejected_ids||[]};
}
async function instagramSelectionConfirm(params={}){
  const a=await getIgApproval(params.approval_id),allIds=new Set(a.candidates.map(x=>x.id)),requested=Array.isArray(params.candidate_ids)?params.candidate_ids.map(String):[];
  const decision=String(params.decision|| (requested.length?"approve_selected":"approve_all"));
  let approved=decision==="approve_all"?[...allIds]:requested.filter(x=>allIds.has(x));
  if(!approved.length)throw new Error("INSTAGRAM_APPROVAL_SELECTION_EMPTY");
  a.approved_ids=[...new Set(approved)];a.status="approved";a.updated_at=now();const all=await igApprovalsAll();all[a.id]=a;await saveIgApprovals(all);
  return {ok:true,approval_id:a.id,status:a.status,approved_count:a.approved_ids.length,approved_ids:a.approved_ids};
}
async function instagramSelectionReject(params={}){
  const a=await getIgApproval(params.approval_id),allIds=new Set(a.candidates.map(x=>x.id)),requested=Array.isArray(params.candidate_ids)?params.candidate_ids.map(String):[];
  if(requested.length){a.rejected_ids=[...new Set([...(a.rejected_ids||[]),...requested.filter(x=>allIds.has(x))])];a.approved_ids=(a.approved_ids||[]).filter(x=>!a.rejected_ids.includes(x));a.status=a.approved_ids.length?"approved":"pending"}
  else{a.rejected_ids=[...allIds];a.approved_ids=[];a.status="rejected"}
  a.updated_at=now();const all=await igApprovalsAll();all[a.id]=a;await saveIgApprovals(all);
  return {ok:true,approval_id:a.id,status:a.status,rejected_count:a.rejected_ids.length,approved_count:a.approved_ids.length};
}
async function igApprovalSelection(params={},max=30){
  const a=await getIgApproval(params.approval_id),scan=await getIgScan(a.scan_id),ids=Array.isArray(params.candidate_ids)&&params.candidate_ids.length?params.candidate_ids.map(String):(a.approved_ids||[]);
  if(!ids.length)throw new Error("INSTAGRAM_APPROVAL_REQUIRED");
  const wanted=new Set(ids),selected=[];
  for(const cand of a.candidates){
    if(!wanted.has(cand.id))continue;const p=scan.posts.find(x=>Number(x.index)===Number(cand.post_index)),m=p?.media?.[Number(cand.media_index)];
    if(p&&m&&igAllowedMediaUrl(m.url))selected.push({post:p,media:m,candidate_id:cand.id,media_index:Number(cand.media_index)});
    if(selected.length>=max)break;
  }
  if(!selected.length)throw new Error("INSTAGRAM_APPROVED_MEDIA_NOT_AVAILABLE");
  return {approval:a,scan,selected};
}
async function instagramExport(params={}){
  const approval=await getIgApproval(params.approval_id);if(approval.status!=="approved"||!(approval.approved_ids||[]).length)throw new Error("INSTAGRAM_APPROVAL_REQUIRED");
  const {scan,selected}=await igApprovalSelection({approval_id:approval.id},60),folder=String(params.folder||("SOKNA-Instagram-"+(scan.profile||"export"))).replace(/[\\:*?"<>|]/g,"_").replace(/^\/+|\/+$/g,"")||"SOKNA-Instagram",downloads=[];
  for(const item of selected){
    const m=item.media,p=item.post,url=String(m.url||"");if(!url)continue;
    const base=(p.shortcode||("post-"+p.index)).replace(/[^A-Za-z0-9._-]/g,"_"),filename=folder+"/"+base+"-"+String(item.media_index+1).padStart(2,"0")+"."+igExt(m);
    try{const id=await chrome.downloads.download({url,filename,saveAs:false,conflictAction:"uniquify"});downloads.push({download_id:id,candidate_id:item.candidate_id,post_url:p.url,filename})}
    catch(e){downloads.push({candidate_id:item.candidate_id,post_url:p.url,filename,error:String(e)})}
  }
  return {ok:true,approval_id:approval.id,scan_id:scan.id,approved_count:selected.length,downloaded:downloads.filter(x=>x.download_id).length,folder,downloads};
}
function igAllowedMediaUrl(raw){
  try{
    const u=new URL(String(raw||""));if(u.protocol!=="https:")return false;
    const h=u.hostname.toLowerCase();
    return h==="instagram.com"||h==="www.instagram.com"||h.endsWith(".cdninstagram.com")||h.endsWith(".fbcdn.net");
  }catch{return false}
}
function igHex(buffer){return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function igB64(bytes){let bin="";for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin)}
function igContentType(m,response){
  const h=String(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  if(h.startsWith("image/")||h.startsWith("video/"))return h;
  return String(m?.type||"")==="video"?"video/mp4":"image/jpeg";
}
function igAttachExt(contentType,m){
  const map={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/quicktime":"mov"};
  return map[contentType]||igExt(m);
}
async function igAttachSelection(params={}){
  const scan=await getIgScan(params.scan_id);
  const indexes=Array.isArray(params.indexes)?params.indexes.map(Number).filter(Number.isFinite):[];
  const offset=Math.max(Number(params.offset)||0,0);
  const postLimit=Math.min(Math.max(Number(params.limit)||4,1),6);
  let posts=indexes.length?scan.posts.filter(p=>indexes.includes(Number(p.index))):scan.posts.slice(offset,offset+postLimit);
  if(!posts.length)throw new Error("INSTAGRAM_ATTACH_SELECTION_EMPTY");
  const includeVideo=params.include_video===true,maxPerPost=Math.min(Math.max(Number(params.max_media_per_post)||1,1),3);
  const selected=[];
  for(const p of posts){
    let used=0;
    for(const m of Array.isArray(p.media)?p.media:[]){
      if(!includeVideo&&String(m.type||"")==="video")continue;
      if(!igAllowedMediaUrl(m.url))continue;
      selected.push({post:p,media:m});used++;
      if(used>=maxPerPost||selected.length>=6)break;
    }
    if(selected.length>=6)break;
  }
  if(!selected.length)throw new Error("INSTAGRAM_ATTACH_NO_SUPPORTED_MEDIA");
  return {scan,selected};
}
async function instagramMediaAttachSelected(tabId,scan,selected,label="Instagram visual evidence"){
  const armed=await isArmed(tabId);if(!armed.armed)throw new Error("INSTAGRAM_ATTACH_CHAT_NOT_CONNECTED");
  const prepared=[];let total=0;
  for(const item of selected){
    const media=item.media,url=String(media.url||"");
    const response=await fetch(url,{method:"GET",credentials:"include",cache:"no-store"});
    if(!response.ok)throw new Error("INSTAGRAM_MEDIA_FETCH_HTTP_"+response.status);
    const buf=await response.arrayBuffer(),bytes=new Uint8Array(buf);
    if(bytes.byteLength<1)throw new Error("INSTAGRAM_MEDIA_EMPTY");
    if(bytes.byteLength>20*1024*1024)throw new Error("INSTAGRAM_MEDIA_TOO_LARGE");
    total+=bytes.byteLength;if(total>48*1024*1024)throw new Error("INSTAGRAM_ATTACH_BATCH_TOO_LARGE");
    const digest=await crypto.subtle.digest("SHA-256",buf),sha=igHex(digest),type=igContentType(media,response);
    const base=String(item.post.shortcode||("post-"+item.post.index)).replace(/[^A-Za-z0-9._-]/g,"_");
    const name=("instagram-"+base+"-"+String(prepared.length+1).padStart(2,"0")+"."+igAttachExt(type,media)).slice(0,170);
    prepared.push({bytes,ref:{id:sha,name,bytes:bytes.byteLength,sha256:sha,content_type:type},post_url:String(item.post.url||""),post_index:Number(item.post.index)});
  }
  const sources=[...new Set(prepared.map(x=>x.post_url).filter(Boolean))];
  const note=[
    "SOKNA Bridge "+label,
    "Scan: "+scan.id,
    "Please inspect the attached media visually and use only the source posts below for attribution:",
    ...sources.map(x=>"- "+x)
  ].join("\n");
  const results=[];
  try{
    for(let i=0;i<prepared.length;i++){
      const item=prepared[i],transferId=("igatt-"+item.ref.id.slice(0,12)+"-"+i+"-"+Date.now().toString(36)).slice(0,90);
      const begin=await chrome.tabs.sendMessage(tabId,{type:"OUTBOUND_ATTACHMENT_BEGIN",transferId,artifactRef:item.ref,append:i>0},{frameId:0});
      if(!begin?.ok)throw new Error((begin?.code||"INSTAGRAM_ATTACH_BEGIN_FAILED")+":"+(begin?.error||"page rejected media"));
      let offset=0,index=0;
      while(offset<item.bytes.length){
        const end=Math.min(item.bytes.length,offset+192*1024),dataB64=igB64(item.bytes.subarray(offset,end));
        const ack=await chrome.tabs.sendMessage(tabId,{type:"OUTBOUND_ATTACHMENT_CHUNK",transferId,index,dataB64},{frameId:0});
        if(!ack?.ok)throw new Error((ack?.code||"INSTAGRAM_ATTACH_CHUNK_FAILED")+":"+(ack?.error||"page rejected chunk"));
        offset=end;index++;
      }
      const last=i===prepared.length-1;
      const committed=await chrome.tabs.sendMessage(tabId,{type:"OUTBOUND_ATTACHMENT_COMMIT",transferId,append:i>0,submit:last,note:last?note:""},{frameId:0});
      if(!committed?.ok)throw new Error((committed?.code||"INSTAGRAM_ATTACH_COMMIT_FAILED")+":"+(committed?.error||"page rejected media"));
      results.push({filename:item.ref.name,bytes:item.ref.bytes,sha256:item.ref.sha256,post_url:item.post_url,post_index:item.post_index,status:String(committed.status||"")});
    }
  }catch(e){
    throw new Error("INSTAGRAM_ATTACH_FAILED:"+String(e?.message||e));
  }
  return {ok:true,scan_id:scan.id,attached:results.length,total_bytes:total,sources,attachments:results,visual_review_ready:true};
}
async function instagramMediaAttach(tabId,params={}){
  const {scan,selected}=await igAttachSelection(params);return await instagramMediaAttachSelected(tabId,scan,selected);
}
async function instagramCandidatesAttach(tabId,params={}){
  const {approval,scan,selected}=await igApprovalSelection(params,6);
  const r=await instagramMediaAttachSelected(tabId,scan,selected,"Instagram candidate review");
  return {...r,approval_id:approval.id,candidate_ids:selected.map(x=>x.candidate_id),approval_required:true};
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
  if(!s[k])s[k]={state:"done",kind:"transport-nack",ts:now(),conversationKey:a.registered.conversationKey,posted:false,result:{kind:"transport-nack",...TERMINAL.terminalEvent(d)}};
  await saveSeen(s);return await postPending(t,k,s[k]);
}
const commandTails=new Map();
async function handleCommand(tabId,command,meta={}){
  const key=String(tabId);
  const prev=commandTails.get(key)||Promise.resolve();
  const run=prev.catch(()=>{}).then(()=>handleCommandInner(tabId,command,meta));
  commandTails.set(key,run);
  try{return await run}finally{if(commandTails.get(key)===run)commandTails.delete(key)}
}
function resultRefOf(rec,id){
  const r=rec?.result||{};
  return String(r?.result_ref?.id||r?.artifact_ref?.id||r?.artifact_id||("command:"+id));
}
async function handleCommandInner(tabId,command,meta={}){
  const a=await isArmed(tabId);if(!a.armed)return {ok:false,ignored:true};
  await appendTrace(tabId,"background.received",{command_id:String(command?.id||""),action:String(command?.action||""),trigger:String(meta?.trigger||""),attempt_key:String(meta?.attemptKey||"")});
  let seen=await seenAll();
  const commandKey=commandStorageKey(a.registered.conversationKey,command.id);
  const legacy=(seen[command.id]?.conversationKey===a.registered.conversationKey)?seen[command.id]:null;
  const original=seen[commandKey]||legacy;
  if(original){
    await appendTrace(tabId,"semantic.duplicate",{command_id:command.id,action:command.action,original_state:String(original?.state||""),trigger:String(meta?.trigger||"")});
    try{
      const durable=await recoverBrokerCommand(a.registered.conversationKey,command.id),recovered=durableRecordResult(durable);
      if(recovered){
        seen[commandKey]={...original,state:"done",commandId:command.id,completedAt:Number(durable?.completed_at||now()),result:recovered,posted:!!original?.posted,brokerRecovered:true};
        await saveSeen(seen);await appendTrace(tabId,"semantic.duplicate_recovered",{command_id:command.id,action:command.action,durable_state:String(durable?.state||"")});
        if(!seen[commandKey].posted){const delivery=await postPending(tabId,commandKey,seen[commandKey]);return {ok:true,duplicate:true,recovered:true,state:String(durable?.state||""),delivery}}
        return {ok:true,duplicate:true,recovered:true,state:String(durable?.state||""),already_posted:true};
      }
    }catch(e){await appendTrace(tabId,"semantic.duplicate_recovery_miss",{command_id:command.id,action:command.action,error:String(e)})}
    if(String(meta?.trigger||"")==="reconcile")return {ok:true,duplicate:true,state:original.state,reconcile_duplicate:true};
    const result={kind:"duplicate",status:"duplicate",commandId:command.id,correlationId:command.correlationId||command.id,action:command.action,executed:false,original_command_id:command.id,original_state:String(original?.state||""),original_result_ref:resultRefOf(original,command.id)};
    const key="duplicate:"+command.id+":"+(String(meta?.attemptKey||"")||now());
    const q=await queueStatusEvent(tabId,a.registered.conversationKey,key,command.id,result);
    return {ok:true,duplicate:true,state:original.state,status_event:q};
  }
  const acceptedAt=now();seen[commandKey]={state:"running",commandId:command.id,ts:acceptedAt,acceptedAt,ackAt:acceptedAt,conversationKey:a.registered.conversationKey,sessionId:a.registered.conversationKey,sequence:acceptedAt,action:command.action,posted:false};await saveSeen(seen);
  await setExecutionStart(tabId,command.id,command.action);
  await setStatus(tabId,{etaMs:null,etaConfidence:"unknown"});
  await appendTrace(tabId,"agent.forward_started",{command_id:command.id,action:command.action});
  await queueStatusEvent(tabId,a.registered.conversationKey,"accepted:"+command.id,command.id,{kind:"command-accepted",status:"accepted",commandId:command.id,correlationId:command.correlationId||command.id,action:command.action,accepted_at:acceptedAt});
  let result,extensionLedgerCommand=null,extensionLedgerActive=false;
  if(extensionOwnedLedgerActions.has(command.action)){
    extensionLedgerCommand={...command,conversationKey:a.registered.conversationKey};
    try{
      const begun=await extensionLedgerMessage("ledger.external.begin",extensionLedgerCommand);
      if(begun?.duplicate){
        result=recoveredLedgerResult(begun);
        seen=await seenAll();seen[commandKey]={...(seen[commandKey]||{}),state:"done",commandId:command.id,completedAt:now(),result,posted:false};await saveSeen(seen);
        await appendTrace(tabId,"result.recovered",{command_id:command.id,action:command.action,state:String(begun?.state||"")});
        await setExecutionFinish(tabId,command.id,result?.ok!==false,String(result?.error||""));
        const delivery=await postPending(tabId,commandKey,seen[commandKey]);
        return {ok:true,executed:false,recovered:true,result_ok:result?.ok!==false,delivery};
      }
      extensionLedgerActive=true;
    }catch(e){
      result={ok:false,error:"COMMAND_LEDGER_BEGIN_FAILED: "+String(e)};
      await appendTrace(tabId,"ledger.external_begin_failed",{command_id:command.id,action:command.action,error:String(e)});
      seen=await seenAll();seen[commandKey]={...(seen[commandKey]||{}),state:"done",commandId:command.id,completedAt:now(),result,posted:false};await saveSeen(seen);
      await setExecutionFinish(tabId,command.id,false,result.error);
      const delivery=await postPending(tabId,commandKey,seen[commandKey]);
      return {ok:true,executed:false,result_ok:false,ledger_failed:true,delivery};
    }
  }
  try{
    if(command.action==="artifact.chat.apply")result=await registerChatArtifactApply(tabId,command,a.registered.conversationKey);
    else if(command.action==="bridge.actions.list")result=await bridgeActionsList();
    else if(command.action==="bridge.action.describe")result=bridgeActionDescribe(command.params||{});
    else if(command.action==="browser.backend.status"||command.action==="browser.tabs.list"||command.action==="browser.tab.open"||command.action==="browser.tab.claim"||command.action==="browser.tab.release"||BROWSER_TARGET.isPageAction(command.action))result=await browserSemanticAction(command,a.registered.conversationKey);
    else if(command.action==="bridge.bootstrap")result=await extensionBootstrap(command,tabId);
    else if(command.action==="bridge.diagnostics.get")result=await fullDiagnostics(tabId,a.registered.conversationKey,"bounded");
    else if(command.action==="instagram.adapter.status")result=await instagramAdapterStatus(command.params||{});
    else if(command.action==="instagram.profile.scan")result=await instagramProfileScan(command.params||{});
    else if(command.action==="instagram.post.inspect")result=await instagramPostInspect(command.params||{});
    else if(command.action==="instagram.scan.get")result=await instagramScanGet(command.params||{});
    else if(command.action==="instagram.scan.search")result=await instagramScanSearch(command.params||{});
    else if(command.action==="instagram.media.download")result=await instagramMediaDownload(command.params||{});
    else if(command.action==="instagram.media.attach")result=await instagramMediaAttach(tabId,command.params||{});
    else if(command.action==="instagram.research.plan")result=await instagramResearchPlan(command.params||{});
    else if(command.action==="instagram.candidates.get")result=await instagramCandidatesGet(command.params||{});
    else if(command.action==="instagram.candidates.attach")result=await instagramCandidatesAttach(tabId,command.params||{});
    else if(command.action==="instagram.selection.confirm")result=await instagramSelectionConfirm(command.params||{});
    else if(command.action==="instagram.selection.reject")result=await instagramSelectionReject(command.params||{});
    else if(command.action==="instagram.export")result=await instagramExport(command.params||{});
    else result=await agentExec({...command,conversationKey:a.registered.conversationKey});
    await appendTrace(tabId,"agent.accepted",{command_id:command.id,action:command.action,ok:result?.ok!==false});
  }catch(e){
    result={ok:false,error:String(e)};
    if(extensionLedgerActive){try{await extensionLedgerMessage("ledger.external.fail",extensionLedgerCommand,null,String(e))}catch(le){await appendTrace(tabId,"ledger.external_fail_write_failed",{command_id:command.id,error:String(le)})}}
    extensionLedgerActive=false;
    await appendTrace(tabId,"agent.forward_failed",{command_id:command.id,action:command.action,error:String(e)})
  }
  if(extensionLedgerActive){try{await extensionLedgerMessage("ledger.external.complete",extensionLedgerCommand,result)}catch(e){result={ok:false,error:"COMMAND_LEDGER_COMMIT_FAILED: "+String(e)};await appendTrace(tabId,"ledger.external_complete_failed",{command_id:command.id,error:String(e)})}}
  for(const submitted of JOBCORE.findSubmittedJobs(command.action,result)){try{await registerJobWatch(tabId,command.id,submitted,a.registered.conversationKey)}catch{}}
  seen=await seenAll();seen[commandKey]={...(seen[commandKey]||{}),state:"done",commandId:command.id,completedAt:now(),result,posted:false};await saveSeen(seen);
  await appendTrace(tabId,"result.received",{command_id:command.id,action:command.action,ok:result?.ok!==false});
  await setExecutionFinish(tabId,command.id,result?.ok!==false,String(result?.error||""));
  const delivery=await postPending(tabId,commandKey,seen[commandKey]);
  return {ok:true,executed:true,result_ok:result?.ok!==false,delivery};
}
function classifyPending(seen,registered,t=now(),force=false){
  const retryEligible=[],deferred=[],stale=[],suppressed=[],uncertain=[];
  const conversationKey=registered?.conversationKey||"",armedAt=registered?.armedAt||0;
  for(const [id,raw] of Object.entries(seen||{})){
    if(raw?.state!=="done"||raw?.posted)continue;
    const r=DELIVERY.normalize(raw,t);
    if(r?.suppressed){suppressed.push([id,r,"suppressed"]);continue}
    if(!conversationKey||r?.conversationKey!==conversationKey){stale.push([id,r,"different_conversation"]);continue}
    if(!r?.result){stale.push([id,r,"missing_result"]);continue}
    if(r?.kind==="transport-nack"&&(r?.ts||0)<armedAt){stale.push([id,r,"pre_arm_nack"]);continue}
    if(JOBCORE.shouldBlockStatusEvent(id,r,seen,conversationKey)){deferred.push([id,r,"result_first_barrier"]);continue}
    const mode=DELIVERY.mode(r,t,force);
    if(mode==="uncertain"){uncertain.push([id,r,"delivery_uncertain"]);continue}
    if(mode==="deferred"){deferred.push([id,r,"backoff"]);continue}
    if(mode==="none")continue;
    retryEligible.push([id,r,mode]);
  }
  const byAge=(x,y)=>(x[1].acceptedAt||x[1].ts||0)-(y[1].acceptedAt||y[1].ts||0);
  retryEligible.sort(byAge);deferred.sort(byAge);stale.sort(byAge);suppressed.sort(byAge);uncertain.sort(byAge);
  return {retryEligible,deferred,stale,suppressed,uncertain};
}
async function retryPending(tabId,force=false){
  const a=await isArmed(tabId);if(!a.armed)return {ok:false,reason:"not_armed"};
  const seen=await seenAll();let migrated=false;
  for(const [id,r] of Object.entries(seen)){
    if(r?.state!=="done"||r?.posted)continue;
    const n=DELIVERY.normalize(r,now());
    if(!r.deliveryState||r.submitted!==n.submitted||r.ackDeadlineAt!==n.ackDeadlineAt){seen[id]=n;migrated=true}
  }
  if(migrated)await saveSeen(seen);
  const c=classifyPending(seen,a.registered,now(),force);
  const p=c.retryEligible[0];
  if(p)return await postPending(tabId,p[0],p[1],force);
  return {ok:false,reason:c.deferred.length?c.deferred[0][2]:(c.uncertain.length?"delivery_uncertain":"no_eligible")};
}

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  (async()=>{
    try{
      const tabId=m.tabId??sender.tab?.id;
      if(m.type==="CHAT_ORIGIN_STATUS")return reply(await chatOriginStatus(m.url||sender.tab?.url||""));
      if(m.type==="REGISTER_CHAT_ORIGIN")return reply(await registerChatOrigin(tabId,m.url||sender.tab?.url||""));
      if(m.type==="BROWSER_ORIGIN_STATUS")return reply(await browserOriginStatus(m.url||sender.tab?.url||""));
      if(m.type==="REGISTER_BROWSER_ORIGIN")return reply(await registerBrowserOrigin(tabId,m.url||sender.tab?.url||""));
      if(m.type==="CONNECT_CHAT")return reply(await connectChat(tabId));
      if(m.type==="ARM")return reply(await arm(tabId));
      if(m.type==="DISARM")return reply(await disarm(tabId));
      if(m.type==="COMMAND")return reply(await handleCommand(tabId,m.command,m.semantic||{}));
      if(m.type==="SEMANTIC_TRACE"){const t=m.trace||{};await appendTrace(tabId,String(t.event||"semantic.trace"),{...t});return reply({ok:true,recorded:true})}
      if(m.type==="SEMANTIC_PROBE_REQUEST"){
        await appendTrace(tabId,"semantic.probe_started",{probe_id:String(m.probeId||"")});
        try{const p=await agentExec(unifiedLocalCommand("ping",{}));await appendTrace(tabId,"semantic.probe_completed",{probe_id:String(m.probeId||""),ok:p?.ok!==false});return reply({ok:true,agent_ok:p?.ok!==false,agent_version:String(p?.version||"")})}
        catch(e){await appendTrace(tabId,"semantic.probe_failed",{probe_id:String(m.probeId||""),error:String(e)});return reply({ok:false,agent_ok:false,error:String(e)})}
      }
      if(m.type==="SEMANTIC_INTAKE_PROVEN"){
        const a=await isArmed(tabId),expected=String(a.registered?.intakeChallenge||"");
        if(!a.armed||!expected||String(m.challenge||"")!==expected)return reply({ok:false,error:"intake challenge mismatch"});
        const all=await armedAll();
        if(all[String(tabId)]){
          all[String(tabId)].intakeProof={challenge:expected,verifiedAt:now(),evidence:String(m.evidence||"challenge-response"),selectorMode:String(m.selectorMode||""),probeSignature:String(m.probeSignature||""),conversationKey:String(a.registered?.conversationKey||"")};
          await saveArmed(all);
        }
        await appendTrace(tabId,"semantic.intake_proven",{evidence:String(m.evidence||""),selector_mode:String(m.selectorMode||""),probe_signature:String(m.probeSignature||"")});
        const probe=await connectionProbe(tabId),state=probe.verified?"Ready":(probe.agent?.ok?"Waiting":"Needs Action");
        const detail=probe.verified?"Connected — End-to-End Verified":(!probe.semantic?.ok?"Connected — Transport Unverified":(!probe.message_intake?.ready?"Connected — Message Intake Unverified":(!probe.agent?.ok?"Connected — Agent Unreachable":"Connected — Delivery Unavailable")));
        await setStatus(tabId,{state,detail,lastError:probe.verified?"":String(probe.semantic?.error||probe.agent?.error||probe.delivery?.error||""),actionRequired:state==="Needs Action",transportVerified:probe.verified,connectionProbe:probe});
        return reply({ok:true,verified:probe.verified,probe});
      }
      if(m.type==="TRANSPORT_DIAG"){
        const d=m.diagnostic||{};await setStatus(tabId,{lastTransportDiagnostic:d});
        const correlated=VALID_COMMAND_ID.test(String(d.commandId||""));
        if(TERMINAL?.isTerminalCommandRejection?.(d)){
          const queued=await queueTransportNack(tabId,d);
          await appendTrace(tabId,"command.terminal_rejected",{command_id:String(d.commandId||""),code:TERMINAL.code(d),reason:String(d.reason||""),retryable:!!d.retryable,recovery_action:TERMINAL.recoveryAction(d)});
          return reply(TERMINAL.response(d,{nack_queued:queued?.ok!==false||!!queued?.duplicate,delivery:queued}));
        }
        return reply({ok:true,recorded:true,uncorrelated:d.final===true&&d.executed===false&&!correlated});
      }
      if(m.type==="RECHECK_DELIVERY"){
        const a=await isArmed(tabId,m.conversationKey||"");
        if(!a.armed)return reply({ok:false,error:"Chat is not armed"});
        const seen=await seenAll(),pending=classifyPending(seen,a.registered,now(),false);
        const wanted=String(m.recordId||"");
        const target=wanted?pending.uncertain.find(x=>x[0]===wanted):pending.uncertain[0];
        if(!target)return reply({ok:false,reason:"no_uncertain_delivery",error:"No delivery_uncertain record is pending for this conversation"});
        const result=await postPending(tabId,target[0],target[1],true);
        await appendTrace(tabId,"chat.delivery_manual_recheck",{record_id:target[0],ok:!!result?.ok,reason:String(result?.reason||"")});
        return reply({...result,record_id:target[0],visibility_only:true,resubmitted:false});
      }
      if(m.type==="DELIVERY_READY"){const a=await isArmed(tabId);if(a.armed)retryPending(tabId,!!m.force).catch(()=>{});return reply({ok:true,armed:a.armed})}
      if(m.type==="CONTENT_READY"){
        const currentUrl=sender.tab?.url||m.url||"";
        await migrateArmedConversationIfProvisional(tabId,currentUrl);
        const a=await isArmed(tabId);
        if(a.armed){
          const currentKey=conv(currentUrl);
          if(currentKey&&a.registered?.conversationKey&&currentKey!==a.registered.conversationKey)return reply({ok:true,armed:false,reason:"conversation changed"});
          const frameId=Number.isInteger(sender.frameId)?sender.frameId:0,isTop=frameId===0||m.topFrame===true;
          try{
            await messageFrame(tabId,frameId,{type:a.registered?.reconcileReady?"RECONCILE":"BASELINE"});
            if(isTop){
              const challenge=String(a.registered?.intakeChallenge||"");
              const proof=a.registered?.intakeProof||null;
              const sameConversation=!!proof&&String(proof.conversationKey||"")===String(a.registered?.conversationKey||"")&&String(proof.challenge||"")===challenge;
              if(challenge){
                if(sameConversation){
                  const restored=await semanticTop(tabId,"SEMANTIC_RESTORE_PROOF",{proof});
                  if(!restored?.ok)await semanticTop(tabId,"SEMANTIC_SET_CHALLENGE",{challenge});
                  else await appendTrace(tabId,"semantic.intake_proof_restored",{verified_at:Number(proof.verifiedAt||0),selector_mode:String(proof.selectorMode||""),probe_signature:String(proof.probeSignature||"")});
                }else await semanticTop(tabId,"SEMANTIC_SET_CHALLENGE",{challenge});
              }
              await semanticTop(tabId,a.registered?.reconcileReady?"SEMANTIC_RECONCILE":"SEMANTIC_BASELINE");
            }
            const all=await armedAll();if(all[String(tabId)]){all[String(tabId)].reconcileReady=true;await saveArmed(all)}
            await appendTrace(tabId,"page.rearm_completed",{frame_id:frameId,top_frame:isTop});
          }catch(e){
            await appendTrace(tabId,isTop?"page.rearm_failed":"page.child_frame_transient_failed",{frame_id:frameId,top_frame:isTop,error:String(e)});
            if(isTop){
              await setStatus(tabId,{state:"Needs Action",detail:"Needs Re-arm",lastError:String(e),actionRequired:true,transportVerified:false});
              return reply({ok:false,armed:true,error:"re-arm failed: "+String(e)});
            }
            return reply({ok:true,armed:true,warning:"child frame re-arm transient failure"});
          }
          retryPending(tabId).catch(()=>{});
        }
        return reply({ok:true,armed:a.armed});
      }
      if(m.type==="STATUS"){
        const a=await isArmed(tabId,m.conversationKey||""),seen=await seenAll();
        const registered=a.registered||{conversationKey:m.conversationKey||"",armedAt:0};
        const pending=classifyPending(seen,registered,now(),false);
        let pageDiagnostics=await diagAllFrames(tabId);
        const top0=pageDiagnostics.find(x=>x?.ok&&x.topFrame);
        if(a.armed&&top0?.armed===false){
          try{await messageFrame(tabId,0,{type:"RECONCILE"});await semanticTop(tabId,"SEMANTIC_RECONCILE");pageDiagnostics=await diagAllFrames(tabId)}
          catch(e){await appendTrace(tabId,"page.top_reconcile_failed",{error:String(e)})}
        }
        let semantic={ok:false,error:"unavailable"};try{semantic=await semanticTop(tabId,"SEMANTIC_DIAG")}catch(e){semantic={ok:false,error:String(e)}}
        const probe=a.armed?await connectionProbe(tabId):{verified:false};
        let status=await getStatus(tabId);
        if(a.armed){
          const hasUncertain=pending.uncertain.length>0;
          const nextState=hasUncertain?"Needs Action":(probe.verified?"Ready":(probe.agent?.ok?"Waiting":"Needs Action"));
          const detail=hasUncertain?"Delivery uncertain — review queued result":(probe.verified?"Connected — End-to-End Verified":(!probe.semantic?.ok?"Connected — Transport Unverified":(!probe.message_intake?.ready?"Connected — Message Intake Unverified":(!probe.agent?.ok?"Connected — Agent Unreachable":"Connected — Delivery Unavailable"))));
          const lastError=hasUncertain?"A submitted result was not acknowledged before the safety deadline; automatic re-send is disabled.":(probe.verified?"":String(probe.semantic?.error||probe.agent?.error||probe.delivery?.error||""));
          status=await setConnectionStatus(tabId,{state:nextState,detail,transportVerified:!!probe.verified&&!hasUncertain,connectionProbe:probe,actionRequired:nextState==="Needs Action",lastError});
        }
        const jobWatches=await jobWatchesAll(),jobWatchIds=Object.keys(jobWatches),jobWatchCount=jobWatchIds.length,jobDiag=await jobWatchDiag();
        const chatTransfers=await chatTransfersAll(),chatTransferIds=Object.keys(chatTransfers),chatDiag=await chatTransferDiag();
        const top=pageDiagnostics.find(x=>x?.ok&&x.topFrame),activePostCount=status?.deliveryState==="queued"||status?.state==="Posting"?1:0;
        const deliveryRecordId=String(status?.deliveryPendingRecordId||"");
        const currentRec=(deliveryRecordId&&seen[deliveryRecordId])||pending.retryEligible[0]?.[1]||pending.deferred[0]?.[1]||pending.uncertain[0]?.[1]||null;
        const nextRetryAt=Number(currentRec?.nextPostAt||0),dprobe=top?.deliveryProbe||{};
        const child=pageDiagnostics.filter(x=>!x?.topFrame),childReady=child.filter(x=>x?.ok&&x.armed===a.armed).length,childFailed=child.length-childReady;
        const health={
          runtimeVersion:VERSION,armed:a.armed,transportVerified:status?.transportVerified===true,conversationKeySuffix:(registered?.conversationKey||"").slice(-12),
          state:status?.state||"Ready",currentCommandId:status?.executionCurrentCommandId||status?.currentCommandId||"",executionState:status?.executionState||"idle",deliveryPendingRecordId:status?.deliveryPendingRecordId||"",deliveryPendingCommandId:status?.deliveryPendingCommandId||"",
          pendingRetryEligibleCount:pending.retryEligible.length,deferredPendingCount:pending.deferred.length,uncertainPendingCount:pending.uncertain.length,staleUnpostedCount:pending.stale.length,suppressedCount:pending.suppressed.length,activePostCount,
          waitReason:currentRec?.waitReason||"",deliveryState:currentRec?.deliveryState||"",submitted:!!currentRec?.submitted,ackPolls:Number(currentRec?.ackPolls||0),ackDeadlineAt:Number(currentRec?.ackDeadlineAt||0),postAttempts:Number(currentRec?.postAttempts||0),nextRetryAt,nextRetryInMs:nextRetryAt?Math.max(0,nextRetryAt-now()):0,
          sendControlReady:!!dprobe.chosenSend&&!dprobe.chosenSend.disabled&&dprobe.chosenSend.ariaDisabled!=="true",composerTextLen:Number(dprobe.composer?.textLen||0),composerKind:dprobe.composerKind||"",
          lastErrorCode:status?.lastError?"runtime_error":"",lastTransportDiagnosticCode:status?.lastTransportDiagnostic?.reason||status?.lastTransportDiagnostic?.kind||"",
          pageAdapterState:top?(top.armed===a.armed?(childFailed?"ready_with_warning":"ready"):"arm_mismatch"):"unavailable",
          semanticAdapterState:semantic?.ok&&semantic?.semantic?.armed&&semantic?.semantic?.observer_active?(semantic?.semantic?.selector_ready?"ready":"selector_unverified"):"unavailable",
          childFrames:{ready:childReady,transient_failed:childFailed},
          connectionProbe:probe,jobWatchCount,jobWatchIds:jobWatchIds.slice(0,8),
          lastJobWatchRegisteredAt:Number(jobDiag.lastRegisteredAt||0),lastJobWatchRegisteredId:String(jobDiag.lastRegisteredJobId||""),lastJobPollAt:Number(jobDiag.lastPollAt||0),lastJobPollStatus:String(jobDiag.lastPollStatus||""),lastJobWatchError:String(jobDiag.lastWatchError||""),
          lastTerminalEventAt:Number(jobDiag.lastTerminalAt||0),lastTerminalJobId:String(jobDiag.lastTerminalJobId||""),lastTerminalJobStatus:String(jobDiag.lastTerminalStatus||""),lastTerminalQueueAt:Number(jobDiag.lastQueueAt||0),lastTerminalQueueOk:!!jobDiag.lastQueueOk,lastTerminalDeliveryOk:!!jobDiag.lastQueueDeliveryOk,
          chatArtifactTransferCount:chatTransferIds.length,chatArtifactTransferIds:chatTransferIds.slice(0,8),lastChatArtifactRegisteredAt:Number(chatDiag.lastRegisteredAt||0),lastChatArtifactTransferId:String(chatDiag.lastRegisteredTransferId||""),lastChatArtifactCompletedAt:Number(chatDiag.lastCompletedDownloadAt||0),lastChatArtifactTerminalAt:Number(chatDiag.lastTerminalAt||0),lastChatArtifactTerminalStatus:String(chatDiag.lastTerminalStatus||""),lastChatArtifactError:String(chatDiag.lastTransferError||""),lastChatArtifactDeliveryOk:!!chatDiag.lastQueueDeliveryOk
        };
        return reply({ok:true,version:VERSION,armed:a.armed,registered:a.registered,status,pendingPostCount:health.pendingRetryEligibleCount,pendingRetryEligibleCount:health.pendingRetryEligibleCount,deferredPendingCount:health.deferredPendingCount,staleUnpostedCount:health.staleUnpostedCount,suppressedPendingCount:health.suppressedCount,activePostCount,health,pageDiagnostics,semanticDiagnostics:semantic});
      }
      if(m.type==="FULL_DIAGNOSTICS")return reply(await fullDiagnostics(tabId,m.conversationKey||""));
      if(m.type==="SEND_DIAGNOSTICS_TO_CHAT"){
        const d=await fullDiagnostics(tabId,m.conversationKey||""),payload="SOKNA Bridge diagnostics (redacted)\n"+JSON.stringify(d);
        const p=await chrome.tabs.sendMessage(tabId,{type:"POST_USER_TEXT",text:payload},{frameId:0});return reply({ok:!!p?.ok,delivery:p,diagnostics:d});
      }
      if(m.type==="CREATE_SUPPORT_BUNDLE")return reply(await nativeMessage({type:"support.bundle.create",request_id:uid()}));
      if(m.type==="OPEN_LOGS")return reply(await nativeMessage({type:"logs.open",request_id:uid()}));
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
chrome.tabs.onRemoved.addListener(tabId=>{disarm(tabId).catch(()=>{});browserTargetsAll().then(async all=>{let changed=false;for(const [k,v] of Object.entries(all)){if(Number(v?.tab_id)===Number(tabId)){delete all[k];changed=true}}if(changed)await saveBrowserTargets(all)}).catch(()=>{})});

rehydrateApprovedChatOrigins().catch(()=>{});
