"""Local-only browser fixtures. JSON output contains synthetic credentials: pipe it, never log it."""
import html
import json
import pathlib
import re
import secrets
import subprocess
import sys
import time
import urllib.request
import uuid

repo=pathlib.Path(__file__).resolve().parent.parent
settings=json.loads(subprocess.check_output(['supabase','status','--workdir',str(repo),'-o','json'],stderr=subprocess.PIPE,text=True))
api=settings['API_URL'].rstrip('/')
assert api.startswith('http://127.0.0.1:58321')
def request(path,method='GET',body=None):
    req=urllib.request.Request(api+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'apikey':settings['SERVICE_ROLE_KEY'],'Authorization':'Bearer '+settings['SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
def cleanup(ids):
    for uid in ids:
        user=request('/auth/v1/admin/users/'+str(uuid.UUID(uid)))
        assert user['email'].startswith('phase-b-') and user['email'].endswith('@example.invalid')
        request('/auth/v1/admin/users/'+uid,'DELETE')
if len(sys.argv)>1 and sys.argv[1]=='cleanup':
    cleanup(json.load(sys.stdin));sys.exit()
users=[]
try:
    for letter in ['a','b']:
        email=f'phase-b-{uuid.uuid4()}-{letter}@example.invalid'
        user=request('/auth/v1/invite','POST',{'email':email});uid=user.get('id') or user['user']['id']
        users.append({'id':uid,'email':email,'password':secrets.token_urlsafe(24)})
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            with urllib.request.urlopen('http://127.0.0.1:58324/api/v1/messages',timeout=5) as response:messages=json.load(response).get('messages',[])
            match=next((item for item in messages if any(to.get('Address')==email for to in item.get('To',[]))),None)
            if match:
                with urllib.request.urlopen('http://127.0.0.1:58324/api/v1/message/'+match['ID'],timeout=5) as response:mail=json.load(response)
                token=re.search(r'token_hash=([^&"<>\s]+)',html.unescape(mail['HTML']))
                if token:users[-1]['token']=token[1];break
            time.sleep(.1)
        else:raise RuntimeError('Invitation email was not captured locally')
    print(json.dumps({'api':api,'publicKey':settings['ANON_KEY'],'users':users}))
except Exception:
    cleanup([user['id'] for user in users]);raise
