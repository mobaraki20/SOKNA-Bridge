import fs from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";

const src=fs.readFileSync(new URL("../../extension/chrome/outbound_attachment_core.js",import.meta.url),"utf8");
vm.runInThisContext(src,{filename:"outbound_attachment_core.js"});
const Core=globalThis.__SOKNA_OUTBOUND_ATTACHMENT_CORE_V1__;
if(!Core)throw new Error("outbound attachment core not loaded");

const payload=new TextEncoder().encode("verified outbound attachment\n");
const sha=Buffer.from(await webcrypto.subtle.digest("SHA-256",payload)).toString("hex");
const ref={id:sha,sha256:sha,name:"evidence.txt",bytes:payload.byteLength,content_type:"text/plain"};
let t=Core.createTransfer("attach-test-1",ref);
let r=t.add(0,Buffer.from(payload.subarray(0,7)).toString("base64"));
if(r.received!==7||r.nextIndex!==1)throw new Error("first chunk accounting failed");
t.add(1,Buffer.from(payload.subarray(7)).toString("base64"));
const fin=await t.finalize(webcrypto);
if(fin.ref.name!=="evidence.txt"||Buffer.compare(Buffer.from(fin.bytes),Buffer.from(payload))!==0)throw new Error("verified round-trip failed");

try{Core.createTransfer("bad/id",ref);throw new Error("unsafe transfer id accepted")}catch(e){if(e.code!=="ATTACHMENT_TRANSFER_ID_INVALID")throw e}
try{Core.createTransfer("attach-big",{...ref,bytes:Core.maxAttachBytes+1});throw new Error("oversize attachment accepted")}catch(e){if(e.code!=="OUTBOUND_ATTACHMENT_TOO_LARGE")throw e}
t=Core.createTransfer("attach-order",ref);
try{t.add(1,Buffer.from(payload).toString("base64"));throw new Error("out-of-order chunk accepted")}catch(e){if(e.code!=="ATTACHMENT_CHUNK_ORDER_INVALID")throw e}
t=Core.createTransfer("attach-hash",{...ref,id:"0".repeat(64),sha256:"0".repeat(64)});t.add(0,Buffer.from(payload).toString("base64"));
try{await t.finalize(webcrypto);throw new Error("hash mismatch accepted")}catch(e){if(e.code!=="ATTACHMENT_SHA256_MISMATCH")throw e}

console.log("OUTBOUND_ATTACHMENT_CORE_PASS");
