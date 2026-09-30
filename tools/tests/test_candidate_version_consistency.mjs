import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT=process.cwd();
const EXPECTED="3.13.0";
const AGENT="2.7.1";
const CANDIDATE="sokna-agent-2.7.1-r10";
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");

const manifest=JSON.parse(read("extension/chrome/manifest.json"));
assert.equal(manifest.version,EXPECTED,"manifest candidate version mismatch");
assert.ok(read("extension/chrome/background.js").includes('const VERSION="'+EXPECTED+'"'),"background version mismatch");
assert.ok(read("extension/chrome/content.js").includes('const VERSION="'+EXPECTED+'"'),"content version mismatch");

const wf=read(".github/workflows/r10-final-validation.yml");
for(const needle of [
  "SOKNA_CANDIDATE_REF: "+CANDIDATE,
  "SOKNA_AGENT_VERSION: "+AGENT,
  "SOKNA_EXTENSION_VERSION: "+EXPECTED,
  "SOKNA_SEMANTIC_VERSION: 2.1.1"
]) assert.ok(wf.includes(needle),"r10 final workflow missing "+needle);

const release=read("docs/releases/2.7.1-r10.md");
for(const needle of [CANDIDATE,EXPECTED,AGENT])
  assert.ok(release.includes(needle),"r10 release document missing "+needle);

for(const file of ["extension/chrome/background.js","extension/chrome/content.js","extension/chrome/manifest.json"])
  assert.ok(!read(file).includes("3.12.8"),file+" still contains previous extension version");

console.log("CANDIDATE_VERSION_CONSISTENCY_PASS");
