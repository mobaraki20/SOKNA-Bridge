import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('extension/chrome/browser_capture_map.js','utf8');
const from=source.indexOf('function safeReadOnlyUrl(url){');
const to=source.indexOf('async function explicitDomAssertion(',from);
assert.ok(from>=0&&to>from,"Capture security helpers missing");
const helpers=vm.runInNewContext(
  source.slice(from,to)+'\n({safeReadOnlyUrl,validExpected})',
  {URL,decodeURIComponent,RegExp,Array,Object,String});
for(const url of [
  'https://example.org/','https://example.org/read-only?tab=1',
  'http://127.0.0.1:8080/app/report'
])assert.equal(helpers.safeReadOnlyUrl(url),true,url);
for(const url of [
  'file:///tmp/secret','https://user:password@example.org/','not-a-url',
  'https://example.org/logout','https://example.org/LOG-OUT',
  'https://example.org/delete/record','https://example.org/a?cmd=signout',
  'https://example.org/%6cogout','https://example.org/%256cogout',
  'https://example.org/forgot/reset-session','https://example.org/remove-account'
])assert.equal(helpers.safeReadOnlyUrl(url),false,url);
assert.equal(helpers.validExpected({selector:'#safe'}),true);
assert.equal(helpers.validExpected({forbidden_selector:'.danger'}),true);
for(const invalid of [{},null,[],{selector:''},{secret:'x'},{selector:'x'.repeat(241)}])
  assert.equal(helpers.validExpected(invalid),false,JSON.stringify(invalid));
assert.ok(source.includes('assertion=await explicitDomAssertion(tabId,e.expected)'),"DOM assertion not executed");
assert.ok(source.includes('const qaPass=passed&&items.every(x=>x.assertion_status==="PASS")'),"missing QA evidence gate");
assert.ok(source.includes('qa_pass:qaPass'),"report missing QA outcome");
assert.ok(source.includes('BROWSER_CAPTURE_SESSION_MUTATION_BLOCKED'),"mutating URL not blocked at import");
console.log('BRIDGE_CAPTURE_SAFETY_AND_DOM_QA_GATE_PASS');
