(()=>{
"use strict";
const G="__SOKNA_SEMANTIC_CORE_V1__";
if(globalThis[G])return;
const ID=/^[A-Za-z0-9._-]{1,96}$/;
const SHA=/^[0-9a-fA-F]{64}$/;
const SAFE=/^[A-Za-z0-9._-]{1,180}$/;
const E=new TextEncoder();
const MAX_CONTROL_BYTES=800,MAX_STEPS=64;
const fail=(code,message,extra={})=>({ok:false,code,message,executed:false,...extra});
const obj=(v)=>v===undefined||v===null?{}:(v&&typeof v==="object"&&!Array.isArray(v)?v:null);
const text=v=>String(v??"").trim();
function compile(spec,newId){
  if(!spec||typeof spec!=="object"||Array.isArray(spec))return fail("SCHEMA_INVALID","semantic request must be an object");
  const intent=text(spec.intent||"exec").toLowerCase();
  const supplied=text(spec.id),id=supplied||(typeof newId==="function"?text(newId()):"");
  if(!ID.test(id))return fail("SCHEMA_INVALID","invalid/generated command id");
  let command=null,route="control";
  if(intent==="exec"){
    const action=text(spec.action),params=obj(spec.params);
    if(!action||params===null)return fail("SCHEMA_INVALID","exec requires action and object params");
    command={id,action,params};
  }else if(intent==="batch"){
    const workspace=text(spec.workspace),steps=spec.steps;
    if(!workspace||!Array.isArray(steps)||steps.length<1||steps.length>MAX_STEPS)return fail("SCHEMA_INVALID","batch requires workspace and 1..64 steps");
    const clean=[];
    for(let i=0;i<steps.length;i++){
      const s=steps[i],action=text(s?.action),params=obj(s?.params),name=text(s?.name||`step-${i+1}`);
      if(!s||typeof s!=="object"||!action||params===null||!SAFE.test(name))return fail("SCHEMA_INVALID",`invalid batch step ${i+1}`);
      clean.push({name,action,params,stop_on_error:s.stop_on_error!==false});
    }
    command={id,action:"job.batch",params:{workspace,steps:clean}};route="batch";
  }else if(intent==="job"){
    const workspace=text(spec.workspace),path=text(spec.path);
    if(!workspace||!path)return fail("SCHEMA_INVALID","job requires workspace and plan path");
    const params={workspace,path},expected=text(spec.expected_sha256);
    if(expected){if(!SHA.test(expected))return fail("SCHEMA_INVALID","expected_sha256 must be 64 hex");params.expected_sha256=expected.toLowerCase()}
    command={id,action:"job.submit",params};route="job";
  }else if(intent==="artifact"){
    const workspace=text(spec.workspace),filename=text(spec.filename),expected=text(spec.expected_sha256);
    if(!workspace||!SAFE.test(filename)||!filename.toLowerCase().endsWith(".zip")||!SHA.test(expected))return fail("SCHEMA_INVALID","artifact requires workspace, safe .zip filename and expected_sha256");
    const params={workspace,filename,expected_sha256:expected.toLowerCase()},artifactId=text(spec.artifact_id);
    if(artifactId){if(!SAFE.test(artifactId))return fail("SCHEMA_INVALID","invalid artifact_id");params.artifact_id=artifactId}
    command={id,action:"artifact.chat.apply",params};route="artifact";
  }else return fail("ROUTE_POLICY_VIOLATION",`unsupported semantic intent: ${intent}`);
  const bytes=E.encode(JSON.stringify(command)).byteLength;
  if(bytes>MAX_CONTROL_BYTES)return fail("ARTIFACT_ROUTE_REQUIRED","compiled control command exceeds budget",{canonical_route:"artifact",commandId:id,bytes,maxBytes:MAX_CONTROL_BYTES});
  return {ok:true,intent,route,command,bytes};
}
globalThis[G]=Object.freeze({v:1,maxControlBytes:MAX_CONTROL_BYTES,compile});
})();
