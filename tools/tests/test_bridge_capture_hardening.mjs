import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=fs.readFileSync('extension/chrome/browser_capture_map.js','utf8');
const base={
  contracts:{"browser.capture.batch":{name:"browser.capture.batch"}},
  describe:name=>({
    name,description:"Generic capture",inputSchema:{
      properties:{capture_id:{type:"string"},items:{type:"array"},start_url:{type:"string"},urls:{type:"array"},source_collection_id:{type:"string"}},
      required:["capture_id"],
      anyOf:[{required:["items"]},{required:["start_url"]},{required:["urls"]},{required:["source_collection_id"]}]
    },annotations:{readOnlyHint:false}
  }),
  list:()=>[{name:"browser.capture.batch",contracted:true}]
};
const context={
  console,URL,TextDecoder,TextEncoder,Map,Set,Array,Object,Date,String,Promise,RegExp,Number,
  __SOKNA_BROWSER_CAPTURE_MAPS_V1__:{maps:{},get:()=>null},
  __SOKNA_BROWSER_TARGET_CORE_V1__:{normalizeOrigin:url=>new URL(url).origin,originPattern:u=>u+"/*"},
  __SOKNA_ACTION_CONTRACTS_V1__:base,
  browserSemanticAction:async command=>({ok:true,action:command.action}),
  ingestExtensionArtifact:async()=>({artifact_ref:{id:"fake"}}),
  chrome:{},setTimeout,clearTimeout
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(file,context);
const contract=context.__SOKNA_ACTION_CONTRACTS_V1__.describe("browser.capture.batch");
assert.deepEqual([...contract.inputSchema.required],["capture_id"]);
const modes=new Set(contract.inputSchema.anyOf.map(x=>x.required?.[0]));
for(const x of ["items","start_url","urls","source_collection_id","map_artifact_ref","map_preset"])
  assert.ok(modes.has(x),"regression: lost capture mode "+x);
assert.equal(context.__SOKNA_BROWSER_CAPTURE_MAP_RUNTIME_V1__.presets.length,0);
assert.equal(context.__SOKNA_BROWSER_CAPTURE_MAP_RUNTIME_V1__.supports_artifact_map,true);
assert.ok(file.includes('bytes>8*1024*1024'),"8MiB limit missing");
assert.ok(file.includes('next-off>524288'),"chunk size bound missing");
assert.ok(file.includes('bin.length!==next-off'),"chunk length validation missing");
assert.ok(file.includes('total!==bytes'),"truncated artifact check missing");
assert.ok(!file.includes('text:String(document.body?.innerText'),"capture exfiltrates page text");
assert.ok(file.includes('if(status==="ok"){if(!state.reached)'),"failure classification overwritten");
assert.ok(file.includes('BROWSER_CAPTURE_MAP_CROSS_ORIGIN'),"origin permission scope missing");
const fallback=await context.browserSemanticAction({action:"browser.capture.batch",params:{capture_id:"legacy",items:[{id:"1",url:"https://example.org/"}]}});
assert.equal(fallback.ok,true);
console.log("BRIDGE_W11_CAPTURE_CONTRACT_PRESERVATION_PASS");
