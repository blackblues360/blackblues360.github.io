"""Real independent connections, loopback only. Requires psycopg[binary].

Use --port 15432 for the portable fixture or --port 57322 for local Supabase.
This test creates/deletes only its own random synthetic fixture user.
"""
import argparse
import concurrent.futures
import json
import os
import subprocess
import time
import urllib.parse
import uuid
import psycopg

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,required=True)
parser.add_argument('--cli')
parser.add_argument('--project')
args=parser.parse_args()
if args.cli:
    status=json.loads(subprocess.check_output([args.cli,'status','-o','json'],cwd=args.project,stderr=subprocess.PIPE,text=True))
    local_url=urllib.parse.urlsplit(status['DB_URL'])
    assert local_url.hostname in ('127.0.0.1','localhost') and local_url.port==args.port
    os.environ['PGPASSWORD']=urllib.parse.unquote(local_url.password or '')
def connect():
    return psycopg.connect(host='127.0.0.1',port=args.port,user='postgres',dbname='postgres',autocommit=True)
admin=connect()
owner=uuid.uuid4()
claims=json.dumps({'sub':str(owner),'role':'authenticated'})
content=json.dumps({'version':1,'plate':{'type':'6','title':''},'wells':{},'labels':[],'ui':{}})
def identity(connection):
    connection.execute('set local role authenticated')
    connection.execute("select set_config('request.jwt.claims',%s,true)",(claims,))
def operation(connection,kind,doc,title):
    query=("select count(*) from public.save_tool_document(%s,1,%s,%s,1)" if kind=='save'
           else "select count(*) from public.delete_tool_document(%s,1)")
    return connection.execute(query,(doc,title,content) if kind=='save' else (doc,)).fetchone()[0]
admin.execute('insert into auth.users(id) values (%s)',(owner,))
checks=[]
try:
    for label,first,second,commit in [
        ('save/save commit','save','save',True),('save/save rollback','save','save',False),
        ('save/delete commit','save','delete',True),('delete/save commit','delete','save',True),
    ]:
        doc=uuid.uuid4()
        admin.execute("insert into public.tool_documents(id,user_id,app_id,title,content,schema_version) values (%s,%s,'plate-layout','initial',%s,1)",(doc,owner,content))
        with connect() as a,connect() as b:
            a.execute('begin');identity(a)
            b.execute('begin');identity(b)
            assert a.execute('select revision from public.tool_documents where id=%s',(doc,)).fetchone()[0]==1
            assert b.execute('select revision from public.tool_documents where id=%s',(doc,)).fetchone()[0]==1
            assert operation(a,first,doc,'device-A')==1
            def compete():
                b.execute("set local application_name='stage-a-competitor'")
                value=operation(b,second,doc,'device-B');b.execute('commit');return value
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future=executor.submit(compete)
                deadline=time.monotonic()+8
                while time.monotonic()<deadline:
                    if admin.execute("select count(*) from pg_stat_activity where application_name='stage-a-competitor' and wait_event_type='Lock'").fetchone()[0]==1: break
                    time.sleep(.05)
                else:
                    a.execute('rollback');raise AssertionError('No actual row-lock wait observed')
                a.execute('commit' if commit else 'rollback')
                assert future.result(timeout=10)==(0 if commit else 1),label
        row=admin.execute('select title,revision,deleted_at is not null from public.tool_documents where id=%s',(doc,)).fetchone()
        expected=('device-B',2,False) if not commit else (('initial',2,True) if first=='delete' else ('device-A',2,False))
        assert row==expected,(label,row)
        checks.append(label)
    doc=uuid.uuid4()
    admin.execute("insert into public.tool_documents(id,user_id,app_id,title,content,schema_version) values (%s,%s,'plate-layout','initial',%s,1)",(doc,owner,content))
    with connect() as client:
        for title,expected in [('committed',1),('retry',0)]:
            client.execute('begin');identity(client);assert operation(client,'save',doc,title)==expected;client.execute('commit')
    checks.append('lost committed response: old revision retry refused')
    print(json.dumps({'passed':len(checks),'checks':checks}))
finally:
    admin.execute('delete from auth.users where id=%s',(owner,));admin.close()
