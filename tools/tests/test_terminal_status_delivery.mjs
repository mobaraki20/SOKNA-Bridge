import fs from 'fs';
import vm from 'vm';

const source=fs.readFileSync('extension/chrome/content.js','utf8');
const start=source.indexOf('function parseBridgeEnvelope(text){');
const end=source.indexOf('async function waitForResultVisible',start);
if(start<0||end<0)throw new Error('type-aware visibility helpers not found');
const fnSource=source.slice(start,end)+'\nglobalThis.__testResultVisible=resultVisibleInUserTurn;';

function run(pageText,payload,composerText=''){
  const ctx={
    Date,
    JSON,
    document:{
      body:{innerText:pageText,textContent:pageText},
      querySelectorAll:()=>[]
    },
    composer:()=>({value:composerText}),
    textOf:e=>String(e?.value||e?.innerText||e?.textContent||''),
    samePayload:(a,b)=>String(a||'').trim()===String(b||'').trim(),
  };
  ctx.globalThis=ctx;
  vm.runInNewContext(fnSource,ctx,{filename:'content-result-visible.js'});
  return ctx.__testResultVisible(payload);
}

const parent='rc7-ci-submit-45';
const eventId='__event__:job:rc7-ci-a6672fe';
const ack=`[SOKNA-V2-RESULT]{"id":"${parent}","status":"queued","ok":true,"job_id":"rc7-ci-a6672fe"}[/SOKNA-V2-RESULT]`;
const terminal=`[SOKNA-V2-STATUS]{"eventId":"${eventId}","kind":"job-terminal","commandId":"${parent}","jobId":"rc7-ci-a6672fe","status":"failed","ok":false}[/SOKNA-V2-STATUS]`;

if(run(ack,terminal))throw new Error('parent ACK falsely satisfied terminal event delivery');
if(!run(ack+'\n'+terminal,terminal))throw new Error('terminal event bubble not recognized by eventId');

const normal='[SOKNA-V2-RESULT]{"id":"normal-1","ok":true}[/SOKNA-V2-RESULT]';
if(!run(normal,normal))throw new Error('normal result existing-bubble regression');

const acceptedId='workspace-list-test-20260928-014';
const acceptedStatus=`[SOKNA-V2-STATUS]{"eventId":"__event__:accepted:${acceptedId}","kind":"command-accepted","commandId":"${acceptedId}","status":"accepted"}[/SOKNA-V2-STATUS]`;
const successResult=`[SOKNA-V2-RESULT]{"id":"${acceptedId}","ok":true,"workspaces":["SOKNA-Bridge"]}[/SOKNA-V2-RESULT]`;
if(run(acceptedStatus,successResult))throw new Error('accepted STATUS commandId falsely satisfied RESULT visibility');
if(!run(acceptedStatus+'\n'+successResult,successResult))throw new Error('real RESULT bubble was not recognized after accepted STATUS');

const errorId='repo-access-20260928-006';
const errorStatus=`[SOKNA-V2-STATUS]{"eventId":"__event__:accepted:${errorId}","kind":"command-accepted","commandId":"${errorId}","status":"accepted"}[/SOKNA-V2-STATUS]`;
const errorResult=`[SOKNA-V2-RESULT]{"id":"${errorId}","ok":false,"error":"WORKSPACE_TOOL_NOT_ALLOWED: gh"}[/SOKNA-V2-RESULT]`;
if(run(errorStatus,errorResult))throw new Error('accepted STATUS commandId falsely suppressed error RESULT');
if(!run(errorStatus+'\n'+errorResult,errorResult))throw new Error('real error RESULT bubble was not recognized');

const strayText='debug text says "commandId":"'+acceptedId+'" and "id":"'+acceptedId+'" but has no RESULT envelope';
if(run(strayText,successResult))throw new Error('free-text id substring falsely satisfied RESULT visibility');


console.log(JSON.stringify({ok:true,tests:8}));
