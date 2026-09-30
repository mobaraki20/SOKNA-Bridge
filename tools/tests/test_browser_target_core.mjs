import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src=fs.readFileSync("extension/chrome/browser_target_core.js","utf8");
const ctx={globalThis:null,URL,Set,Object,Number,String,Date};ctx.globalThis=ctx;
vm.runInNewContext(src,ctx,{filename:"browser_target_core.js"});
const B=ctx.__SOKNA_BROWSER_TARGET_CORE_V1__;assert.ok(B);

assert.equal(B.normalizeOrigin("http://127.0.0.1:18080/login.php"),"http://127.0.0.1:18080");
assert.equal(B.normalizeOrigin("https://Example.COM/a"),"https://example.com");
assert.equal(B.normalizeOrigin("chrome://settings"),"");
assert.equal(B.normalizeOrigin("file:///tmp/a"),"");
assert.equal(B.originPattern("http://127.0.0.1:18080/x"),"http://127.0.0.1:18080/*");

const rec=B.targetRecord({conversationKey:"chatgpt:c:abc",tabId:42,url:"http://127.0.0.1:18080/login.php",title:"SOKNA",claimedAt:100});
assert.equal(rec.origin,"http://127.0.0.1:18080");assert.equal(rec.tab_id,42);
assert.equal(B.validateRecord(rec,"chatgpt:c:abc",{id:42,url:"http://127.0.0.1:18080/orders"}).ok,true);
assert.equal(B.validateRecord(rec,"chatgpt:c:def",{id:42,url:"http://127.0.0.1:18080/orders"}).code,"BROWSER_TARGET_SCOPE_MISMATCH");
assert.equal(B.validateRecord(rec,"chatgpt:c:abc",{id:43,url:"http://127.0.0.1:18080/orders"}).code,"BROWSER_TARGET_TAB_MISMATCH");
assert.equal(B.validateRecord(rec,"chatgpt:c:abc",{id:42,url:"https://example.com/"}).code,"BROWSER_TARGET_ORIGIN_CHANGED");

assert.equal(B.isPageAction("browser.page.click"),true);
assert.equal(B.isPageAction("browser.audit.run"),false);
assert.deepEqual(Array.from(B.normalizeApproved(["https://EXAMPLE.com/a","http://127.0.0.1:18080/x","https://example.com/b"])),["http://127.0.0.1:18080","https://example.com"]);

console.log("BROWSER_TARGET_CORE_PASS");
