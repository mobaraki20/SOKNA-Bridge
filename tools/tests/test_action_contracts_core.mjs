import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../../extension/chrome/action_contracts_core.js",import.meta.url),"utf8");
const ctx={URL,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);
const R=ctx.__SOKNA_ACTION_CONTRACTS_V1__;
if(!R||R.schema!=="sokna-mcp-tool-registry-v1"||R.version!==2)throw new Error("MCP-shaped registry missing");

const required=[
  "bridge.actions.list","bridge.action.describe","bridge.command.get","bridge.command.list",
  "browser.audit.run","browser.recipe.run","artifact.out.get","artifact.out.attach",
  "workspace.permissions.update","file.read","file.write","git.status","git.commit","job.batch"
];
for(const name of required){
  const t=R.describe(name);
  if(!t||t.name!==name)throw new Error("missing tool: "+name);
  if(!t.inputSchema||t.inputSchema.type!=="object")throw new Error("missing inputSchema: "+name);
  if(t.inputSchema.$schema!=="https://json-schema.org/draft/2020-12/schema")throw new Error("wrong schema dialect: "+name);
  if(!t.outputSchema||t.outputSchema.type!=="object")throw new Error("missing outputSchema: "+name);
  if(typeof t.annotations?.readOnlyHint!=="boolean")throw new Error("missing MCP annotations: "+name);
  if(typeof t.annotations?.idempotentHint!=="boolean")throw new Error("missing idempotency hint: "+name);
  if(!t._meta?.["sokna/owner"])throw new Error("missing SOKNA metadata: "+name);
}
const audit=R.describe("browser.audit.run").inputSchema;
if(!audit.required.includes("workspace")||!audit.required.includes("allowed_origins")||!audit.required.includes("pages"))throw new Error("browser audit required fields incomplete");
if(audit.properties.pages.minItems!==1||audit.properties.pages.maxItems!==12)throw new Error("browser audit pages bounds incorrect");
if(R.describe("browser.audit.run").annotations.openWorldHint!==true)throw new Error("browser open-world hint missing");
const perm=R.describe("workspace.permissions.update").inputSchema;
if(!perm.required.includes("tools")||perm.properties.tools.type!=="array")throw new Error("workspace tools contract incomplete");
if(R.describe("workspace.permissions.update").annotations.readOnlyHint!==false)throw new Error("permission mutation annotation incorrect");
const listing=R.list(["browser.audit.run","unknown.action"]);
if(!listing.find(x=>x.name==="browser.audit.run"&&x.contracted))throw new Error("contracted listing missing");
if(!listing.find(x=>x.name==="unknown.action"&&!x.contracted))throw new Error("legacy listing status missing");
const tools=R.tools(["browser.audit.run","unknown.action"]);
if(tools.length!==1||tools[0].name!=="browser.audit.run")throw new Error("MCP tools projection incorrect");


const agentCaps=JSON.parse(fs.readFileSync("native/runtime/v2.7.1/AGENT_CAPABILITIES.json","utf8"));
const bootstrapSrc=fs.readFileSync("extension/chrome/background_bootstrap.js","utf8");
const block=bootstrapSrc.match(/const bridgeLocalActions=\[([\s\S]*?)\];/);
if(!block)throw new Error("extension action catalog missing");
const extensionActions=[...block[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const effective=[...new Set([...(agentCaps.actions||[]),...extensionActions])].sort();
const missing=effective.filter(name=>!R.describe(name));
if(missing.length)throw new Error("uncontracted effective actions: "+missing.join(", "));
if(!R.describe("bridge.doctor"))throw new Error("doctor contract missing");
for(const name of effective){
  const t=R.describe(name);
  if(!t.inputSchema?.$schema||!t.outputSchema?.$schema)throw new Error("schema dialect missing: "+name);
  if(!t.annotations||typeof t.annotations.readOnlyHint!=="boolean"||typeof t.annotations.destructiveHint!=="boolean")throw new Error("annotations incomplete: "+name);
}

console.log("ACTION_CONTRACTS_CORE_PASS");
