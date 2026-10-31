"""Real independent local connections for restore/purge and retained-ID races."""
import concurrent.futures
import json
import pathlib
import subprocess
import time
import urllib.parse
import uuid
import psycopg

repo=pathlib.Path(__file__).resolve().parent.parent
settings=json.loads(subprocess.check_output(['supabase','status','--workdir',str(repo),'-o','json'],stderr=subprocess.PIPE,text=True))
url=urllib.parse.urlsplit(settings['DB_URL']);assert url.hostname=='127.0.0.1' and url.port==58322
def connect():return psycopg.connect(settings['DB_URL'],autocommit=True)
admin=connect();owner=uuid.uuid4();checks=[]
admin.execute('insert into auth.users(id) values(%s)',(owner,))
content={'version':1,'plate':{'type':'6','title':'original'},'labels':[],'wells':{},'ui':{}}
def identity(connection):
    connection.execute('begin');connection.execute('set local role authenticated')
    connection.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(owner),'role':'authenticated'}),))
def operation(connection,kind,doc):return connection.execute(f'select count(*) from public.{kind}_tool_document(%s,2)',(doc,)).fetchone()[0]
def fixture():
    doc=uuid.uuid4();admin.execute("insert into public.tool_documents(id,user_id,app_id,title,content,schema_version,revision,deleted_at) values(%s,%s,'plate-layout','original',%s,1,2,now())",(doc,owner,json.dumps(content)));return doc
try:
    for first,second,commit in [('restore','purge',True),('restore','purge',False),('purge','restore',True),('purge','restore',False)]:
        doc=fixture()
        with connect() as a,connect() as b:
            identity(a);identity(b);assert operation(a,first,doc)==1
            def compete():
                b.execute("set local application_name='blackblues-phase-c-competitor'");result=operation(b,second,doc);b.execute('commit');return result
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(compete);deadline=time.monotonic()+8
                while time.monotonic()<deadline:
                    if admin.execute("select count(*) from pg_stat_activity where application_name='blackblues-phase-c-competitor' and wait_event_type='Lock'").fetchone()[0]==1:break
                    time.sleep(.03)
                else:a.execute('rollback');raise AssertionError('No real lock wait observed')
                a.execute('commit' if commit else 'rollback');assert future.result(timeout=10)==(0 if commit else 1)
            winner=first if commit else second
            row=admin.execute('select revision,content,purged_at is not null,deleted_at is not null from public.tool_documents where id=%s',(doc,)).fetchone()
            assert row==(3,{} if winner=='purge' else content,winner=='purge',winner=='purge')
        checks.append(f'{first}/{second}: '+('commit' if commit else 'rollback')+' with observed lock wait')
    doc=fixture()
    with connect() as a,connect() as b:
        identity(a);assert operation(a,'purge',doc)==1
        identity(b)
        def replay():
            try:b.execute("insert into public.tool_documents(id,app_id,title,content,schema_version) values(%s,'plate-layout','late',%s,1)",(doc,json.dumps(content)));b.execute('commit');return None
            except psycopg.Error as error:b.execute('rollback');return error.sqlstate
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(replay)
            # Unique checking may itself wait for the updating transaction.
            # Release that transaction before joining the competing request.
            time.sleep(.1);a.execute('commit');assert future.result(timeout=10)=='23505'
        assert admin.execute('select content from public.tool_documents where id=%s',(doc,)).fetchone()[0]=={}
    checks.append('overlapping delayed insert rejected after purge commits; retained ID cannot be reused')
    print(json.dumps({'passed':len(checks),'checks':checks}))
finally:
    admin.execute('delete from auth.users where id=%s',(owner,));admin.close()
