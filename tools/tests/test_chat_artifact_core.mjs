import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=fs.readFileSync(path.join(root,'extension/chrome/chat_artifact_core.js'),'utf8');
const ctx={};vm.createContext(ctx);vm.runInContext(src,ctx);
const C=ctx.__SOKNA_CHAT_ARTIFACT_CORE_V1__;
if(!C)throw new Error('core missing');
const ok=(v,m)=>{if(!v)throw new Error(m)};
ok(C.safeFilename('SOKNA-RC9-checkpoint3.zip'),'safe filename');
ok(!C.safeFilename('../x.zip'),'traversal filename');
ok(!C.safeFilename('x\\y.zip'),'nested filename');
ok(C.normalizeSha('A'.repeat(64))==='a'.repeat(64),'sha normalize');
ok(C.normalizeSha('abc')==='','invalid sha');
const one=C.selectCandidate([
  {index:0,href:'sandbox:/mnt/data/SOKNA-RC9-checkpoint3.zip',text:'SOKNA-RC9-checkpoint3.zip',visible:true},
  {index:1,href:'https://example.invalid/nope',text:'Other.zip',visible:true},
  {index:2,href:'https://example.invalid/hidden',text:'SOKNA-RC9-checkpoint3.zip',visible:false},
  {index:3,href:'https://example.invalid/user',text:'SOKNA-RC9-checkpoint3.zip',authorRole:'user',visible:true},
],'SOKNA-RC9-checkpoint3.zip');
ok(one.ok&&one.candidate.index===0,'exact visible candidate');
const amb=C.selectCandidate([
  {index:0,href:'a',text:'same.zip',visible:true},{index:1,href:'b',text:'same.zip',visible:true}
],'same.zip');
ok(!amb.ok&&amb.reason==='attachment_ambiguous','ambiguous must fail closed');
ok(C.pathWithin('C:\\Users\\Mehran\\Downloads\\x.zip','C:\\Users\\Mehran\\Downloads'),'windows path within');
ok(!C.pathWithin('C:\\Temp\\x.zip','C:\\Users\\Mehran\\Downloads'),'windows path outside');
const t=C.terminalSummary({transferId:'chat-x',parentCommandId:'x',filename:'x.zip'},true,'',{ok:true,artifact_id:'a'});
ok(t.kind==='artifact-transfer-terminal'&&t.ok&&t.status==='applied'&&t.commandId==='x','terminal summary');
console.log('CHAT_ARTIFACT_CORE_PASS');
