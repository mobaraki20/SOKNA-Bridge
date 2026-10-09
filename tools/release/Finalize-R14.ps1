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
function AsLines([string]$Text){
  $list=[System.Collections.Generic.List[string]]::new()
  foreach($line in ($Text -split "`n")){[void]$list.Add($line)}
  return ,$list
}
function FindLine($Lines,[string]$Needle,[int]$Start=0){
  for($i=$Start;$i-lt$Lines.Count;$i++){if($Lines[$i].Contains($Needle)){return $i}}
  return -1
}
function InsertBlock($Lines,[int]$Index,[string]$Block){
  $arr=$Block.Replace("`r`n","`n") -split "`n"
  for($j=$arr.Length-1;$j-ge0;$j--){$Lines.Insert($Index,$arr[$j])}
}
function ReplaceRangeWithBlock($Lines,[int]$Start,[int]$EndExclusive,[string]$Block){
  if($Start-lt0-or$EndExclusive-le$Start){throw "R14_INVALID_REPLACE_RANGE: $Start..$EndExclusive"}
  $Lines.RemoveRange($Start,$EndExclusive-$Start)
  InsertBlock $Lines $Start $Block
}

# 1) plan.stage — safe nested JSON paths under tools/plans; SafePath remains authoritative.
$agent='native/runtime/v2.7.1/agent.ps1'
$agentText=ReadUtf8 $agent
if(-not $agentText.Contains('PLAN_STAGE_INVALID_PATH')){
  $l=AsLines $agentText
  $i=FindLine $l '"plan.stage" {$w=ResolveWorkspace $p;$r=[string]$p.path'
  if($i-lt0-or$i+1-ge$l.Count-or-not$l[$i+1].Contains('Invalid plan path')){throw 'R14_PLAN_STAGE_SOURCE_SHAPE_MISSING'}
  $l[$i]='    "plan.stage" {$w=ResolveWorkspace $p;$r=([string]$p.path).Replace(''\'',''/'').Trim()'
  $l[$i+1]='      $segments=@($r-split''/'');$unsafeSegment=@($segments|Where-Object{$_-eq''.''-or$_-eq''..''}).Count-gt0'
  $l.Insert($i+2,'      if([string]::IsNullOrWhiteSpace($r)-or$r.Length-gt240-or$r.StartsWith(''/'')-or$r-match''^[A-Za-z]:''-or$unsafeSegment-or$r-notmatch''^tools/plans/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.json$''){throw "PLAN_STAGE_INVALID_PATH: path must be a safe workspace-relative JSON path below tools/plans"}')
  WriteUtf8 $agent ($l -join "`n")
}

# 2) Bootstrap — supported != executable; effective_actions honors active workspace git/gh policy.
$bg='extension/chrome/background.js'
$bgText=ReadUtf8 $bg
$l=AsLines $bgText
if(-not $bgText.Contains('async function activeWorkspaceToolPolicy(b)')){
  $i=FindLine $l 'async function extensionBootstrap(command,tabId=null){'
  if($i-lt0){throw 'R14_BOOTSTRAP_FUNCTION_MISSING'}
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
  InsertBlock $l $i $helper
}
$joinedBg=$l -join "`n"
if(-not $joinedBg.Contains('const tool_policy=await activeWorkspaceToolPolicy')){
  $i=FindLine $l 'const b=await agentExec(command),agent_actions=agentActionsFromBootstrap(b),extension_actions=extensionActions();'
  $j=FindLine $l 'const effective_actions=' ([Math]::Max(0,$i))
  if($i-lt0-or$j-lt0){throw 'R14_BOOTSTRAP_ACTION_LINES_MISSING'}
  $l[$i]='  const b=await agentExec(command),agent_actions=agentActionsFromBootstrap(b),extension_actions=extensionActions();'
  $l[$j]='  const tool_policy=await activeWorkspaceToolPolicy(b),effective_agent_actions=filterPolicyBoundActions(agent_actions,tool_policy);'
  $l.Insert($j+1,'  const supported_actions=[...new Set([...agent_actions,...extension_actions])].sort(),effective_actions=[...new Set([...effective_agent_actions,...extension_actions])].sort(),recovery_actions=[...(globalThis.__SOKNA_RECOVERY_ACTIONS_V1__||[])].map(String).sort();')
}
$i=FindLine $l 'return {...b,capabilities:{agent_actions,extension_actions,effective_actions},effective_actions,extension_policy};'
if($i-ge0){$l[$i]='  return {...b,capabilities:{agent_actions,extension_actions,supported_actions,effective_actions,tool_policy,effective_source:tool_policy.resolved?"active-workspace-policy":"no-active-workspace-policy"},supported_actions,effective_actions,extension_policy};'}
elseif(-not ($l -join "`n").Contains('effective_source:tool_policy.resolved')){throw 'R14_BOOTSTRAP_RETURN_MISSING'}
WriteUtf8 $bg ($l -join "`n")

# 3) Capture truth — interactive states require handlers and observable state changes.
$cap='extension/chrome/browser_capture_map.js'
$capText=ReadUtf8 $cap
$l=AsLines $capText
for($x=0;$x-lt$l.Count;$x++){
  if($l[$x].Contains('C06:[["click",["ویرایش","دسته‌بندی جدید","دسته جدید"]]],C09:[["click",["ویرایش","منوی جدید","منو جدید"]]],')){
    $l[$x]=$l[$x].Replace('C06:[["click",["ویرایش","دسته‌بندی جدید","دسته جدید"]]],C09:[["click",["ویرایش","منوی جدید","منو جدید"]]],','C06:[["click",["دسته‌بندی جدید","دسته جدید","ویرایش دسته","ویرایش"]]],C09:[["click",["منوی جدید","منو جدید","ویرایش منو","ویرایش"]]],')
  }
}
$joined=$l -join "`n"
if(-not $joined.Contains('reason:"state-handler-missing"')){
  $s=FindLine $l 'async function applyState(tabId,e){'
  $e=FindLine $l 'async function waitDownload(' ([Math]::Max(0,$s+1))
  if($s-lt0-or$e-lt0){throw 'R14_CAPTURE_APPLYSTATE_RANGE_MISSING'}
  $block=@'
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
  ReplaceRangeWithBlock $l $s $e $block
}

# 4) Capture-map source — validated Artifact Plane map may replace the bundled preset.
$i=FindLine $l 'const props={...(old.inputSchema?.properties||{}),map_preset:'
if($i-lt0){throw 'R14_MAP_CONTRACT_PROPS_LINE_MISSING'}
if(-not $l[$i].Contains('map_artifact_ref')){$l[$i]='  const props={...(old.inputSchema?.properties||{}),map_preset:{type:"string",enum:["local18080-ui-audit-v1"]},map_artifact_ref:{type:"string",pattern:"^[a-fA-F0-9]{64}$"},map_workers:{type:"integer",minimum:1,maximum:5}};'}
$i=FindLine $l 'const input={...(old.inputSchema||{}),properties:props,anyOf:'
if($i-lt0){throw 'R14_MAP_CONTRACT_INPUT_LINE_MISSING'}
if(-not $l[$i].Contains('map_artifact_ref')){$l[$i]='  const input={...(old.inputSchema||{}),properties:props,anyOf:[...(old.inputSchema?.anyOf||[]),{required:["map_preset"]},{required:["map_artifact_ref"]}]};'}

$joined=$l -join "`n"
if(-not $joined.Contains('BROWSER_CAPTURE_MAP_ARTIFACT_INVALID')){
  $i=FindLine $l 'const preset=String(p.map_preset||""),entries=MAPS.get(preset);'
  if($i-lt0){throw 'R14_MAP_RUN_START_LINE_MISSING'}
  $block=@'
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
  ReplaceRangeWithBlock $l $i ($i+1) $block
}
for($x=0;$x-lt$l.Count;$x++){
  if($l[$x].Contains('const manifest={schema:SCHEMA')){$l[$x]=$l[$x].Replace('map_preset:preset,','map_preset:mapName,map_source:mapSource,map_artifact_ref:mapRef||undefined,')}
  if($l[$x].Contains('const result={ok:true,schema:RESULT_SCHEMA')){$l[$x]=$l[$x].Replace('map_preset:preset,','map_preset:mapName,map_source:mapSource,map_artifact_ref:mapRef||undefined,')}
  if($l[$x].Contains('if(String(command?.action||"")===ACTION&&p.map_preset)')){$l[$x]=$l[$x].Replace('&&p.map_preset','&&(p.map_preset||p.map_artifact_ref)')}
  if($l[$x].Contains('globalThis.__SOKNA_BROWSER_CAPTURE_MAP_RUNTIME_V1__')-and-not$l[$x].Contains('supports_artifact_map')){$l[$x]=$l[$x].Replace('max_workers:5','max_workers:5,supports_artifact_map:true')}
}
WriteUtf8 $cap ($l -join "`n")

# 5) Final version — successor to Library 3.14.1 and GitHub 3.14.0.
Get-ChildItem 'extension/chrome' -Recurse -File | Where-Object {$_.Extension -in @('.js','.json','.html')} | ForEach-Object {
  $x=[IO.File]::ReadAllText($_.FullName)
  if($x.Contains('3.14.0')){[IO.File]::WriteAllText($_.FullName,$x.Replace('3.14.0','3.14.2'),[Text.UTF8Encoding]::new($false))}
}
$m=Get-Content 'extension/chrome/manifest.json' -Raw | ConvertFrom-Json
if([string]$m.version-ne'3.14.2'){throw "R14_VERSION_NOT_APPLIED: $($m.version)"}

Write-Host 'R14_FINALIZE_OK'