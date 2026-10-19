"""Behavioral W11 capture-recipe quality gate (never contacts a site)."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import tempfile

root=Path(__file__).resolve().parents[2]
f=root/'tools/qa/compile_capture_recipe.py'
spec=spec_from_file_location('bridge_recipe',f)
compiler=module_from_spec(spec)
spec.loader.exec_module(compiler)
recipe=json.loads((root/'examples/generic-web/read-only-recipe-v1.json').read_text(encoding='utf-8'))
for base in ('https://example.org/public/','http://127.0.0.1:8766/capture/'):
    data=compiler.build(recipe,base)
    assert len(data['entries'])==2
    assert len({x['id'] for x in data['entries']})==2
    assert all(x['url'].startswith(base) for x in data['entries'])
    assert data['schema']=='sokna-bridge-capture-map-template-output-v1'
cases=('../escape','..%2Fescape','%252e%252e/secret','/absolute','//evil.org/',r'x\\y',
       'https://other.test/index.html','foo#frag','logout','users/log-out','delete/records','update/reset-session')
for route in cases:
    sample={'schema':recipe['schema'],'entries':[{'id':'danger','route':route}]}
    try: compiler.build(sample,'https://example.org/public/')
    except ValueError: pass
    else: raise AssertionError('unsafe route accepted: '+route)
for base in ('file:///tmp/','https://user:pass@example.org/','https://example.org/?secret=1'):
    try: compiler.build(recipe,base)
    except ValueError: pass
    else: raise AssertionError('unsafe base URL accepted')
wrong={'schema':recipe['schema'],'entries':[{'id':'dup','route':'one'},{'id':'dup','route':'two'}]}
try: compiler.build(wrong,'https://example.org/')
except ValueError: pass
else: raise AssertionError('duplicate IDs accepted')
with tempfile.TemporaryDirectory() as root_tmp:
    out=Path(root_tmp)/'map.json'
    inp=Path(root_tmp)/'recipe.json'
    inp.write_text(json.dumps(recipe),encoding='utf-8')
    assert compiler.main(['--recipe',str(inp),'--base-url','https://example.org/public/','--output',str(out)])==0
    assert out.is_file()
    assert len(json.loads(out.read_text(encoding='utf-8'))['entries'])==2
print('BRIDGE_W11_CAPTURE_RECIPE_PARITY_PASS')
