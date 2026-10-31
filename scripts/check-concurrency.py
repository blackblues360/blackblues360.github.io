"""Stage-B real independent connections, fixed local project only; credentials stay in memory."""
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
url=urllib.parse.urlsplit(settings['DB_URL']);assert url.hostname in ('127.0.0.1','localhost') and url.port==58322
def connect():return psycopg.connect(settings['DB_URL'],autocommit=True)
admin=connect();owner=uuid.uuid4();quota_owner=uuid.uuid4();checks=[]
admin.execute('insert into auth.users(id) values (%s),(%s)',(owner,quota_owner))
def identity(connection,uid):
    connection.execute('begin');connection.execute('set local role authenticated')
    connection.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(uid),'role':'authenticated'}),))
def operation(connection,kind,doc):
    if kind=='save':return connection.execute("select count(*) from public.save_anniversary(%s,1,'saved','2024-02-29',true,'')",(doc,)).fetchone()[0]
    return connection.execute('select count(*) from public.delete_anniversary(%s,1)',(doc,)).fetchone()[0]
try:
    for first,second,commit in [('save','save',True),('save','save',False),('save','delete',True),('delete','save',True)]:
        doc=uuid.uuid4();admin.execute("insert into public.anniversaries(id,user_id,title,event_date) values (%s,%s,'initial','2024-02-29')",(doc,owner))
        with connect() as a,connect() as b:
            identity(a,owner);identity(b,owner)
            assert a.execute('select revision from public.anniversaries where id=%s',(doc,)).fetchone()[0]==1
            assert b.execute('select revision from public.anniversaries where id=%s',(doc,)).fetchone()[0]==1
            assert operation(a,first,doc)==1
            def compete():
                b.execute("set local application_name='blackblues-phase-b-competitor'");result=operation(b,second,doc);b.execute('commit');return result
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(compete);deadline=time.monotonic()+8
                while time.monotonic()<deadline:
                    if admin.execute("select count(*) from pg_stat_activity where application_name='blackblues-phase-b-competitor' and wait_event_type='Lock'").fetchone()[0]==1:break
                    time.sleep(.03)
                else:a.execute('rollback');raise AssertionError('Expected a real lock wait')
                a.execute('commit' if commit else 'rollback');assert future.result(timeout=10)==(0 if commit else 1)
        checks.append(f'anniversary {first}/{second}: '+('commit' if commit else 'rollback'))
    admin.execute("insert into public.anniversaries(user_id,title,event_date) select %s,'fixture-'||n,'2026-01-01' from generate_series(1,999) n",(quota_owner,))
    doc=uuid.uuid4()
    with connect() as a,connect() as b:
        identity(a,quota_owner);identity(b,quota_owner)
        a.execute("insert into public.anniversaries(id,title,event_date) values (%s,'last-slot','2026-01-01')",(doc,))
        def replay():
            b.execute("set local application_name='blackblues-phase-b-quota-retry'")
            try:b.execute("insert into public.anniversaries(id,title,event_date) values (%s,'last-slot','2026-01-01')",(doc,));b.execute('commit');return 'unexpected success'
            except psycopg.Error as error:b.execute('rollback');return error.sqlstate
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(replay);deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                if admin.execute("select count(*) from pg_stat_activity where application_name='blackblues-phase-b-quota-retry' and wait_event_type='Lock'").fetchone()[0]==1:break
                time.sleep(.03)
            else:a.execute('rollback');raise AssertionError('Expected quota retry lock wait')
            a.execute('commit');assert future.result(timeout=10)=='23505'
        identity(b,quota_owner);assert b.execute('select title from public.anniversaries where id=%s',(doc,)).fetchone()[0]=='last-slot';b.execute('commit')
    checks.append('999 -> 1000 concurrent same-ID retry returns 23505 and reads committed record')
    print(json.dumps({'passed':len(checks),'checks':checks}))
finally:
    admin.execute('delete from auth.users where id in (%s,%s)',(owner,quota_owner));admin.close()
