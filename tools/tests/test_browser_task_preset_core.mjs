import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src=fs.readFileSync("extension/chrome/browser_task_preset_core.js","utf8");
const ctx={globalThis:null,Object,Number,String,Math,Error,Set};ctx.globalThis=ctx;
vm.runInNewContext(src,ctx,{filename:"browser_task_preset_core.js"});
const P=ctx.__SOKNA_BROWSER_TASK_PRESET_CORE_V1__;assert.ok(P);

const x=P.expand({
  task_id:"uat-compact-001",
  preset:"login_capture_links",
  credential_ref:"sokna-local-admin",
  username_selector:"#sc-username",
  password_selector:"#sc-password",
  submit_selector:"button[type=submit]",
  count:3
});
assert.equal(x.steps.length,5);
assert.equal(x.steps[0].op,"fill_many");
assert.equal(x.steps[0].fields[0].credential_field,"username");
assert.equal(x.steps[0].fields[1].credential_field,"secret");
assert.equal(x.steps[3].op,"find_links");
assert.equal(x.steps[3].limit,3);
assert.equal(x.steps[4].op,"foreach_capture");
assert.equal(x.steps[4].max_items,3);
assert.ok(x.max_steps>=17);

assert.throws(()=>P.expand({task_id:"x",preset:"bad",credential_ref:"c",username_selector:"#u",password_selector:"#p",submit_selector:"#s"}),/unsupported browser task preset/);
assert.throws(()=>P.expand({task_id:"x",preset:"login_capture_links",credential_ref:"bad ref",username_selector:"#u",password_selector:"#p",submit_selector:"#s"}),/credential_ref invalid/);

const command={id:"r12-flow-006",intent:"exec",action:"browser.task.run",params:{task_id:"r12flow2",preset:"login_capture_links",start_url:"http://127.0.0.1:18080/login.php",credential_ref:"sokna-local-admin",username_selector:"#sc-username",password_selector:"#sc-password",submit_selector:"button[type=submit]",count:3},bridge_nonce:"probe-0e11a53f-24ec-46d0-b33f-26e20f5e1ca8"};
assert.ok(Buffer.byteLength(JSON.stringify(command),"utf8")<800,"compact preset command must fit control-plane budget");
console.log("BROWSER_TASK_PRESET_CORE_PASS");
