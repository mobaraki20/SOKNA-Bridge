import fs from "node:fs";
import assert from "node:assert/strict";

const m=JSON.parse(fs.readFileSync("extension/chrome/manifest.json","utf8"));
assert.ok(m.permissions.includes("scripting"));
assert.ok(m.permissions.includes("debugger"),"exact-tab CDP screenshots require debugger permission");
assert.deepEqual(m.optional_host_permissions,["https://*/*","http://*/*"]);
assert.ok(!JSON.stringify(m.content_scripts).includes("<all_urls>"),"Browser hosts must never become automatic content-script matches");

const origin=fs.readFileSync("extension/chrome/origin_registry_core.js","utf8");
assert.ok(origin.includes('u.protocol!=="https:"'),"ChatGPT Adapter origins must remain HTTPS-only");

const target=fs.readFileSync("extension/chrome/browser_target_core.js","utf8");
assert.ok(target.includes('"http:"')&&target.includes('"https:"'),"Browser targets must support explicit HTTP/HTTPS origins");

const b=fs.readFileSync("extension/chrome/background.js","utf8");
assert.ok(b.includes("REGISTER_CHAT_ORIGIN"));
assert.ok(b.includes("REGISTER_BROWSER_ORIGIN"));
assert.ok(b.includes("chrome.permissions.contains"));
assert.ok(b.includes("registerContentScripts"),"Chat origins still use persistent registered Chat scripts");
assert.ok(b.includes("ensureBrowserPage"),"Browser page engine must be injected only for an exact approved tab");

const p=fs.readFileSync("extension/chrome/popup.js","utf8");
assert.ok(p.includes("chrome.permissions.request"));
assert.ok(p.includes("REGISTER_BROWSER_ORIGIN"),"Browser origin grant must come from explicit popup user gesture");

console.log("MULTI_ORIGIN_POLICY_PASS");
