"""Compare actual local/cloud application catalogs without reading business rows."""
import hashlib
import json
import pathlib
import subprocess
import urllib.request
import psycopg

repo=pathlib.Path(__file__).resolve().parent.parent
token=(pathlib.Path.home()/'.supabase'/'access-token').read_text().strip();assert token.startswith('sbp_')
settings=json.loads(subprocess.check_output(['supabase','status','--workdir',str(repo),'-o','json'],stderr=subprocess.PIPE,text=True))
assert settings['API_URL']=='http://127.0.0.1:58321'
query="""
select jsonb_build_object(
 'columns',(select jsonb_agg(t order by table_schema,table_name,ordinal_position) from (select table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default from information_schema.columns where (table_schema='public' and table_name in ('profiles','anniversaries','tool_documents')) or (table_schema='private' and table_name='write_limits'))t),
 'tables',(select jsonb_agg(t order by nspname,relname) from (select n.nspname,c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) owner,array(select x::text from unnest(coalesce(c.relacl,acldefault('r',c.relowner)))x order by 1) acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and ((n.nspname='public' and c.relname in ('profiles','anniversaries','tool_documents'))or(n.nspname='private' and c.relname='write_limits')))t),
 'column_access',(select jsonb_agg(t order by relname,attname,role) from (select c.relname,a.attname,r.role,has_column_privilege(r.role,c.oid,a.attnum,'SELECT') can_select,has_column_privilege(r.role,c.oid,a.attnum,'INSERT') can_insert,has_column_privilege(r.role,c.oid,a.attnum,'UPDATE') can_update from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join(values('anon'),('authenticated'))r(role) where n.nspname='public' and c.relname in ('profiles','anniversaries','tool_documents') and a.attnum>0 and not a.attisdropped)t),
 'constraints',(select jsonb_agg(t order by relname,conname) from (select c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relname in ('profiles','anniversaries','tool_documents','write_limits'))t),
 'indexes',(select jsonb_agg(t order by schemaname,indexname) from (select schemaname,indexname,indexdef from pg_indexes where schemaname in ('public','private') and tablename in ('profiles','anniversaries','tool_documents','write_limits'))t),
 'policies',(select jsonb_agg(t order by tablename,policyname) from (select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private') and tablename in ('profiles','anniversaries','tool_documents','write_limits'))t),
 'functions',(select jsonb_agg(t order by nspname,proname) from (select n.nspname,p.proname,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,array(select x::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner)))x order by 1) acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('touch_updated_at','document_shape_valid','save_tool_document','delete_tool_document','save_anniversary','delete_anniversary','check_write_limits'))t),
 'migrations',(select jsonb_agg(t order by version) from(select version,name from supabase_migrations.schema_migrations)t)
) as catalog;
"""
with psycopg.connect(settings['DB_URL']) as connection:local=connection.execute(query).fetchone()[0]
request=urllib.request.Request('https://api.supabase.com/v1/projects/orjmbavlxuuccxdphepi/database/query',data=json.dumps({'query':query,'read_only':True}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=60) as response:remote=json.load(response)[0]['catalog']
different=[key for key in local if local[key]!=remote.get(key)]
if different:
    for key in different:
        print(json.dumps({'difference':key,'local':local[key],'remote':remote.get(key)}))
    raise RuntimeError('Local/cloud catalog mismatch: '+','.join(different))
print(json.dumps({'passed':True,'compared':sorted(local),'sha256':hashlib.sha256(json.dumps(local,sort_keys=True).encode()).hexdigest()}))
