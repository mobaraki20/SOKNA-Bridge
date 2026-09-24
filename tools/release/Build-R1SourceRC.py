#!/usr/bin/env python3
"""Build a deterministic SOKNA R1 source RC directly from a Git commit object."""
from __future__ import annotations
import argparse, hashlib, json, os, stat, subprocess, sys, zipfile
from pathlib import Path

FIXED_ZIP_TIME=(1980,1,1,0,0,0)
MANIFEST_ENTRY='__SOKNA_RC__/SOURCE_MANIFEST.json'


def git(root: Path, *args: str, text: bool=True):
    return subprocess.check_output(['git','-C',str(root),*args], text=text)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tracked_entries(root: Path, commit: str):
    raw=git(root,'ls-tree','-r','-z','--full-tree',commit,text=False)
    out=[]
    for rec in raw.split(b'\0'):
        if not rec: continue
        header,path_b=rec.split(b'\t',1)
        mode,kind,oid=header.decode('ascii').split(' ')
        path=path_b.decode('utf-8','surrogateescape')
        if kind!='blob':
            raise SystemExit(f'R1_UNSUPPORTED_GIT_ENTRY: {kind} {path}')
        if path==MANIFEST_ENTRY:
            raise SystemExit('R1_RESERVED_MANIFEST_PATH_COLLISION')
        blob=git(root,'cat-file','blob',oid,text=False)
        out.append((path,mode,oid,blob))
    out.sort(key=lambda x:x[0].encode('utf-8','surrogateescape'))
    return out


def zip_info(path: str, mode: str) -> zipfile.ZipInfo:
    zi=zipfile.ZipInfo(path,FIXED_ZIP_TIME)
    zi.create_system=3
    zi.compress_type=zipfile.ZIP_DEFLATED
    perms=int(mode[-3:],8) if len(mode)>=3 else 0o644
    file_type=stat.S_IFLNK if mode=='120000' else stat.S_IFREG
    zi.external_attr=(file_type|perms)<<16
    zi.flag_bits=0x800
    return zi


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo',default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument('--commit',default='HEAD')
    ap.add_argument('--candidate-ref',default='sokna-agent-2.6.0-rc7')
    ap.add_argument('--output',required=True)
    ap.add_argument('--manifest-output',required=True)
    ap.add_argument('--allow-dirty',action='store_true',help='development-only; forbidden for canonical R1 freeze')
    args=ap.parse_args()
    root=Path(args.repo).resolve()
    commit=git(root,'rev-parse',f'{args.commit}^{{commit}}').strip()
    head=git(root,'rev-parse','HEAD').strip()
    if commit!=head:
        raise SystemExit(f'R1_COMMIT_NOT_HEAD: requested={commit} head={head}')
    dirty=git(root,'status','--porcelain','--untracked-files=all').splitlines()
    if dirty and not args.allow_dirty:
        raise SystemExit('R1_DIRTY_SOURCE_NOT_ALLOWED: '+'; '.join(dirty[:20]))
    tree=git(root,'rev-parse',f'{commit}^{{tree}}').strip()
    commit_time=git(root,'show','-s','--format=%cI',commit).strip()
    entries=tracked_entries(root,commit)
    files=[]
    for path,mode,oid,blob in entries:
        files.append({'path':path,'git_mode':mode,'git_blob':oid,'bytes':len(blob),'sha256':sha256(blob)})
    manifest={
        'schema':'sokna-r1-source-rc-manifest-v1',
        'candidate_ref':args.candidate_ref,
        'source_commit':commit,
        'source_tree':tree,
        'source_commit_time':commit_time,
        'candidate_agent_version':'2.6.0',
        'accepted_live_agent_baseline':'2.5.7-r4',
        'extension_version':'3.10.7',
        'windows_ci':{
            'workflow':'.github/workflows/windows-agent-validation.yml',
            'required_profile':'full',
            'runner':'windows-2025',
            'dotnet':'8.0.x',
            'inno_setup_package':'Tools.InnoSetup 6.7.3',
            'exact_commit_required':True,
        },
        'activation':{'home_pc_allowed':False,'requires_exact_rc_windows_ci_pass':True},
        'tracked_file_count':len(files),
        'files':files,
    }
    manifest_bytes=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode('utf-8')
    out=Path(args.output).resolve(); out.parent.mkdir(parents=True,exist_ok=True)
    mout=Path(args.manifest_output).resolve(); mout.parent.mkdir(parents=True,exist_ok=True)
    tmp=out.with_suffix(out.suffix+'.tmp')
    if tmp.exists(): tmp.unlink()
    with zipfile.ZipFile(tmp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9,strict_timestamps=False) as z:
        for path,mode,_oid,blob in entries:
            z.writestr(zip_info(path,mode),blob,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        z.writestr(zip_info(MANIFEST_ENTRY,'100644'),manifest_bytes,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    os.replace(tmp,out)
    mout.write_bytes(manifest_bytes)
    result={'ok':True,'schema':'sokna-r1-source-rc-build-v1','candidate_ref':args.candidate_ref,'source_commit':commit,'source_tree':tree,'files':len(files),'bundle':str(out),'bundle_sha256':sha256(out.read_bytes()),'manifest':str(mout),'manifest_sha256':sha256(manifest_bytes)}
    print(json.dumps(result,separators=(',',':')))

if __name__=='__main__': main()
