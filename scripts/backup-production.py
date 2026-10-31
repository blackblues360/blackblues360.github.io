"""Read-only production dump; restore only to a random LOCAL database.
Credentials arrive on stdin and only in process environments. No remote writes.
Raw archive is protected from the preview server and ignored by Git.
"""
import hashlib
import argparse
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import uuid
import psycopg
from psycopg import sql

parser=argparse.ArgumentParser();parser.add_argument('--archive');args=parser.parse_args()
os.umask(0o077)
repo=pathlib.Path(__file__).resolve().parent.parent;inputs=json.load(sys.stdin)
certificate=repo/'.local'/'certs'/'prod-ca-2021.crt';assert certificate.is_file()
connection_settings={'host':'aws-0-ap-southeast-1.pooler.supabase.com','hostaddr':str(ipaddress.ip_address(inputs['address'])),'port':5432,'user':'postgres.orjmbavlxuuccxdphepi','dbname':'postgres','password':inputs['password'],'sslmode':'verify-full','sslrootcert':str(certificate),'connect_timeout':15}
local_settings=json.loads(subprocess.check_output(['supabase','status','--workdir',str(repo),'-o','json'],stderr=subprocess.PIPE,text=True));assert local_settings['API_URL']=='http://127.0.0.1:58321'
database='production_restore_'+uuid.uuid4().hex;folder=repo/'.local'/'production-backups';folder.mkdir(parents=True,exist_ok=True)
environment=os.environ.copy();environment.update({key:value for key,value in {'PGHOST':connection_settings['host'],'PGHOSTADDR':connection_settings['hostaddr'],'PGPORT':'5432','PGUSER':connection_settings['user'],'PGDATABASE':'postgres','PGPASSWORD':inputs['password'],'PGSSLMODE':'verify-full','PGSSLROOTCERT':str(certificate),'PGCONNECT_TIMEOUT':'15'}.items()})
if args.archive:
    archive=pathlib.Path(args.archive).resolve();assert archive.is_relative_to(folder.resolve()) and archive.suffix=='.dump'
    dump_bytes=archive.read_bytes()
else:
    dump=subprocess.run(['pg_dump','-Fc'],env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if dump.returncode:raise RuntimeError('Production read-only pg_dump failed: '+dump.stderr.decode(errors='replace')[-1200:])
    dump_bytes=dump.stdout;archive=folder/(database+'.dump');archive.write_bytes(dump_bytes)
local=psycopg.connect(local_settings['DB_URL'],autocommit=True);created=False
queries={
 'business_rows':"select jsonb_build_object('profiles',(select coalesce(jsonb_agg(t order by id),'[]') from public.profiles t),'anniversaries',(select coalesce(jsonb_agg(t order by id),'[]') from public.anniversaries t),'tool_documents',(select coalesce(jsonb_agg(t order by id),'[]') from public.tool_documents t))",
 'owners_and_revisions':"select id,user_id,revision,deleted_at is not null from public.tool_documents order by id",
 'auth_links':"select id,email from auth.users order by id",
 'policies':"select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private') order by 1,2,3",
 'table_acl':"select n.nspname,c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner),array(select x::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner)))x order by 1) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by 1,2",
 'column_acl':"select c.relname,a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1,2",
 'functions':"select n.nspname,p.proname,pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,pg_get_functiondef(p.oid),array(select x::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner)))x order by 1) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2",
 'history':"select version,name from supabase_migrations.schema_migrations order by version"
}
try:
    # Managed cloud roles differ slightly from the local image. Missing owners
    # are inert NOLOGIN roles in this isolated local cluster; no cloud changes.
    with psycopg.connect(**connection_settings) as source:
        source.execute('set transaction read only')
        roles=source.execute("select rolname from pg_roles where rolname !~ '^pg_' order by rolname").fetchall()
    missing=[]
    for (role,) in roles:
        if local.execute('select 1 from pg_roles where rolname=%s',(role,)).fetchone():continue
        if not re.fullmatch(r'[A-Za-z0-9_]+',role):raise RuntimeError('Nonstandard role requires manual restore review')
        command=sql.SQL('create role {} nologin').format(sql.Identifier(role)).as_string(local)
        result=subprocess.run(['docker','exec','supabase_db_blackblues-local','psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',command],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:raise RuntimeError('Could not create inert LOCAL owner role')
        missing.append(role)
    local.execute(sql.SQL('create database {} template template0').format(sql.Identifier(database)));created=True
    restored=subprocess.run(['docker','exec','-i','supabase_db_blackblues-local','pg_restore','-U','supabase_admin','--exit-on-error','-d',database],input=dump_bytes,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if restored.returncode:raise RuntimeError('LOCAL restore failed: '+restored.stderr.decode(errors='replace')[-1500:])
    with psycopg.connect(**connection_settings) as source,psycopg.connect(local_settings['DB_URL'],dbname=database) as target:
        source.execute('set transaction read only')
        source_counts=source.execute('select (select count(*) from auth.users),(select count(*) from public.profiles),(select count(*) from public.anniversaries),(select count(*) from public.tool_documents)').fetchone()
        for name,query in queries.items():
            if source.execute(query).fetchall()!=target.execute(query).fetchall():raise RuntimeError('Restore comparison failed: '+name)
        # Exercise the restored schema and the pending C upgrade with synthetic
        # identities ONLY in the disposable local restore target.
        if not target.execute("select 1 from information_schema.columns where table_schema='public' and table_name='tool_documents' and column_name='purged_at'").fetchone():
            target.execute((repo/'supabase'/'migrations'/'20261030100000_document_recycle_bin.sql').read_text())
        a,b,doc=uuid.uuid4(),uuid.uuid4(),uuid.uuid4()
        target.execute('insert into auth.users(id) values(%s),(%s)',(a,b))
        target.execute('set local role authenticated')
        target.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(a),'role':'authenticated'}),))
        content={'version':1,'plate':{'type':'6','title':'restore sample'},'labels':[],'wells':{},'ui':{}}
        target.execute("insert into public.tool_documents(id,app_id,title,content,schema_version) values(%s,'plate-layout','restore sample',%s,1)",(doc,json.dumps(content)))
        assert target.execute("select revision from public.save_tool_document(%s,1,'saved',%s,1)",(doc,json.dumps(content))).fetchone()==(2,)
        assert target.execute('select count(*) from public.delete_tool_document(%s,2)',(doc,)).fetchone()==(1,)
        assert target.execute('select count(*) from public.list_deleted_tool_documents()').fetchone()==(1,)
        target.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(b),'role':'authenticated'}),))
        assert target.execute('select count(*) from public.list_deleted_tool_documents()').fetchone()==(0,)
        assert target.execute('select count(*) from public.restore_tool_document(%s,3)',(doc,)).fetchone()==(0,)
        target.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(a),'role':'authenticated'}),))
        assert target.execute('select revision from public.restore_tool_document(%s,3)',(doc,)).fetchone()==(4,)
        assert target.execute('select content from public.tool_documents where id=%s',(doc,)).fetchone()[0]==content
        assert target.execute('select count(*) from public.delete_tool_document(%s,4)',(doc,)).fetchone()==(1,)
        assert target.execute('select count(*) from public.purge_tool_document(%s,5)',(doc,)).fetchone()==(1,)
        assert target.execute('select count(*) from public.restore_tool_document(%s,6)',(doc,)).fetchone()==(0,)
    print(json.dumps({'passed':True,'source':'approved cloud project; read-only pg_dump','source_counts_auth_profiles_anniversaries_documents':source_counts,'target':'isolated local database','compared':list(queries),'local_synthetic_checks':['ownership','RLS','revision','trash','restore','purge'],'archive':str(archive),'sha256':hashlib.sha256(dump_bytes).hexdigest(),'local_inert_owner_roles_added':missing,'storage_objects_included':False,'auth_config_included':False}))
finally:
    if created:local.execute(sql.SQL('drop database {} with(force)').format(sql.Identifier(database)))
    local.close()
