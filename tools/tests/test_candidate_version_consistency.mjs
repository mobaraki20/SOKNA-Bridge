import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT=process.cwd();
const CURRENT_EXTENSION="3.14.2";
const CURRENT_AGENT="2.7.1";
const R11_EXTENSION="3.14.0";
const R11_CANDIDATE="sokna-agent-2.7.1-r11";
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");

// Current release lineage must be internally version-consistent.
const manifest=JSON.parse(read("extension/chrome/manifest.json"));
assert.equal(manifest.version,CURRENT_EXTENSION,"manifest current version mismatch");
assert.ok(read("extension/chrome/background.js").includes('const VERSION="'+CURRENT_EXTENSION+'"'),"background current version mismatch");
assert.ok(read("extension/chrome/content.js").includes('const VERSION="'+CURRENT_EXTENSION+'"'),"content current version mismatch");

// Historical release contracts are frozen and must not be rewritten by a later release.
const r11wf=read(".github/workflows/r11-final-validation.yml");
for(const needle of [
  "SOKNA_CANDIDATE_REF: "+R11_CANDIDATE,
  "SOKNA_AGENT_VERSION: "+CURRENT_AGENT,
  "SOKNA_EXTENSION_VERSION: "+R11_EXTENSION,
  "SOKNA_SEMANTIC_VERSION: 2.1.1"
]) assert.ok(r11wf.includes(needle),"r11 frozen workflow missing "+needle);

const r11release=read("docs/releases/2.7.1-r11.md");
for(const needle of [R11_CANDIDATE,R11_EXTENSION,CURRENT_AGENT])
  assert.ok(r11release.includes(needle),"r11 frozen release document missing "+needle);

const r10wf=read(".github/workflows/r10-final-validation.yml");
assert.ok(r10wf.includes("SOKNA_EXTENSION_VERSION: 3.13.0"),"frozen r10 workflow must keep extension 3.13.0");

for(const file of ["extension/chrome/background.js","extension/chrome/content.js","extension/chrome/manifest.json"])
  assert.ok(!read(file).includes("3.12.8"),file+" still contains previous extension version");

console.log("CANDIDATE_VERSION_CONSISTENCY_PASS");
