(()=>{
"use strict";
const G="__SOKNA_ACTION_CONTRACTS_V1__";if(globalThis[G])return;
const DRAFT="https://json-schema.org/draft/2020-12/schema";
const S={type:"string",minLength:1}, B={type:"boolean"};
const strArr={type:"array",items:{type:"string"}};
const scope={type:"object",additionalProperties:false,required:["path","access"],properties:{path:S,access:{type:"string",enum:["read","write","deny"]}}};
const scopes={type:"array",items:scope};
const obj=(properties={},required=[],additionalProperties=false)=>({$schema:DRAFT,type:"object",additionalProperties,properties,required});
const okOut={$schema:DRAFT,type:"object",required:["ok"],properties:{ok:B},additionalProperties:true};
const safeIdempotency=new Set(["safe_retry","replace","replace_content","content_addressed","id_guarded","precondition_guarded","delivery_idempotent","baseline_id_guarded","run_id_guarded"]);
function tool(owner,description,inputSchema,{mutating=false,destructive=null,idempotency="safe_retry",capabilities=[],outputSchema=okOut,errors=[],openWorld=false}={}){
  const idempotentHint=safeIdempotency.has(idempotency);
  return {
    description,
    inputSchema,
    outputSchema,
    annotations:{
      readOnlyHint:!mutating,
      destructiveHint:mutating?(destructive===null?true:!!destructive):false,
      idempotentHint:mutating?!!idempotentHint:true,
      openWorldHint:!!openWorld
    },
    _meta:{
      "sokna/owner":owner,
      "sokna/idempotency":idempotency,
      "sokna/requiredCapabilities":capabilities,
      "sokna/errors":errors
    }
  };
}
const C={
 "bridge.actions.list":tool("chat-adapter","List effective Bridge actions and their MCP-contract migration status.",obj()),
 "bridge.action.describe":tool("chat-adapter","Return the MCP-compatible Tool descriptor for one Bridge action.",obj({action:S},["action"])),
 "bridge.command.get":tool("broker","Recover one durable command outcome in the current conversation scope.",obj({id:S},["id"]),{errors:["invalid command id","not found"]}),
 "bridge.command.list":tool("broker","List durable command outcomes for the current conversation using a monotonic cursor.",obj({since_sequence:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:200}})),
 "bridge.bootstrap":tool("chat-adapter","Check Bridge readiness and active session for this Chat.",obj()),
 "bridge.diagnostics.get":tool("chat-adapter","Return bounded diagnostics for the active Chat and local Bridge.",obj()),
 "bridge.doctor":tool("chat-adapter","Run a bounded readiness check across Agent, durable broker, tool registry, ArtifactRoot, Browser QA and credential reference discovery.",obj()),
 "bridge.activity":tool("broker","Read recent durable Bridge command/job activity events.",obj({limit:{type:"integer",minimum:1,maximum:500}})),
 "agent.capabilities":tool("agent","Return Agent version, action list and execution limits.",obj()),
 "system.capabilities":tool("agent","Return local system/runtime capabilities visible to the Agent.",obj()),
 "ping":tool("agent","Check Agent health.",obj()),
 "artifact.chat.apply":tool("chat-adapter","Apply a Chat-delivered artifact reference through the verified ArtifactRoot workflow.",obj({artifact_id:S,workspace:S,expected_sha256:{type:"string"}},["artifact_id","workspace"]),{mutating:true,destructive:true,idempotency:"precondition_guarded"}),
 "artifact.root.status":tool("agent","Report ArtifactRoot configuration and security boundary.",obj()),
 "artifact.import.local":tool("agent","Import a local file into ArtifactRoot through the local_file provider.",obj({source_path:S,artifact_id:{type:"string"},expected_sha256:{type:"string"},workspace:{type:"string"},job_id:{type:"string"}},["source_path"]),{mutating:true,destructive:false,idempotency:"content_addressed"}),
 "artifact.chat.import.download":tool("agent","Import an exact-basename ZIP from the user's Downloads into ArtifactRoot; expected SHA-256 is required.",obj({filename:S,expected_sha256:S,cleanup_source:B,artifact_id:{type:"string"}},["filename","expected_sha256"]),{mutating:true,destructive:false,idempotency:"content_addressed"}),
 "artifact.provider.status":tool("agent","Report configured Artifact Provider capabilities and managed-folder boundary.",obj()),
 "artifact.provider.probe":tool("agent","Probe an Artifact Provider source without executing acquired content.",obj({provider:S,artifact_id:{type:"string"},expected_sha256:{type:"string"}},["provider"],true),{openWorld:true}),
 "artifact.provider.acquire":tool("agent","Acquire an artifact through a configured provider into ArtifactRoot; remote sources require expected SHA-256.",obj({provider:S,artifact_id:{type:"string"},expected_sha256:{type:"string"},signature:{type:"object"}},["provider"],true),{mutating:true,destructive:false,idempotency:"content_addressed",openWorld:true}),
 "artifact.provider.verify":tool("agent","Verify a managed ArtifactRoot path against expected hash/signature evidence.",obj({path:S,expected_sha256:{type:"string"},artifact_id:{type:"string"},signature:{type:"object"}},["path"])),
 "artifact.cleanup":tool("agent","Plan or execute ArtifactRoot retention cleanup.",obj({execute:B}),{mutating:true,destructive:true,idempotency:"safe_retry"}),
 "artifact.inspect":tool("agent","Inspect a workspace artifact package and validate its manifest/patch boundary.",obj({workspace:S,path:S,expected_sha256:{type:"string"}},["workspace","path"])),
 "artifact.apply":tool("agent","Apply a verified workspace patch artifact with SHA/freshness guards.",obj({workspace:S,path:S,expected_sha256:S,apply:B},["workspace","path","expected_sha256"]),{mutating:true,destructive:true,idempotency:"precondition_guarded"}),
 "workspace.registry.status":tool("agent","Report workspace registry and permission-model status.",obj()),
 "workspace.unregister":tool("agent","Remove a workspace registration without deleting source files.",obj({id:S},["id"]),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "workspace.assess":tool("agent","Assess an absolute local path before workspace registration.",obj({root:S},["root"])),
 "workspace.managed_copy.plan":tool("agent","Plan a managed workspace copy; source is preserved and no copy is executed.",obj({source:S,destination:S},["source","destination"])),
 "workspace.grant.create":tool("agent","Create a bounded job/context grant that cannot exceed base workspace policy.",obj({id:S,workspace:S,job_id:S,issuer:S,context:{type:"string"},scopes,tools:strArr,ttl_seconds:{type:"integer",minimum:1,maximum:86400}},["id","workspace","job_id","issuer","scopes","tools","ttl_seconds"]),{mutating:true,destructive:false,idempotency:"id_guarded"}),
 "workspace.grant.revoke":tool("agent","Revoke a workspace grant fail-closed.",obj({id:S,issuer:S},["id","issuer"]),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "workspace.remote.register":tool("agent","Register a remote workspace adapter using opaque endpoint/credential references; credential values are forbidden.",obj({id:S,adapter:S,endpoint_ref:S,root_ref:S,credential_ref:{type:"string"},scopes,tools:strArr},["id","adapter","endpoint_ref","root_ref","scopes","tools"]),{mutating:true,destructive:false,idempotency:"id_guarded",openWorld:true}),
 "workspace.remote.exec":tool("agent","Execute an operation through a registered remote-workspace adapter under grant/job policy.",obj({workspace:S,grant_id:S,job_id:S,path:S,operation:S,args:strArr},["workspace","grant_id","job_id","path","operation"]),{mutating:true,destructive:true,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "workspace.ephemeral.checkout":tool("agent","Create a managed ephemeral checkout with deterministic cleanup and bounded policy.",obj({workspace:S,grant_id:{type:"string"},job_id:{type:"string"},id:{type:"string"},ref:{type:"string"},ttl_seconds:{type:"integer",minimum:1},scopes,tools:strArr},["workspace"]),{mutating:true,destructive:false,idempotency:"id_guarded",openWorld:true}),
 "workspace.advanced.cleanup":tool("agent","Remove expired/revoked grants and expired/orphan ephemeral workspaces.",obj({execute:B}),{mutating:true,destructive:true,idempotency:"safe_retry"}),
 "repo.inspect":tool("agent","Inspect repository state for a workspace.",obj({workspace:S},["workspace"]),{capabilities:["git"]}),
 "repo.sync.preflight":tool("agent","Check whether a workspace repository can be safely fast-forward synchronized.",obj({workspace:S},["workspace"]),{capabilities:["git"],openWorld:true}),
 "repo.sync.apply_ff":tool("agent","Apply an allowed fast-forward repository synchronization.",obj({workspace:S},["workspace"]),{mutating:true,destructive:true,idempotency:"not_safe_to_blind_retry",capabilities:["git"],openWorld:true}),
 "process.run":tool("agent","Run one explicitly permitted executable inside the workspace boundary. The executable must be present in workspace tool permissions.",obj({workspace:S,exe:S,args:strArr,cwd:{type:"string"},timeout_sec:{type:"integer",minimum:1,maximum:1800},mutating:B},["workspace","exe"]),{mutating:true,destructive:true,idempotency:"depends_on_command",capabilities:["process"],openWorld:true}),
 "git.log":tool("agent","Read bounded Git log history.",obj({workspace:S,count:{type:"integer",minimum:1,maximum:100}},["workspace"]),{capabilities:["git"]}),
 "git.fetch":tool("agent","Fetch and prune the verified origin remote.",obj({workspace:S},["workspace"]),{mutating:true,destructive:false,idempotency:"safe_retry",capabilities:["git"],openWorld:true}),
 "git.switch":tool("agent","Switch to an existing Git branch.",obj({workspace:S,name:S},["workspace","name"]),{mutating:true,destructive:false,idempotency:"replace",capabilities:["git"]}),
 "git.branch.create":tool("agent","Create and switch to a new Git branch.",obj({workspace:S,name:S},["workspace","name"]),{mutating:true,destructive:false,idempotency:"id_guarded",capabilities:["git"]}),
 "git.add":tool("agent","Stage all workspace changes. Prefer git.add.paths when possible.",obj({workspace:S},["workspace"]),{mutating:true,destructive:false,idempotency:"safe_retry",capabilities:["git"]}),
 "gh.auth.status":tool("agent","Check GitHub CLI authentication status within an authorized workspace.",obj({workspace:S},["workspace"]),{capabilities:["gh"],openWorld:true}),
 "github.repo.create":tool("agent","Create a GitHub repository only for configured allowed owners.",obj({workspace:S,name:S,owner:{type:"string"},visibility:{type:"string",enum:["private","public","internal"]},description:{type:"string"}},["workspace","name"]),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",capabilities:["gh"],openWorld:true}),
 "plan.stage":tool("agent","Stage a bounded base64 plan chunk under tools/plans in a workspace.",obj({workspace:S,path:S,data_b64:S,reset:B,expected_sha256:{type:"string"}},["workspace","path","data_b64"]),{mutating:true,destructive:true,idempotency:"precondition_guarded"}),
 "plan.run":tool("agent","Execute a stored bounded plan under workspace/grant/job policy.",obj({workspace:S,path:S,expected_sha256:{type:"string"},grant_id:{type:"string"},job_id:{type:"string"}},["workspace","path"]),{mutating:true,destructive:true,idempotency:"depends_on_steps"}),
 "component.registry.status":tool("agent","Report component and automation registries plus security boundaries.",obj()),
 "component.list":tool("agent","List registered managed components.",obj()),
 "component.inspect":tool("agent","Inspect one managed component.",obj({id:S},["id"])),
 "component.register":tool("agent","Register a managed component definition.",obj({id:S,display_name:{type:"string"},type:{type:"string",enum:["process","service","plugin"]},release_channel:S,entrypoint:{type:"string"},args:strArr,service_name:{type:"string"},health_path:{type:"string"},dependencies:strArr},["id","type","release_channel"]),{mutating:true,destructive:false,idempotency:"id_guarded"}),
 "component.channel.set":tool("agent","Set a managed component release channel.",obj({id:S,channel:S},["id","channel"]),{mutating:true,destructive:false,idempotency:"replace"}),
 "component.dependency.acquire":tool("agent","Acquire component dependency evidence only through Artifact Provider; never auto-executes.",obj({id:S,provider:S,expected_sha256:{type:"string"}},["id","provider"],true),{mutating:true,destructive:false,idempotency:"content_addressed",openWorld:true}),
 "component.release.apply":tool("agent","Verify, stage, activate, health-check and commit a managed component release with rollback on failure.",obj({id:S,version:S,artifact_path:S,artifact_id:{type:"string"},expected_sha256:{type:"string"},activate:B},["id","version","artifact_path"]),{mutating:true,destructive:true,idempotency:"precondition_guarded"}),
 "component.start":tool("agent","Start a managed component with ownership checks.",obj({id:S},["id"]),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "component.stop":tool("agent","Stop a managed component while refusing foreign/stale ownership.",obj({id:S},["id"]),{mutating:true,destructive:true,idempotency:"safe_retry"}),
 "component.restart":tool("agent","Restart a managed component with ownership checks.",obj({id:S},["id"]),{mutating:true,destructive:true,idempotency:"not_safe_to_blind_retry"}),
 "component.health":tool("agent","Read health of a managed component.",obj({id:S},["id"])),
 "component.rollback":tool("agent","Activate the per-component last-known-good release.",obj({id:S},["id"]),{mutating:true,destructive:true,idempotency:"not_safe_to_blind_retry"}),
 "component.remove":tool("agent","Remove only the managed component root while preserving workspace/user data.",obj({id:S},["id"]),{mutating:true,destructive:true,idempotency:"safe_retry"}),
 "automation.list":tool("agent","List registered local automations.",obj()),
 "automation.register":tool("agent","Register an interval or trigger automation with a policy-bounded grant template.",obj({id:S,workspace:S,path:S,type:{type:"string",enum:["interval","trigger"]},grant_scopes:scopes,grant_tools:strArr,interval_seconds:{type:"integer",minimum:60},trigger_key:{type:"string"},missed_run_policy:{type:"string"},max_concurrency:{type:"integer",minimum:1,maximum:8},grant_ttl_seconds:{type:"integer",minimum:1,maximum:86400}},["id","workspace","path","type","grant_scopes","grant_tools"]),{mutating:true,destructive:false,idempotency:"id_guarded"}),
 "automation.remove":tool("agent","Remove an automation registration.",obj({id:S},["id"]),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "automation.tick":tool("agent","Claim due interval automation runs with dedupe and bounded concurrency.",obj(),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "automation.trigger":tool("agent","Claim a trigger automation event idempotently using per-run grant/job state.",obj({trigger_key:S,event_id:S},["trigger_key","event_id"]),{mutating:true,destructive:false,idempotency:"id_guarded"}),
 "session.open":tool("chat-adapter","Open a persistent Bridge work session.",obj({id:{type:"string"},project:{type:"string"},workspace:{type:"string"},phase:{type:"string"},summary:{type:"string"}},[]),{mutating:true,destructive:false,idempotency:"id_guarded"}),
 "session.resume":tool("chat-adapter","Resume a persistent Bridge work session.",obj({id:S},["id"]),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "session.checkpoint":tool("chat-adapter","Write a checkpoint for the active Bridge work session.",obj({id:{type:"string"},phase:{type:"string"},summary:{type:"string"},data:{type:"object"}},[],true),{mutating:true,destructive:false,idempotency:"replace"}),
 "session.close":tool("chat-adapter","Close a persistent Bridge work session.",obj({id:{type:"string"},summary:{type:"string"}},[]),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "session.list":tool("chat-adapter","List recent persistent Bridge work sessions.",obj({limit:{type:"integer",minimum:1,maximum:100}})),
 "instagram.adapter.status":tool("chat-adapter","Check whether the Instagram browser adapter can access the requested profile using the user's browser session.",obj({profile:{type:"string"},url:{type:"string"}},[],true),{openWorld:true}),
 "instagram.profile.scan":tool("chat-adapter","Scan a bounded number of posts from an Instagram profile into local extension storage.",obj({profile:{type:"string"},url:{type:"string"},limit:{type:"integer",minimum:1,maximum:60}},[],true),{mutating:true,destructive:false,idempotency:"new_scan_each_call",openWorld:true}),
 "instagram.post.inspect":tool("chat-adapter","Inspect one Instagram post URL.",obj({url:S},["url"]),{openWorld:true}),
 "instagram.scan.get":tool("chat-adapter","Read a bounded page from a stored Instagram scan.",obj({scan_id:S,offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:15}},["scan_id"])),
 "instagram.scan.search":tool("chat-adapter","Search a stored Instagram scan across caption, visible text, hashtags, mentions and alt text.",obj({scan_id:S,query:S,limit:{type:"integer",minimum:1,maximum:25}},["scan_id","query"])),
 "instagram.media.download":tool("chat-adapter","Download selected media from a stored scan or a single post into the browser Downloads area.",obj({scan_id:{type:"string"},url:{type:"string"},indexes:{type:"array",items:{type:"integer"}},post_urls:strArr,folder:{type:"string"}},[],true),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "instagram.media.attach":tool("chat-adapter","Attach selected media from a stored scan into the connected Chat for visual review.",obj({scan_id:S,indexes:{type:"array",items:{type:"integer"}},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:6},include_video:B,max_media_per_post:{type:"integer",minimum:1,maximum:3}},["scan_id"]),{mutating:true,destructive:false,idempotency:"delivery_idempotent",openWorld:true}),
 "instagram.research.plan":tool("chat-adapter","Build a local candidate/approval plan from a stored Instagram scan; identity-sensitive selections require user confirmation.",obj({scan_id:S,query:{type:"string"},criteria:{type:"object"},media_type:{type:"string",enum:["image","video"]},strict_text_filter:B},["scan_id"]),{mutating:true,destructive:false,idempotency:"new_plan_each_call"}),
 "instagram.candidates.get":tool("chat-adapter","Read a bounded page of candidates from an Instagram approval plan.",obj({approval_id:S,offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:30}},["approval_id"])),
 "instagram.candidates.attach":tool("chat-adapter","Attach approved/candidate Instagram media into Chat for visual review.",obj({approval_id:S,candidate_ids:strArr},["approval_id"]),{mutating:true,destructive:false,idempotency:"delivery_idempotent",openWorld:true}),
 "instagram.selection.confirm":tool("chat-adapter","Confirm all or selected candidate ids in an Instagram approval plan.",obj({approval_id:S,decision:{type:"string",enum:["approve_all","approve_selected"]},candidate_ids:strArr},["approval_id"]),{mutating:true,destructive:false,idempotency:"replace"}),
 "instagram.selection.reject":tool("chat-adapter","Reject selected or all candidate ids in an Instagram approval plan.",obj({approval_id:S,candidate_ids:strArr},["approval_id"]),{mutating:true,destructive:false,idempotency:"replace"}),
 "instagram.export":tool("chat-adapter","Export only user-approved Instagram media selections to Downloads.",obj({approval_id:S,folder:{type:"string"}},["approval_id"]),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "artifact.out.get":tool("broker","Read a bounded base64 chunk from a durable outbound artifact.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:524288}},["id"])),
 "artifact.out.info":tool("broker","Return metadata for a durable outbound artifact.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},["id"])),
 "artifact.out.list":tool("broker","List durable outbound artifacts.",obj({limit:{type:"integer",minimum:1,maximum:200}})),
 "artifact.out.attach":tool("chat-adapter","Attach a durable artifact to the active Chat. Delivery defers while the Assistant is generating.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},["id"]),{mutating:true,destructive:false,idempotency:"delivery_idempotent",errors:["ATTACHMENT_ASSISTANT_BUSY","ATTACHMENT_USER_DRAFT_PRESENT"]}),
 "artifact.out.attach_many":tool("chat-adapter","Attach multiple durable artifacts to the active Chat in bounded internal batches. delivery_id checkpoints completed batches and refuses blind replay of an uncertain in-flight batch.",obj({delivery_id:{type:"string",pattern:"^[A-Za-z0-9._-]{1,96}$"},ids:{type:"array",minItems:1,maxItems:100,uniqueItems:true,items:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},batch_size:{type:"integer",minimum:1,maximum:10},note:{type:"string",maxLength:2000}},["delivery_id","ids"]),{mutating:true,destructive:false,idempotency:"id_guarded",errors:["ATTACHMENT_ASSISTANT_BUSY","ATTACHMENT_USER_DRAFT_PRESENT","ATTACHMENT_INPUT_AMBIGUOUS","ATTACHMENT_BATCH_OUTCOME_UNKNOWN"]}),
 "artifact.collection.get":tool("chat-adapter","Read a bounded page of entries from a durable SOKNA artifact collection manifest.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:20}},["id"])),
 "artifact.out.publish":tool("broker","Publish a file already inside ArtifactRoot into the durable outbound artifact namespace.",obj({path:S,name:{type:"string"}},["path"]),{mutating:true,destructive:false,idempotency:"content_addressed"}),
 "browser.backend.status":tool("chat-adapter","Report the real-browser backend policy and availability. Browser target access is exact-tab and approved-origin only.",obj()),
 "browser.tabs.list":tool("chat-adapter","List tabs whose HTTP/HTTPS origins were explicitly approved for SOKNA Browser tools.",obj(),{outputSchema:okOut}),
 "browser.tab.open":tool("chat-adapter","Open a URL only when its origin was explicitly approved, and claim the new tab for this conversation by default.",obj({url:S,claim:B},["url"]),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "browser.tab.claim":tool("chat-adapter","Bind one approved browser tab to the current Chat conversation. Subsequent page actions target that exact tab id.",obj({tab_id:{type:"integer",minimum:1}},["tab_id"]),{mutating:true,destructive:false,idempotency:"replace"}),
 "browser.tab.release":tool("chat-adapter","Release the browser-tab binding for the current Chat conversation.",obj(),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "browser.page.snapshot":tool("chat-adapter","Return a bounded accessibility-style snapshot of interactive elements in the top frame of the claimed tab with stable refs.",obj(),{openWorld:true}),
 "browser.page.text":tool("chat-adapter","Read bounded visible or full text from the top frame of the claimed tab. Password values are not exposed.",obj({mode:{type:"string",enum:["visible","full"]}}),{openWorld:true}),
 "browser.page.click":tool("chat-adapter","Click an element in the exact claimed tab by stable ref or selector.",obj({ref:{type:"string"},selector:{type:"string"}},[],true),{mutating:true,destructive:true,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "credential.ref.list":tool("chat-adapter","List opaque credential references and usernames from the Windows user-bound DPAPI store. Secret values are never returned.",obj()),
 "browser.page.fill":tool("chat-adapter","Fill a field in the exact claimed tab by stable ref or selector. Provide either value or credential_ref+credential_field; credential secrets never enter the semantic command result.",{$schema:DRAFT,type:"object",additionalProperties:false,properties:{ref:{type:"string"},selector:{type:"string"},value:{type:"string"},credential_ref:S,credential_field:{type:"string",enum:["username","secret","password"]}},allOf:[{anyOf:[{required:["ref"]},{required:["selector"]}]},{anyOf:[{required:["value"]},{required:["credential_ref"]}]}]}, {mutating:true,destructive:true,idempotency:"replace_content",openWorld:true}),
 "browser.page.scroll":tool("chat-adapter","Scroll the exact claimed tab by direction or pixel amount.",obj({direction:{type:"string",enum:["up","down","top","bottom"]},pixels:{type:"number"}}),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "browser.page.wait":tool("chat-adapter","Wait in the exact claimed tab for selector/text or a short DOM-settled condition.",obj({selector:{type:"string"},text:{type:"string"},minCount:{type:"integer",minimum:1},settled:B,timeoutMs:{type:"integer",minimum:50,maximum:60000}},[],true),{openWorld:true}),
 "browser.page.screenshot":tool("chat-adapter","Capture the exact claimed tab through CDP and return a durable SOKNA artifact reference instead of inline image bytes.",obj({full_page:B}),{mutating:true,destructive:false,idempotency:"content_addressed",openWorld:true}),
 "browser.capture.batch":tool("chat-adapter","Capture up to 100 states/pages from the exact claimed tab as one resumable local operation. capture_id checkpoints each item, skips completed items after restart, and refuses blind replay of an interrupted mutating item.",obj({capture_id:{type:"string",pattern:"^[A-Za-z0-9._-]{1,96}$"},items:{type:"array",minItems:1,maxItems:100,items:{type:"object",additionalProperties:false,properties:{id:{type:"string",minLength:1,maxLength:80},url:{type:"string",minLength:1},actions:{type:"array",maxItems:10,items:{type:"object",additionalProperties:false,required:["action"],properties:{action:{type:"string",enum:["browser.page.click","browser.page.fill","browser.page.scroll","browser.page.wait"]},params:{type:"object"}}}},full_page:B,settle_ms:{type:"integer",minimum:0,maximum:10000}}}},stop_on_error:B},["capture_id","items"]),{mutating:true,destructive:false,idempotency:"id_guarded",openWorld:true,errors:["BROWSER_CAPTURE_PLAN_MISMATCH","BROWSER_CAPTURE_ITEM_OUTCOME_UNKNOWN"]}),
 "browser.qa.status":tool("agent","Report Browser QA runner availability and policy boundary.",obj()),
 "browser.live.capture.policy":tool("agent","Report consent and security policy for live-browser capture.",obj()),
 "browser.recipe.run":tool("agent","Run a compatibility browser recipe stored in a workspace JSON file.",obj({workspace:S,path:S,baseline_id:{type:"string"},run_id:{type:"string"},job_id:{type:"string"}},["workspace","path"]),{mutating:true,destructive:false,idempotency:"run_id_guarded",capabilities:["browser"],openWorld:true}),
 "browser.baseline.promote":tool("agent","Promote screenshots from a browser run into an immutable baseline.",obj({workspace:S,run_id:S,baseline_id:S,execute:B},["workspace","run_id","baseline_id"]),{mutating:true,destructive:false,idempotency:"baseline_id_guarded",capabilities:["browser"]}),
 "browser.audit.run":tool("broker","Run bounded multi-page Browser QA. Defaults to desktop 1366x768 and mobile 390x844 when viewports are omitted.",
   obj({
     workspace:S,
     allowed_origins:{type:"array",minItems:1,maxItems:20,items:{type:"string",pattern:"^https?://"}},
     viewports:{type:"array",maxItems:12,items:{type:"object",additionalProperties:false,required:["id","width","height"],properties:{id:S,width:{type:"integer",minimum:1},height:{type:"integer",minimum:1},dpr:{type:"number",exclusiveMinimum:0}}}},
     pages:{type:"array",minItems:1,maxItems:12,items:{type:"object",additionalProperties:true,required:["url"],properties:{id:{type:"string"},url:S,actions:{type:"array",items:{type:"object"}},assertions:{type:"array",items:{type:"object"}},captures:{type:"object"},setup:{type:"object"},visual:{type:"object"},baseline_id:{type:"string"}}}},
     job_id:{type:"string"}
   },["workspace","allowed_origins","pages"]),{mutating:true,destructive:false,idempotency:"new_audit_each_call",capabilities:["browser"],openWorld:true}),
 "workspace.list":tool("agent","List registered workspaces.",obj()),
 "workspace.inspect":tool("agent","Inspect one workspace and its effective base policy.",obj({workspace:S},["workspace"])),
 "workspace.register":tool("agent","Register a local workspace with explicit scopes and optional tools.",obj({id:S,display_name:{type:"string"},root:S,scopes,tools:strArr},["id","root","scopes"]),{mutating:true,destructive:false,idempotency:"id_guarded"}),
 "workspace.permissions.update":tool("agent","Replace workspace scopes and tool permissions atomically. tools may be an empty array.",obj({id:S,scopes,tools:strArr},["id","scopes","tools"]),{mutating:true,destructive:true,idempotency:"replace"}),
 "workspace.policy.status":tool("agent","Report base/effective policy for a workspace and optional grant/job context.",obj({workspace:S,grant_id:{type:"string"},job_id:{type:"string"}},["workspace"])),
 "file.list":tool("agent","List readable entries under a workspace-relative path.",obj({workspace:S,path:{type:"string"}},["workspace"]),{capabilities:["files.read"]}),
 "file.read":tool("agent","Read a bounded line range from a workspace-relative file.",obj({workspace:S,path:S,start_line:{type:"integer",minimum:1},line_count:{type:"integer",minimum:1}},["workspace","path"]),{capabilities:["files.read"]}),
 "file.search":tool("agent","Search text inside readable workspace files.",obj({workspace:S,query:S,glob:{type:"string"},max_results:{type:"integer",minimum:1}},["workspace","query"]),{capabilities:["files.read"]}),
 "file.write":tool("agent","Write UTF-8 content to a workspace-relative file.",obj({workspace:S,path:S,content:{type:"string"}},["workspace","path","content"]),{mutating:true,destructive:true,idempotency:"replace_content",capabilities:["files.write"]}),
 "file.replace":tool("agent","Replace exact text in a workspace-relative file.",obj({workspace:S,path:S,old:S,new:{type:"string"},expected_sha256:{type:"string"}},["workspace","path","old","new"]),{mutating:true,destructive:true,idempotency:"precondition_guarded",capabilities:["files.write"]}),
 "git.status":tool("agent","Return Git status for a workspace repository.",obj({workspace:S},["workspace"]),{capabilities:["git"]}),
 "git.diff":tool("agent","Return Git diff; cached=true selects staged diff.",obj({workspace:S,cached:B},["workspace"]),{capabilities:["git"]}),
 "git.add.paths":tool("agent","Stage exact workspace-relative paths.",obj({workspace:S,paths:{type:"array",minItems:1,items:S}},["workspace","paths"]),{mutating:true,destructive:false,idempotency:"safe_retry",capabilities:["git"]}),
 "git.commit":tool("agent","Create a Git commit from the current staged changes.",obj({workspace:S,message:S},["workspace","message"]),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",capabilities:["git"]}),
 "git.push":tool("agent","Push the current branch/upstream according to Agent policy.",obj({workspace:S},["workspace"]),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",capabilities:["git"],openWorld:true}),
 "job.get":tool("agent","Read durable state/result for one Agent job.",obj({id:S},["id"])),
 "job.submit":tool("agent","Submit a plan/job for background execution under workspace policy.",obj({workspace:S,path:S},["workspace","path"]),{mutating:true,destructive:false,idempotency:"job_id_or_plan_guarded"}),
 "job.batch":tool("agent","Execute an ordered batch of actions in one workspace.",obj({workspace:S,steps:{type:"array",minItems:1,items:{type:"object",additionalProperties:true,required:["name","action","params"],properties:{name:S,action:S,params:{type:"object"},stop_on_error:B}}}},["workspace","steps"]),{mutating:true,destructive:true,idempotency:"depends_on_steps"}),
 "job.list":tool("broker","List locally known jobs and owned processes.",obj({limit:{type:"integer",minimum:1,maximum:200}})),
 "job.events":tool("broker","Read recent job activity events.",obj({id:{type:"string"},limit:{type:"integer",minimum:1,maximum:500}})),
 "result.get":tool("agent","Read a bounded chunk from an Agent large-result reference.",obj({id:{type:"string",pattern:"^[a-f0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:12000}},["id"]))
};
function describe(name){
 const n=String(name||""),base=C[n];return base?Object.freeze({name:n,...base}):null;
}
function list(effective=[]){
 const names=[...new Set((effective||[]).map(String).filter(Boolean))].sort();
 return names.map(name=>{
   const t=describe(name);
   return {name,action:name,contracted:!!t,owner:(t?._meta?.["sokna/owner"]||"legacy"),read_only:t?.annotations?.readOnlyHint??null,idempotent:t?.annotations?.idempotentHint??null};
 });
}
function tools(effective=[]){return list(effective).filter(x=>x.contracted).map(x=>describe(x.name))}
globalThis[G]=Object.freeze({schema:"sokna-mcp-tool-registry-v1",mcp_schema:"Tool",json_schema_dialect:DRAFT,version:2,contracts:Object.freeze(C),describe,list,tools});
})();