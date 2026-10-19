from pathlib import Path
import json

root=Path(__file__).resolve().parents[2]
read=lambda p:(root/p).read_text(encoding="utf-8")
extension=read("extension/chrome/browser_capture_maps.js")
engine=read("extension/chrome/browser_capture_map.js")
bootstrap=read("installer/bootstrap/install.ps1")
helper=read("tools/github-workspace.ps1")
collector=read("tools/qa/Collect-SoknaWindowsReadOnly.ps1")
for code in (extension,engine,bootstrap,helper):
    assert "mobaraki20" not in code
    assert "SoknaCafe" not in code
    assert "127.0.0.1:18080" not in code
assert "local18080-ui-audit-v1" not in extension and "local18080-ui-audit-v1" not in engine
assert "presets:Object.keys(MAPS.maps||{})" in engine
assert "BROWSER_CAPTURE_MAP_CROSS_ORIGIN" in engine
assert "8*1024*1024" in engine
assert "text:String(document.body?.innerText" not in engine
assert 'allowed_github_owners=@()' in bootstrap
assert 'workspaces=[ordered]@{}' in bootstrap
assert 'protected_repositories=@()' in bootstrap
assert "BRIDGE_CONFIG_INVALID_REFUSING_OVERWRITE" in bootstrap
assert "PROTECTED_REPOSITORY" in helper and "GITHUB_OWNER_NOT_CONFIGURED" in helper
assert "Get-FileHash" not in collector.split("$hashes = @()",1)[1]
assert "Stop-Service" not in collector and "Start-Service" not in collector
assert "Restart-Service" not in collector and "Stop-Process" not in collector
assert "real_uat_qualified=$false" in collector
example=json.loads(read("examples/sokna-cafe/legacy_cafe_111_capture_states.json"))
assert len(example["entries"])==111
recipe=json.loads(read("examples/generic-web/read-only-recipe-v1.json"))
assert len(recipe["entries"])>=1
assert (root/"BRIDGE_CORE_INDEPENDENCE.md").is_file()
print("BRIDGE_W11_APP_INDEPENDENCE_READONLY_CONTRACT_PASS")
