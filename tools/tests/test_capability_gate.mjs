import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../../extension/chrome/capability_gate.js",import.meta.url),"utf8");
vm.runInThisContext(src,{filename:"capability_gate.js"});
const Gate=globalThis.__SOKNA_CAPABILITY_GATE_V1__;
if(!Gate)throw new Error("capability gate not loaded");

let now=1000,calls=0;
const gate=Gate.create({
  now:()=>now,
  ttlMs:5000,
  extensionActions:["artifact.chat.apply"],
  fetchCapabilities:async()=>{calls++;return ["ping","repo.inspect","job.batch"]}
});

let r=await gate.check("ping");
if(!r.ok||r.source!=="agent"||calls!==1)throw new Error("supported action did not pass");
r=await gate.check("repo.inspect");
if(!r.ok||calls!==1)throw new Error("capability cache was not reused");
r=await gate.check("artifact.chat.apply");
if(!r.ok||r.source!=="extension"||calls!==1)throw new Error("extension-owned action did not bypass agent manifest");
r=await gate.check("definitely.unsupported");
if(r.ok||r.code!=="CAPABILITY_UNAVAILABLE"||r.executed!==false||calls!==1)throw new Error("unsupported action did not fail closed");

now+=6000;
r=await gate.check("job.batch");
if(!r.ok||calls!==2)throw new Error("expired capability cache was not refreshed");

const broken=Gate.create({fetchCapabilities:async()=>{throw new Error("agent offline")}});
r=await broken.check("ping");
if(r.ok||r.code!=="CAPABILITY_PREFLIGHT_FAILED"||r.executed!==false)throw new Error("capability fetch failure did not fail closed");

const empty=Gate.create({fetchCapabilities:async()=>[]});
r=await empty.check("ping");
if(r.ok||r.code!=="CAPABILITY_PREFLIGHT_FAILED"||r.executed!==false)throw new Error("empty capability manifest did not fail closed");

console.log("CAPABILITY_GATE_PASS");
