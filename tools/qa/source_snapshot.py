#!/usr/bin/env python3
"""Freeze / verify an offline Workspace source snapshot, no GitHub or build needed.

This is provenance for the *source* only, not installer or Windows UAT.
Keep the manifest OUTSIDE the source directory. Never silently skip extra files.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

SCHEMA = 'sokna-bridge-workspace-snapshot-v1'
EXCLUDED_DIRS = {'.git', 'artifacts', '__pycache__', '.pytest_cache'}
EXCLUDED_FILES = {'.DS_Store'}

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        while True:
            b=f.read(1024*1024)
            if not b: break
            h.update(b)
    return h.hexdigest()

def inventory(root):
    if not root.is_dir(): raise ValueError('source root not found')
    rows=[]
    for p in sorted(root.rglob('*')):
        rel=p.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in rel.parts): continue
        if p.is_symlink(): raise ValueError(f'symlinks not allowed in snapshot: {rel}')
        if not p.is_file(): continue
        if p.name in EXCLUDED_FILES or p.suffix in ('.pyc','.pyo'): continue
        posix=rel.as_posix()
        if '\\' in posix or any(x in ('.','..','') for x in posix.split('/')):
            raise ValueError(f'unsafe relative path: {posix}')
        rows.append({'path':posix,'sha256':digest(p),'bytes':p.stat().st_size})
    folded=[row['path'].casefold() for row in rows]
    if len(folded)!=len(set(folded)):raise ValueError('case-insensitive filename conflict (Windows)')
    return rows

def process(root, manifest, mode):
    root=root.resolve(strict=True)
    manifest=manifest.resolve()
    if manifest==root or root in manifest.parents:raise ValueError('manifest must be outside source root')
    actual=inventory(root)
    if mode=='create':
        payload={'schema':SCHEMA,'source_file_count':len(actual),'files':actual}
        manifest.parent.mkdir(parents=True,exist_ok=True)
        if manifest.exists():raise ValueError('immutable snapshot manifest exists; choose a new path')
        manifest.write_text(json.dumps(payload,ensure_ascii=False,sort_keys=True,indent=2)+'\n',encoding='utf-8')
        return {'status':'SNAPSHOT_CREATED','files':len(actual),'manifest_sha256':digest(manifest)}
    expected=json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(expected,dict) or set(expected)!={'schema','source_file_count','files'} or expected['schema']!=SCHEMA:
        raise ValueError('invalid source snapshot schema')
    if not isinstance(expected['files'],list) or expected['source_file_count']!=len(expected['files']):
        raise ValueError('invalid source snapshot count')
    if actual!=expected['files']:raise ValueError('snapshot mismatch: file added, changed, deleted, or inventory order changed')
    return {'status':'SNAPSHOT_VERIFIED','files':len(actual),'manifest_sha256':digest(manifest)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    a=p.add_mutually_exclusive_group(required=True)
    a.add_argument('--create',action='store_true');a.add_argument('--verify',action='store_true')
    p.add_argument('--root',required=True,type=Path);p.add_argument('--manifest',required=True,type=Path)
    opts=p.parse_args()
    try: print(json.dumps(process(opts.root,opts.manifest,'create' if opts.create else 'verify'),sort_keys=True));return 0
    except (ValueError,OSError,KeyError,TypeError,json.JSONDecodeError) as e:
        print('SOURCE_SNAPSHOT_REJECTED: '+str(e),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
