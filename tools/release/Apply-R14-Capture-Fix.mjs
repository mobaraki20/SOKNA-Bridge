import fs from 'node:fs';
import path from 'node:path';

const FINAL_EXTENSION='3.14.2';
const capturePath='extension/chrome/browser_capture_map.js';
let text=fs.readFileSync(capturePath,'utf8');
const captureBefore=text;

const categoryLabels='["\u062f\u0633\u062a\u0647\u200c\u0628\u0646\u062f\u06cc \u062c\u062f\u06cc\u062f","\u062f\u0633\u062a\u0647 \u062c\u062f\u06cc\u062f","\u0648\u06cc\u0631\u0627\u06cc\u0634 \u062f\u0633\u062a\u0647","\u0648\u06cc\u0631\u0627\u06cc\u0634"]';
const menuLabels='["\u0645\u0646\u0648\u06cc \u062c\u062f\u06cc\u062f","\u0645\u0646\u0648 \u062c\u062f\u06cc\u062f","\u0648\u06cc\u0631\u0627\u06cc\u0634 \u0645\u0646\u0648","\u0648\u06cc\u0631\u0627\u06cc\u0634"]';
const staffAssignments='["\u0627\u062e\u062a\u0635\u0627\u0635\u200c\u0647\u0627"]';

// Match capture IDs only at an object-entry boundary. Never let C06 match the suffix of SC06.
text=text.replace(/(^|[,\n])C06:\[\["click",\[[^\n]*?\]\]\]/m,`$1C06:[["click",${categoryLabels}]]`);
text=text.replace(/(^|[,\n])C09:\[\["click",\[[^\n]*?\]\]\]/m,`$1C09:[["click",${menuLabels}]]`);
// Repair the one SC06 entry that an earlier over-broad correction could have touched.
text=text.replace(/(^|[,\n])SC06:\[\["click",\[[^\n]*?\]\]\]/m,`$1SC06:[["click",${staffAssignments}]]`);

const handler=/function interactionRequiresHandler\(e\)\{\n\s*const a=norm\(e\?\.action\|\|""\);\n\s*if\(!a\)return false;\n\s*return [^\n]+;\n\}/;
const handlerReplacement=[
  'function interactionRequiresHandler(e){',
  '  const a=norm(e?.action||"");',
  '  if(!a)return false;',
  '  return /(^|\\b)(open|click|select|toggle|type|switch|expand|choose|pick|edit)\\b/i.test(a)||/(\\u0628\\u0627\\u0632 \\u06a9\\u0646|\\u0628\\u0627\\u0632\\u06a9\\u0631\\u062f\\u0646|\\u06a9\\u0644\\u06cc\\u06a9|\\u0627\\u0646\\u062a\\u062e\\u0627\\u0628|\\u0648\\u06cc\\u0631\\u0627\\u06cc\\u0634|\\u062a\\u063a\\u06cc\\u06cc\\u0631 \\u062a\\u0645|\\u062c\\u0633\\u062a\\u062c\\u0648)/i.test(a);',
  '}'
].join('\n');
if(!handler.test(text))throw new Error('R14_CAPTURE_HANDLER_SHAPE_MISSING');
text=text.replace(handler,handlerReplacement);

if(!text.includes(`C09:[["click",${menuLabels}]]`))throw new Error('R14_C09_ORDER_NOT_APPLIED');
if(!text.includes(`C06:[["click",${categoryLabels}]]`))throw new Error('R14_C06_ORDER_NOT_APPLIED');
if(!text.includes(`SC06:[["click",${staffAssignments}]]`))throw new Error('R14_SC06_REPAIR_NOT_APPLIED');
if(/Ø|Ù|Ú|Û/.test(text.match(/function interactionRequiresHandler[\s\S]*?\n\}/)?.[0]||''))throw new Error('R14_HANDLER_MOJIBAKE_REMAINS');

if(text!==captureBefore){
  fs.writeFileSync(capturePath,text,'utf8');
  console.log('R14_CAPTURE_SOURCE_UPDATED');
}else{
  console.log('R14_CAPTURE_SOURCE_ALREADY_FINAL');
}

const contractsPath='extension/chrome/action_contracts_core.js';
let contracts=fs.readFileSync(contractsPath,'utf8');
const contractsBefore=contracts;
const resultGetContract=' "result.get":tool("agent","Read a bounded chunk from a durable large-result reference. id must be the 64-hex result_ref.id returned by the Agent. This is not a command lookup; use bridge.command.get for command ids.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:12000}},["id"]),{errors:["Invalid result ref id","Result ref not found"]})';
const oldResultGet=/ "result\.get":tool\("agent","Read a bounded chunk from an Agent large-result reference\."[^\n]*\)/;
if(contracts.includes('"result.get":tool(')){
  if(!contracts.includes('This is not a command lookup; use bridge.command.get for command ids.')){
    if(!oldResultGet.test(contracts))throw new Error('R14_RESULT_GET_EXISTING_CONTRACT_SHAPE_MISSING');
    contracts=contracts.replace(oldResultGet,resultGetContract);
  }
}else{
  const anchor=' "artifact.apply":tool("agent","Apply a verified workspace patch artifact with SHA/freshness guards.",obj({workspace:S,path:S,expected_sha256:S,apply:B},["workspace","path","expected_sha256"]),{mutating:true,destructive:true,idempotency:"precondition_guarded"}),\n';
  if(!contracts.includes(anchor))throw new Error('R14_RESULT_GET_CONTRACT_ANCHOR_MISSING');
  contracts=contracts.replace(anchor,anchor+resultGetContract+',\n');
}
if(!contracts.includes('This is not a command lookup; use bridge.command.get for command ids.'))throw new Error('R14_RESULT_GET_CONTRACT_NOT_APPLIED');
const resultLine=contracts.match(/ "result\.get":tool\([^\n]+/)?.[0]||'';
if(!resultLine.includes('pattern:"^[a-fA-F0-9]{64}$"'))throw new Error('R14_RESULT_GET_HASH_PATTERN_MISSING');
if(contracts!==contractsBefore){
  fs.writeFileSync(contractsPath,contracts,'utf8');
  console.log('R14_RESULT_GET_CONTRACT_UPDATED');
}else{
  console.log('R14_RESULT_GET_CONTRACT_ALREADY_FINAL');
}

// Current-extension contract sweep. Only touch Python tests that read the current extension manifest;
// historical migration fixtures and unrelated legacy-version tests remain untouched.
const testDir='tools/tests';
let normalizedTests=[];
for(const name of fs.readdirSync(testDir)){
  if(!/^test_.*\.py$/.test(name))continue;
  const p=path.join(testDir,name);
  let src=fs.readFileSync(p,'utf8');
  if(!src.includes('extension/chrome/manifest.json')||!src.includes('3.14.0'))continue;
  const before=src;
  src=src.replace(/(manifest\[['"]version['"]\]\s*==\s*['"])3\.14\.0(['"])/g,`$1${FINAL_EXTENSION}$2`);
  src=src.replace(/(CURRENT_EXTENSION\s*=\s*['"])3\.14\.0(['"])/g,`$1${FINAL_EXTENSION}$2`);
  src=src.replace(/(EXPECTED_EXTENSION(?:_VERSION)?\s*=\s*['"])3\.14\.0(['"])/g,`$1${FINAL_EXTENSION}$2`);
  if(src!==before){fs.writeFileSync(p,src,'utf8');normalizedTests.push(name)}
}
console.log(JSON.stringify({event:'R14_PY_VERSION_CONTRACT_SWEEP',normalized:normalizedTests}));

// Fail hard if a current-manifest assertion still pins the obsolete version.
const stale=[];
for(const name of fs.readdirSync(testDir)){
  if(!/^test_.*\.py$/.test(name))continue;
  const p=path.join(testDir,name),src=fs.readFileSync(p,'utf8');
  if(src.includes('extension/chrome/manifest.json')&&/manifest\[['"]version['"]\]\s*==\s*['"]3\.14\.0['"]/.test(src))stale.push(name);
}
if(stale.length)throw new Error(`R14_STALE_CURRENT_EXTENSION_TESTS:${stale.join(',')}`);
