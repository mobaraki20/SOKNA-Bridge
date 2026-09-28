from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[2]
policy=json.loads((root/'docs/contracts/ARTIFACT_PROVIDER_POLICY_V1.json').read_text(encoding='utf-8'))
assert policy['core_provider_dependency'] is None
for p in ['local_file','managed_folder','https','github_release_asset','object_storage','google_drive','onedrive']:
    assert p in policy['providers'],p
assert policy['providers']['chat_attachment']['status']=='candidate-rc9'
assert policy['providers']['google_drive']['oauth_in_core'] is False
assert policy['provider_contract']['network']['raw_credential_query_forbidden'] is True
assert policy['provider_contract']['signature']['required_means_fail_closed'] is True

provider=(root/'native/provider/providers.go').read_text(encoding='utf-8')
http=(root/'native/provider/http.go').read_text(encoding='utf-8')
security=(root/'native/provider/security.go').read_text(encoding='utf-8')
verify=(root/'native/provider/verify.go').read_text(encoding='utf-8')
main=(root/'native/provider/main.go').read_text(encoding='utf-8')
for x in ['type provider interface','Probe(context.Context','Acquire(context.Context','managed_folder','github_release_asset','object_storage','google_drive','onedrive','remote provider requires expected_sha256']:
    assert x in provider,x
for x in ['Range','retryableStatus','too many redirects','Authorization','githubResolve','Content-Range']:
    assert x in http,x
for x in ['credential-bearing URL must be supplied via url_env','sourceFingerprint','redactErrorMessage','errorSecretPattern','os.Lstat','os.ModeSymlink','os.ModeIrregular']:
    assert x in security,x
assert 'filepath.EvalSymlinks' not in security
for x in ['ed25519-sha256','required signature material missing','artifact signature mismatch']:
    assert x in verify,x
for x in ['.provider-','staging','os.Rename','verifyFile','os.Remove(sidecar)']:
    assert x in main or x in provider,x

ps=(root/'native/runtime/v2.7.0/Sokna.ArtifactProvider.psm1').read_text(encoding='utf-8')
agent=(root/'native/runtime/v2.7.0/agent.ps1').read_text(encoding='utf-8')
caps=json.loads((root/'native/runtime/v2.7.0/AGENT_CAPABILITIES.json').read_text(encoding='utf-8'))
for x in ['Initialize-SoknaArtifactProviders','Invoke-SoknaArtifactProviderProbe','Invoke-SoknaArtifactProviderAcquire','Invoke-SoknaArtifactProviderVerify','auto_execute=$false','quota_remaining_bytes','managed_folders','url_env','$finalOwned=$false','$metaOwned=$false','ARTIFACT_PROVIDER_METADATA_EXISTS',"phase='started'","phase='failed'"]:
    assert x in ps,x
for action in ['artifact.provider.status','artifact.provider.probe','artifact.provider.acquire','artifact.provider.verify','artifact.chat.import.download']:
    assert action in agent and action in caps['actions'],action
assert "artifact.import.local\" { return (Invoke-SoknaArtifactProviderAcquire -Provider 'local_file'" in agent
assert 'Import-SoknaLocalArtifact -SourcePath' not in agent
assert 'Initialize-SoknaArtifactProviders' in agent

build=(root/'tools/installer/Build-P1Installer.ps1').read_text(encoding='utf-8')
for x in ["$providerDest",'native\\provider','sokna-artifact-provider.exe','GO_ARTIFACT_PROVIDER_TEST_FAILED']:
    assert x in build,x
wf=(root/'.github/workflows/windows-agent-validation.yml').read_text(encoding='utf-8')
for x in ['test_p4_artifact_providers.py','Native artifact provider tests','Test-ArtifactProviders270.ps1',"native/provider/**"]:
    assert x in wf,x
win=(root/'tools/runtime/releases/2.7.0/Test-ArtifactProviders270.ps1').read_text(encoding='utf-8')
for x in ['hash mismatch accepted','raw credential URL accepted','cloud provider bypassed url_env boundary','required signature missing accepted','managed source was modified','artifact id collision accepted','collision cleanup modified existing artifact']:
    assert x in win,x

contract=(root/'docs/contracts/ARTIFACT_PROVIDER_CONTRACT_V1_FA.md').read_text(encoding='utf-8')
for x in ['probe/resolve','اتمیک','expected_sha256','ed25519-sha256','auto_execute=false','credential_env','url_env','Result Plane']:
    assert x in contract,x
manifest=json.loads((root/'docs/status/P4_ARTIFACT_PROVIDERS_MANIFEST.json').read_text(encoding='utf-8'))
assert manifest['schema']=='sokna-p4-artifact-providers-manifest-v1'
assert manifest['base_checkpoint']=='2c4bcd1095812f181c8495331c58a56b4e34a56d'
assert manifest['windows_provider_acceptance_authored'] is True
assert manifest['windows_provider_execution_claimed'] is False
assert manifest['home_pc_touched'] is False and manifest['github_pushed'] is False
# The P4 manifest is archival checkpoint evidence. Later phases intentionally evolve
# shared files such as agent.ps1, capabilities and the Windows workflow, so comparing
# those checkpoint hashes to the current tree would make every later phase invalidate
# a previously completed P4. Semantic P4 contracts above remain enforced against the
# current tree; manifest entries are validated as well-formed immutable evidence only.
for e in manifest['files']:
    assert isinstance(e.get('path'),str) and e['path'], e
    assert isinstance(e.get('bytes'),int) and e['bytes'] >= 0, e['path']
    h=e.get('sha256','')
    assert len(h)==64 and all(c in '0123456789abcdef' for c in h), e['path']
print('P4_ARTIFACT_PROVIDER_CONTRACTS_PASS')
