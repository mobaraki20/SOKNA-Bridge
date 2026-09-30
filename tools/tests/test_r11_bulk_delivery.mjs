import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const contractsSrc=fs.readFileSync("extension/chrome/action_contracts_core.js","utf8");
vm.runInThisContext(contractsSrc,{filename:"action_contracts_core.js"});
const reg=globalThis.__SOKNA_ACTION_CONTRACTS_V1__;
assert.ok(reg,"action contract registry missing");

const batch=reg.describe("browser.capture.batch");
assert.ok(batch,"browser.capture.batch contract missing");
assert.equal(batch.inputSchema.properties.items.maxItems,100);
assert.equal(batch._meta["sokna/owner"],"chat-adapter");

const attachMany=reg.describe("artifact.out.attach_many");
assert.ok(attachMany,"artifact.out.attach_many contract missing");
assert.equal(attachMany.inputSchema.properties.ids.maxItems,100);
assert.equal(attachMany.inputSchema.properties.batch_size.maximum,10);

const collection=reg.describe("artifact.collection.get");
assert.ok(collection,"artifact.collection.get contract missing");
assert.equal(collection.inputSchema.properties.limit.maximum,20);

const bg=fs.readFileSync("extension/chrome/background.js","utf8");
for(const token of [
  "async function browserCaptureBatch",
  "sokna-browser-capture-collection-v1",
  "BROWSER_BATCH_ORIGIN_CHANGE_FORBIDDEN",
  "collection_ref:ingested.artifact_ref",
  "async function artifactCollectionGet"
])assert.ok(bg.includes(token),`background missing ${token}`);
assert.ok(bg.includes("items.length<1||items.length>100"),"capture batch must be bounded to 100");
assert.ok(bg.includes("failed===0"),"batch result must surface partial capture failure");

const boot=fs.readFileSync("extension/chrome/background_bootstrap.js","utf8");
for(const token of [
  "artifact.out.attach_many",
  "async function deliverOutboundAttachmentMany",
  "async function waitAttachmentComposerReady",
  "OUTBOUND_ATTACHMENT_READY",
  "batchSize=Math.min(10"
])assert.ok(boot.includes(token),`bootstrap missing ${token}`);

const adapter=fs.readFileSync("extension/chrome/outbound_attachment.js","utf8");
assert.ok(adapter.includes("Core.selectInputCandidate"),"attachment input resolver must use tested core ranking");
assert.ok(adapter.includes('m?.type==="OUTBOUND_ATTACHMENT_READY"'),"attachment readiness probe missing");

const content=fs.readFileSync("extension/chrome/content.js","utf8");
assert.ok(content.includes('reason:"body-fallback-exact-envelope"'),"exact-envelope body fallback ACK missing");
assert.ok(content.includes("if(retained&&!resultVisibleInUserTurn(payload))return null;"),"safe retained-draft submit fallback missing");

console.log("R11_BULK_DELIVERY_PASS");
