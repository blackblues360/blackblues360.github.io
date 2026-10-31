"""Explicitly authorized .invalid browser fixtures; stdout is credentials, never log."""
import json,pathlib,secrets,subprocess,sys,urllib.request,uuid
root=pathlib.Path(__file__).resolve().parent.parent
api='https://orjmbavlxuuccxdphepi.supabase.co'
keys=json.loads(subprocess.check_output(['supabase','projects','api-keys','--project-ref','orjmbavlxuuccxdphepi','-o','json'],stderr=subprocess.PIPE,text=True))
admin=next(k['api_key'] for k in keys if k['name']=='service_role');public=next(k['api_key'] for k in keys if k.get('type')=='publishable')
def request(path,method='GET',body=None):
    req=urllib.request.Request(api+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'apikey':admin,'Authorization':'Bearer '+admin,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
if len(sys.argv)>1 and sys.argv[1]=='cleanup':
    for value in json.load(sys.stdin):
        uid=str(uuid.UUID(value));marker=root/'.local'/('production-fixture-'+uid+'.json');saved=json.loads(marker.read_text())
        user=request('/auth/v1/admin/users/'+uid);assert user['email']==saved['email'] and user['email'].startswith('phase-c-release-') and user['email'].endswith('@example.invalid')
        request('/auth/v1/admin/users/'+uid,'DELETE');marker.write_text(json.dumps({**saved,'cleaned':True}))
else:
    users=[]
    try:
        for _ in range(2):
            uid=str(uuid.uuid4());email='phase-c-release-'+uid+'@example.invalid';password=secrets.token_urlsafe(24)
            user=request('/auth/v1/admin/users','POST',{'id':uid,'email':email,'password':password,'email_confirm':True})
            assert user['id']==uid
            (root/'.local'/('production-fixture-'+uid+'.json')).write_text(json.dumps({'id':uid,'email':email,'cleaned':False}))
            users.append({'id':uid,'email':email,'password':password})
        print(json.dumps({'production':True,'api':api,'publicKey':public,'users':users}))
    except Exception:
        for user in users:request('/auth/v1/admin/users/'+user['id'],'DELETE')
        raise RuntimeError('Production synthetic setup failed; credentials suppressed') from None
