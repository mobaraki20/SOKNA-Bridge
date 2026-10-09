import fs from 'node:fs';

const capturePath='extension/chrome/browser_capture_map.js';
let text=fs.readFileSync(capturePath,'utf8');
const captureBefore=text;

const categoryLabels='["\u062f\u0633\u062a\u0647\u200c\u0628\u0646\u062f\u06cc \u062c\u062f\u06cc\u062f","\u062f\u0633\u062a\u0647 \u062c\u062f\u06cc\u062f","\u0648\u06cc\u0631\u0627\u06cc\u0634 \u062f\u0633\u062a\u0647","\u0648\u06cc\u0631\u0627\u06cc\u0634"]';
const menuLabels='["\u0645\u0646\u0648\u06cc \u062c\u062f\u06cc\u062f","\u0645\u0646\u0648 \u062c\u062f\u06cc\u062f","\u0648\u06cc\u0631\u0627\u06cc\u0634 \u0645\u0646\u0648","\u0648\u06cc\u0631\u0627\u06cc\u0634"]';

text=text.replace(/C06:\[\["click",\[[^\n]*?\]\]\]/,`C06:[["click",${categoryLabels}]]`);
text=text.replace(/C09:\[\["click",\[[^\n]*?\]\]\]/,`C09:[["click",${menuLabels}]]`);

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
const resultGetContract=' "result.get":tool("agent","Read a bounded chunk from a durable large-result reference. id must be the 64-hex result_ref.id returned by the Agent. This is not a command lookup; use bridge.command.get for command ids.",obj({id:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:12000}},["id"]),{errors:["Invalid result ref id","Result ref not found"]}),\n';
if(!contracts.includes('"result.get":tool(')){
  const anchor=' "artifact.apply":tool("agent","Apply a verified workspace patch artifact with SHA/freshness guards.",obj({workspace:S,path:S,expected_sha256:S,apply:B},["workspace","path","expected_sha256"]),{mutating:true,destructive:true,idempotency:"precondition_guarded"}),\n';
  if(!contracts.includes(anchor))throw new Error('R14_RESULT_GET_CONTRACT_ANCHOR_MISSING');
  contracts=contracts.replace(anchor,anchor+resultGetContract);
}
if(!contracts.includes('This is not a command lookup; use bridge.command.get for command ids.'))throw new Error('R14_RESULT_GET_CONTRACT_NOT_APPLIED');
if(!contracts.includes('pattern:"^[a-fA-F0-9]{64}$"'))throw new Error('R14_RESULT_GET_HASH_PATTERN_MISSING');
if(contracts!==contractsBefore){
  fs.writeFileSync(contractsPath,contracts,'utf8');
  console.log('R14_RESULT_GET_CONTRACT_UPDATED');
}else{
  console.log('R14_RESULT_GET_CONTRACT_ALREADY_FINAL');
}
