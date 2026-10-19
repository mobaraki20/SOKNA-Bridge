import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const root=new URL('../../extension/chrome/',import.meta.url);
const ctx={};
runInNewContext(readFileSync(new URL('message_sender_boundary_core.js',root),'utf8'),ctx);
const gate=ctx.__SOKNA_MESSAGE_SENDER_BOUNDARY_V1__;
assert.ok(gate&&typeof gate.validate==='function');
const content={tab:{id:42,url:'https://chatgpt.com/c/test'},frameId:0};
assert.equal(gate.validate({type:'COMMAND',tabId:42},content).ok,true);
assert.equal(gate.validate({type:'CONTENT_READY'},content).ok,true);
assert.equal(gate.validate({type:'ACTIVITY_SNAPSHOT',tabId:42},content).ok,true);
for(const badId of [43,0,-1,'42',null]){
  const r=gate.validate({type:'COMMAND',tabId:badId},content);
  assert.equal(r.ok,false);assert.equal(r.code,'SENDER_TAB_MISMATCH');
}
for(const type of ['REGISTER_CHAT_ORIGIN','REGISTER_BROWSER_ORIGIN','CONNECT_CHAT','ARM','DISARM']){
  const r=gate.validate({type,tabId:42,url:'https://example.com'},content);
  assert.equal(r.ok,false);assert.equal(r.code,'EXTENSION_UI_REQUIRED');
  assert.equal(gate.validate({type,tabId:42,url:'https://example.com'},{id:'extension'}).ok,true);
}
const bootstrap=readFileSync(new URL('background_bootstrap.js',root),'utf8');
assert.match(bootstrap,/importScripts\([^)]*message_sender_boundary_core\.js/);
assert.match(bootstrap,/MSGBOUNDARY\?\.validate\?\.\(m,sender\)/);
const chromeManifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
assert.equal(chromeManifest.manifest_version,3);
assert.ok(chromeManifest.permissions.includes('nativeMessaging'));
assert.equal(Object.prototype.hasOwnProperty.call(chromeManifest,'externally_connectable'),false);
assert.equal(chromeManifest.content_scripts.every(s=>s.world==='ISOLATED'),true);
assert.equal(chromeManifest.optional_host_permissions.includes('<all_urls>'),false);
assert.equal(chromeManifest.host_permissions.includes('<all_urls>'),false);
console.log('BRIDGE_MESSAGE_SENDER_AND_MANIFEST_SECURITY_PASS');
