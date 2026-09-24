(()=>{
  "use strict";
  const G="__SOKNA_CHAT_ARTIFACT_CORE_V1__";
  if(globalThis[G])return;
  const SAFE_FILE=/^[^\\/:*?"<>|\x00-\x1F]{1,180}$/;
  const SHA=/^[a-fA-F0-9]{64}$/;
  const SAFE_ID=/^[A-Za-z0-9._-]{1,96}$/;
  function basename(v){
    const s=String(v||"").replace(/\\/g,"/");
    try{return decodeURIComponent(s.split("/").pop()||"")}catch{return s.split("/").pop()||""}
  }
  function safeFilename(v){
    const s=String(v||"").trim();
    return !!s&&SAFE_FILE.test(s)&&basename(s)===s&&s!=="."&&s!=="..";
  }
  function normalizeSha(v){const s=String(v||"").trim().toLowerCase();return SHA.test(s)?s:""}
  function safeTransferId(v){return SAFE_ID.test(String(v||""))}
  function candidateNameSet(c){
    const out=new Set();
    for(const v of [c?.download,c?.text,c?.ariaLabel,c?.title,basename(c?.href||"")]){
      const s=String(v||"").trim();if(s)out.add(s);
    }
    return out;
  }
  function candidateMatches(c,filename){
    const wanted=String(filename||"").trim();if(!safeFilename(wanted)||!c||c.visible===false)return false;
    const role=String(c.authorRole||"").toLowerCase();if(role&&role!=="assistant")return false;
    for(const n of candidateNameSet(c))if(n===wanted||basename(n)===wanted)return true;
    return false;
  }
  function selectCandidate(candidates,filename){
    if(!safeFilename(filename))return {ok:false,reason:"invalid_filename"};
    const matches=(Array.isArray(candidates)?candidates:[]).filter(c=>candidateMatches(c,filename));
    if(!matches.length)return {ok:false,reason:"attachment_not_found"};
    const uniq=[];const keys=new Set();
    for(const c of matches){const k=String(c.href||"")+"|"+String(c.index??"");if(keys.has(k))continue;keys.add(k);uniq.push(c)}
    if(uniq.length!==1)return {ok:false,reason:"attachment_ambiguous",count:uniq.length};
    return {ok:true,candidate:uniq[0]};
  }
  function normalizeWinPath(v){return String(v||"").replace(/\//g,"\\").replace(/\\+$/g,"").toLowerCase()}
  function pathWithin(path,root){
    const p=normalizeWinPath(path),r=normalizeWinPath(root);if(!p||!r)return false;
    return p===r||p.startsWith(r+"\\");
  }
  function terminalSummary(t,ok,error="",apply=null){
    return {kind:"artifact-transfer-terminal",transferId:String(t?.transferId||""),commandId:String(t?.parentCommandId||""),filename:String(t?.filename||""),status:ok?"applied":"failed",ok:!!ok,error:String(error||""),artifact:apply||null};
  }
  globalThis[G]=Object.freeze({version:1,basename,safeFilename,normalizeSha,safeTransferId,candidateMatches,selectCandidate,pathWithin,terminalSummary});
})();
