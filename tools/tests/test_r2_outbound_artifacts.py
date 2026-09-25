#!/usr/bin/env python3
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOST = (ROOT / "native" / "host" / "main.go").read_text(encoding="utf-8")
OUT = (ROOT / "native" / "host" / "outbound_artifact.go").read_text(encoding="utf-8")
BOOT = (ROOT / "extension" / "chrome" / "background_bootstrap.js").read_text(encoding="utf-8")
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
for action in ['artifact.out.publish','artifact.out.get','artifact.out.info','artifact.out.list']:
    assert action in BOOT, f'capability gate missing {action}'
print('R2_OUTBOUND_ARTIFACT_PASS')
