"""Official Management API rollback-only security test, pinned to approved project."""
import json
import pathlib
import urllib.error
import urllib.request

repo=pathlib.Path(__file__).resolve().parent.parent
token=(pathlib.Path.home()/'.supabase'/'access-token').read_text().strip();assert token.startswith('sbp_')
query=(repo/'supabase'/'checks'/'cloud-smoke.sql').read_text()
request=urllib.request.Request('https://api.supabase.com/v1/projects/orjmbavlxuuccxdphepi/database/query',data=json.dumps({'query':query,'read_only':False}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(request,timeout=60) as response:result=json.load(response)
except urllib.error.HTTPError as error:
    raise RuntimeError(error.read().decode()[:1800]) from None
assert 'phase_b_cloud_smoke_completed' in json.dumps(result),'No completion marker; do not treat as passed'
print(json.dumps({'passed':True,'scope':'remote PostgreSQL RLS, CAS, owner/column ACL, SECURITY DEFINER; rollback-only synthetic identities','real_user_jwt_or_email_test':False}))
