import fs from "node:fs";
import assert from "node:assert/strict";
const c=fs.readFileSync("extension/chrome/content.js","utf8");
assert.ok(c.includes('scope:"user-message-shells",authoritative:true'),"ACK must require authoritative user-message shells");
assert.ok(c.includes('scope:"body-fallback",authoritative:false'),"body fallback must be diagnostic-only");
assert.ok(c.includes('"type-id-header-match"'),"large-result ACK needs type+id header correlation");
assert.ok(c.includes('"body-fallback-diagnostic-only"'),"fallback must never silently acknowledge");
console.log("DELIVERY_ACK_V3_SOURCE_PASS");
