import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const parseClickLabels=(source,id)=>{
  const raw=source.match(new RegExp(`(?:^|[,\\n])${id}:\\[\\["click",\\[(.*?)\\]\\]\\]`,'m'))?.[1]||'';
  try{return JSON.parse(`[${raw}]`)}catch{return []}
};

const manifest=JSON.parse(read('extension/chrome/manifest.json'));
const bg=read('extension/chrome/background.js');
const content=read('extension/chrome/content.js');
const capture=read('extension/chrome/browser_capture_map.js');
const agent=read('native/runtime/v2.7.1/agent.ps1');
const outcome=read('extension/chrome/terminal_outcome_core.js');
const contracts=read('extension/chrome/action_contracts_core.js');

must(manifest.version==='3.14.2','R14_VERSION_MANIFEST');
must(bg.includes('const VERSION="3.14.2"'),'R14_VERSION_BACKGROUND');
must(content.includes('const VERSION="3.14.2"'),'R14_VERSION_CONTENT');

must(agent.includes('PLAN_STAGE_INVALID_PATH'),'R14_PLAN_STAGE_ERROR');
must(agent.includes("^tools/plans/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\\.json$"),'R14_PLAN_STAGE_NESTED_PATH');
must(agent.includes("$d=Split-Path $f -Parent")&&agent.includes('New-Item -ItemType Directory -Path $d -Force'),'R14_PLAN_STAGE_PARENT_DIR');

must(bg.includes('activeWorkspaceToolPolicy'),'R14_POLICY_PROBE');
must(bg.includes('filterPolicyBoundActions'),'R14_POLICY_FILTER');
must(bg.includes('tools:{git:r?.git||{},gh:r?.gh||{}}'),'R14_POLICY_TOOL_STATUS');
must(bg.includes('a.startsWith("gh.")'),'R14_POLICY_GH');
must(bg.includes('a.startsWith("git.")'),'R14_POLICY_GIT');
must(bg.includes('effective_source:tool_policy.resolved'),'R14_EFFECTIVE_SOURCE');
must(bg.includes('supported_actions'),'R14_SUPPORTED_VS_EFFECTIVE');

must(capture.includes('operator-recipe-required'),'GENERIC_CAPTURE_EXPLICIT_INTERACTION_GATE');
must(capture.includes('unexpected-navigation'),'GENERIC_CAPTURE_WRONG_PAGE_GATE');
must(capture.includes('http-error'),'GENERIC_CAPTURE_HTTP_ERROR_GATE');
must(capture.includes('BROWSER_CAPTURE_MAP_ARTIFACT_INVALID'),'GENERIC_CAPTURE_ARTIFACT_MAP');
must(capture.includes('supports_artifact_map:true'),'GENERIC_CAPTURE_ARTIFACT_CAPABILITY');
must(!capture.includes('H01:')&&!capture.includes('clickText('),'GENERIC_CAPTURE_HAS_NO_CAFE_CONTROLS');
must(capture.includes('const passed=items.length===entries.length'),'GENERIC_CAPTURE_FAIL_CLOSED_RESULT');
const sample=JSON.parse(read('examples/generic-web/read-only-capture-map.json'));
const cafe=JSON.parse(read('examples/sokna-cafe/legacy_cafe_111_capture_states.json'));
must(sample.entries.length>=1&&cafe.entries.length===111,'OPTIONAL_EXTERNAL_PROFILES_AVAILABLE');
const spec=read('extension/chrome/browser_capture_maps.js');
must(!spec.includes('local18080-ui-audit-v1'),'NO_BUNDLED_CAFE_PROFILE');

must(content.includes('if(env.kind!==expected.kind)continue'),'R14_STATUS_RESULT_KIND_GATE');
must(outcome.includes('retryable:!!d?.retryable'),'R14_NACK_RETRYABLE_SOURCE');
must(agent.includes('"result.get" {')&&agent.includes("if($id-notmatch'^[a-f0-9]{64}$')"),'R14_RESULT_REF_CONTRACT');
must(contracts.includes('This is not a command lookup; use bridge.command.get for command ids.'),'R14_RESULT_GET_DESCRIPTION');
must(contracts.includes('"bridge.command.get":tool("broker","Recover one durable command outcome'),'R14_COMMAND_GET_CONTRACT');

console.log(JSON.stringify({ok:true,suite:'r14-final-hardening',version:manifest.version}));
