import fs from "node:fs";
const p=JSON.parse(fs.readFileSync("docs/third_party/browser-backend-whg517-v0.7.1.json","utf8"));
if(p.schema!=="sokna-third-party-pin-v1")throw new Error("third-party pin schema invalid");
if(p.upstream?.repository!=="whg517/browser-bridge")throw new Error("browser backend repository drift");
if(p.upstream?.license!=="Apache-2.0")throw new Error("browser backend license drift");
if(p.upstream?.release_tag!=="v0.7.1")throw new Error("browser backend tag drift");
if(!/^[a-f0-9]{40}$/.test(p.upstream?.release_commit||""))throw new Error("browser backend commit pin missing");
if(!/^[a-f0-9]{64}$/.test(p.windows_x64?.expected_sha256||""))throw new Error("browser backend sha256 pin missing");
if(p.windows_x64.expected_sha256!==p.windows_x64.sha256)throw new Error("browser backend sha mismatch");
if(p.windows_x64.provider!=="github_release_asset")throw new Error("browser backend provider must use verified GitHub release acquisition");
if(p.sokna_policy?.mandatory_target_gate!==true||p.sokna_policy?.allow_ambient_tab_access!==false)throw new Error("SOKNA browser target policy weakened");
for(const highRisk of ["page_eval","cookie_get","storage_get"]){
  if(!p.sokna_policy.disable_or_do_not_expose.includes(highRisk))throw new Error("high-risk browser tool exposed: "+highRisk);
}
console.log("THIRD_PARTY_BROWSER_PIN_PASS");
