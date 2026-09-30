import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src=fs.readFileSync("extension/chrome/delivery_state_core.js","utf8");
const ctx={globalThis:null,Date,Number,String,Math};
ctx.globalThis=ctx;
vm.runInNewContext(src,ctx,{filename:"delivery_state_core.js"});
const D=ctx.__SOKNA_DELIVERY_STATE_CORE_V1__;
assert.ok(D,"delivery state core missing");

const t0=1_000_000;
const queued={state:"done",posted:false,acceptedAt:t0,result:{ok:true}};
assert.equal(D.mode(queued,t0,false),"send","fresh result must be sendable");

const submitted=D.markSubmitted(queued,t0);
assert.equal(submitted.deliveryState,"submitted_awaiting_ack");
assert.equal(submitted.submitted,true);
assert.equal(D.mode(submitted,t0,false),"deferred","submitted result must wait before ACK poll");
assert.equal(D.mode(submitted,submitted.nextPostAt,false),"ack_poll","submitted result must become ACK-poll eligible, never resend");

let cur=submitted;
for(let i=0;i<D.MAX_ACK_POLLS-1;i++){
  const out=D.pollResult(cur,false,(cur.nextPostAt||t0)+1);
  cur=out.record;
  assert.notEqual(out.state,"presentation_expired","ACK budget expired too early");
  assert.equal(D.mode(cur,cur.nextPostAt,false),"ack_poll");
}
const exhausted=D.pollResult(cur,false,(cur.nextPostAt||t0)+1);
assert.equal(exhausted.state,"presentation_expired","missing ACK must terminalize presentation after bounded polling");
assert.equal(exhausted.record.nextPostAt,0);
assert.equal(exhausted.record.presentationFinal,true);
assert.equal(exhausted.record.actionRequired,false);
assert.equal(D.mode(exhausted.record,t0+999999,false),"none","expired presentation must leave the active queue");
assert.equal(D.mode(exhausted.record,t0+999999,true),"ack_poll","manual recovery may visibility-check without resubmission");

const manualMiss=D.pollResult(exhausted.record,false,t0+1_000_000);
assert.equal(manualMiss.state,"presentation_expired","failed manual visibility check remains terminal");
assert.equal(D.mode(manualMiss.record,t0+1_000_001,false),"none");
assert.equal(manualMiss.record.submitted,true);
assert.equal(manualMiss.record.manualVisibilityChecks,1);

const visible=D.pollResult(submitted,true,t0+3000);
assert.equal(visible.state,"acknowledged");
assert.equal(visible.record.posted,true);
assert.equal(visible.record.deliveryState,"acknowledged");

const legacyUncertain=D.normalize({state:"done",posted:false,submitted:true,deliveryState:"delivery_uncertain",ackPolls:65,acceptedAt:t0,result:{ok:true}},t0+5000);
assert.equal(legacyUncertain.deliveryState,"presentation_expired","r9 delivery_uncertain records must migrate to terminal presentation history");
assert.equal(legacyUncertain.actionRequired,false);
assert.equal(D.mode(legacyUncertain,t0+5000,false),"none","legacy uncertain record must never poll automatically");

const legacyAwaiting=D.normalize({state:"done",posted:false,waitReason:"awaiting_conversation_ack",acceptedAt:t0,result:{ok:true}},t0+D.ACK_DEADLINE_MS+100);
assert.equal(legacyAwaiting.deliveryState,"presentation_expired","old awaiting-ACK records must expire during migration");
assert.equal(D.mode(legacyAwaiting,t0+D.ACK_DEADLINE_MS+100,false),"none");

const bg=fs.readFileSync("extension/chrome/background.js","utf8");
for(const marker of ["CHECK_RESULT_VISIBLE","chat.delivery_ack_poll","chat.presentation_expired","presentation_expired","DELIVERY.markSubmitted","DELIVERY.markPresentationExpired","DELIVERY.pollResult"]){
  assert.ok(bg.includes(marker),`background missing ${marker}`);
}
assert.ok(!bg.includes('setTimeout(()=>retryPending(tabId).catch(()=>{}),delay);\n      return {ok:false,waiting:false,reason:"delivery_uncertain"}'),"expired presentation must not remain in the automatic retry loop");
assert.ok(bg.includes("expiredPresentationCount"),"health must expose historical presentation expiry without poisoning execution");

console.log("DELIVERY_STATE_MACHINE_PASS");
