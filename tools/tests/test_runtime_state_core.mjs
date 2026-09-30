import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src=fs.readFileSync("extension/chrome/runtime_state_core.js","utf8");
const ctx={globalThis:null,Date,String};ctx.globalThis=ctx;vm.runInNewContext(src,ctx,{filename:"runtime_state_core.js"});
const R=ctx.__SOKNA_RUNTIME_STATE_CORE_V1__;assert.ok(R);

let s={state:"Ready"};
s={...s,...R.executionStart(s,"cmd-new","workspace.list",10)};
assert.equal(s.currentCommandId,"cmd-new");assert.equal(s.executionState,"running");

s={...s,...R.deliveryUpdate(s,{recordId:"old-result",commandId:"cmd-old",deliveryState:"delivery_uncertain",uiState:"Needs Action",detail:"old delivery uncertain",actionRequired:true})};
assert.equal(s.currentCommandId,"cmd-new","older delivery must never replace the executing command id");
assert.equal(s.state,"Working","presentation delivery must not override running execution");
assert.equal(s.deliveryPendingCommandId,"cmd-old");
assert.equal(s.presentationState,"Needs Action");

s={...s,...R.executionFinish(s,"cmd-new",true,"",20)};
assert.equal(s.currentCommandId,"");assert.equal(s.executionState,"completed");
assert.equal(s.state,"Ready","stale presentation failure must not poison completed execution truth");
assert.equal(s.deliveryPendingCommandId,"cmd-old","delivery telemetry remains inspectable");
assert.equal(s.presentationState,"Needs Action","presentation state remains separately visible");

let failed={...s,...R.executionStart(s,"cmd-fail","file.write",30)};
failed={...failed,...R.executionFinish(failed,"cmd-fail",false,"write failed",40)};
assert.equal(failed.executionState,"failed");assert.equal(failed.state,"Error");assert.equal(failed.lastError,"write failed");

const newer={...failed,...R.executionStart(failed,"cmd-next","ping",50)};
const clear=R.deliveryClear(newer,"old-result",{uiState:"Ready"});
const after={...newer,...clear};
assert.equal(after.currentCommandId,"cmd-next","ACK of old delivery must not clear newer execution");
assert.equal(after.state,"Working","presentation ACK must not replace execution state");
assert.equal(after.presentationState,"Ready");

console.log("RUNTIME_STATE_CORE_PASS");
