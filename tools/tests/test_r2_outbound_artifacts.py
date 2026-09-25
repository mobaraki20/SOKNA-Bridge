#!/usr/bin/env python3
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOST = (ROOT / "native" / "host" / "main.go").read_text(encoding="utf-8")
OUT = (ROOT / "native" / "host" / "outbound_artifact.go").read_text(encoding="utf-8")
BOOT = (ROOT / "extension" / "chrome" / "background_bootstrap.js").read_text(encoding="utf-8")
CORE = (ROOT / "extension" / "chrome" / "outbound_attachment_core.js").read_text(encoding="utf-8")
ADAPTER = (ROOT / "extension" / "chrome" / "outbound_attachment.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "extension" / "chrome" / "manifest.json").read_text(encoding="utf-8"))
TEST = (ROOT / "native" / "host" / "main_test.go").read_text(encoding="utf-8")

for action in ['artifact.out.publish','artifact.out.get','artifact.out.info','artifact.out.list']:
    assert f'"{action}"' in OUT or f'"{action}"' in BOOT, action
assert 'localOutbound(c)' in HOST
assert 'maxArtifactChunk = 512 * 1024' in OUT
assert 'artifact path must be ArtifactRoot-relative' in OUT
assert 'artifact path escapes ArtifactRoot' in OUT
assert 'outbound artifact copy integrity mismatch' in OUT
assert 'local_path_is_delivery' in OUT and 'false' in OUT
assert '"ai":"artifact.out.get"' in OUT
assert '"user":"ai_attachment"' in OUT
assert 'public_url' in OUT
assert 'data_b64' in OUT and 'base64.StdEncoding.EncodeToString' in OUT
assert 'TestOutboundArtifactPublishAndChunkRoundTrip' in TEST
assert 'TestOutboundArtifactRejectsPathEscape' in TEST
for action in ['artifact.out.publish','artifact.out.get','artifact.out.info','artifact.out.list','artifact.out.attach']:
    assert action in BOOT, f'capability/delivery path missing {action}'

# R2-C acceptance requires an actual page-level File submission path, not merely
# delivery metadata or a local path masquerading as a link.
assert 'MAX_CHAT_ATTACHMENT_BYTES=64*1024*1024' in BOOT
for token in ['OUTBOUND_ATTACHMENT_BEGIN','OUTBOUND_ATTACHMENT_CHUNK','OUTBOUND_ATTACHMENT_COMMIT','artifact.out.attach']:
    assert token in BOOT, f'background attachment stream missing {token}'
assert 'OUTBOUND_ATTACHMENT_TOO_LARGE' in CORE
assert 'ATTACHMENT_SHA256_MISMATCH' in CORE
assert 'DataTransfer' in ADAPTER and 'new File(' in ADAPTER
assert 'DOM.submitEnvelope(note)' in ADAPTER
assert 'ATTACHMENT_USER_DRAFT_PRESENT' in ADAPTER
assert 'ATTACHMENT_ASSISTANT_BUSY' in ADAPTER
assert 'file://' not in BOOT and 'file://' not in ADAPTER

scripts = MANIFEST['content_scripts'][0]['js']
for script in ['outbound_attachment_core.js','dom_core.js','outbound_attachment.js']:
    assert script in scripts, f'manifest missing {script}'
assert scripts.index('outbound_attachment_core.js') < scripts.index('outbound_attachment.js')
assert scripts.index('dom_core.js') < scripts.index('outbound_attachment.js')

print('R2_OUTBOUND_ARTIFACT_PASS')
