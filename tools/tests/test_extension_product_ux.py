from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[2]

def read(path):
    p=ROOT/path
    assert p.exists(), f"missing {path}"
    return p.read_text(encoding="utf-8")

manifest=json.loads(read(Path("extension/chrome/manifest.json")))
assert manifest["version"]=="3.12.7"
matches=set()
for cs in manifest.get("content_scripts",[]):
    matches.update(cs.get("matches",[]))
assert "https://chatgpt.com/*" in matches, "official ChatGPT origin missing"
assert "https://www.instagram.com/*" in matches, "Instagram origin missing"
assert "downloads" in manifest.get("permissions",[]), "Instagram media download permission missing"

popup=read(Path("extension/chrome/popup.html"))
for marker in ["Connect this Chat","Instagram Research Assistant","Advanced diagnostics","باز کردن Control Center"]:
    assert marker in popup, f"popup UX missing {marker}"
assert "Test Credentials" not in popup, "developer credential UI must not be in primary popup"

popup_js=read(Path("extension/chrome/popup.js"))
for marker in ["CONNECT_CHAT","IG_POPUP_DOWNLOAD","IG_POPUP_SCAN","OPEN_CONTROL_CENTER"]:
    assert marker in popup_js, f"popup integration missing {marker}"
assert "setInterval" not in popup_js, "popup must not poll Activity continuously"

background=read(Path("extension/chrome/background.js"))
origin_registry=read(Path("extension/chrome/origin_registry_core.js"))
for marker in ["https://chatgpt.com","https://gpt.arzanai.com","normalizeOrigin","conversationKey"]:
    assert marker in origin_registry, f"origin registry missing {marker}"
for marker in [
    "CONNECT_CHAT","REGISTER_CHAT_ORIGIN","instagram.profile.scan","instagram.scan.search",
    "instagram.scan.get","instagram.media.download","instagram.media.attach","instagram.research.plan","instagram.selection.confirm","bridge.diagnostics.get","POST_USER_TEXT",
    "delivery_state_core.js","CHECK_RESULT_VISIBLE","chat.delivery_uncertain","SEMANTIC_RESTORE_PROOF"
]:
    assert marker in background, f"background product integration missing {marker}"
delivery_core=read(Path("extension/chrome/delivery_state_core.js"))
for marker in ["submitted_awaiting_ack","delivery_uncertain","ACK_DEADLINE_MS","MAX_ACK_POLLS"]:
    assert marker in delivery_core, f"delivery state core missing {marker}"

bootstrap=read(Path("extension/chrome/background_bootstrap.js"))
for marker in ["instagram.profile.scan","instagram.scan.search","instagram.scan.get","instagram.media.download","instagram.media.attach","instagram.research.plan","instagram.candidates.get","instagram.candidates.attach","instagram.selection.confirm","instagram.selection.reject","instagram.export","bridge.diagnostics.get"]:
    assert marker in bootstrap, f"extension capability gate missing {marker}"

content=read(Path("extension/chrome/content.js"))
assert "POST_USER_TEXT" in content, "chat handshake posting path missing"

ig=read(Path("extension/chrome/instagram_capture.js"))
for marker in ["IG_PROFILE_LINKS","IG_POST_SNAPSHOT","caption","hashtags","mentions","media"]:
    assert marker in ig, f"Instagram adapter missing {marker}"

selftest=read(Path("extension/chrome/selftest.js"))
for retired in ["PROTO.accept","PROTO.expand","nextV4Frame","SOKNA3CMD:","SOKNA4CMD:"]:
    assert retired not in selftest, f"retired self-test protocol remains: {retired}"
for marker in ["validateEnvelope","agent.capabilities","bridge.bootstrap"]:
    assert marker in selftest, f"semantic self-test missing {marker}"

host=read(Path("native/host/main.go"))
for marker in ['"bridge.activity":true','"job.list":true','"job.events":true',"shouldRecordCommandActivity","control.open"]:
    assert marker in host, f"native host UX/observability guard missing {marker}"

for path in [
    Path("maintenance/Sokna.Bridge.ControlCenter/Sokna.Bridge.ControlCenter.csproj"),
    Path("maintenance/Sokna.Bridge.ControlCenter/MainForm.cs"),
    Path("maintenance/Sokna.Bridge.ControlCenter/WorkspaceDialog.cs"),
]:
    read(path)

maintenance=read(Path("maintenance/Sokna.Agent.Maintenance/Program.cs"))
assert '"settings-apply"' in maintenance
installer=read(Path("installer/windows/SOKNA.Agent.iss"))
for marker in ["Sokna.Bridge.ControlCenter.exe","SOKNA Bridge Control Center","postinstall"]:
    assert marker in installer, f"installer UX missing {marker}"
build=read(Path("tools/installer/Build-P1Installer.ps1"))
assert "Sokna.Bridge.ControlCenter" in build and "DOTNET_CONTROL_CENTER_PUBLISH_FAILED" in build

print("PRODUCT_UX_BROWSER_INTEGRATION_CONTRACTS_PASS")

outbound=read(Path("extension/chrome/outbound_attachment.js"))
for marker in ['append===true','submit===false','ATTACHMENT_EXISTING_FILES_PRESENT']:
    assert marker in outbound, f'visual attachment batching guard missing {marker}'
assert 'INSTAGRAM_ATTACH_BATCH_TOO_LARGE' in background
assert 'visual_review_ready:true' in background
assert 'media:media.slice(0,10).map(x=>({type:' in background and 'url:String(x?.url||"")' not in background.split('function igPostSummary',1)[1].split('async function inspectInstagramPostPrivate',1)[0], 'public Instagram scan summary must not expose CDN URLs'

for marker in ['FULL_DIAGNOSTICS','SEND_DIAGNOSTICS_TO_CHAT','transportVerified','Connected — End-to-End Verified']:
    assert marker in background, f'missing diagnostic/verified UX contract: {marker}'
assert 'document.body.innerText' not in read(Path("extension/chrome/semantic_intent.js"))
assert '[data-message-author-role="assistant"]' in read(Path("extension/chrome/semantic_intent.js"))
assert 'semantic_fallback_diagnostics_v2' in read(Path("extension/chrome/semantic_intent.js"))
