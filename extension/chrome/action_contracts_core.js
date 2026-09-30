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
 "artifact.out.get":tool("broker","Read a bounded base64 chunk from a durable outbound artifact.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:524288}},["id"])),
 "artifact.out.info":tool("broker","Return metadata for a durable outbound artifact.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},["id"])),
 "artifact.out.list":tool("broker","List durable outbound artifacts.",obj({limit:{type:"integer",minimum:1,maximum:200}})),
 "artifact.out.attach":tool("chat-adapter","Attach a durable artifact to the active Chat. Delivery defers while the Assistant is generating.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},["id"]),{mutating:true,destructive:false,idempotency:"delivery_idempotent",errors:["ATTACHMENT_ASSISTANT_BUSY","ATTACHMENT_USER_DRAFT_PRESENT"]}),
 "artifact.out.publish":tool("broker","Publish a file already inside ArtifactRoot into the durable outbound artifact namespace.",obj({path:S,name:{type:"string"}},["path"]),{mutating:true,destructive:false,idempotency:"content_addressed"}),
 "browser.backend.status":tool("chat-adapter","Report the real-browser backend policy and availability. Browser target access is exact-tab and approved-origin only.",obj()),
 "browser.tabs.list":tool("chat-adapter","List tabs whose HTTP/HTTPS origins were explicitly approved for SOKNA Browser tools.",obj(),{outputSchema:okOut}),
 "browser.tab.open":tool("chat-adapter","Open a URL only when its origin was explicitly approved, and claim the new tab for this conversation by default.",obj({url:S,claim:B},["url"]),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "browser.tab.claim":tool("chat-adapter","Bind one approved browser tab to the current Chat conversation. Subsequent page actions target that exact tab id.",obj({tab_id:{type:"integer",minimum:1}},["tab_id"]),{mutating:true,destructive:false,idempotency:"replace"}),
 "browser.tab.release":tool("chat-adapter","Release the browser-tab binding for the current Chat conversation.",obj(),{mutating:true,destructive:false,idempotency:"safe_retry"}),
 "browser.page.snapshot":tool("chat-adapter","Return a bounded accessibility-style snapshot of interactive elements in the top frame of the claimed tab with stable refs.",obj(),{openWorld:true}),
 "browser.page.text":tool("chat-adapter","Read bounded visible or full text from the top frame of the claimed tab. Password values are not exposed.",obj({mode:{type:"string",enum:["visible","full"]}}),{openWorld:true}),
 "browser.page.click":tool("chat-adapter","Click an element in the exact claimed tab by stable ref or selector.",obj({ref:{type:"string"},selector:{type:"string"}},[],true),{mutating:true,destructive:true,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "browser.page.fill":tool("chat-adapter","Fill a field in the exact claimed tab by stable ref or selector. This action accepts an explicit value; credential-ref fill is a separate control-plane feature.",obj({ref:{type:"string"},selector:{type:"string"},value:{type:"string"}},["value"],true),{mutating:true,destructive:true,idempotency:"replace_content",openWorld:true}),
 "browser.page.scroll":tool("chat-adapter","Scroll the exact claimed tab by direction or pixel amount.",obj({direction:{type:"string",enum:["up","down","top","bottom"]},pixels:{type:"number"}}),{mutating:true,destructive:false,idempotency:"not_safe_to_blind_retry",openWorld:true}),
 "browser.page.wait":tool("chat-adapter","Wait in the exact claimed tab for selector/text or a short DOM-settled condition.",obj({selector:{type:"string"},text:{type:"string"},minCount:{type:"integer",minimum:1},settled:B,timeoutMs:{type:"integer",minimum:50,maximum:60000}},[],true),{openWorld:true}),
 "browser.page.screenshot":tool("chat-adapter","Capture the exact claimed tab through CDP and return a durable SOKNA artifact reference instead of inline image bytes.",obj({full_page:B}),{mutating:true,destructive:false,idempotency:"content_addressed",openWorld:true}),
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