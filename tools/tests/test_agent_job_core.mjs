import fs from 'fs';import vm from 'vm';
const code=fs.readFileSync('extension/chrome/agent_job_core.js','utf8');const ctx={};ctx.globalThis=ctx;vm.runInNewContext(code,ctx,{filename:'agent_job_core.js'});const C=ctx.__SOKNA_AGENT_JOB_CORE_V1__;const a=(v,m)=>{if(!v)throw new Error(m)};
const ci={schema:'sokna-ci-summary-v1',ok:true,provider:'github-actions',environment:'github_windows_clean',profile:'full',request_id:'r1',run_id:7,conclusion:'success',head_sha:'abc'};
let s=C.summarizeJob({job:{id:'j1',status:'done',result:{results:[{result:{stdout:JSON.stringify(ci)}}]}}});a(s.ok&&s.ci?.run_id===7&&s.ci?.profile==='full','CI summary');
s=C.summarizeJob({job:{id:'j2',status:'failed',result:{results:[{result:{ok:false,stderr:'boom'}}]}}});a(!s.ok&&s.error.includes('boom'),'failed evidence');
s=C.summarizeJob({job:{id:'j3',status:'done',result:{results:[{result:{ok:true,stdout:'activation-ok'}}]}}});a(s.ok&&s.output_excerpt.includes('activation-ok'),'generic output');
a(C.terminalJobStatus('done')&&C.terminalJobStatus('failed')&&!C.terminalJobStatus('running'),'terminal states');
let jobs=C.findSubmittedJobs('job.submit',{ok:true,job_id:'direct-1'});a(jobs.length===1&&jobs[0].job_id==='direct-1','direct job discovery');
jobs=C.findSubmittedJobs('job.batch',{ok:true,results:[{action:'plan.run',result:{ok:true,results:[{action:'job.submit',result:{ok:true,job_id:'nested-1'}}]}}]});a(jobs.length===1&&jobs[0].job_id==='nested-1','nested job discovery');
const seen={a:{state:'done',posted:false,conversationKey:'c',acceptedAt:10,result:{ok:true}},stale:{state:'done',posted:false,conversationKey:'c',acceptedAt:5},e:{state:'done',posted:false,kind:'status-event',conversationKey:'c',parentCommandId:'a',acceptedAt:30}};
a(C.shouldBlockStatusEvent('e',seen.e,seen,'c'),'result-first parent block');seen.a.posted=true;a(!C.shouldBlockStatusEvent('e',seen.e,seen,'c'),'result-first parent release');
const orphan={state:'done',posted:false,kind:'status-event',conversationKey:'c',parentCommandId:'missing',acceptedAt:40};a(!C.shouldBlockStatusEvent('o',orphan,seen,'c'),'stale unrelated result must not block terminal event');

console.log(JSON.stringify({ok:true,tests:9}));
