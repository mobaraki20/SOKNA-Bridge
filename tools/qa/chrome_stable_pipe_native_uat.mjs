#!/usr/bin/env node
// Google Chrome STABLE (branded) + real Inno-installed extension and Native Host.
// Disposable GitHub Windows only; DevTools unsafe-extension flag scoped to test profile.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const args=Object.fromEntries(process.argv.slice(2).filter((_,i)=>i%2===0).map((k,i)=>[k,process.argv[i*2+3]]));
const fail=why=>{throw Error(why)};
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Windows')fail('STABLE_UAT_REQUIRES_DISPOSABLE_WINDOWS');
const base=resolve(process.env.RUNNER_TEMP||fail('RUNNER_TEMP_REQUIRED'));
for(const k of ['--chrome','--extension','--host-manifest','--evidence','--profile']){
  if(!args[k])fail('ARG_MISSING_'+k);
}
for(const k of ['--extension','--host-manifest','--evidence','--profile']){
  if(!resolve(args[k]).toLowerCase().startsWith((base+'\\').toLowerCase()))fail('PATH_OUTSIDE_EPHEMERAL_RUNNER');
}
const chromeExe=resolve(args['--chrome']),ext=resolve(args['--extension']),profile=resolve(args['--profile']);
if(!existsSync(chromeExe)||!existsSync(join(ext,'manifest.json')))fail('CHROME_OR_EXTENSION_NOT_FOUND');
const chromeParts=chromeExe.toLowerCase().replaceAll('/','\\');
if(!chromeParts.endsWith('\\google\\chrome\\application\\chrome.exe'))fail('NOT_INSTALLED_BRANDED_GOOGLE_CHROME');
const evidencePath=resolve(args['--evidence']),manifest=JSON.parse(readFileSync(join(ext,'manifest.json'),'utf8'));
const pub=Buffer.from(manifest.key||'','base64');
if(pub.length<128)fail('EXTENSION_KEY_INVALID');
const abc='abcdefghijklmnop';
const expectedId=[...createHash('sha256').update(pub).digest().subarray(0,16)].map(b=>abc[b>>4]+abc[b&15]).join('');
const nativeName='com.sokna.bridge.v3',nativePath=resolve(args['--host-manifest']),host=JSON.parse(readFileSync(nativePath,'utf8'));
assert.equal(host.name,nativeName);assert.deepEqual(host.allowed_origins,['chrome-extension://'+expectedId+'/']);
if(!existsSync(host.path))fail('NATIVE_HOST_EXE_NOT_FOUND');
const registry='HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\'+nativeName;
const reg=(action,params)=>execFileSync('reg.exe',[action,registry,...params],{windowsHide:true,stdio:'ignore',timeout:10000});
let registryPresent=true;
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const passed=[];
const mark=x=>{passed.push(x);console.log(x+'_PASS')};
function startBrowser(){
  const opt=['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-sync','--remote-debugging-pipe','--enable-unsafe-extension-debugging',
    '--user-data-dir='+profile,'about:blank'];
  const p=spawn(chromeExe,opt,{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
  const pending=new Map();let buffer=Buffer.alloc(0),serial=0;
  const rejectAll=()=>{for(const x of pending.values()){clearTimeout(x.timer);x.reject(Error('BROWSER_PIPE_CLOSED'))}pending.clear()};
  p.stdio[4].on('data',part=>{
    buffer=Buffer.concat([buffer,part]);
    if(buffer.length>8_000_000){rejectAll();buffer=Buffer.alloc(0);return}
    let i;
    while((i=buffer.indexOf(0))>=0){
      const packet=buffer.subarray(0,i);buffer=buffer.subarray(i+1);
      if(!packet.length)continue;
      let msg;try{msg=JSON.parse(packet.toString('utf8'))}catch{continue}
      const x=pending.get(msg.id);
      if(x){pending.delete(msg.id);clearTimeout(x.timer);if(msg.error)x.reject(Error('CDP_ERROR_'+msg.error.code+'_'+x.method));else x.resolve(msg.result||{})}
    }
  });
  p.on('exit',rejectAll);p.on('error',rejectAll);
  const command=(method,params={},sessionId)=>{
    return new Promise((resolve,reject)=>{
      const id=++serial;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT_'+method))},30000);
      pending.set(id,{resolve,reject,timer,method});
      const payload={id,method,params};if(sessionId)payload.sessionId=sessionId;
      try{p.stdio[3].write(JSON.stringify(payload)+'\0')}catch(e){clearTimeout(timer);pending.delete(id);reject(Error('PIPE_WRITE_FAILED'))}
    });
  };
  const close=async()=>{
    // Browser.close acknowledges before Chrome has flushed profile Preferences.
    // Wait for actual process termination; forcibly killing it immediately
    // can make an otherwise persistent unpacked extension disappear on restart.
    try{await Promise.race([command('Browser.close'),sleep(3000)])}catch{}
    for(let i=0;i<40&&p.exitCode===null;i++)await sleep(200);
    if(p.exitCode===null){try{p.kill()}catch{}}
    rejectAll();
  };
  return {command,close,process:p};
}
async function extensionContext(b){
  const t=await b.command('Target.createTarget',{url:'chrome-extension://'+expectedId+'/popup.html'});
  const a=await b.command('Target.attachToTarget',{targetId:t.targetId,flatten:true});
  await b.command('Runtime.enable',{},a.sessionId);
  // Target.createTarget/attach completes before navigation or extension globals are ready.
  // Do not treat a transient about:blank evaluation as a Chrome/Native Host failure.
  let ready=false;
  for(let i=0;i<40;i++){
    try{
      const check=await b.command('Runtime.evaluate',{
        expression:'({href:location.href,id:globalThis.chrome?.runtime?.id||""})',
        returnByValue:true
      },a.sessionId);
      const x=check.result?.value;
      if(x?.id===expectedId&&String(x.href||'').startsWith('chrome-extension://'+expectedId+'/')){
        ready=true;break;
      }
    }catch{}
    await sleep(250);
  }
  if(!ready)fail('EXTENSION_POPUP_CONTEXT_NOT_READY');
  const evaluate=async expression=>{
    const r=await b.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},a.sessionId);
    if(r.exceptionDetails||r.result?.subtype==='error')fail('EXTENSION_CONTEXT_EVAL_FAILED');
    return r.result?.value;
  };
  const native=async (request)=>evaluate('new Promise(resolve=>chrome.runtime.sendNativeMessage('+
    JSON.stringify(nativeName)+','+JSON.stringify(request)+',reply=>{const e=chrome.runtime.lastError;resolve({error:e?String(e.message):null,response:reply||null})}))');
  return {evaluate,native};
}
async function main(){
  mkdirSync(profile,{recursive:true});
  let b=startBrowser();let chromeVersion='';
  try{
    let v;
    for(let i=0;i<10;i++){try{v=await b.command('Browser.getVersion');break}catch{await sleep(400)}}
    if(!v||!/^Chrome\//.test(String(v.product||'')))fail('NOT_BRANDED_STABLE_CHROME_CDP');
    chromeVersion=String(v.product);
    mark('STABLE_CHROME_BRANDED_PIPE');
    const loaded=await b.command('Extensions.loadUnpacked',{path:ext,enableInIncognito:false});
    assert.equal(loaded.id,expectedId);
    const list=await b.command('Extensions.getExtensions');
    const item=(list.extensions||[]).find(x=>x.id===expectedId);
    if(!item||!item.enabled||item.version!==manifest.version)fail('CHROME_STABLE_EXTENSION_NOT_ENABLED');
    mark('STABLE_CHROME_UNPACKED_INSTALLED');
    const extCtx=await extensionContext(b);
    const detail=await extCtx.evaluate('({id:chrome.runtime.id,version:chrome.runtime.getManifest().version,href:location.href})');
    assert.equal(detail.id,expectedId);assert.equal(detail.version,manifest.version);
    const permission=await extCtx.evaluate('Promise.all([chrome.permissions.contains({permissions:["nativeMessaging"]}),chrome.permissions.contains({origins:["https://example.com/*"]})])');
    assert.deepEqual(permission,[true,false]);
    mark('STABLE_CHROME_EXTENSION_PERMISSIONS');
    let reply=await extCtx.native({type:'host.ping',request_id:'stable-first-1'});
    assert.equal(reply.error,null);assert.equal(reply.response?.ok,true);
    assert.equal(reply.response?.type,'host.pong');assert.equal(reply.response?.request_id,'stable-first-1');
    mark('STABLE_CHROME_TO_INSTALLED_HOST_PING');
    reply=await extCtx.native({type:'invalid.stable',request_id:'stable-invalid-2'});
    assert.equal(reply.error,null);assert.equal(reply.response?.ok,false);
    mark('STABLE_CHROME_INVALID_COMMAND_DENIED');
    reg('delete',['/f']);registryPresent=false;
    reply=await extCtx.native({type:'host.ping',request_id:'stable-disconnected-3'});
    if(!reply.error||reply.response?.ok===true)fail('STABLE_DISCONNECTED_FALSE_SUCCESS');
    mark('STABLE_CHROME_FAIL_CLOSED');
    reg('add',['/ve','/t','REG_SZ','/d',nativePath,'/f']);registryPresent=true;
    reply=await extCtx.native({type:'host.ping',request_id:'stable-reconnected-4'});
    assert.equal(reply.error,null);assert.equal(reply.response?.ok,true);
    mark('STABLE_CHROME_NATIVE_RECONNECTED');
    // Allow Chrome to persist the extension/profile metadata before clean quit.
    await sleep(2000);
    await b.close();
    await sleep(800);
    b=startBrowser();
    let version;
    for(let i=0;i<10;i++){try{version=await b.command('Browser.getVersion');break}catch{await sleep(400)}}
    if(!version||!/^Chrome\//.test(String(version.product||'')))fail('STABLE_RESTART_NOT_READY');
    const again=await b.command('Extensions.getExtensions');
    if(!(again.extensions||[]).some(x=>x.id===expectedId&&x.enabled))fail('STABLE_EXTENSION_DID_NOT_SURVIVE_RESTART');
    const ctx=await extensionContext(b);
    reply=await ctx.native({type:'host.ping',request_id:'stable-restart-5'});
    assert.equal(reply.error,null);assert.equal(reply.response?.ok,true);
    mark('STABLE_CHROME_RESTART_RECONNECT');
    writeFileSync(evidencePath,JSON.stringify({
      schema:'sokna-bridge-branded-chrome-pipe-native-e2e-v1',
      evidence_kind:'DISPOSABLE_WINDOWS_SERVER_BRANDED_CHROME_CDP_PIPE',
      browser:chromeVersion,extension_version:manifest.version,extension_id:expectedId,
      passed,result:'PASS',windows10_client:'NOT_RUN',chrome_manual_ui:'NOT_RUN',
      maintenance_delta_upgrade:'NOT_RUN',release_ready:false
    },null,2)+'\n',{flag:'wx'});
    console.log('STABLE_BRANDED_CHROME_NATIVE_E2E_PASS');
  }finally{
    if(!registryPresent){try{reg('add',['/ve','/t','REG_SZ','/d',nativePath,'/f'])}catch{console.error('STABLE_REGISTRY_RESTORE_FAIL')}}
    await b.close();
  }
}
main().catch(e=>{console.error('STABLE_BRANDED_CHROME_NATIVE_E2E_FAIL:'+String(e?.message||'unknown'));process.exitCode=1});
