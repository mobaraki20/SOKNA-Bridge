import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('extension/chrome/manifest.json','utf8'));
const core=readFileSync('extension/chrome/message_sender_boundary_core.js','utf8');
const bootstrap=readFileSync('extension/chrome/background_bootstrap.js','utf8');
assert.ok(core.includes('SENDER_TAB_MISMATCH'));
assert.ok(core.includes('EXTENSION_UI_REQUIRED'));
assert.ok(bootstrap.includes('MSGBOUNDARY?.validate?.(m,sender)'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.externally_connectable,undefined);
assert.ok(manifest.permissions.includes('nativeMessaging'));
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
assert.ok(manifest.content_scripts.every(x=>x.world==='ISOLATED'));
assert.equal(manifest.host_permissions.includes('<all_urls>'),false);
if(!process.env.GITHUB_ACTIONS||!process.env.RUNNER_TEMP)throw Error('CI_EVIDENCE_ONLY');
const file=resolve(process.env.RUNNER_TEMP,'bridge-security-readiness.json');
if(existsSync(file))throw Error('DO_NOT_OVERWRITE_EVIDENCE');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const document={
 schema:'sokna-bridge-security-readiness-audit-v1',
 source_commit:commit,
 environment:'GitHub Windows Server 2025 source regression',
 status:'PASS_STATIC_GATES_RELEASE_BLOCKED',
 security_gates:{
   authenticated_sender_tab_binding:'PASS_STATIC_AND_UNIT',
   privileged_origin_registration_ui_only:'PASS_STATIC_AND_UNIT',
   manifest_v3:'PASS_STATIC',
   no_externally_connectable:'PASS_STATIC',
   content_script_isolated_world:'PASS_STATIC',
   no_unconditional_all_urls_host_permission:'PASS_STATIC',
   user_requested_optional_http_https_origin_access:'DECLARED_EXPLICIT_APPROVAL_REQUIRED',
   chrome_native_host_integration:'TESTED_SEPARATE_CI',
   chrome_genuine_gui_load_unpacked_persistence:'NOT_RUN',
   enterprise_policy_extension_install:'NOT_REQUESTED_NOT_RUN',
   third_party_privacy_dpi:'NOT_RUN',
   binaries_signed_and_provenance_verified:'NOT_VERIFIED',
   owner_release_approval:'NOT_GRANTED'
 },
 manifest_permissions:[...manifest.permissions],
 content_script_hosts:manifest.host_permissions,
 optional_host_permissions:manifest.optional_host_permissions,
 release_ready:false
};
writeFileSync(file,JSON.stringify(document,null,2)+'\n',{flag:'wx'});
console.log('BRIDGE_SECURITY_READINESS_STATIC_GATES_PASS');
console.log('BRIDGE_RELEASE_READY_FALSE_PENDING_APPROVAL');
