(()=>{
"use strict";
const G="__SOKNA_ACTION_CONTRACTS_V1__";if(globalThis[G])return;
const S={type:"string",minLength:1}, B={type:"boolean"}, I={type:"integer"}, N={type:"number"};
const strArr={type:"array",items:{type:"string"}};
const scope={type:"object",additionalProperties:false,required:["path","access"],properties:{path:S,access:{type:"string",enum:["read","write","deny"]}}};
const scopes={type:"array",items:scope};
const obj=(properties={},required=[],additionalProperties=false)=>({type:"object",additionalProperties,properties,required});
const okOut={type:"object",required:["ok"],properties:{ok:B},additionalProperties:true};
const contract=(owner,description,input_schema,{mutating=false,idempotency="safe_retry",capabilities=[],output_schema=okOut,errors=[]}={})=>({
 schema:"sokna-action-contract-v1",owner,description,input_schema,output_schema,mutating,idempotency,required_capabilities:capabilities,errors
});
const C={
 "bridge.actions.list":contract("chat-adapter","List effective Bridge actions and contract migration status.",obj(),{output_schema:okOut}),
 "bridge.action.describe":contract("chat-adapter","Return the machine-readable contract for one Bridge action.",obj({action:S},["action"]),{output_schema:okOut}),
 "bridge.command.get":contract("broker","Recover one durable command outcome in the current conversation scope.",obj({id:S},["id"]),{output_schema:okOut,errors:["invalid command id","not found"]}),
 "bridge.command.list":contract("broker","List durable command outcomes for the current conversation using a monotonic cursor.",obj({since_sequence:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:200}},[]),{output_schema:okOut}),
 "bridge.bootstrap":contract("chat-adapter","Check Bridge readiness and active session for this Chat.",obj(),[],{output_schema:okOut}),
 "bridge.diagnostics.get":contract("chat-adapter","Return bounded diagnostics for the active Chat and local Bridge.",obj(),[],{output_schema:okOut}),
 "artifact.out.get":contract("broker","Read a bounded base64 chunk from a durable outbound artifact.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:524288}},["id"]),{output_schema:okOut}),
 "artifact.out.info":contract("broker","Return metadata for a durable outbound artifact.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},["id"]),{output_schema:okOut}),
 "artifact.out.list":contract("broker","List durable outbound artifacts.",obj({limit:{type:"integer",minimum:1,maximum:200}},[]),{output_schema:okOut}),
 "artifact.out.attach":contract("chat-adapter","Attach a durable artifact to the active Chat. Delivery defers while the Assistant is generating.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"}},["id"]),{mutating:true,idempotency:"delivery_idempotent",output_schema:okOut,errors:["ATTACHMENT_ASSISTANT_BUSY","ATTACHMENT_USER_DRAFT_PRESENT"]}),
 "artifact.out.publish":contract("broker","Publish a file already inside ArtifactRoot into the durable outbound artifact namespace.",obj({path:S,name:{type:"string"}},["path"]),{mutating:true,idempotency:"content_addressed",output_schema:okOut}),
 "browser.qa.status":contract("agent","Report Browser QA runner availability and policy boundary.",obj(),[],{output_schema:okOut}),
 "browser.live.capture.policy":contract("agent","Report consent and security policy for live-browser capture.",obj(),[],{output_schema:okOut}),
 "browser.recipe.run":contract("agent","Run a compatibility browser recipe stored in a workspace JSON file.",obj({workspace:S,path:S,baseline_id:{type:"string"},run_id:{type:"string"},job_id:{type:"string"}},["workspace","path"]),{mutating:true,idempotency:"run_id_guarded",capabilities:["browser"],output_schema:okOut}),
 "browser.baseline.promote":contract("agent","Promote screenshots from a browser run into an immutable baseline.",obj({workspace:S,run_id:S,baseline_id:S,execute:B},["workspace","run_id","baseline_id"]),{mutating:true,idempotency:"baseline_id_guarded",capabilities:["browser"],output_schema:okOut}),
 "browser.audit.run":contract("broker","Run bounded multi-page Browser QA. Defaults to desktop 1366x768 and mobile 390x844 when viewports are omitted.",
   obj({
     workspace:S,
     allowed_origins:{type:"array",minItems:1,maxItems:20,items:{type:"string",pattern:"^https?://"}},
     viewports:{type:"array",maxItems:12,items:obj({id:S,width:{type:"integer",minimum:1},height:{type:"integer",minimum:1},dpr:{type:"number",exclusiveMinimum:0}},["id","width","height"])},
     pages:{type:"array",minItems:1,maxItems:12,items:obj({id:{type:"string"},url:S,actions:{type:"array",items:{type:"object"}},assertions:{type:"array",items:{type:"object"}},captures:{type:"object"},setup:{type:"object"},visual:{type:"object"},baseline_id:{type:"string"}},["url"],true)},
     job_id:{type:"string"}
   },["workspace","allowed_origins","pages"]),{mutating:true,idempotency:"new_audit_each_call",capabilities:["browser"],output_schema:okOut}),
 "workspace.list":contract("agent","List registered workspaces.",obj(),[],{output_schema:okOut}),
 "workspace.inspect":contract("agent","Inspect one workspace and its effective base policy.",obj({workspace:S},["workspace"]),{output_schema:okOut}),
 "workspace.register":contract("agent","Register a local workspace with explicit scopes and optional tools.",obj({id:S,display_name:{type:"string"},root:S,scopes,tools:strArr},["id","root","scopes"]),{mutating:true,idempotency:"id_guarded",output_schema:okOut}),
 "workspace.permissions.update":contract("agent","Replace workspace scopes and tool permissions atomically. tools may be an empty array.",obj({id:S,scopes,tools:strArr},["id","scopes","tools"]),{mutating:true,idempotency:"replace",output_schema:okOut}),
 "workspace.policy.status":contract("agent","Report base/effective policy for a workspace and optional grant/job context.",obj({workspace:S,grant_id:{type:"string"},job_id:{type:"string"}},["workspace"]),{output_schema:okOut}),
 "file.list":contract("agent","List readable entries under a workspace-relative path.",obj({workspace:S,path:{type:"string"}},["workspace"]),{capabilities:["files.read"],output_schema:okOut}),
 "file.read":contract("agent","Read a bounded line range from a workspace-relative file.",obj({workspace:S,path:S,start_line:{type:"integer",minimum:1},line_count:{type:"integer",minimum:1}},["workspace","path"]),{capabilities:["files.read"],output_schema:okOut}),
 "file.search":contract("agent","Search text inside readable workspace files.",obj({workspace:S,query:S,glob:{type:"string"},max_results:{type:"integer",minimum:1}},["workspace","query"]),{capabilities:["files.read"],output_schema:okOut}),
 "file.write":contract("agent","Write UTF-8 content to a workspace-relative file.",obj({workspace:S,path:S,content:{type:"string"}},["workspace","path","content"]),{mutating:true,idempotency:"replace_content",capabilities:["files.write"],output_schema:okOut}),
 "file.replace":contract("agent","Replace exact text in a workspace-relative file.",obj({workspace:S,path:S,old:S,new:{type:"string"},expected_sha256:{type:"string"}},["workspace","path","old","new"]),{mutating:true,idempotency:"precondition_guarded",capabilities:["files.write"],output_schema:okOut}),
 "git.status":contract("agent","Return Git status for a workspace repository.",obj({workspace:S},["workspace"]),{capabilities:["git"],output_schema:okOut}),
 "git.diff":contract("agent","Return Git diff; cached=true selects staged diff.",obj({workspace:S,cached:B},["workspace"]),{capabilities:["git"],output_schema:okOut}),
 "git.add.paths":contract("agent","Stage exact workspace-relative paths.",obj({workspace:S,paths:{type:"array",minItems:1,items:S}},["workspace","paths"]),{mutating:true,idempotency:"safe_retry",capabilities:["git"],output_schema:okOut}),
 "git.commit":contract("agent","Create a Git commit from the current staged changes.",obj({workspace:S,message:S},["workspace","message"]),{mutating:true,idempotency:"not_safe_to_blind_retry",capabilities:["git"],output_schema:okOut}),
 "git.push":contract("agent","Push the current branch/upstream according to Agent policy.",obj({workspace:S},["workspace"]),{mutating:true,idempotency:"not_safe_to_blind_retry",capabilities:["git"],output_schema:okOut}),
 "job.get":contract("agent","Read durable state/result for one Agent job.",obj({id:S},["id"]),{output_schema:okOut}),
 "job.submit":contract("agent","Submit a plan/job for background execution under workspace policy.",obj({workspace:S,path:S},["workspace","path"]),{mutating:true,idempotency:"job_id_or_plan_guarded",output_schema:okOut}),
 "job.batch":contract("agent","Execute an ordered batch of actions in one workspace.",obj({workspace:S,steps:{type:"array",minItems:1,items:obj({name:S,action:S,params:{type:"object"},stop_on_error:B},["name","action","params"],true)}},["workspace","steps"]),{mutating:true,idempotency:"depends_on_steps",output_schema:okOut}),
 "job.list":contract("broker","List locally known jobs and owned processes.",obj({limit:{type:"integer",minimum:1,maximum:200}},[]),{output_schema:okOut}),
 "job.events":contract("broker","Read recent job activity events.",obj({id:{type:"string"},limit:{type:"integer",minimum:1,maximum:500}},[]),{output_schema:okOut}),
 "result.get":contract("agent","Read a bounded chunk from an Agent large-result reference.",obj({id:{type:"string",pattern:"^[a-f0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:12000}},["id"]),{output_schema:okOut})
};
function describe(name){return C[String(name||"")]||null}
function list(effective=[]){
 const names=[...new Set((effective||[]).map(String).filter(Boolean))].sort();
 return names.map(name=>({action:name,contracted:!!C[name],owner:C[name]?.owner||"legacy",mutating:C[name]?.mutating??null,idempotency:C[name]?.idempotency||"unknown"}));
}
globalThis[G]=Object.freeze({schema:"sokna-action-registry-v1",version:1,contracts:Object.freeze(C),describe,list});
})();