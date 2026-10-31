"""Read-only Management API audit of the explicitly approved phase-B project.
Uses the official CLI credential store in memory; never prints credentials.
"""
import json
import pathlib
import urllib.request

PROJECT='orjmbavlxuuccxdphepi'
token=(pathlib.Path.home()/'.supabase'/'access-token').read_text().strip()
assert token.startswith('sbp_')
def request(path,body=None):
    req=urllib.request.Request('https://api.supabase.com/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'blackblues-phase-b-audit'})
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)

project=request('projects/'+PROJECT)
org=request('organizations/'+project['organization_id'])
print(json.dumps({'project':{key:project.get(key) for key in ['id','name','region','status']},'organization':{key:org.get(key) for key in ['id','name','plan']}}))
poolers=request(f'projects/{PROJECT}/config/database/pooler')
print(json.dumps({'poolers':[{key:item.get(key) for key in ['database_type','db_host','db_port','db_name','db_user','pool_mode']} for item in poolers]}))
auth=request(f'projects/{PROJECT}/config/auth')
print(json.dumps({'auth':{key:auth.get(key) for key in ['disable_signup','site_url','uri_allow_list','external_email_enabled','mailer_autoconfirm','password_min_length','smtp_host','smtp_admin_email','smtp_sender_name','rate_limit_email_sent']}}))
print(json.dumps({'migrations':request(f'projects/{PROJECT}/database/migrations')}))
