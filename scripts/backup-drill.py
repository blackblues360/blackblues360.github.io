"""Local synthetic full-database dump/restore drill. Never accepts a remote URL."""
import hashlib
import json
import os
import pathlib
import subprocess
import urllib.parse
import uuid
import psycopg
from psycopg import sql

os.umask(0o077)
repo=pathlib.Path(__file__).resolve().parent.parent
settings=json.loads(subprocess.check_output(['supabase','status','--workdir',str(repo),'-o','json'],stderr=subprocess.PIPE,text=True))
url=urllib.parse.urlsplit(settings['DB_URL'])
assert url.hostname=='127.0.0.1' and url.port==58322
container='supabase_db_blackblues-local'
database='phase_b_restore_'+uuid.uuid4().hex
owner=uuid.uuid4();record=uuid.uuid4()
archive=repo/'.local'/'backups'/(database+'.dump')
archive.parent.mkdir(parents=True,exist_ok=True)
admin=psycopg.connect(settings['DB_URL'],autocommit=True)
created=False
try:
    admin.execute('insert into auth.users(id) values (%s)',(owner,))
    admin.execute("insert into public.anniversaries(id,user_id,title,event_date,revision) values (%s,%s,'backup-drill','2024-02-29',7)",(record,owner))
    dump=subprocess.run(['docker','exec',container,'pg_dump','-U','supabase_admin','-Fc','postgres'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
    archive.write_bytes(dump)
    admin.execute(sql.SQL('create database {} template template0').format(sql.Identifier(database)));created=True
    restored=subprocess.run(['docker','exec','-i',container,'pg_restore','-U','supabase_admin','--exit-on-error','-d',database],input=dump,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if restored.returncode:
        # Only database object diagnostics; no connection URLs or row data.
        raise RuntimeError(restored.stderr.decode(errors='replace')[-1800:])
    with psycopg.connect(settings['DB_URL'],dbname=database,autocommit=True) as target:
        assert target.execute('select title,event_date::text,revision from public.anniversaries where id=%s',(record,)).fetchone()==('backup-drill','2024-02-29',7)
        for query in ["select n.nspname,c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner),array(select x::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) x order by 1) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by 1,2", "select n.nspname,p.proname,p.prosecdef,p.proconfig::text,pg_get_userbyid(p.proowner),array(select x::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) x order by 1) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2", "select c.relname,a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1,2", "select version,name from supabase_migrations.schema_migrations order by version"]:
            actual=target.execute(query).fetchall();expected=admin.execute(query).fetchall()
            if actual!=expected:
                missing=[row for row in expected if row not in actual]
                added=[row for row in actual if row not in expected]
                raise RuntimeError(f'Catalog mismatch: missing={missing[:3]!r}; added={added[:3]!r}')
        target.execute('begin');target.execute('set local role authenticated');target.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(owner),'role':'authenticated'}),))
        assert target.execute('select revision from public.anniversaries where id=%s',(record,)).fetchone()==(7,)
        assert target.execute("select revision from public.save_anniversary(%s,7,'restored save','2024-02-29',true,'')",(record,)).fetchone()==(8,)
        target.execute('rollback')
    print(json.dumps({'passed':4,'checks':['full local dump restored into independent database','synthetic data and revision preserved','RLS, ACL, function settings and migration history preserved','authenticated CAS works after restore'],'archive':str(archive),'sha256':hashlib.sha256(dump).hexdigest()}))
finally:
    # Only the random database created by this run and its own synthetic identity.
    if created:
        admin.execute(sql.SQL('drop database {} with (force)').format(sql.Identifier(database)))
    admin.execute('delete from auth.users where id=%s',(owner,));admin.close()
