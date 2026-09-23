(()=>{
  "use strict";
  const G="__SOKNA_AGENT_JOB_CORE_V1__";
  if(globalThis[G])return;
  function clip(s,n=3000){s=String(s||"");return s.length<=n?s:s.slice(0,n)+`...[truncated ${s.length-n}]`}
  function maybeJSON(s){try{const v=JSON.parse(String(s||"").trim());return v&&typeof v==="object"?v:null}catch{return null}}
  function findCiSummary(node,depth=0){
    if(depth>8||node==null)return null;
    if(typeof node==="string"){const v=maybeJSON(node);return v?findCiSummary(v,depth+1):null}
    if(Array.isArray(node)){for(const x of node){const r=findCiSummary(x,depth+1);if(r)return r}return null}
    if(typeof node==="object"){
      if((node.schema==="sokna-ci-summary-v1"||node.provider==="github-actions")&&node.run_id)return node;
      for(const k of ["stdout","summary","result","results","job","data"]){if(k in node){const r=findCiSummary(node[k],depth+1);if(r)return r}}
    }
    return null;
  }
  function findFailureText(node,depth=0){
    if(depth>8||node==null)return "";
    if(Array.isArray(node)){for(const x of node){const r=findFailureText(x,depth+1);if(r)return r}return ""}
    if(typeof node==="object"){
      if(node.ok===false){const s=node.error||node.stderr||node.stdout;if(s)return clip(s,2000)}
      for(const k of ["result","results","job","data"]){if(k in node){const r=findFailureText(node[k],depth+1);if(r)return r}}
    }
    return "";
  }
  function findOutputText(node,depth=0){
    if(depth>8||node==null)return "";
    if(Array.isArray(node)){for(const x of node){const r=findOutputText(x,depth+1);if(r)return r}return ""}
    if(typeof node==="object"){
      if(typeof node.stdout==="string"&&node.stdout.trim())return clip(node.stdout.trim(),1800);
      for(const k of ["result","results","job","data"]){if(k in node){const r=findOutputText(node[k],depth+1);if(r)return r}}
    }
    return "";
  }
  function terminalJobStatus(s){return ["done","failed","completed","canceled","cancelled"].includes(String(s||"").toLowerCase())}

  function shouldBlockStatusEvent(eventId,eventRec,seen,conversationKey){
    if(eventRec?.kind!=="status-event")return false;
    const rAt=Number(eventRec.acceptedAt||eventRec.ts||0);
    return Object.entries(seen||{}).some(([otherId,x])=>otherId!==eventId&&x?.state==="done"&&!x?.posted&&x?.conversationKey===conversationKey&&x?.kind!=="status-event"&&Number(x.acceptedAt||x.ts||0)<=rAt);
  }
  function summarizeJob(resp){
    const j=resp?.job||resp||{},status=String(j.status||""),ci=findCiSummary(j.result);
    return {
      kind:"job-terminal",jobId:String(j.id||""),status,
      ok:status==="done"||status==="completed",
      error:clip(j.error||j.last_error||findFailureText(j.result)||"",2000),
      output_excerpt:ci?"":findOutputText(j.result),
      ci:ci?{
        schema:String(ci.schema||""),ok:!!ci.ok,provider:String(ci.provider||""),environment:String(ci.environment||""),
        workflow:String(ci.workflow||""),profile:String(ci.profile||""),request_id:String(ci.request_id||""),
        run_id:ci.run_id,url:String(ci.url||""),head_sha:String(ci.head_sha||""),head_branch:String(ci.head_branch||""),
        conclusion:String(ci.conclusion||""),failed_steps:ci.failed_steps||[],failure_excerpt:clip(ci.failure_excerpt||"",3000),
        evidence_path:String(ci.evidence_path||"")
      }:null
    };
  }
  globalThis[G]=Object.freeze({version:1,clip,findCiSummary,summarizeJob,terminalJobStatus,shouldBlockStatusEvent});
})();
