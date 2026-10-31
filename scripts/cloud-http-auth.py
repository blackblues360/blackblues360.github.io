"""Real cloud JWT isolation tests using disposable .invalid identities, no email.
Admin credentials are held only in this process; business calls use user JWTs.
"""
import json
import secrets
import subprocess
import urllib.error
import urllib.request
import uuid

project='orjmbavlxuuccxdphepi';api=f'https://{project}.supabase.co'
keys=json.loads(subprocess.check_output(['supabase','projects','api-keys','--project-ref',project,'-o','json'],stderr=subprocess.PIPE,text=True))
admin=next(item['api_key'] for item in keys if item['name']=='service_role')
public=next(item['api_key'] for item in keys if item.get('type')=='publishable')
users=[];checks=[]
def call(path,method='GET',body=None,token=None,privileged=False):
    key=admin if privileged else public
    headers={'apikey':key,'Content-Type':'application/json','Prefer':'return=representation'}
    if token or privileged:headers['Authorization']='Bearer '+(token or admin)
    req=urllib.request.Request(api+path,data=None if body is None else json.dumps(body).encode(),method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=30) as response:return response.status,json.loads(response.read() or 'null')
    except urllib.error.HTTPError as error:return error.code,json.loads(error.read() or 'null')
try:
    for label in ['a','b']:
        email=f'phase-b-cloud-{uuid.uuid4()}-{label}@example.invalid';password=secrets.token_urlsafe(24)
        status,user=call('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True},privileged=True)
        assert status==200,'Synthetic identity setup failed; credentials suppressed'
        users.append({'id':user['id'],'email':email})
        status,session=call('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password})
        assert status==200,'Synthetic password login failed; credentials suppressed'
        users[-1]['token']=session['access_token']
    a,b=users;checks.append('two independent Auth password logins produce real JWTs')
    for user in users:
        status,_=call('/rest/v1/profiles','POST',{'id':user['id'],'display_name':'synthetic'},user['token']);assert status==201
        status,rows=call('/rest/v1/anniversaries','POST',{'id':str(uuid.uuid4()),'title':'synthetic '+user['id'],'event_date':'2024-02-29'},user['token']);assert status==201
        user['record']=rows[0]['id']
    status,_=call('/rest/v1/anniversaries?select=id');assert status in (401,403);checks.append('anonymous private read denied')
    status,rows=call('/rest/v1/anniversaries?select=id',token=a['token']);assert status==200 and [row['id'] for row in rows]==[a['record']];checks.append('A only reads own record')
    status,rows=call('/rest/v1/profiles?select=id',token=a['token']);assert status==200 and [row['id'] for row in rows]==[a['id']];checks.append('profile owner isolation')
    status,_=call('/rest/v1/anniversaries','POST',{'user_id':b['id'],'title':'forged','event_date':'2026-01-01'},a['token']);assert status==403;checks.append('forged owner denied')
    status,_=call('/rest/v1/anniversaries?id=eq.'+a['record'],'PATCH',{'user_id':b['id']},a['token']);assert status==403;checks.append('owner transfer denied')
    status,_=call('/rest/v1/anniversaries?id=eq.'+b['record'],'PATCH',{'title':'forged'},a['token']);assert status==403;checks.append('direct update denied')
    status,_=call('/rest/v1/anniversaries?id=eq.'+b['record'],'DELETE',token=a['token']);assert status==403;checks.append('direct deletion denied')
    payload={'p_id':b['record'],'p_expected_revision':1,'p_title':'forged','p_event_date':'2026-01-01','p_repeat_annually':False,'p_notes':''}
    status,rows=call('/rest/v1/rpc/save_anniversary','POST',payload,a['token']);assert status==200 and rows==[];checks.append('RPC owner check')
    payload.update(p_id=a['record'],p_title='winner')
    status,rows=call('/rest/v1/rpc/save_anniversary','POST',payload,a['token']);assert status==200 and rows[0]['revision']==2;checks.append('CAS increments revision')
    status,rows=call('/rest/v1/rpc/save_anniversary','POST',payload,a['token']);assert status==200 and rows==[];checks.append('stale or timed-out replay cannot overwrite')
    status,rows=call('/rest/v1/rpc/delete_anniversary','POST',{'p_id':a['record'],'p_expected_revision':1},a['token']);assert status==200 and rows==[];checks.append('stale deletion denied')
    status,rows=call('/rest/v1/rpc/delete_anniversary','POST',{'p_id':a['record'],'p_expected_revision':2},a['token']);assert status==200 and rows==[a['record']];checks.append('versioned soft deletion succeeds')
    payload['p_expected_revision']=3
    status,rows=call('/rest/v1/rpc/save_anniversary','POST',payload,a['token']);assert status==200 and rows==[];checks.append('old requests cannot revive deleted data')
    status,_=call('/rest/v1/rpc/delete_anniversary','POST',{'p_id':b['record'],'p_expected_revision':0},b['token']);assert status==400;checks.append('invalid revision rejected')
    print(json.dumps({'passed':len(checks),'checks':checks,'email_delivery_tested':False}))
finally:
    for user in users:
        status,actual=call('/auth/v1/admin/users/'+user['id'],privileged=True)
        assert status==200 and actual['email']==user['email'] and actual['email'].startswith('phase-b-cloud-') and actual['email'].endswith('@example.invalid')
        status,_=call('/auth/v1/admin/users/'+user['id'],'DELETE',privileged=True);assert status in (200,204)
