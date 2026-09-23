import hashlib,json,re,sys,zipfile,tempfile,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FORBIDDEN=re.compile(r'(?im)(^|[;\s])(gci|gc|cp|mv|rm|kill|sleep|gfh)(?=\s|;|$)')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def ps_balance(text):
    stack=[]; pairs={')':'(',']':'[','}':'{'}; opens=set(pairs.values());i=0;quote=None
    while i<len(text):
        c=text[i]
        if quote:
            if quote=="'" and c=="'":
                if i+1<len(text) and text[i+1]=="'":i+=2;continue
                quote=None
            elif quote=='"' and c=='"' and not(i>0 and text[i-1]=='`'):quote=None
            i+=1;continue
        if c in "'\"":quote=c;i+=1;continue
        if c=='#':
            j=text.find('\n',i);i=len(text) if j<0 else j+1;continue
        if c in opens:stack.append(c)
        elif c in pairs:
            if not stack or stack.pop()!=pairs[c]:return False
        i+=1
    return quote is None and not stack
m=json.loads((ROOT/'runtime-manifest.json').read_text(encoding='utf-8'))
assert m['schema']=='sokna-runtime-deployment-v1' and m['target_version']=='2.5.7' and m['release_revision']==4
declared={x['path']:(x['sha256'],x['size']) for x in m['files']}
actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p.name!='runtime-manifest.json'}
assert actual==set(declared),(sorted(actual-set(declared)),sorted(set(declared)-actual))
for rel,(h,size) in declared.items():
    p=ROOT/rel;assert p.stat().st_size==size,rel;assert sha(p)==h,rel
scripts=[p for p in ROOT.rglob('*.ps1')]
for p in scripts:
    t=p.read_text(encoding='utf-8');assert ps_balance(t),('balance',p);assert not FORBIDDEN.search(t),('alias',p)
a=(ROOT/'payload/agent.ps1').read_text(encoding='utf-8');c=json.loads((ROOT/'payload/AGENT_CAPABILITIES.json').read_text())
assert 'version="2.5.7"' in a and c['agent']=='2.5.7'
for marker in ['ARTIFACT_EXPECTED_SHA256_REQUIRED','ARTIFACT_FILE_LIST_MISMATCH','ARTIFACT_HANDOFF_REQUIRED','ARTIFACT_ZIP_TOO_MANY_ENTRIES','ARTIFACT_AUDIT_FINALIZE_FAILED_ROLLED_BACK']:
    assert marker in a,marker
for f in ['Preflight-AgentRuntime257.ps1','Startup-Probe-AgentRuntime257.ps1','Stage-AgentRuntime257.ps1','Activate-AgentRuntime.ps1','Agent-Launcher.ps1','Rollback-AgentRuntime.ps1','Acceptance-AgentRuntime257.ps1','Finalize-RepoUpdate257.ps1','Complete-AgentRuntime257.ps1']:
    assert sha(ROOT/f)==sha(ROOT/'repo-overlay/tools/runtime/releases/2.5.7'/f),f
assert sha(ROOT/'payload/agent.ps1')==sha(ROOT/'repo-overlay/native/runtime/v2.5.7/agent.ps1')
assert sha(ROOT/'payload/AGENT_CAPABILITIES.json')==sha(ROOT/'repo-overlay/native/runtime/v2.5.7/AGENT_CAPABILITIES.json')
launcher=(ROOT/'Agent-Launcher.ps1').read_text();activate=(ROOT/'Activate-AgentRuntime.ps1').read_text();stage=(ROOT/'Stage-AgentRuntime257.ps1').read_text();pre=(ROOT/'Preflight-AgentRuntime257.ps1').read_text();acc=(ROOT/'Acceptance-AgentRuntime257.ps1').read_text()
for x in ['recovery_target_complete','rolled_back_by_launcher','LAUNCHER_BACKUP_AGENT_HASH']:assert x in launcher
for x in ['ACTIVATE_STAGE_LAUNCHER_HASH',"state='activating'",'SOKNA Bridge Agent']:assert x in activate
for x in ['stage_launcher_sha256','backup_agent_sha256','backup_caps_sha256']:assert x in stage
for x in ['PREFLIGHT_PACKAGE_FILE_SET','PREFLIGHT_CURRENT_HEALTH_VERSION','PREFLIGHT_CURRENT_CAPS_VERSION','PREFLIGHT_PS_PARSE',"ValidateSet('AgentMediated','External')","healthEvidence='agent-mediated-control-plane+pid-ownership+disk-version'"]:assert x in pre
assert '-InvocationMode AgentMediated' in stage
_marker="if($InvocationMode-eq'External')"
assert _marker in pre
_external,_mediated=pre.split(_marker,1)[1].split('}else{',1)
assert 'Invoke-RestMethod' in _external
assert 'Invoke-RestMethod' not in _mediated.split('$recoveryRoot=',1)[0]
for x in ['artifact.inspect','artifact.apply','ACCEPT_REVERSE','ACCEPT_AUDIT_EVENTS','ACCEPT_REPO_NOT_CLEAN']:assert x in acc
finalize=(ROOT/'Finalize-RepoUpdate257.ps1').read_text()
assert 'MASTER_AGENT_HANDOFF_ROADMAP_FA.md' in finalize
assert 'Read docs/handoffs/MASTER_AGENT_HANDOFF_ROADMAP_FA.md first' in finalize
assert (ROOT/'MASTER_AGENT_HANDOFF_ROADMAP_FA.md').is_file()
assert (ROOT/'repo-overlay/docs/handoffs/MASTER_AGENT_HANDOFF_ROADMAP_FA.md').is_file()

probe=(ROOT/'Startup-Probe-AgentRuntime257.ps1').read_text();launcher=(ROOT/'Agent-Launcher.ps1').read_text();stage=(ROOT/'Stage-AgentRuntime257.ps1').read_text();agent=(ROOT/'payload/agent.ps1').read_text()
for x in ['[switch]$StartupProbe','STARTUP_PROBE_CAPABILITIES_VERSION','mode="startup-probe"']:assert x in agent,x
for x in ['STARTUP_PROBE_PROCESS_FAILED','-StartupProbe','RedirectStandardOutput','RedirectStandardError']:assert x in probe,x
assert 'Startup-Probe-AgentRuntime257.ps1' in stage and 'STAGE_STARTUP_PROBE_PROCESS' in stage
for x in ['RedirectStandardOutput','RedirectStandardError','runtime_exit']:assert x in launcher,x
assert 'ACTIVATE_NEW_HEALTH_FAILED stderr=' in (ROOT/'Activate-AgentRuntime.ps1').read_text()
activating_line=next(x for x in activate.splitlines() if "state='activating'" in x and '$state=[ordered]@{' in x)
active_line=next(x for x in activate.splitlines() if "state='active'" in x and "active_version=[string]$plan.target_version" in x and '$state=[ordered]@{' in x)
assert "active_version=[string]$plan.current_version" in activating_line
assert "recovered_at=$null" in activating_line
assert "accepted_at=$null" in activating_line
assert "accepted_at=$null" in active_line
reg=(ROOT/'State-Schema-Regression257.ps1').read_text()
for x in ['state_schema_regression','recovered_target_files_complete','STATE_SCHEMA_ACTIVE_VERSION','DUMMY257']:assert x in reg,x
assert sha(ROOT/'State-Schema-Regression257.ps1')==sha(ROOT/'repo-overlay/tools/runtime/releases/2.5.7/State-Schema-Regression257.ps1')

# Control-plane bootstrap budget reference (64-char real SHA placeholder)
shell='$z="$env:USERPROFILE\\Downloads\\SOKNA-Agent-2.5.7-R4-Release.zip";$d="$env:LOCALAPPDATA\\SOKNA\\Bridge\\incoming\\agent-2.5.7";if((Get-FileHash $z).Hash.ToLower()-ne"'+('0'*64)+'"){throw"hash"};Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue;Expand-Archive $z $d -Force;& "$d\\Stage-AgentRuntime257.ps1"'
cmd={'id':'rt257-bootstrap','action':'process.run','workspace':'SOKNA-Bridge','params':{'exe':'powershell','args':['-NoProfile','-Command',shell],'mutating':True}}
assert len(json.dumps(cmd,separators=(',',':')).encode())<=600
print(json.dumps({'ok':True,'manifest_files':len(declared),'powershell_files':len(scripts),'version':'2.5.7','bootstrap_command_bytes':len(json.dumps(cmd,separators=(',',':')).encode())},separators=(',',':')))
