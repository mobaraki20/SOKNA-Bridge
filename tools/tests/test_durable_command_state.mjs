import fs from "node:fs";
import assert from "node:assert/strict";
const bg=fs.readFileSync("extension/chrome/background.js","utf8");
assert.ok(bg.includes("commandStorageKey(a.registered.conversationKey,command.id)"),"command identity must include conversation");
assert.ok(bg.includes("commandId:command.id"),"stored command record must preserve wire command id");
assert.ok(bg.includes("resultEnvelope({id:resultIdOf(id,rec)"),"storage key must never leak into RESULT id");
assert.ok(bg.includes("deliveryPendingRecordId"),"delivery state must have a distinct record id");
assert.ok(bg.includes("executionCurrentCommandId"),"execution state must have a distinct command id");
console.log("DURABLE_COMMAND_STATE_PASS");
