from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]

def need(path,*terms):
    s=(ROOT/path).read_text(encoding='utf-8-sig')
    for t in terms: assert t in s, f'{path}: missing {t}'
    return s

builder=need(Path('tools/release/Build-R1SourceRC.py'),'R1_DIRTY_SOURCE_NOT_ALLOWED','R1_COMMIT_NOT_HEAD','git_mode','git_blob','FIXED_ZIP_TIME','__SOKNA_RC__/SOURCE_MANIFEST.json','sokna-r1-source-rc-manifest-v1','requires_exact_rc_windows_ci_pass')
assert "git(root,'cat-file','blob',oid" in builder
assert "git(root,'ls-tree','-r','-z','--full-tree',commit" in builder
build=need(Path('tools/installer/Build-P1Installer.ps1'),'ExpectedSourceCommit','SOURCE_COMMIT_MISMATCH')
wf=need(Path('.github/workflows/windows-agent-validation.yml'),'expected_commit','EXACT_RC_EXPECTED_COMMIT_REQUIRED','Build-R1SourceRC.py','Write-ExactRCEvidence.ps1','upload-artifact@v4')
evidence=need(Path('tools/ci/Write-ExactRCEvidence.ps1'),'EXACT_RC_SOURCE_COMMIT_MISMATCH','EXACT_RC_PAYLOAD_COMMIT_MISMATCH','whole_product_acceptance_passed','browser_runner_sha256','artifact_provider_runner_sha256')
status=need(Path('docs/status/R1_RELEASE_CANDIDATE_FREEZE.md'),'base Workspace Policy','job-scoped grant','exact source','CI','LIVE','2.5.7 R4','3.10.5')
policy=json.loads((ROOT/'docs/status/R1_RELEASE_CANDIDATE_POLICY.json').read_text(encoding='utf-8'))
assert policy['schema']=='sokna-r1-release-candidate-policy-v1' and policy['ci_expected_commit_required'] is True
assert policy['home_pc_allowed_before_ci_pass'] is False and policy['candidate_ref']=='sokna-agent-2.6.0-rc8'
corr=json.loads((ROOT/'docs/status/R1_RC2_CORRECTION_MANIFEST.json').read_text(encoding='utf-8'))
assert corr['schema']=='sokna-r1-rc2-correction-manifest-v1' and corr['candidate_ref']=='sokna-agent-2.6.0-rc2' and corr['windows_exact_rc_execution_claimed'] is False
rc3=json.loads((ROOT/'docs/status/R1_RC3_SESSION_GATE_MANIFEST.json').read_text(encoding='utf-8'))
assert rc3['schema']=='sokna-r1-rc3-session-gate-manifest-v1' and rc3['candidate_ref']=='sokna-agent-2.6.0-rc3' and rc3['windows_exact_rc_execution_claimed'] is False
rc4=json.loads((ROOT/'docs/status/R1_RC4_PROVIDER_WINDOWS_MANIFEST.json').read_text(encoding='utf-8'))
assert rc4['schema']=='sokna-r1-rc4-provider-windows-manifest-v1' and rc4['candidate_ref']=='sokna-agent-2.6.0-rc4' and rc4['source_ci_failure_reproduced_off_endpoint'] is True
rc5=json.loads((ROOT/'docs/status/R1_RC5_WINDOWS_AUTONOMY_MANIFEST.json').read_text(encoding='utf-8'))
assert rc5['schema']=='sokna-r1-rc5-windows-autonomy-hardening-manifest-v1' and rc5['candidate_ref']=='sokna-agent-2.6.0-rc5' and rc5['diagnostic_aggregation'] is True and rc5['durable_ci_job_required_when_available'] is True

rc6=json.loads((ROOT/'docs/status/R1_RC6_PS51_NESTED_JOB_MANIFEST.json').read_text(encoding='utf-8'))
assert rc6['schema']=='sokna-r1-rc6-ps51-nested-job-hardening-manifest-v1' and rc6['candidate_ref']=='sokna-agent-2.6.0-rc6' and rc6['candidate_extension_version']=='3.10.6' and rc6['nested_job_watch_hardened'] is True

rc7=json.loads((ROOT/'docs/status/R1_RC7_PS51_TERMINAL_DELIVERY_MANIFEST.json').read_text(encoding='utf-8'))
assert rc7['schema']=='sokna-r1-rc7-ps51-terminal-delivery-hardening-manifest-v1' and rc7['candidate_ref']=='sokna-agent-2.6.0-rc7' and rc7['candidate_extension_version']=='3.10.7' and rc7['terminal_job_delivery_hardened'] is True

rc8=json.loads((ROOT/'docs/status/R1_RC8_BOM_EVENTID_DIAGNOSTICS_MANIFEST.json').read_text(encoding='utf-8'))
assert rc8['schema']=='sokna-r1-rc8-bom-eventid-diagnostics-hardening-manifest-v1' and rc8['candidate_ref']=='sokna-agent-2.6.0-rc8' and rc8['candidate_extension_version']=='3.10.8' and rc8['terminal_event_unique_id_hardened'] is True

print('R1_RELEASE_CANDIDATE_CONTRACTS_PASS')
