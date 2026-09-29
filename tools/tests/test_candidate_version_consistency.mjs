import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT=process.cwd();
const EXPECTED="3.12.8";
const STALE="3.12.7";

const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,"extension/chrome/manifest.json"),"utf8"));
assert.equal(manifest.version,EXPECTED,"manifest candidate version mismatch");

for(const [file,needle] of [
  ["extension/chrome/background.js",'const VERSION="'+EXPECTED+'"'],
  ["extension/chrome/content.js",'const VERSION="'+EXPECTED+'"'],
  ["tools/release/Build-R1SourceRC.py","default='"+EXPECTED+"'"],
  [".github/workflows/windows-agent-validation.yml","--extension-version "+EXPECTED],
  ["tools/activation/Activate-AutonomyBootstrap.ps1",EXPECTED],
]){
  const text=fs.readFileSync(path.join(ROOT,file),"utf8");
  assert.ok(text.includes(needle),file+" missing candidate version "+EXPECTED);
}

const roots=["extension/chrome","tools/tests","tools/activation","tools/release",".github/workflows"];
const stale=[];
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())walk(p);
    else if(/\.(?:js|mjs|py|ps1|yml|yaml|json|html)$/.test(ent.name)){
      const rel=path.relative(ROOT,p).replaceAll("\\","/");
      if(rel==="tools/tests/test_candidate_version_consistency.mjs")continue;
      const text=fs.readFileSync(p,"utf8");
      if(text.includes(STALE))stale.push(rel);
    }
  }
}
for(const r of roots)walk(path.join(ROOT,r));
assert.deepEqual(stale,[],"stale active 3.12.7 references: "+stale.join(", "));
console.log("CANDIDATE_VERSION_CONSISTENCY_PASS");
