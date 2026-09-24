import fs from 'fs';
import vm from 'vm';

const source=fs.readFileSync('extension/chrome/content.js','utf8');
const start=source.indexOf('function resultVisibleInUserTurn(payload){');
const end=source.indexOf('async function waitForResultVisible',start);
if(start<0||end<0)throw new Error('resultVisibleInUserTurn not found');
const fnSource=source.slice(start,end)+'\nglobalThis.__testResultVisible=resultVisibleInUserTurn;';

function run(pageText,payload,composerText=''){
  const ctx={
    document:{body:{innerText:pageText,textContent:pageText}},
    composer:()=>({value:composerText}),
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

console.log(JSON.stringify({ok:true,tests:3}));
