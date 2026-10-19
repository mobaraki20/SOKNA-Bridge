#!/usr/bin/env node
// Real loaded Google Chrome for Testing -> Inno-installed Chrome Native Host.
// This harness is forbidden outside isolated, disposable GitHub Windows runners.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const arg=Object.fromEntries(process.argv.slice(2).filter((_,i)=>i%2===0).map((key,i)=>[key,process.argv[3+i*2]]));
const stop=code=>{throw Error(code)};
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Windows')stop('NOT_A_DISPOSABLE_GITHUB_WINDOWS_RUNNER');
const tmp=resolve(process.env.RUNNER_TEMP||stop('RUNNER_TEMP_UNSET'));
for(const k of ['--profile','--extension','--host-manifest','--evidence']){
  if(!arg[k]||!resolve(arg[k]).toLowerCase().startsWith((tmp+'\\').toLowerCase()))stop('UNSAFE_QA_PATH');
}
const profile=resolve(arg['--profile']),ext=resolve(arg['--extension']);
const manifest=JSON.parse(readFileSync(join(ext,'manifest.json'),'utf8'));
const pub=Buffer.from(manifest.key||'','base64');
if(pub.length<128)stop('EXTENSION_PUBLIC_KEY_INVALID');
const hash=createHash('sha256').update(pub).digest(), abc='abcdefghijklmnop';
const extId=[...hash.subarray(0,16)].map(x=>abc[x>>4]+abc[x&15]).join('');
const hostName='com.sokna.bridge.v3',hostPath=resolve(arg['--host-manifest']);
const host=JSON.parse(readFileSync(hostPath,'utf8'));
assert.equal(host.name,hostName);
assert.deepEqual(host.allowed_origins,['chrome-extension://'+extId+'/']);
if(!existsSync(host.path))stop('INSTALLED_HOST_EXECUTABLE_MISSING');
const reg='HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\'+hostName;
const regCmd=(op,args)=>execFileSync('reg.exe',[op,reg,...args],{stdio:'ignore',windowsHide:true,timeout:10000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),passed=[];
const mark=code=>{passed.push(code);console.log(code+'_PASS')};
let browser='';
async function launchCdp(){
  const portFile=join(profile,'DevToolsActivePort');let url='';
  for(let i=0;i<80;i++){
    if(existsSync(portFile)){
      const port=Number(readFileSync(portFile,'utf8').split(/\r?\n/)[0]);
      if(!Number.isInteger(port)||port<1||port>65535)stop('CDP_PORT_INVALID');
      try{
        const r=await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1500)});
        const d=await r.json();
        if(!/^Chrome\//.test(d.Browser||''))stop('NOT_GOOGLE_CHROME_FOR_TESTING');
        if(!String(d.webSocketDebuggerUrl||'').startsWith('ws://127.0.0.1:'))stop('CDP_NOT_LOOPBACK');
        browser=d.Browser;url=d.webSocketDebuggerUrl;break;
      }catch{}
    }
    await sleep(500);
  }
  if(!url)stop('CHROME_STARTUP_TIMEOUT');
  if(typeof WebSocket!=='function')stop('NODE_WEBSOCKET_UNAVAILABLE');
  const ws=new WebSocket(url),pending=new Map();let seq=0;
  await new Promise((ok,bad)=>{
    const t=setTimeout(()=>bad(Error('CDP_WEBSOCKET_TIMEOUT')),12000);
    ws.addEventListener('open',()=>{clearTimeout(t);ok()},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(t);bad(Error('CDP_WEBSOCKET_ERROR'))},{once:true});
  });
  ws.addEventListener('message',e=>{
    let p;try{p=JSON.parse(e.data)}catch{return}
    if(!pending.has(p.id))return;
    const x=pending.get(p.id);pending.delete(p.id);clearTimeout(x.timer);
    if(p.error)x.bad(Error('CDP_COMMAND_FAILED:'+p.error.code));
    else x.ok(p.result||{});
  });
  ws.addEventListener('close',()=>{for(const x of pending.values()){clearTimeout(x.timer);x.bad(Error('CDP_CLOSED'))}pending.clear()});
  const cmd=(method,params={},sessionId=null)=>{
    return new Promise((ok,bad)=>{
      const id=++seq,timer=setTimeout(()=>{pending.delete(id);bad(Error('CDP_TIMEOUT_'+method))},20000);
      pending.set(id,{ok,bad,timer});
      try{ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))}
      catch{pending.delete(id);clearTimeout(timer);bad(Error('CDP_SEND_FAILED'))}
    });
  };
  return {cmd,close:()=>ws.close()};
}
async function main(){
  const c=await launchCdp();let registered=true;
  try{
    const t=await c.cmd('Target.createTarget',{url:'chrome-extension://'+extId+'/popup.html'});
    const attach=await c.cmd('Target.attachToTarget',{targetId:t.targetId,flatten:true});
    const sid=attach.sessionId;
    await c.cmd('Runtime.enable',{},sid);
    const evalExt=async expression=>{
      const r=await c.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sid);
      if(r.exceptionDetails||r.result?.subtype==='error')stop('EXTENSION_EVALUATION_FAILED');
      return r.result?.value;
    };
    let id;
    for(let i=0;i<30;i++){
      try{id=await evalExt('({id:chrome.runtime.id,version:chrome.runtime.getManifest().version,href:location.href})');if(id?.id===extId)break}catch{}
      await sleep(500);
    }
    assert.equal(id?.id,extId,'EXTENSION_NOT_ACTUALLY_LOADED_IN_CHROME');
    assert.equal(id?.version,manifest.version,'EXTENSION_VERSION_MISMATCH');
    assert.ok(id.href.startsWith('chrome-extension://'+extId+'/'),'NOT_EXTENSION_PAGE');
    mark('CHROME_EXTENSION_CONTEXT');
    const permission=await evalExt('Promise.all([chrome.permissions.contains({permissions:["nativeMessaging"]}),chrome.permissions.contains({origins:["https://example.com/*"]})])');
    assert.deepEqual(permission,[true,false],'NATIVE_OR_OPTIONAL_HOST_PERMISSION_WRONG');
    mark('CHROME_PERMISSION_SCOPE');
    const native=async m=>evalExt('new Promise(resolve=>chrome.runtime.sendNativeMessage('+JSON.stringify(hostName)+','+JSON.stringify(m)+',r=>{const e=chrome.runtime.lastError;resolve({error:e?String(e.message):null,response:r||null})}))');
    const ping=await native({type:'host.ping',request_id:'chrome-ping-1'});
    assert.equal(ping?.error,null,'CHROME_TO_NATIVE_CONNECTION_FAILED');
    assert.equal(ping?.response?.ok,true);assert.equal(ping.response.type,'host.pong');
    assert.equal(ping.response.request_id,'chrome-ping-1');
    mark('CHROME_INSTALLED_HOST_PING');
    const unknown=await native({type:'test.invalid.type',request_id:'chrome-reject-2'});
    assert.equal(unknown?.error,null);assert.equal(unknown?.response?.ok,false);
    assert.equal(unknown.response.request_id,'chrome-reject-2');
    const badId=await native({type:'agent.exec',request_id:'chrome-reject-3',command:{id:'../invalid',action:'ping'}});
    assert.equal(badId?.error,null);assert.equal(badId?.response?.ok,false);
    mark('CHROME_HOST_REJECT_INVALID_COMMANDS');
    regCmd('delete',['/f']);registered=false;
    const missing=await native({type:'host.ping',request_id:'chrome-missing-4'});
    if(!missing?.error||missing?.response?.ok===true)stop('DISCONNECTED_HOST_FALSE_SUCCESS');
    mark('CHROME_HOST_DISCONNECT_FAIL_CLOSED');
    regCmd('add',['/ve','/t','REG_SZ','/d',hostPath,'/f']);registered=true;
    const recovered=await native({type:'host.ping',request_id:'chrome-reconnect-5'});
    assert.equal(recovered?.error,null);assert.equal(recovered?.response?.ok,true);
    assert.equal(recovered.response.request_id,'chrome-reconnect-5');
    mark('CHROME_HOST_RECONNECTED');
    assert.deepEqual(passed,['CHROME_EXTENSION_CONTEXT','CHROME_PERMISSION_SCOPE','CHROME_INSTALLED_HOST_PING','CHROME_HOST_REJECT_INVALID_COMMANDS','CHROME_HOST_DISCONNECT_FAIL_CLOSED','CHROME_HOST_RECONNECTED'],'CHROME_EVIDENCE_INCOMPLETE');
    writeFileSync(resolve(arg['--evidence']),JSON.stringify({
      schema:'sokna-bridge-chrome-installed-native-v1',
      kind:'DISPOSABLE_WINDOWS_CHROME_FOR_TESTING_INSTALLED_HOST',
      browser,extension_version:id.version,extension_id:extId,host:hostName,
      passed,status:'PASS',manual_chrome:'NOT_RUN',old_version_upgrade:'NOT_RUN',
      physical_power_failure:'NOT_RUN',target_app_uat:'NOT_RUN',release_ready:false
    },null,2)+'\n',{flag:'wx'});
    console.log('CHROME_INSTALLED_NATIVE_UAT_PASS');
    console.log('RELEASE_GATE_NOT_SATISFIED: manual Chrome, old version upgrade, physical recovery, 75 scenarios');
  }finally{
    if(!registered){try{regCmd('add',['/ve','/t','REG_SZ','/d',hostPath,'/f'])}catch{console.error('REGISTRY_RESTORE_FAILED')}}
    c.close();
  }
}
main().catch(e=>{console.error('CHROME_INSTALLED_NATIVE_UAT_FAIL:'+String(e?.message||'unknown'));process.exitCode=1});