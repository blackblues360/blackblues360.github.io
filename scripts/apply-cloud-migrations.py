"""Apply reviewed files via Supabase's official migration API when DB DNS fails.
Pinned to the approved empty phase-B project. No generic SQL execution interface.
API-assigned versions become the canonical filenames; SQL bytes are unchanged.
Run only after local tests. Network failures stop; reruns reconcile history first.
"""
import argparse
import hashlib
import json
import pathlib
import re
import urllib.request

parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parent.parent
project='orjmbavlxuuccxdphepi'
token=(pathlib.Path.home()/'.supabase'/'access-token').read_text().strip();assert token.startswith('sbp_')
endpoint=f'https://api.supabase.com/v1/projects/{project}/database/migrations'
def request(suffix='',body=None):
    req=urllib.request.Request(endpoint+suffix,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'blackblues-reviewed-migrations'})
    with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)

files=sorted((repo/'supabase'/'migrations').glob('*.sql'));assert len(files)==7
history=request();manifest=[]
names={file.stem.split('_',1)[1] for file in files}
assert len(names)==7 and all(item['name'] in names for item in history),'Unexpected remote migrations; manual review required'
for file in files:
    source=file.read_bytes();query=source.decode('utf-8');name=file.stem.split('_',1)[1]
    matches=[item for item in history if item['name']==name];assert len(matches)<=1
    if not matches:
        if not args.apply:
            print('pending: '+file.name);continue
        request(body={'name':name,'query':query})
        history=request();matches=[item for item in history if item['name']==name];assert len(matches)==1
    version=matches[0]['version'];assert re.fullmatch(r'\d{14}',version)
    detail=request('/'+version)
    assert detail['statements']==[query],f'{name}: remote SQL differs; do not rename or reapply'
    target=file.with_name(version+'_'+name+'.sql')
    if target!=file:
        assert not target.exists() and target.parent==file.parent
        if args.apply:file.rename(target)
    manifest.append({'name':name,'old_file':file.name,'file':target.name,'version':version,'sha256':hashlib.sha256(source).hexdigest()})
    print('verified: '+target.name)
if args.apply:
    destination=repo/'.local'/'cloud-migrations.json';destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps({'project':project,'migrations':manifest},indent=2)+'\n')
