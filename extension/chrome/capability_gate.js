(()=>{
"use strict";
const G="__SOKNA_CAPABILITY_GATE_V1__";
if(globalThis[G])return;
const DEFAULT_TTL_MS=60000;
const DEFAULT_EXTENSION_ACTIONS=["artifact.chat.apply"];
function cleanAction(v){return String(v||"").trim()}
function normalizeActions(raw){
  const list=Array.isArray(raw)?raw:(Array.isArray(raw?.actions)?raw.actions:[]);
  const actions=new Set(list.map(cleanAction).filter(Boolean));
  if(!actions.size)throw new Error("CAPABILITY_ACTIONS_MISSING");
  return actions;
}
function create(options={}){
  const fetchCapabilities=options.fetchCapabilities;
  if(typeof fetchCapabilities!=="function")throw new Error("CAPABILITY_FETCHER_REQUIRED");
  const now=typeof options.now==="function"?options.now:()=>Date.now();
  const ttlMs=Math.max(1000,Number(options.ttlMs)||DEFAULT_TTL_MS);
  const extensionActions=new Set((options.extensionActions||DEFAULT_EXTENSION_ACTIONS).map(cleanAction).filter(Boolean));
  let cache=null,expiresAt=0,flight=null;
  async function load(force=false){
    const t=now();
    if(!force&&cache&&t<expiresAt)return cache;
    if(!force&&flight)return await flight;
    flight=(async()=>{
      const raw=await fetchCapabilities();
      const actions=normalizeActions(raw);
      cache=actions;expiresAt=now()+ttlMs;
      return actions;
    })();
    try{return await flight}finally{flight=null}
  }
  async function check(action){
    action=cleanAction(action);
    if(!action)return{ok:false,code:"CAPABILITY_ACTION_REQUIRED",executed:false,error:"command action is required"};
    if(extensionActions.has(action))return{ok:true,action,source:"extension",cached:true};
    try{
      const actions=await load(false);
      if(actions.has(action))return{ok:true,action,source:"agent",cached:true};
      return{ok:false,code:"CAPABILITY_UNAVAILABLE",executed:false,action,error:`Agent does not advertise action: ${action}`};
    }catch(e){
      return{ok:false,code:"CAPABILITY_PREFLIGHT_FAILED",executed:false,action,error:String(e?.message||e||"capability preflight failed")};
    }
  }
  function invalidate(){cache=null;expiresAt=0;flight=null}
  return Object.freeze({check,load,invalidate});
}
globalThis[G]=Object.freeze({version:"1",defaultTtlMs:DEFAULT_TTL_MS,create,normalizeActions});
})();
