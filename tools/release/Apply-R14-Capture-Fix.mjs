import fs from 'node:fs';

const path='extension/chrome/browser_capture_map.js';
let text=fs.readFileSync(path,'utf8');
const before=text;

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

if(text!==before){
  fs.writeFileSync(path,text,'utf8');
  console.log('R14_CAPTURE_SOURCE_UPDATED');
}else{
  console.log('R14_CAPTURE_SOURCE_ALREADY_FINAL');
}
