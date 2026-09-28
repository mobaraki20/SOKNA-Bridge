(()=>{
"use strict";
const ACK_POLL_MS=2500;
const ACK_DEADLINE_MS=45000;
const MAX_ACK_POLLS=12;
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function normalize(rec,t=Date.now()){
  const r={...(rec||{})};
  if(r.posted)return {...r,deliveryState:"acknowledged",submitted:!!r.submitted,ackPolls:n(r.ackPolls)};
  if(r.deliveryState)return {...r,ackPolls:n(r.ackPolls)};
  const legacySubmitted=r.submitted===true||r.waitReason==="awaiting_conversation_ack";
  if(legacySubmitted){
    const submittedAt=n(r.submittedAt)||n(r.completedAt)||n(r.acceptedAt)||n(r.ts)||t;
    return {...r,submitted:true,deliveryState:"submitted_awaiting_ack",submittedAt,ackDeadlineAt:n(r.ackDeadlineAt)||submittedAt+ACK_DEADLINE_MS,ackPolls:n(r.ackPolls)};
  }
  return {...r,submitted:false,deliveryState:"queued",ackPolls:n(r.ackPolls)};
}
function markSubmitted(rec,t=Date.now()){
  const r=normalize(rec,t),submittedAt=n(r.submittedAt)||t;
  return {...r,submitted:true,deliveryState:"submitted_awaiting_ack",submittedAt,ackDeadlineAt:n(r.ackDeadlineAt)||submittedAt+ACK_DEADLINE_MS,ackPolls:n(r.ackPolls),waitReason:"awaiting_conversation_ack",nextPostAt:t+ACK_POLL_MS};
}
function markAcknowledged(rec,method,t=Date.now()){
  const r=normalize(rec,t);
  return {...r,posted:true,postedAt:n(r.postedAt)||t,deliveryState:"acknowledged",waitReason:"",nextPostAt:0,postMethod:String(method||r.postMethod||"conversation-ack"),postError:""};
}
function pollResult(rec,visible,t=Date.now()){
  const r=normalize(rec,t);
  if(visible)return {record:markAcknowledged(r,"conversation-ack",t),state:"acknowledged",retry:false};
  const polls=n(r.ackPolls)+1;
  const deadline=n(r.ackDeadlineAt)||(n(r.submittedAt)||t)+ACK_DEADLINE_MS;
  const expired=t>=deadline||polls>=MAX_ACK_POLLS;
  if(expired){
    return {record:{...r,deliveryState:"delivery_uncertain",ackPolls:polls,ackDeadlineAt:deadline,waitReason:"delivery_uncertain",nextPostAt:0,actionRequired:true},state:"delivery_uncertain",retry:false};
  }
  return {record:{...r,deliveryState:"submitted_awaiting_ack",ackPolls:polls,ackDeadlineAt:deadline,waitReason:"awaiting_conversation_ack",nextPostAt:t+ACK_POLL_MS},state:"submitted_awaiting_ack",retry:true};
}
function mode(rec,t=Date.now(),force=false){
  const r=normalize(rec,t);
  if(r.posted||r.deliveryState==="acknowledged")return "none";
  if(r.deliveryState==="delivery_uncertain")return force?"ack_poll":"uncertain";
  if(r.deliveryState==="submitted_awaiting_ack"){
    if(force||!r.nextPostAt||r.nextPostAt<=t)return "ack_poll";
    return "deferred";
  }
  if(!force&&r.nextPostAt&&r.nextPostAt>t)return "deferred";
  return "send";
}
globalThis.__SOKNA_DELIVERY_STATE_CORE_V1__={ACK_POLL_MS,ACK_DEADLINE_MS,MAX_ACK_POLLS,normalize,markSubmitted,markAcknowledged,pollResult,mode};
})();