"""Real local Auth tokens and Data API isolation. Credentials live only in memory.
Only localhost API URLs and the dedicated synthetic-test container are accepted.
"""
import argparse
import json
import secrets
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('--cli',required=True)
parser.add_argument('--project',required=True)
args=parser.parse_args()
status=json.loads(subprocess.check_output([args.cli,'status','-o','json'],cwd=args.project,stderr=subprocess.PIPE,text=True))
base=status['API_URL'].rstrip('/')
assert urllib.parse.urlsplit(base).hostname in ('127.0.0.1','localhost')
key=status['ANON_KEY']
users=[]
checks=[]
def request(path,token=None,method='GET',body=None):
    headers={'apikey':key,'Authorization':'Bearer '+(token or key),'Content-Type':'application/json','Prefer':'return=representation'}
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(base+path,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            text=response.read().decode();return response.status,json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        return error.code,json.loads(error.read().decode())
def check(name,condition):
    assert condition,name
    checks.append(name)
def signup(letter):
    email=f'stage-a-{uuid.uuid4()}-{letter}@example.invalid'
    password=secrets.token_urlsafe(30)
    code,session=request('/auth/v1/signup',method='POST',body={'email':email,'password':password})
    assert code in (200,201),'Local synthetic signup failed'
    user=session.get('user',session)
    uid=user.get('id')
    assert uid,'Signup did not return a local user ID'
    users.append(str(uuid.UUID(uid)))
    if not session.get('access_token'):
        # Fixture confirmation only; business requests never use administrative keys.
        sql=f"update auth.users set email_confirmed_at=now() where id='{users[-1]}' and email_confirmed_at is null;"
        subprocess.run(['docker','exec','-i','supabase_db_blackblues-stage-a','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,check=True)
        code,session=request('/auth/v1/token?grant_type=password',method='POST',body={'email':email,'password':password})
    assert session.get('access_token'),'Local sign-in did not return a JWT'
    return users[-1],session['access_token']
try:
    a,ta=signup('a');b,tb=signup('b')
    check('two synthetic users obtain real local Auth JWTs',a!=b)
    for uid,token in [(a,ta),(b,tb)]:
        code,_=request('/rest/v1/profiles',token,'POST',{'id':uid,'display_name':'synthetic'})
        assert code==201,'Own profile insert failed'
    code,rows=request('/rest/v1/profiles',ta)
    check('profile SELECT returns only A',code==200 and [row['id'] for row in rows]==[a])
    for table in ['profiles','anniversaries','tool_documents']:
        code,_=request('/rest/v1/'+table)
        check('anonymous '+table+' read denied',code in (401,403))
    content={'version':1,'plate':{'type':'6','title':''},'wells':{},'labels':[],'ui':{}}
    da,db=str(uuid.uuid4()),str(uuid.uuid4())
    for uid,token,doc in [(a,ta,da),(b,tb,db)]:
        code,_=request('/rest/v1/tool_documents',token,'POST',{'id':doc,'user_id':uid,'app_id':'plate-layout','title':'synthetic','content':content,'schema_version':1})
        assert code==201,'Own document insert failed'
    code,rows=request('/rest/v1/tool_documents?id=eq.'+db,ta)
    check('A cannot read B document',code==200 and rows==[])
    code,_=request('/rest/v1/tool_documents',ta,'POST',{'user_id':b,'app_id':'plate-layout','title':'forged','content':content,'schema_version':1})
    check('A cannot forge B owner',code==403)
    code,_=request('/rest/v1/tool_documents?id=eq.'+da,ta,'PATCH',{'user_id':b})
    check('A cannot transfer ownership',code==403)
    code,_=request('/rest/v1/tool_documents?id=eq.'+da,ta,'PATCH',{'title':'bypass'})
    check('direct document update blocked',code==403)
    payload={'p_id':db,'p_expected_revision':1,'p_title':'cross','p_content':content,'p_schema_version':1}
    code,rows=request('/rest/v1/rpc/save_tool_document',ta,'POST',payload)
    check('RPC cannot save B document',code==200 and rows==[])
    code,rows=request('/rest/v1/rpc/delete_tool_document',ta,'POST',{'p_id':db,'p_expected_revision':1})
    check('RPC cannot delete B document',code==200 and rows==[])
    payload.update(p_id=da,p_title='saved')
    code,rows=request('/rest/v1/rpc/save_tool_document',ta,'POST',payload)
    check('own RPC increments revision',code==200 and len(rows)==1 and rows[0]['revision']==2)
    code,rows=request('/rest/v1/rpc/save_tool_document',ta,'POST',payload)
    check('stale retry returns conflict result',code==200 and rows==[])
    code,rows=request('/rest/v1/rpc/delete_tool_document',ta,'POST',{'p_id':da,'p_expected_revision':2})
    check('versioned soft delete succeeds',code==200 and rows==[da])
    payload['p_expected_revision']=3
    code,rows=request('/rest/v1/rpc/save_tool_document',ta,'POST',payload)
    check('deleted document cannot revive',code==200 and rows==[])
    code,_=request('/rest/v1/profiles','invalid-test-token')
    check('forged JWT rejected by API',code==401)
    print(json.dumps({'passed':len(checks),'checks':checks}))
finally:
    if users:
        ids=','.join("'"+uid+"'" for uid in users)
        subprocess.run(['docker','exec','-i','supabase_db_blackblues-stage-a','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=f'delete from auth.users where id in ({ids});',text=True,capture_output=True,check=True)
