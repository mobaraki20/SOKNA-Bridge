(()=>{
"use strict";
const ACK_POLL_MS=2500;
const ACK_DEADLINE_MS=45000;
const MAX_ACK_POLLS=12;
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function normalize(rec,t=Date.now()){
  const r={...(rec||{})};
  if(r.posted)return {...r,deliveryState:"acknowledged",submitted:!!r.submitted,ackPolls:n(r.ackPolls),presentationFinal:true};
  if(r.deliveryState==="delivery_uncertain"){
    return {...r,deliveryState:"presentation_expired",presentationFinal:true,ackPolls:n(r.ackPolls),waitReason:"presentation_unverified",nextPostAt:0,actionRequired:false};
  }
  if(r.deliveryState)return {...r,ackPolls:n(r.ackPolls),presentationFinal:r.deliveryState==="presentation_expired"||!!r.presentationFinal};
  const legacySubmitted=r.submitted===true||r.waitReason==="awaiting_conversation_ack";
  if(legacySubmitted){
    const submittedAt=n(r.submittedAt)||n(r.completedAt)||n(r.acceptedAt)||n(r.ts)||t;
    const deadline=n(r.ackDeadlineAt)||submittedAt+ACK_DEADLINE_MS;
    if(t>=deadline)return {...r,submitted:true,deliveryState:"presentation_expired",presentationFinal:true,submittedAt,ackDeadlineAt:deadline,ackPolls:n(r.ackPolls),waitReason:"presentation_unverified",nextPostAt:0,actionRequired:false};
    return {...r,submitted:true,deliveryState:"submitted_awaiting_ack",presentationFinal:false,submittedAt,ackDeadlineAt:deadline,ackPolls:n(r.ackPolls)};
  }
  return {...r,submitted:false,deliveryState:"queued",presentationFinal:false,ackPolls:n(r.ackPolls)};
}
function markSubmitted(rec,t=Date.now()){
  const r=normalize(rec,t),submittedAt=n(r.submittedAt)||t;
  return {...r,submitted:true,deliveryState:"submitted_awaiting_ack",presentationFinal:false,submittedAt,ackDeadlineAt:n(r.ackDeadlineAt)||submittedAt+ACK_DEADLINE_MS,ackPolls:n(r.ackPolls),waitReason:"awaiting_conversation_ack",nextPostAt:t+ACK_POLL_MS,actionRequired:false};
}
function markAcknowledged(rec,method,t=Date.now()){
  const r=normalize(rec,t);
  return {...r,posted:true,postedAt:n(r.postedAt)||t,deliveryState:"acknowledged",presentationFinal:true,waitReason:"",nextPostAt:0,postMethod:String(method||r.postMethod||"conversation-ack"),postError:"",actionRequired:false};
}
function markPresentationExpired(rec,t=Date.now()){
  const r={...(rec||{})},deadline=n(r.ackDeadlineAt)||(n(r.submittedAt)||t)+ACK_DEADLINE_MS;
  return {...r,submitted:true,deliveryState:"presentation_expired",presentationFinal:true,ackDeadlineAt:deadline,waitReason:"presentation_unverified",nextPostAt:0,actionRequired:false,presentationExpiredAt:n(r.presentationExpiredAt)||t};
}
function pollResult(rec,visible,t=Date.now()){
  const r=normalize(rec,t);
  if(visible)return {record:markAcknowledged(r,"conversation-ack",t),state:"acknowledged",retry:false};
  if(r.deliveryState==="presentation_expired"){
    return {record:{...r,manualVisibilityChecks:n(r.manualVisibilityChecks)+1,lastVisibilityCheckAt:t},state:"presentation_expired",retry:false};
  }
  const polls=n(r.ackPolls)+1;
  const deadline=n(r.ackDeadlineAt)||(n(r.submittedAt)||t)+ACK_DEADLINE_MS;
  const expired=t>=deadline||polls>=MAX_ACK_POLLS;
  if(expired){
    return {record:markPresentationExpired({...r,ackPolls:polls,ackDeadlineAt:deadline},t),state:"presentation_expired",retry:false};
  }
  return {record:{...r,deliveryState:"submitted_awaiting_ack",presentationFinal:false,ackPolls:polls,ackDeadlineAt:deadline,waitReason:"awaiting_conversation_ack",nextPostAt:t+ACK_POLL_MS},state:"submitted_awaiting_ack",retry:true};
}
function mode(rec,t=Date.now(),force=false){
  const r=normalize(rec,t);
  if(r.posted||r.deliveryState==="acknowledged")return "none";
  if(r.deliveryState==="presentation_expired")return force?"ack_poll":"none";
  if(r.deliveryState==="submitted_awaiting_ack"){
    if(t>=n(r.ackDeadlineAt)||n(r.ackPolls)>=MAX_ACK_POLLS)return force?"ack_poll":"expire";
    if(force||!r.nextPostAt||r.nextPostAt<=t)return "ack_poll";
    return "deferred";
  }
  if(!force&&r.nextPostAt&&r.nextPostAt>t)return "deferred";
  return "send";
}
globalThis.__SOKNA_DELIVERY_STATE_CORE_V1__={ACK_POLL_MS,ACK_DEADLINE_MS,MAX_ACK_POLLS,normalize,markSubmitted,markAcknowledged,markPresentationExpired,pollResult,mode};
})();