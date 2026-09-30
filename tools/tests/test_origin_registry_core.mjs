import fs from "node:fs";import vm from "node:vm";import assert from "node:assert/strict";
const src=fs.readFileSync("extension/chrome/origin_registry_core.js","utf8");const ctx={globalThis:null,URL,String,Set,Math,Object};ctx.globalThis=ctx;vm.runInNewContext(src,ctx);const O=ctx.__SOKNA_CHAT_ORIGIN_REGISTRY_V1__;assert.ok(O);
assert.equal(O.normalizeOrigin("https://chatgpt.com/c/abc"),"https://chatgpt.com");assert.equal(O.normalizeOrigin("http://chat.example/c/abc"),"");assert.equal(O.normalizeOrigin("https://u:p@example.com"),"");
assert.equal(O.conversationKey("https://foo.example/c/abc?x=1"),"chatgpt:c:abc");assert.equal(O.conversationKey("https://foo.example/g/g-p-project-bridge/c/abc?x=1"),"chatgpt:c:abc");assert.equal(O.conversationKey("https://foo.example/projects/p1/c/abc"),"chatgpt:c:abc");assert.equal(O.conversationKey("https://foo.example/g/xyz"),"https://foo.example/g/xyz");assert.equal(O.conversationKey("https://bar.example/c/abc"),"chatgpt:c:abc");
assert.ok(O.normalizeList(["https://custom.example"]).includes("https://chatgpt.com"));assert.ok(O.scriptId("https://custom.example").startsWith("sokna-chat-"));
console.log("ORIGIN_REGISTRY_CORE_PASS");
