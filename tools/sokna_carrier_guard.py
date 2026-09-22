#!/usr/bin/env python3
import argparse, base64, json, re, sys
MAX_RAW_BYTES=800
MAX_CARRIER_CHARS=1200
ID_RE=re.compile(r'^[A-Za-z0-9._-]{1,96}$')

def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')

def build(obj):
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
    body=b64url(raw)
    carrier=f'SOKNA4CMD:{cid}:{body}:SOKNA4END'
    if len(carrier)>MAX_CARRIER_CHARS: raise ValueError(f'carrier {len(carrier)} > {MAX_CARRIER_CHARS} chars')
    # Mandatory round-trip verification.
    pad='='*((4-len(body)%4)%4)
    decoded=base64.urlsafe_b64decode(body+pad)
    obj2=json.loads(decoded.decode('utf-8'))
    if obj2!=obj: raise ValueError('round-trip JSON mismatch')
    if str(obj2.get('i') or obj2.get('id') or '')!=cid: raise ValueError('outer id mismatch')
    return carrier, len(raw), len(carrier)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--json', help='compact/expanded command JSON; omit to read stdin')
    ap.add_argument('--meta', action='store_true')
    ns=ap.parse_args()
    text=ns.json if ns.json is not None else sys.stdin.read()
    obj=json.loads(text)
    carrier,raw_n,carrier_n=build(obj)
    if ns.meta: print(json.dumps({'ok':True,'rawBytes':raw_n,'carrierChars':carrier_n},separators=(',',':')))
    print(carrier)
if __name__=='__main__': main()
