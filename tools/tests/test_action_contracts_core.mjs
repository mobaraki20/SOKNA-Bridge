import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../../extension/chrome/action_contracts_core.js",import.meta.url),"utf8");
const ctx={URL,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);
const R=ctx.__SOKNA_ACTION_CONTRACTS_V1__;
if(!R||R.schema!=="sokna-action-registry-v1")throw new Error("registry missing");

const required=[
  "bridge.actions.list","bridge.action.describe","bridge.command.get","bridge.command.list",
  "browser.audit.run","browser.recipe.run","artifact.out.get","artifact.out.attach",
  "workspace.permissions.update","file.read","file.write","git.status","git.commit","job.batch"
];
for(const name of required){
  const c=R.describe(name);
  if(!c)throw new Error("missing contract: "+name);
  if(c.schema!=="sokna-action-contract-v1")throw new Error("bad contract schema: "+name);
  if(!c.input_schema||c.input_schema.type!=="object")throw new Error("missing input schema: "+name);
  if(!c.output_schema||c.output_schema.type!=="object")throw new Error("missing output schema: "+name);
  if(typeof c.mutating!=="boolean")throw new Error("missing mutability: "+name);
  if(!c.idempotency)throw new Error("missing idempotency: "+name);
}
const audit=R.describe("browser.audit.run").input_schema;
if(!audit.required.includes("workspace")||!audit.required.includes("allowed_origins")||!audit.required.includes("pages"))throw new Error("browser audit required fields incomplete");
if(audit.properties.pages.minItems!==1||audit.properties.pages.maxItems!==12)throw new Error("browser audit pages bounds incorrect");
const perm=R.describe("workspace.permissions.update").input_schema;
if(!perm.required.includes("tools")||perm.properties.tools.type!=="array")throw new Error("workspace tools contract incomplete");
const listing=R.list(["browser.audit.run","unknown.action"]);
if(!listing.find(x=>x.action==="browser.audit.run"&&x.contracted))throw new Error("contracted listing missing");
if(!listing.find(x=>x.action==="unknown.action"&&!x.contracted))throw new Error("legacy listing status missing");

console.log("ACTION_CONTRACTS_CORE_PASS");
