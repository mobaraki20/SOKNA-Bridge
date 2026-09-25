import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src=fs.readFileSync(new URL('../../extension/chrome/protocol.js',import.meta.url),'utf8');
const ctx={TextEncoder,Date,Set,globalThis:{}};ctx.globalThis=ctx;vm.runInNewContext(src,ctx);
const P=ctx.__SOKNA_PROTOCOL_V1__;assert.ok(P);
assert.equal(P.v,2);assert.equal(P.protocolVersion,'2');assert.equal(P.schemaVersion,'2');

const c=P.commandEnvelope({id:'unified-1',action:'ping',params:{}});
assert.equal(c.kind,'command');assert.equal(c.messageId,'unified-1');assert.equal(c.correlationId,'unified-1');assert.equal(c.id,'unified-1');
assert.equal(P.validateEnvelope(c,{kind:'command'}).ok,true);
assert.equal(P.validateEnvelope({...c,protocolVersion:'1'},{kind:'command'}).error,'PROTOCOL_VERSION_UNSUPPORTED');
assert.equal(P.validateEnvelope({...c,correlationId:'other'},{kind:'command'}).error,'COMMAND_ID_CORRELATION_MISMATCH');
const n=P.nack({messageId:'nack-1',correlationId:'unified-1',action:'ping',error:'SCHEMA_INVALID'});
assert.equal(n.kind,'nack');assert.equal(n.executed,false);assert.equal(n.correlationId,'unified-1');

const content=fs.readFileSync(new URL('../../extension/chrome/content.js',import.meta.url),'utf8');
const dom=fs.readFileSync(new URL('../../extension/chrome/dom_core.js',import.meta.url),'utf8');
const semantic=fs.readFileSync(new URL('../../extension/chrome/semantic_intent.js',import.meta.url),'utf8');
for(const active of [src,content,dom]){
  assert.doesNotMatch(active,/SOKNA3CMD:/);
  assert.doesNotMatch(active,/SOKNA4CMD:/);
  assert.doesNotMatch(active,/SOKNA-CMD-B64/);
  assert.doesNotMatch(active,/SOKNA-V2-CMD/);
}
assert.match(semantic,/\[SOKNA-INTENT\]/);
assert.match(content,/commandDiscovery:"semantic-intent-only"/);
assert.match(content,/legacyCommandParsers:false/);
console.log('UNIFIED_TRANSPORT_REGRESSION_PASS');
