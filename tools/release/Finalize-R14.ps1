param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function ReadUtf8([string]$Path){
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "R14_FILE_MISSING: $Path"}
  return ([IO.File]::ReadAllText((Resolve-Path $Path))).Replace("`r`n","`n")
}
function WriteUtf8([string]$Path,[string]$Text){
  [IO.File]::WriteAllText((Resolve-Path $Path),$Text.Replace("`r`n","`n"),[Text.UTF8Encoding]::new($false))
}
function ReplaceOnce([string]$Path,[string]$Old,[string]$New,[string]$AppliedMarker){
  $t=ReadUtf8 $Path
  if($AppliedMarker -and $t.Contains($AppliedMarker)){return}
  $n=([regex]::Matches($t,[regex]::Escape($Old))).Count
  if($n-ne1){throw "R14_PATCH_TARGET_COUNT: $Path :: $AppliedMarker :: $n"}
  WriteUtf8 $Path ($t.Replace($Old,$New))
}

# 1) plan.stage: preserve SafePath as authority, but allow safe nested plan files.
$agent='native/runtime/v2.7.1/agent.ps1'
$agentText=ReadUtf8 $agent
if(-not $agentText.Contains('PLAN_STAGE_INVALID_PATH')){
  $lines=[System.Collections.Generic.List[string]]::new()
  foreach($line in ($agentText -split "`n")){[void]$lines.Add($line)}
  $idx=-1
  for($i=0;$i-lt$lines.Count;$i++){
    if($lines[$i].Contains('"plan.stage" {$w=ResolveWorkspace $p;$r=[string]$p.path')){$idx=$i;break}
  }
  if($idx-lt0-or$idx+1-ge$lines.Count-or-not$lines[$idx+1].Contains('Invalid plan path')){throw 'R14_PLAN_STAGE_SOURCE_SHAPE_MISSING'}
  $lines[$idx]='    "plan.stage" {$w=ResolveWorkspace $p;$r=([string]$p.path).Replace(''\'',''/'').Trim()'
  $lines[$idx+1]='      $segments=@($r-split''/'');$unsafeSegment=@($segments|Where-Object{$_-eq''.''-or$_-eq''..''}).Count-gt0'
  $lines.Insert($idx+2,'      if([string]::IsNullOrWhiteSpace($r)-or$r.Length-gt240-or$r.StartsWith(''/'')-or$r-match''^[A-Za-z]:''-or$unsafeSegment-or$r-notmatch''^tools/plans/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.json$''){throw "PLAN_STAGE_INVALID_PATH: path must be a safe workspace-relative JSON path below tools/plans"}')
  WriteUtf8 $agent ($lines -join "`n")
}

# 2) Bootstrap: distinguish supported actions from actions executable under the active workspace policy.
$bg='extension/chrome/background.js'
$t=ReadUtf8 $bg
if(-not $t.Contains('async function activeWorkspaceToolPolicy(b)')){
  $needle='async function extensionBootstrap(command,tabId=null){'
  if(-not $t.Contains($needle)){throw 'R14_BOOTSTRAP_FUNCTION_MISSING'}
  $helper=@'
async function activeWorkspaceToolPolicy(b){
  const workspace=String(b?.active_session?.workspace||b?.active_session?.workspace_id||"").trim();
  if(!workspace)return {resolved:false,workspace:"",tools:{},reason:"no-active-workspace"};
  try{
    const r=await agentExec(unifiedLocalCommand("system.capabilities",{workspace}));
    return {resolved:true,workspace,tools:{git:r?.git||{},gh:r?.gh||{}},reason:"active-workspace-policy"};
  }catch(e){
    return {resolved:false,workspace,tools:{},reason:"capability-probe-failed",error:String(e?.message||e||"")};
  }
}
function toolAllowedByPolicy(policy,name){
  const row=policy?.tools?.[String(name||"").toLowerCase()];
  return !!policy?.resolved&&row?.allowed===true&&row?.available===true;
}
function filterPolicyBoundActions(actions,policy){
  return (Array.isArray(actions)?actions:[]).filter(action=>{
    const a=String(action||"");
    if(a.startsWith("gh."))return toolAllowedByPolicy(policy,"gh");
    if(a.startsWith("git."))return toolAllowedByPolicy(policy,"git");
    return true;
  });
}
'@
  $t=$t.Replace($needle,$helper+"`n"+$needle)
}
$oldBoot=@'
  const b=await agentExec(command),agent_actions=agentActionsFromBootstrap(b),extension_actions=extensionActions();
  const effective_actions=[...new Set([...agent_actions,...extension_actions])].sort(),recovery_actions=[...(globalThis.__SOKNA_RECOVERY_ACTIONS_V1__||[])].map(String).sort();
'@
$newBoot=@'
  const b=await agentExec(command),agent_actions=agentActionsFromBootstrap(b),extension_actions=extensionActions();
  const tool_policy=await activeWorkspaceToolPolicy(b),effective_agent_actions=filterPolicyBoundActions(agent_actions,tool_policy);
  const supported_actions=[...new Set([...agent_actions,...extension_actions])].sort(),effective_actions=[...new Set([...effective_agent_actions,...extension_actions])].sort(),recovery_actions=[...(globalThis.__SOKNA_RECOVERY_ACTIONS_V1__||[])].map(String).sort();
'@
if(-not $t.Contains('const tool_policy=await activeWorkspaceToolPolicy')){
  if(-not $t.Contains($oldBoot)){throw 'R14_BOOTSTRAP_ACTION_BLOCK_MISSING'}
  $t=$t.Replace($oldBoot,$newBoot)
}
$oldReturn='  return {...b,capabilities:{agent_actions,extension_actions,effective_actions},effective_actions,extension_policy};'
$newReturn='  return {...b,capabilities:{agent_actions,extension_actions,supported_actions,effective_actions,tool_policy,effective_source:tool_policy.resolved?"active-workspace-policy":"no-active-workspace-policy"},supported_actions,effective_actions,extension_policy};'
if(-not $t.Contains('effective_source:tool_policy.resolved')){
  if(-not $t.Contains($oldReturn)){throw 'R14_BOOTSTRAP_RETURN_MISSING'}
  $t=$t.Replace($oldReturn,$newReturn)
}
WriteUtf8 $bg $t

# 3) Capture truth: an interaction state must have a handler and must visibly change state.
$cap='extension/chrome/browser_capture_map.js'
$t=ReadUtf8 $cap
$t=$t.Replace('C06:[["click",["ویرایش","دسته‌بندی جدید","دسته جدید"]]],C09:[["click",["ویرایش","منوی جدید","منو جدید"]]],','C06:[["click",["دسته‌بندی جدید","دسته جدید","ویرایش دسته","ویرایش"]]],C09:[["click",["منوی جدید","منو جدید","ویرایش منو","ویرایش"]]],')
$oldApply=@'
async function applyState(tabId,e){
  const ops=H[e.id]||[],details=[];let reached=true,noData=false,revert=null;
  if(!ops.length)return {reached:true,noData:false,details,revert:null};
  for(const op of ops){
    let r={ok:false};
    if(op[0]==="click")r=await clickText(tabId,op[1]);
    else if(op[0]==="searchOpen"){r=await clickText(tabId,op[1]);if(!r.ok)r={ok:true,reason:"search-opener-optional"}}
    else if(op[0]==="type")r=await typeSearch(tabId,op[1]);
    else if(op[0]==="selectRow")r=await selectFirst(tabId,"row");
    else if(op[0]==="selectTable")r=await selectFirst(tabId,"table");
    else if(op[0]==="theme"){r=await themeToggle(tabId);if(r.ok)revert=async()=>{await themeToggle(tabId);await sleep(150)}}
    else if(op[0]==="safetyUnreached"){r={ok:false,reason:op[1],safety:true}}
    details.push({op:op[0],result:r});
    if(!r.ok){reached=false;if(CONDITIONAL.has(e.id))noData=true;break}
    await sleep(250);
  }
  return {reached,noData,details,revert};
}
'@
$newApply=@'
function interactionRequiresHandler(e){
  const a=norm(e?.action||"");
  if(!a)return false;
  return /(^|\b)(open|click|select|toggle|type|switch|expand|choose|pick|edit)\b/i.test(a)||/(باز کن|بازکردن|کلیک|انتخاب|ویرایش|تغییر تم|جستجو)/i.test(a);
}
async function stateFingerprint(tabId){
  try{
    const r=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:()=>{
      const visible=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&b.width>0&&b.height>0};
      const flags=[...document.querySelectorAll('[aria-expanded="true"],[aria-selected="true"],dialog[open],[role="dialog"],[aria-modal="true"]')].filter(visible).slice(0,50).map(e=>`${e.tagName}:${e.id||""}:${e.getAttribute("role")||""}:${String(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,240)}`);
      const values=[...document.querySelectorAll("input,textarea,select")].filter(visible).slice(0,50).map(e=>`${e.tagName}:${e.type||""}:${e.value||""}:${e.getAttribute("aria-expanded")||""}:${e.getAttribute("aria-selected")||""}`);
      const active=document.activeElement;
      return {href:location.href,htmlClass:document.documentElement.className||"",bodyClass:document.body?.className||"",theme:document.documentElement.getAttribute("data-theme")||document.body?.getAttribute("data-theme")||"",active:active?`${active.tagName}:${active.id||""}:${active.getAttribute?.("aria-label")||""}`:"",flags,values,text:String(document.body?.innerText||"").replace(/\s+/g," ").trim().slice(0,12000)};
    }});
    return JSON.stringify(r?.[0]?.result||{});
  }catch{return ""}
}
async function applyState(tabId,e){
  const ops=H[e.id]||[],details=[];let reached=true,noData=false,revert=null;
  if(!ops.length){
    if(interactionRequiresHandler(e))return {reached:false,noData:CONDITIONAL.has(e.id),details:[{op:"state-contract",result:{ok:false,reason:"state-handler-missing"}}],revert:null};
    return {reached:true,noData:false,details,revert:null};
  }
  for(const op of ops){
    const before=op[0]==="safetyUnreached"?"":await stateFingerprint(tabId);
    let r={ok:false};
    if(op[0]==="click")r=await clickText(tabId,op[1]);
    else if(op[0]==="searchOpen"){r=await clickText(tabId,op[1]);if(!r.ok)r={ok:true,reason:"search-opener-optional"}}
    else if(op[0]==="type")r=await typeSearch(tabId,op[1]);
    else if(op[0]==="selectRow")r=await selectFirst(tabId,"row");
    else if(op[0]==="selectTable")r=await selectFirst(tabId,"table");
    else if(op[0]==="theme"){r=await themeToggle(tabId);if(r.ok)revert=async()=>{await themeToggle(tabId);await sleep(150)}}
    else if(op[0]==="safetyUnreached"){r={ok:false,reason:op[1],safety:true}}
    if(r.ok&&op[0]!=="searchOpen"){
      await sleep(450);
      const after=await stateFingerprint(tabId);
      if(before&&after&&before===after)r={...r,ok:false,reason:"state-unchanged"};
    }
    details.push({op:op[0],result:r});
    if(!r.ok){reached=false;if(CONDITIONAL.has(e.id))noData=true;break}
    await sleep(250);
  }
  return {reached,noData,details,revert};
}
'@
if(-not $t.Contains('reason:"state-handler-missing"')){
  if(-not $t.Contains($oldApply)){throw 'R14_CAPTURE_APPLYSTATE_MISSING'}
  $t=$t.Replace($oldApply,$newApply)
}

# 4) Capture-map source: allow a validated Artifact Plane map in addition to the bundled preset.
$oldProps='  const props={...(old.inputSchema?.properties||{}),map_preset:{type:"string",enum:["local18080-ui-audit-v1"]},map_workers:{type:"integer",minimum:1,maximum:5}};'
$newProps='  const props={...(old.inputSchema?.properties||{}),map_preset:{type:"string",enum:["local18080-ui-audit-v1"]},map_artifact_ref:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},map_workers:{type:"integer",minimum:1,maximum:5}};'
if(-not $t.Contains('map_artifact_ref:{type:"string"')){
  if(-not $t.Contains($oldProps)){throw 'R14_MAP_CONTRACT_PROPS_MISSING'}
  $t=$t.Replace($oldProps,$newProps)
}
$oldAny='  const input={...(old.inputSchema||{}),properties:props,anyOf:[...(old.inputSchema?.anyOf||[]),{required:["map_preset"]}]};'
$newAny='  const input={...(old.inputSchema||{}),properties:props,anyOf:[...(old.inputSchema?.anyOf||[]),{required:["map_preset"]},{required:["map_artifact_ref"]}]};'
if(-not $t.Contains('{required:["map_artifact_ref"]}')){
  if(-not $t.Contains($oldAny)){throw 'R14_MAP_CONTRACT_ANYOF_MISSING'}
  $t=$t.Replace($oldAny,$newAny)
}
$oldStart='  const preset=String(p.map_preset||""),entries=MAPS.get(preset);if(!entries)throw E("BROWSER_CAPTURE_MAP_UNKNOWN","Unknown capture map preset.");'
$newStart=@'
  const preset=String(p.map_preset||"");
  let entries=MAPS.get(preset),mapSource=entries?"bundled":"",mapRef=String(p.map_artifact_ref||"").toLowerCase();
  if(!entries&&mapRef){
    const imported=await readJsonArtifact(mapRef),raw=Array.isArray(imported)?imported:(Array.isArray(imported?.entries)?imported.entries:null);
    if(!raw||!raw.length||raw.length>500)throw E("BROWSER_CAPTURE_MAP_ARTIFACT_INVALID","Map artifact must contain 1..500 entries.");
    entries=raw.map((x,i)=>({id:String(x?.id||x?.code||`state-${i+1}`),title:String(x?.title||x?.name||x?.id||""),url:String(x?.url||""),action:String(x?.action||x?.instruction||"")}));
    if(entries.some(x=>!SAFE_ID.test(x.id)||!/^https?:\/\//i.test(x.url)))throw E("BROWSER_CAPTURE_MAP_ARTIFACT_INVALID","Map artifact entries require safe ids and absolute http(s) URLs.");
    const firstOrigin=T.normalizeOrigin(entries[0].url);
    if(entries.some(x=>T.normalizeOrigin(x.url)!==firstOrigin))throw E("BROWSER_CAPTURE_MAP_CROSS_ORIGIN","A capture map must use one approved origin.");
    mapSource="artifact";
  }
  if(!entries)throw E("BROWSER_CAPTURE_MAP_UNKNOWN","Unknown capture map preset or missing map artifact.");
  const mapName=preset||`artifact:${mapRef.slice(0,12)}`;
'@
if(-not $t.Contains('BROWSER_CAPTURE_MAP_ARTIFACT_INVALID')){
  if(-not $t.Contains($oldStart)){throw 'R14_MAP_RUN_START_MISSING'}
  $t=$t.Replace($oldStart,$newStart)
}
$t=$t.Replace('const manifest={schema:SCHEMA,version:1,kind:"capture-map",capture_id:id,map_preset:preset,','const manifest={schema:SCHEMA,version:1,kind:"capture-map",capture_id:id,map_preset:mapName,map_source:mapSource,map_artifact_ref:mapRef||undefined,')
$t=$t.Replace('const result={ok:true,schema:RESULT_SCHEMA,capture_id:id,map_preset:preset,','const result={ok:true,schema:RESULT_SCHEMA,capture_id:id,map_preset:mapName,map_source:mapSource,map_artifact_ref:mapRef||undefined,')
$t=$t.Replace('if(String(command?.action||"")===ACTION&&p.map_preset)return await runMap(command,conversationKey,p);','if(String(command?.action||"")===ACTION&&(p.map_preset||p.map_artifact_ref))return await runMap(command,conversationKey,p);')
$t=$t.Replace('states:MAPS.get("local18080-ui-audit-v1")?.length||0,max_workers:5','states:MAPS.get("local18080-ui-audit-v1")?.length||0,max_workers:5,supports_artifact_map:true')
WriteUtf8 $cap $t

# 5) Final extension version follows Library 3.14.1 and GitHub 3.14.0.
Get-ChildItem 'extension/chrome' -Recurse -File | Where-Object {$_.Extension -in @('.js','.json','.html')} | ForEach-Object {
  $x=[IO.File]::ReadAllText($_.FullName)
  if($x.Contains('3.14.0')){[IO.File]::WriteAllText($_.FullName,$x.Replace('3.14.0','3.14.2'),[Text.UTF8Encoding]::new($false))}
}
$m=Get-Content 'extension/chrome/manifest.json' -Raw | ConvertFrom-Json
if([string]$m.version-ne'3.14.2'){throw "R14_VERSION_NOT_APPLIED: $($m.version)"}

Write-Host 'R14_FINALIZE_OK'
