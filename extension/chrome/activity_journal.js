(()=>{
"use strict";
const KEY="__SOKNA_ACTIVITY_JOURNAL_V1__";
if(globalThis[KEY])return;
function text(v,n){const s=String(v??"");return s.length<=n?s:s.slice(0,n)}
function create({load,save,now=()=>Date.now(),maxEntries=800}){
  if(typeof load!=="function"||typeof save!=="function")throw new Error("JOURNAL_STORAGE_REQUIRED");
  maxEntries=Math.max(50,Math.min(5000,Number(maxEntries)||800));
  let tail=Promise.resolve();
  async function append(e={}){
    const row={ts:Number(e.ts||now()),event:text(e.event||"event",80),commandId:text(e.commandId||"",96),action:text(e.action||"",160),source:text(e.source||"",120),ok:typeof e.ok==="boolean"?e.ok:null,executed:typeof e.executed==="boolean"?e.executed:null,detail:text(e.detail||"",400)};
    const op=tail.catch(()=>{}).then(async()=>{let items=await load();if(!Array.isArray(items))items=[];items.push(row);if(items.length>maxEntries)items=items.slice(-maxEntries);await save(items);return row});
    tail=op.catch(()=>{});return await op;
  }
  async function list({limit=50,commandId=""}={}){await tail.catch(()=>{});let items=await load();if(!Array.isArray(items))items=[];if(commandId)items=items.filter(x=>x?.commandId===commandId);limit=Math.max(1,Math.min(500,Number(limit)||50));return items.slice(-limit)}
  async function clear(){await tail.catch(()=>{});await save([])}
  return Object.freeze({append,list,clear});
}
globalThis[KEY]=Object.freeze({version:"1",create});
})();
