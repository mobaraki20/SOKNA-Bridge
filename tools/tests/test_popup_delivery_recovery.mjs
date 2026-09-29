import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src=fs.readFileSync("extension/chrome/popup_state_core.js","utf8");
const ctx={globalThis:null,String};
ctx.globalThis=ctx;
vm.runInNewContext(src,ctx,{filename:"popup_state_core.js"});
const P=ctx.__SOKNA_POPUP_STATE_V1__;
assert.ok(P,"popup state core missing");

const uncertain={
  armed:true,
  status:{state:"Needs Action",actionRequired:true,transportVerified:false,currentCommandId:"web-error-diagnostics-20260929-012",lastError:"Delivery uncertain"},
  health:{transportVerified:true,deliveryState:"delivery_uncertain",currentCommandId:"web-error-diagnostics-20260929-012",connectionProbe:{verified:true,agent:{ok:true},delivery:{ready:true},semantic:{ok:true}}}
};
let d=P.describeChat(uncertain);
assert.equal(d.dot,"warn","Needs Action must never render green");
assert.match(d.text,/Needs Action/);
assert.notEqual(d.text,"Connected — End-to-End Verified");
let r=P.recoveryModel(uncertain);
assert.equal(r.visible,true,"delivery_uncertain must expose recovery UI");
assert.equal(r.recordId,"web-error-diagnostics-20260929-012");

const contradictory={
  armed:true,
  status:{state:"Needs Action",actionRequired:true,transportVerified:false,currentCommandId:"x"},
  health:{transportVerified:true,deliveryState:"",connectionProbe:{verified:true,agent:{ok:true},delivery:{ready:true},semantic:{ok:true}}}
};
d=P.describeChat(contradictory);
assert.equal(d.dot,"warn","status Needs Action must override probe/health green");
assert.notEqual(d.text,"Connected — End-to-End Verified");

const statusFalseHealthTrue={
  armed:true,
  status:{state:"Waiting",actionRequired:false,transportVerified:false},
  health:{transportVerified:true,connectionProbe:{verified:true,agent:{ok:true},delivery:{ready:true},semantic:{ok:true}}}
};
d=P.describeChat(statusFalseHealthTrue);
assert.notEqual(d.dot,"ok","health.transportVerified alone must not render green");
assert.notEqual(d.text,"Connected — End-to-End Verified");

const verified={
  armed:true,
  status:{state:"Ready",actionRequired:false,transportVerified:true},
  health:{transportVerified:true,deliveryState:"",connectionProbe:{verified:true,agent:{ok:true},delivery:{ready:true},semantic:{ok:true}}}
};
d=P.describeChat(verified);
assert.equal(d.dot,"ok");
assert.equal(d.text,"Connected — End-to-End Verified");
r=P.recoveryModel(verified);
assert.equal(r.visible,false);

const popup=fs.readFileSync("extension/chrome/popup.js","utf8");
const html=fs.readFileSync("extension/chrome/popup.html","utf8");
const bg=fs.readFileSync("extension/chrome/background.js","utf8");

assert.ok(popup.includes('chrome.runtime.getManifest().version'),"popup version must come from manifest");
assert.ok(!html.includes("Extension 3.12.0"),"popup must not hard-code stale extension version");
for(const marker of ["deliveryRecovery","recheckDelivery","RECHECK_DELIVERY"]){
  assert.ok((popup+html).includes(marker),`popup recovery UI missing ${marker}`);
}
const hStart=bg.indexOf('if(m.type==="RECHECK_DELIVERY")');
const hEnd=bg.indexOf('if(m.type==="DELIVERY_READY")',hStart);
assert.ok(hStart>=0&&hEnd>hStart,"RECHECK_DELIVERY handler missing");
const handler=bg.slice(hStart,hEnd);
assert.ok(handler.includes("postPending(tabId,target[0],target[1],true)"),"manual recovery must force ACK poll path");
assert.ok(handler.includes("visibility_only:true"),"manual recovery must declare visibility-only");
assert.ok(handler.includes("resubmitted:false"),"manual recovery must declare no resubmit");
assert.ok(!handler.includes("POST_RESULT"),"manual recovery handler must never send POST_RESULT directly");
assert.ok(bg.includes("transportVerified:status?.transportVerified===true"),"health transportVerified must use authoritative final status");

console.log("POPUP_DELIVERY_RECOVERY_PASS");