import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const source=fs.readFileSync(path.join(root,'extension/chrome/browser_task_core.js'),'utf8');
const context={URL,globalThis:null};context.globalThis=context;vm.createContext(context);vm.runInContext(source,context);
const core=context.__SOKNA_BROWSER_TASK_CORE_V1__;
assert.ok(core);

const plan=core.validatePlan({
  task_id:'uat-login-first-three',
  max_steps:30,
  max_retries_per_step:2,
  steps:[
    {id:'credentials',op:'fill_many',fields:[
      {selector:'#sc-username',credential_ref:'sokna-local-admin',credential_field:'username'},
      {selector:'#sc-password',credential_ref:'sokna-local-admin',credential_field:'password'}
    ]},
    {id:'submit',op:'click',selector:'form button[type="submit"]'},
    {id:'settled',op:'wait',settled:true,timeout_ms:30000},
    {id:'links',op:'find_links',save_as:'first_links',limit:3,same_origin:true},
    {id:'captures',op:'foreach_capture',source:'first_links',max_items:3,full_page:true,settle_ms:500}
  ]
});
assert.equal(plan.steps.length,5);
assert.equal(plan.steps[0].fields.length,2);
assert.equal(plan.steps[3].limit,3);
assert.equal(core.replaySafe(plan.steps[1]),false);
assert.equal(core.interruptedDecision(plan.steps[1],'executing').code,'BROWSER_TASK_STEP_OUTCOME_UNKNOWN');
assert.equal(core.interruptedDecision(plan.steps[0],'executing').resume,'retry_safe');

const links=core.filterLinks([
  {index:0,href:'http://127.0.0.1:18080/dashboard.php#top',name:'خانه',visible:true},
  {index:1,href:'/orders.php',name:'سفارش‌ها',visible:true},
  {index:2,href:'http://127.0.0.1:18080/orders.php#again',name:'duplicate',visible:true},
  {index:3,href:'https://example.com/out',name:'outside',visible:true},
  {index:4,href:'/menu.php',name:'منو',visible:false},
  {index:5,href:'/settings.php',name:'تنظیمات',visible:true}
],{current_url:'http://127.0.0.1:18080/dashboard.php',origin:'http://127.0.0.1:18080',limit:3,same_origin:true,visible_only:true,exclude_current:true});
assert.deepEqual(JSON.parse(JSON.stringify(links)).map(x=>new URL(x.href).pathname),['/orders.php','/settings.php']);

assert.throws(()=>core.validatePlan({task_id:'bad id',steps:[{op:'snapshot'}]}),/task_id/);
assert.throws(()=>core.validatePlan({task_id:'x',steps:[{op:'fill_many',fields:[]}]}),/1..20/);
assert.throws(()=>core.validatePlan({task_id:'x',steps:[{op:'navigate',url:'http://a',from:'x'}]}),/exactly one/);

const wrapper=fs.readFileSync(path.join(root,'extension/chrome/background_r12.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'extension/chrome/browser_task_runtime.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/chrome/manifest.json'),'utf8'));
assert.equal(manifest.background.service_worker,'background_r12.js');
assert.match(wrapper,/browser\.task\.run/);
assert.match(wrapper,/background_bootstrap\.js/);
assert.match(runtime,/BROWSER_TASK_STEP_OUTCOME_UNKNOWN/);
assert.match(runtime,/extensionOwnedLedgerActions\.add\(TASK_ACTION\)/);
assert.match(runtime,/baseBrowserSemanticAction/);
assert.doesNotMatch(runtime,/eval\s*\(/);
console.log('browser task core contract: PASS');
