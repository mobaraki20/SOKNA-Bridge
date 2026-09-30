(()=>{
"use strict";
function executionRunning(s){return String(s?.executionState||"")==="running"&&!!String(s?.executionCurrentCommandId||"")}
function executionStart(prev,id,action,t=Date.now()){
  id=String(id||"");return {executionState:"running",executionCurrentCommandId:id,currentCommandId:id,executionAction:String(action||""),executionStartedAt:t,lastExecutionError:"",state:"Working",detail:`Executing ${String(action||"command")}`,lastError:"",actionRequired:false};
}
function executionFinish(prev,id,ok,error="",t=Date.now()){
  id=String(id||"");const matches=String(prev?.executionCurrentCommandId||prev?.currentCommandId||"")===id;
  const failed=ok===false,err=String(error||"");
  const out={executionState:failed?"failed":"completed",lastExecutedCommandId:id,lastExecutionCompletedAt:t,lastExecutionOk:!failed,lastExecutionError:err};
  if(matches){
    out.executionCurrentCommandId="";out.currentCommandId="";out.executionAction="";
    out.state=failed?"Error":"Ready";out.detail=failed?(err||"Command failed"):"";out.lastError=failed?err:"";out.actionRequired=failed;
  }
  return out;
}
function deliveryUpdate(prev,{recordId="",commandId="",deliveryState="",uiState="Waiting",detail="",lastError="",actionRequired=false,transportVerified}={}){
  const out={
    deliveryPendingRecordId:String(recordId||""),deliveryPendingCommandId:String(commandId||""),deliveryState:String(deliveryState||""),
    deliveryDetail:String(detail||""),deliveryLastError:String(lastError||""),deliveryActionRequired:!!actionRequired,deliveryUpdatedAt:Date.now(),
    presentationState:String(uiState||"Waiting"),presentationDetail:String(detail||""),presentationLastError:String(lastError||""),presentationActionRequired:!!actionRequired
  };
  if(transportVerified!==undefined)out.transportVerified=!!transportVerified;
  return out;
}
function deliveryClear(prev,recordId,{uiState="Ready",detail="",lastError="",actionRequired=false,transportVerified}={}){
  const current=String(prev?.deliveryPendingRecordId||"");if(current&&recordId&&current!==String(recordId))return {};
  const out={
    deliveryPendingRecordId:"",deliveryPendingCommandId:"",deliveryState:"",deliveryDetail:"",deliveryLastError:"",deliveryActionRequired:false,deliveryUpdatedAt:Date.now(),
    presentationState:String(uiState||"Ready"),presentationDetail:String(detail||""),presentationLastError:String(lastError||""),presentationActionRequired:!!actionRequired
  };
  if(transportVerified!==undefined)out.transportVerified=!!transportVerified;
  return out;
}
function connectionUpdate(prev,patch={}){
  if(!executionRunning(prev))return {...patch};
  const {state,detail,lastError,actionRequired,...rest}=patch;
  return {...rest,connectionState:String(state||""),connectionDetail:String(detail||""),connectionLastError:String(lastError||""),connectionActionRequired:!!actionRequired};
}
globalThis.__SOKNA_RUNTIME_STATE_CORE_V1__=Object.freeze({executionRunning,executionStart,executionFinish,deliveryUpdate,deliveryClear,connectionUpdate});
})();