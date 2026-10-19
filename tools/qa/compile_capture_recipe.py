#!/usr/bin/env python3
"""Compile a deployment-independent read-only capture map. No network or Bridge required."""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, urljoin, unquote

IDENT = re.compile(r'^[A-Za-z0-9._-]{1,96}$')
UNSAFE = re.compile(r'(^|[/_?&=.-])(logout|log-out|signout|sign-out|delete|destroy|reset-session)([/?&=.-]|$)', re.I)

def fail(msg):
    raise ValueError(msg)

def checked_base(value):
    u = urlsplit(value)
    if u.scheme not in ('http', 'https') or not u.netloc or u.username or u.password or u.fragment:
        fail('Invalid --base-url: require an absolute http(s) URL with no credentials or fragment')
    if u.query:
        fail('Base URL cannot contain a query')
    path = u.path if u.path.endswith('/') else u.path + '/'
    return urlunsplit((u.scheme, u.netloc, path, '', ''))

def build(recipe, base_url):
    if recipe.get('schema') != 'sokna-bridge-capture-recipe-template-v1':
        fail('Unsupported recipe schema')
    raw = recipe.get('entries')
    if not isinstance(raw, list) or not (1 <= len(raw) <= 500):
        fail('Recipe must have 1..500 entries')
    base = checked_base(base_url)
    parent = urlsplit(base)
    compiled, ids = [], set()
    for item in raw:
        if not isinstance(item, dict): fail('Recipe entry must be an object')
        code = item.get('id')
        if not isinstance(code, str) or not IDENT.fullmatch(code) or code in ids:
            fail(f'Duplicate or invalid entry id: {code!r}')
        ids.add(code)
        route = item.get('route')
        if not isinstance(route, str) or not route or len(route) > 700:
            fail(f'Invalid route for {code}')
        decoded = route
        for _ in range(4):
            nxt = unquote(decoded)
            if nxt == decoded: break
            decoded = nxt
        parts = urlsplit(route)
        if (parts.scheme or parts.netloc or route.startswith(('/', '\\')) or '\\' in route
            or parts.fragment or any(seg in ('.', '..') for seg in decoded.split('?')[0].split('/'))
            or UNSAFE.search(decoded)):
            fail(f'Unsafe or non-relative route: {code}')
        joined = urljoin(base, route)
        u = urlsplit(joined)
        if u.scheme != parent.scheme or u.netloc != parent.netloc or not u.path.startswith(parent.path):
            fail(f'Route escaped approved deployment origin/base path: {code}')
        expected = item.get('expected', None)
        if expected is not None:
            if not isinstance(expected, dict) or not expected or set(expected)-{'selector', 'forbidden_selector'}:
                fail(f'Invalid expected assertion: {code}')
            for key, value in expected.items():
                if not isinstance(value, str) or not value.strip() or len(value)>240:
                    fail(f'Invalid expected selector: {code}')
        entry = {'id':code,'title':str(item.get('title') or code)[:180],
                 'url':joined,'action':str(item.get('action') or 'Capture read-only page')[:350]}
        if expected is not None: entry['expected'] = expected
        compiled.append(entry)
    return {'schema':'sokna-bridge-capture-map-template-output-v1',
            'source_recipe':recipe.get('id','unknown'), 'base_url':base,'entries':compiled}

def main(argv=None):
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--recipe',required=True,type=Path)
    a.add_argument('--base-url',required=True)
    a.add_argument('--output',required=True,type=Path)
    args=a.parse_args(argv)
    try:
        obj=build(json.loads(args.recipe.read_text(encoding='utf-8')),args.base_url)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    except (ValueError,OSError,json.JSONDecodeError) as exc:
        print(f'RECIPE_COMPILE_FAIL: {exc}', file=sys.stderr)
        return 2
    print(f'RECIPE_COMPILE_PASS entries={len(obj["entries"])} output={args.output}')
    return 0
if __name__=='__main__': raise SystemExit(main())
