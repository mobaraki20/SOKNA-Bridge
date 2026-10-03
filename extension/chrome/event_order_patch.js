(()=>{
"use strict";
if(globalThis.__SOKNA_EVENT_ORDER_PATCH_V1__)return;
if(typeof classifyPending!=="function")throw new Error("EVENT_ORDER_PATCH_RUNTIME_UNAVAILABLE");
const baseClassifyPending=classifyPending;
function isAccepted(row){const r=row?.[1];return r?.kind==="status-event"&&r?.result?.kind==="command-accepted"}
function age(row){const r=row?.[1]||{};return Number(r.acceptedAt||r.ts||0)}
classifyPending=function(seen,registered,t=now(),force=false){
  const out=baseClassifyPending(seen,registered,t,force);
  const promote=[];out.deferred=(out.deferred||[]).filter(row=>{if(isAccepted(row)){promote.push([row[0],row[1],"accepted-priority"]);return false}return true});
  out.retryEligible=[...promote,...(out.retryEligible||[])];
  out.retryEligible.sort((a,b)=>(isAccepted(a)?0:1)-(isAccepted(b)?0:1)||age(a)-age(b));
  return out;
};
globalThis.__SOKNA_EVENT_ORDER_PATCH_V1__=Object.freeze({schema:"sokna-event-order-patch-v1",version:1});
})();
