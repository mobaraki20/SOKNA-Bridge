import fs from "node:fs";
import assert from "node:assert/strict";

const manifest=JSON.parse(fs.readFileSync("extension/chrome/manifest.json","utf8"));
const bg=fs.readFileSync("extension/chrome/background.js","utf8");
const page=fs.readFileSync("extension/chrome/browser_page.js","utf8");
const bootstrap=fs.readFileSync("extension/chrome/background_bootstrap.js","utf8");

assert.ok(manifest.permissions.includes("debugger"));
assert.ok(manifest.optional_host_permissions.includes("http://*/*"));
assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
assert.ok(!manifest.content_scripts.some(x=>JSON.stringify(x.matches||[]).includes("<all_urls>")));

assert.ok(page.includes("data-sokna-browser-ref"),"stable element refs missing");
assert.ok(page.includes('type==="password"')&&page.includes("••••••"),"password previews must be masked");
assert.ok(page.includes("BROWSER_REF_STALE"),"stale refs need structured failure");
assert.ok(!page.includes("eval("),"browser page engine must not expose JS evaluation");
assert.ok(!page.includes("chrome.cookies"),"browser page engine must not access cookies");
assert.ok(!page.includes("localStorage")&&!page.includes("sessionStorage"),"browser page engine must not read site storage");

assert.ok(bg.includes('debugTarget={tabId:target.tab.id}'),"CDP screenshot must bind exact claimed tab");
assert.ok(bg.includes('chrome.tabs.sendMessage(target.tab.id'),"DOM actions must target exact claimed tab");
assert.ok(bg.includes('{frameId:0}'),"v1 browser page actions must explicitly target top frame");
assert.ok(bg.includes("BROWSER_TARGET_ORIGIN_CHANGED"),"origin navigation must invalidate target");
assert.ok(!bg.includes("tab_focus"),"SOKNA Browser router must not use focus-then-act targeting");
assert.ok(!bg.includes('chrome.tabs.update(target.tab.id,{active:true}'),"screenshot must not require active-tab focus");

for(const a of ["browser.page.snapshot","browser.page.click","browser.page.fill","browser.page.screenshot"]){
  assert.ok(bootstrap.includes('"'+a+'"'),"capability gate missing "+a);
}
assert.ok(bg.includes('type:"artifact.out.ingest"'),"screenshot must become durable artifact, not inline result");

console.log("BROWSER_EXTENSION_POLICY_PASS");
