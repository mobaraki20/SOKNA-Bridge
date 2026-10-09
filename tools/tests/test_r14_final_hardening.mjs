import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};

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
must(agent.includes('CreateDirectory((Split-Path -Parent $dst))'),'R14_PLAN_STAGE_PARENT_DIR');

must(bg.includes('activeWorkspaceToolPolicy'),'R14_POLICY_PROBE');
must(bg.includes('filterPolicyBoundActions'),'R14_POLICY_FILTER');
must(bg.includes('a.startsWith("gh.")'),'R14_POLICY_GH');
must(bg.includes('a.startsWith("git.")'),'R14_POLICY_GIT');
must(bg.includes('effective_source:tool_policy.resolved'),'R14_EFFECTIVE_SOURCE');

must(capture.includes('state-handler-missing'),'R14_CAPTURE_HANDLER_GATE');
must(capture.includes('state-unchanged'),'R14_CAPTURE_STATE_CHANGE_GATE');
must(capture.includes('stateFingerprint'),'R14_CAPTURE_FINGERPRINT');
must(capture.includes('BROWSER_CAPTURE_MAP_ARTIFACT_INVALID'),'R14_CAPTURE_ARTIFACT_MAP');
must(capture.includes('supports_artifact_map:true'),'R14_CAPTURE_ARTIFACT_CAPABILITY');
must(capture.includes('["منوی جدید","منو جدید","ویرایش منو","ویرایش"]'),'R14_C09_SPECIFIC_FIRST');

must(content.includes('if(env.kind!==expected.kind)continue'),'R14_STATUS_RESULT_KIND_GATE');
must(outcome.includes('retryable:!!d?.retryable'),'R14_NACK_RETRYABLE_SOURCE');
must(contracts.includes('This is not a command lookup; use bridge.command.get for command ids.'),'R14_RESULT_GET_CONTRACT');

console.log(JSON.stringify({ok:true,suite:'r14-final-hardening',version:manifest.version}));
