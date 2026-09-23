#!/usr/bin/env python3
import argparse, base64, json, re, sys
MAX_RAW_BYTES=800
MAX_CARRIER_CHARS=1200
ID_RE=re.compile(r'^[A-Za-z0-9._-]{1,96}$')

def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')

def validate_obj(obj):
    if not isinstance(obj, dict): raise ValueError('command must be a JSON object')
    cid=str(obj.get('i') or obj.get('id') or '')
    if not ID_RE.fullmatch(cid): raise ValueError('invalid command id')
    compact=('i' in obj or 'o' in obj or 'w' in obj or 'a' in obj)
    if compact:
        if not obj.get('o'): raise ValueError('compact command requires o')
        if 'a' in obj and not isinstance(obj['a'], dict): raise ValueError('a must be an object')
    else:
        if not obj.get('action'): raise ValueError('expanded command requires action')
        if 'params' in obj and not isinstance(obj['params'], dict): raise ValueError('params must be an object')
    raw=json.dumps(obj,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    if len(raw)>MAX_RAW_BYTES: raise ValueError(f'raw payload {len(raw)} > {MAX_RAW_BYTES} bytes')
    return cid,raw

def build(obj,transport='v4'):
    cid,raw=validate_obj(obj);body=b64url(raw)
    if transport=='v4': carrier=f'SOKNA4CMD:{cid}:{body}:SOKNA4END'
    elif transport=='v3': carrier=f'SOKNA3CMD:{body}:SOKNA3END'
    else: raise ValueError('transport must be v3 or v4')
    if len(carrier)>MAX_CARRIER_CHARS: raise ValueError(f'carrier {len(carrier)} > {MAX_CARRIER_CHARS} chars')
    pad='='*((4-len(body)%4)%4);obj2=json.loads(base64.urlsafe_b64decode(body+pad).decode('utf-8'))
    if obj2!=obj: raise ValueError('round-trip JSON mismatch')
    if str(obj2.get('i') or obj2.get('id') or '')!=cid: raise ValueError('command id mismatch')
    return carrier,len(raw),len(carrier)

def transport_for_extension(version):
    try: major,minor,*_=map(int,str(version).split('.'))
    except Exception: raise ValueError('invalid extension version')
    return 'v4' if (major,minor)>=(3,10) else 'v3'

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--json',help='compact/expanded command JSON; omit to read stdin')
    ap.add_argument('--json-b64',help='UTF-8 Base64 command JSON; avoids native-shell quoting loss')
    ap.add_argument('--transport',choices=['v3','v4'])
    ap.add_argument('--extension-version',help='select v3 for <3.10, v4 for >=3.10')
    ap.add_argument('--meta',action='store_true')
    ns=ap.parse_args()
    if ns.json is not None and ns.json_b64 is not None: raise ValueError('use only one of --json or --json-b64')
    if ns.json_b64 is not None:
        try: text=base64.b64decode(ns.json_b64,validate=True).decode('utf-8')
        except Exception as e: raise ValueError('invalid --json-b64 payload') from e
    else: text=ns.json if ns.json is not None else sys.stdin.read()
    obj=json.loads(text)
    transport=ns.transport or (transport_for_extension(ns.extension_version) if ns.extension_version else 'v4')
    carrier,raw_n,carrier_n=build(obj,transport)
    if ns.meta: print(json.dumps({'ok':True,'transport':transport,'rawBytes':raw_n,'carrierChars':carrier_n},separators=(',',':')))
    print(carrier)
if __name__=='__main__': main()
