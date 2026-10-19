"""Behavioral and tamper tests for offline Workspace snapshot provenance."""
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'qa'/'source_snapshot.py'
spec=importlib.util.spec_from_file_location('source_snapshot',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def rejected(fn):
    try:fn()
    except ValueError:return
    raise AssertionError('expected closed gate')

with tempfile.TemporaryDirectory() as d:
    dest=Path(d);source=dest/'src';source.mkdir();output=dest/'freeze.json'
    (source/'a.txt').write_text('base',encoding='utf8')
    (source/'.git').mkdir();(source/'.git'/'config').write_text('ignored')
    (source/'artifacts').mkdir();(source/'artifacts'/'output').write_text('ignored')
    assert m.process(source,output,'create')['status']=='SNAPSHOT_CREATED'
    assert m.process(source,output,'verify')['status']=='SNAPSHOT_VERIFIED'
    rejected(lambda:m.process(source,output,'create'))
    (source/'a.txt').write_text('tampered',encoding='utf8')
    rejected(lambda:m.process(source,output,'verify'))
    (source/'a.txt').write_text('base',encoding='utf8')
    (source/'new.txt').write_text('new')
    rejected(lambda:m.process(source,output,'verify'))
    (source/'new.txt').unlink()
    assert m.process(source,output,'verify')['status']=='SNAPSHOT_VERIFIED'
    (source/'A.TXT').write_text('collision')
    rejected(lambda:m.inventory(source))
    (source/'A.TXT').unlink()
    expected=json.loads(output.read_text())
    expected['files'][0]['sha256']='0'*64
    output.write_text(json.dumps(expected))
    rejected(lambda:m.process(source,output,'verify'))
    rejected(lambda:m.process(source,source/'self.json','create'))
print('SOURCE_SNAPSHOT_TAMPER_TEST_PASS')
