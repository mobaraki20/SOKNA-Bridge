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
  assert.notEqual(out.state,"delivery_uncertain","ACK budget expired too early");
  assert.equal(D.mode(cur,cur.nextPostAt,false),"ack_poll");
}
const exhausted=D.pollResult(cur,false,(cur.nextPostAt||t0)+1);
assert.equal(exhausted.state,"delivery_uncertain","missing ACK must become bounded uncertain state");
assert.equal(exhausted.record.nextPostAt,0);
assert.equal(D.mode(exhausted.record,t0+999999,false),"uncertain","uncertain delivery must not auto-resend");
assert.equal(D.mode(exhausted.record,t0+999999,true),"ack_poll","manual recovery may visibility-check but must still not send");

const visible=D.pollResult(submitted,true,t0+3000);
assert.equal(visible.state,"acknowledged");
assert.equal(visible.record.posted,true);
assert.equal(visible.record.deliveryState,"acknowledged");

const legacy=D.normalize({state:"done",posted:false,waitReason:"awaiting_conversation_ack",acceptedAt:t0,result:{ok:true}},t0+5000);
assert.equal(legacy.deliveryState,"submitted_awaiting_ack","r6 pending records must migrate fail-safe to submitted state");
assert.equal(D.mode(legacy,legacy.nextPostAt||t0+5000,true),"ack_poll","legacy awaiting ACK must never be treated as unsent");

const bg=fs.readFileSync("extension/chrome/background.js","utf8");
for(const marker of ["CHECK_RESULT_VISIBLE","chat.delivery_ack_poll","chat.delivery_uncertain","delivery_uncertain","DELIVERY.markSubmitted","DELIVERY.pollResult"]){
  assert.ok(bg.includes(marker),`background missing ${marker}`);
}
assert.ok(!bg.includes('p?.reason==="awaiting_conversation_ack"?0:1'),"legacy unbounded awaiting-ACK accounting must be removed");

console.log("DELIVERY_STATE_MACHINE_PASS");
