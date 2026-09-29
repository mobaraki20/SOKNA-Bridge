(()=>{
"use strict";
function executionRunning(s){return String(s?.executionState||"")==="running"&&!!String(s?.executionCurrentCommandId||"")}
function executionStart(prev,id,action,t=Date.now()){
  id=String(id||"");return {executionState:"running",executionCurrentCommandId:id,currentCommandId:id,executionAction:String(action||""),executionStartedAt:t,lastExecutionError:"",state:"Working",detail:`Executing ${String(action||"command")}`};
}
function executionFinish(prev,id,ok,error="",t=Date.now()){
  id=String(id||"");const matches=String(prev?.executionCurrentCommandId||prev?.currentCommandId||"")===id;
  const out={executionState:ok===false?"failed":"completed",lastExecutedCommandId:id,lastExecutionCompletedAt:t,lastExecutionOk:ok!==false,lastExecutionError:String(error||"")};
  if(matches){out.executionCurrentCommandId="";out.currentCommandId="";out.executionAction="";}
  if(matches){
    if(prev?.deliveryPendingRecordId){out.state=prev?.deliveryActionRequired?"Needs Action":"Waiting";out.detail=String(prev?.deliveryDetail||"Delivery pending");}
    else {out.state="Ready";out.detail="";}
  }
  return out;
}
function deliveryUpdate(prev,{recordId="",commandId="",deliveryState="",uiState="Waiting",detail="",lastError="",actionRequired=false,transportVerified}={}){
  const out={deliveryPendingRecordId:String(recordId||""),deliveryPendingCommandId:String(commandId||""),deliveryState:String(deliveryState||""),deliveryDetail:String(detail||""),deliveryLastError:String(lastError||""),deliveryActionRequired:!!actionRequired};
  if(transportVerified!==undefined)out.transportVerified=!!transportVerified;
  if(!executionRunning(prev)){out.state:String(uiState||"Waiting");out.detail=String(detail||"");out.lastError=String(lastError||"");out.actionRequired=!!actionRequired;}
  return out;
}
function deliveryClear(prev,recordId,{uiState="Ready",detail="",lastError="",actionRequired=false,transportVerified}={}){
  const current=String(prev?.deliveryPendingRecordId||"");if(current&&recordId&&current!==String(recordId))return {};
  const out={deliveryPendingRecordId:"",deliveryPendingCommandId:"",deliveryState:"",deliveryDetail:"",deliveryLastError:"",deliveryActionRequired:false};
  if(transportVerified!==undefined)out.transportVerified=!!transportVerified;
  if(!executionRunning(prev)){out.state:String(uiState||"Ready");out.detail=String(detail||"");out.lastError=String(lastError||"");out.actionRequired=!!actionRequired;}
  return out;
}
function connectionUpdate(prev,patch={}){
  if(!executionRunning(prev))return {...patch};
  const {state,detail,lastError,actionRequired,...rest}=patch;
  return {...rest,connectionState:String(state||""),connectionDetail:String(detail||""),connectionLastError:String(lastError||""),connectionActionRequired:!!actionRequired};
}
globalThis.__SOKNA_RUNTIME_STATE_CORE_V1__=Object.freeze({executionRunning,executionStart,executionFinish,deliveryUpdate,deliveryClear,connectionUpdate});
})();
