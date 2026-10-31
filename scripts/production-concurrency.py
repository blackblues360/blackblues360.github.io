"""Bounded real two-connection CAS test. Production requires explicit approval.
Only creates random synthetic identities with a fixed .invalid marker, records
their IDs before writing, and cleans only the exact identity from this run.
"""
import argparse
import concurrent.futures
import ipaddress
import json
import pathlib
import subprocess
import sys
import time
import uuid
import psycopg

parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--local',action='store_true');mode.add_argument('--production',action='store_true');args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parent.parent
if args.production:
    inputs=json.load(sys.stdin)
    settings={'host':'aws-0-ap-southeast-1.pooler.supabase.com','hostaddr':str(ipaddress.ip_address(inputs['address'])),'port':5432,'user':'postgres.orjmbavlxuuccxdphepi','dbname':'postgres','password':inputs['password'],'sslmode':'verify-full','sslrootcert':str(repo/'.local'/'certs'/'prod-ca-2021.crt'),'connect_timeout':15}
    def connect():return psycopg.connect(**settings,autocommit=True)
else:
    local=json.loads(subprocess.check_output(['supabase','status','--workdir',str(repo),'-o','json'],stderr=subprocess.PIPE,text=True));assert local['API_URL']=='http://127.0.0.1:58321'
    def connect():return psycopg.connect(local['DB_URL'],autocommit=True)
owner=uuid.uuid4();email=f'phase-c-concurrency-{owner}@example.invalid';tag='blackblues-c-'+owner.hex[:12];checks=[]
marker=repo/'.local'/f'concurrency-{owner}.json';marker.parent.mkdir(exist_ok=True);marker.write_text(json.dumps({'project':'orjmbavlxuuccxdphepi' if args.production else 'local','id':str(owner),'email':email,'cleaned':False}))
admin=connect();created=False
def identity(connection):
    connection.execute("set statement_timeout='30s'");connection.execute("set lock_timeout='20s'")
    connection.execute('begin');connection.execute('set local role authenticated');connection.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(owner),'role':'authenticated'}),))
def operation(connection,kind,doc):
    if kind=='delete':return connection.execute('select count(*) from public.delete_tool_document(%s,1)',(doc,)).fetchone()[0]
    return connection.execute("select count(*) from public.save_tool_document(%s,1,'saved','{\"version\":1,\"plate\":{\"type\":\"6\",\"title\":\"\"},\"labels\":[],\"wells\":{},\"ui\":{}}',1)",(doc,)).fetchone()[0]
try:
    admin.execute('insert into auth.users(id,email) values(%s,%s)',(owner,email));created=True
    for first,second,commit in [('save','save',True),('save','save',False),('save','delete',True),('delete','save',True)]:
        doc=uuid.uuid4();admin.execute("insert into public.tool_documents(id,user_id,app_id,title,content,schema_version) values(%s,%s,'plate-layout','synthetic','{\"version\":1,\"plate\":{\"type\":\"6\",\"title\":\"\"},\"labels\":[],\"wells\":{},\"ui\":{}}',1)",(doc,owner))
        with connect() as a,connect() as b:
            identity(a);identity(b)
            assert a.execute('select pg_backend_pid()').fetchone()!=b.execute('select pg_backend_pid()').fetchone()
            assert a.execute('select revision from public.tool_documents where id=%s',(doc,)).fetchone()==(1,)
            assert b.execute('select revision from public.tool_documents where id=%s',(doc,)).fetchone()==(1,)
            assert operation(a,first,doc)==1
            def compete():
                b.execute("select set_config('application_name',%s,true)",(tag,));result=operation(b,second,doc);b.execute('commit');return result
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(compete);deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    if admin.execute("select count(*) from pg_stat_activity where application_name=%s and wait_event_type='Lock'",(tag,)).fetchone()==(1,):break
                    time.sleep(.04)
                else:a.execute('rollback');raise AssertionError('Real competing lock wait was not observed')
                a.execute('commit' if commit else 'rollback');assert future.result(timeout=15)==(0 if commit else 1)
        checks.append(f'{first}/{second}: '+('commit' if commit else 'rollback')+'; distinct backends and real lock wait')
finally:
    if created:
        actual=admin.execute('select email from auth.users where id=%s',(owner,)).fetchone();assert actual==(email,)
        assert admin.execute('delete from auth.users where id=%s and email=%s returning id',(owner,email)).fetchone()==(owner,)
        assert admin.execute('select count(*) from public.tool_documents where user_id=%s',(owner,)).fetchone()==(0,)
    admin.close();marker.write_text(json.dumps({'project':'orjmbavlxuuccxdphepi' if args.production else 'local','id':str(owner),'email':email,'cleaned':True}))
print(json.dumps({'passed':len(checks),'environment':'production' if args.production else 'local','checks':checks,'synthetic_identity_cleaned':True}))
