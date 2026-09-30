from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2]
manifest=json.loads((ROOT/'extension/chrome/manifest.json').read_text(encoding='utf-8'))
bg=(ROOT/'extension/chrome/background.js').read_text(encoding='utf-8')
content=(ROOT/'extension/chrome/content.js').read_text(encoding='utf-8')
agent=(ROOT/'native/runtime/v2.7.1/agent.ps1').read_text(encoding='utf-8')
provider=(ROOT/'native/runtime/v2.7.1/Sokna.ArtifactProvider.psm1').read_text(encoding='utf-8')
policy=json.loads((ROOT/'docs/contracts/ARTIFACT_PROVIDER_POLICY_V1.json').read_text(encoding='utf-8'))
assert manifest['version']=='3.13.0'
assert 'downloads' in manifest.get('permissions',[]), 'Instagram direct media download requires Chrome downloads permission'
assert 'chat_artifact_core.js' in manifest['background'].get('service_worker','') or 'chat_artifact_core.js' in bg
assert 'chat_artifact_core.js' in manifest['content_scripts'][0]['js']
for marker in ['artifact.chat.apply','CHAT_TRANSFER_KEY','scheduleChatTransferPoll','pollChatTransfer','chat-page-click+agent-verified','artifact.chat.import.download']:
    assert marker in bg or marker in agent, marker
for marker in ['FIND_CHAT_ARTIFACT','CLICK_CHAT_ARTIFACT','selectCandidate']:
    assert marker in content, marker
assert 'instagramMediaDownload' in bg and 'chrome.downloads.download' in bg
chat_apply=bg.split('async function registerChatArtifactApply',1)[1].split('async function terminalizeChatTransfer',1)[0]
assert 'chrome.downloads.' not in chat_apply, 'Chat artifact import must remain page-click + Agent verification, not Downloads API'
assert 'CHAT_ARTIFACT_DOWNLOAD_PATH_ESCAPE' in provider
assert 'CHAT_ARTIFACT_DOWNLOAD_REPARSE_BLOCKED' in provider
assert "Invoke-SoknaArtifactProviderAcquire -Provider 'local_file'" in provider
assert 'Invoke-SoknaChatArtifactImportDownload -Params $p' in agent
assert policy['providers']['chat_attachment']['status'] in {'candidate-rc9','implemented'}
assert policy['providers']['chat_attachment']['expected_sha256_required'] is True
assert policy['providers']['chat_attachment']['exact_filename_required'] is True
assert policy['providers']['chat_attachment']['inline_payload_base64'] is False
print('CHAT_ARTIFACT_AUTOPULL_CONTRACTS_PASS')
