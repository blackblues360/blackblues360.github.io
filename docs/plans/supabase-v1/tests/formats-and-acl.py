"""Runtime ACL and real tool-format checks on the dedicated loopback database.
Requires psycopg[binary] and Node.js. No real user data is accessed.
"""
import argparse
import json
import os
import pathlib
import subprocess
import urllib.parse
import uuid
import psycopg
from psycopg.types.json import Jsonb

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,required=True)
parser.add_argument('--node',default='node')
parser.add_argument('--cli')
parser.add_argument('--project')
args=parser.parse_args()
if args.cli:
    status=json.loads(subprocess.check_output([args.cli,'status','-o','json'],cwd=args.project,stderr=subprocess.PIPE,text=True))
    local_url=urllib.parse.urlsplit(status['DB_URL'])
    assert local_url.hostname in ('127.0.0.1','localhost') and local_url.port==args.port
    os.environ['PGPASSWORD']=urllib.parse.unquote(local_url.password or '')
repo=pathlib.Path(__file__).resolve().parents[4]
fixtures=json.loads(subprocess.check_output([args.node,'--input-type=module','-e',"""
import {createState,restoreState} from './tools/plate-layout/core.mjs';
import {sampleDocument,importDocument} from './tools/sop-timeline/core.mjs';
const plate=createState('96');plate.plate.title='孔板原始数据';
plate.labels=[{id:'label-1',name:'对照组',color:'#a9c9ed'}];plate.wells.A1='label-1';
const sop=sampleDocument();sop.name='中文 SOP';
console.log(JSON.stringify({'plate-layout':restoreState(plate),'sop-timeline':importDocument(JSON.stringify(sop))}));
"""],cwd=repo,encoding='utf-8'))
admin=psycopg.connect(host='127.0.0.1',port=args.port,user='postgres',dbname='postgres',autocommit=True)
checks=[]
rls=admin.execute("select relname,relrowsecurity from pg_class where oid in ('public.profiles'::regclass,'public.anniversaries'::regclass,'public.tool_documents'::regclass)").fetchall()
assert len(rls)==3 and all(row[1] for row in rls)
checks.append('RLS enabled on all private tables')
assert admin.execute("select count(*) from pg_constraint where conrelid in ('public.profiles'::regclass,'public.anniversaries'::regclass,'public.tool_documents'::regclass) and contype='f'").fetchone()[0]==3
assert admin.execute("select count(*) from pg_trigger where not tgisinternal and tgrelid in ('public.profiles'::regclass,'public.anniversaries'::regclass,'public.tool_documents'::regclass)").fetchone()[0]==3
assert admin.execute("select count(*) from pg_indexes where schemaname='public' and indexname in ('anniversaries_owner_date','documents_owner_app_updated')").fetchone()[0]==2
assert admin.execute("select count(*) from pg_constraint where conrelid='public.tool_documents'::regclass and conname in ('document_shape','document_size')").fetchone()[0]==2
assert admin.execute('show default_transaction_isolation').fetchone()[0]=='read committed'
checks.append('foreign keys, triggers, indexes and content constraints materialized; READ COMMITTED confirmed')
for privilege in ['UPDATE','DELETE']:
    assert not admin.execute("select has_table_privilege('authenticated','public.tool_documents',%s)",(privilege,)).fetchone()[0]
for table in ['profiles','anniversaries','tool_documents']:
    assert not admin.execute("select has_table_privilege('anon',%s,'SELECT')",('public.'+table,)).fetchone()[0]
assert not admin.execute("select has_column_privilege('authenticated','public.tool_documents','deleted_at','INSERT')").fetchone()[0]
assert not admin.execute("select has_column_privilege('authenticated','public.tool_documents','user_id','UPDATE')").fetchone()[0]
checks.append('actual table and column ACLs exclude bypass writes')
for signature in ['public.save_tool_document(uuid,bigint,text,jsonb,integer)','public.delete_tool_document(uuid,bigint)']:
    row=admin.execute('select r.rolname,p.prosecdef,p.proconfig from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=%s::regprocedure',(signature,)).fetchone()
    assert row[0]=='postgres' and row[1] and 'search_path=""' in row[2],row
    assert not admin.execute("select has_function_privilege('anon',%s,'EXECUTE')",(signature,)).fetchone()[0]
    assert admin.execute("select has_function_privilege('authenticated',%s,'EXECUTE')",(signature,)).fetchone()[0]
assert not admin.execute("select rolbypassrls or rolsuper from pg_roles where rolname='authenticated'").fetchone()[0]
checks.append('SECURITY DEFINER owner/search_path and EXECUTE ACL inspected')
owner=uuid.uuid4()
admin.execute('insert into auth.users(id) values (%s)',(owner,))
try:
    with psycopg.connect(host='127.0.0.1',port=args.port,user='postgres',dbname='postgres') as client:
        client.execute('set local role authenticated')
        client.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(owner),'role':'authenticated'}),))
        assert client.execute('select current_user,auth.uid()').fetchone()==('authenticated',owner)
        for app,content in fixtures.items():
            doc=uuid.uuid4()
            client.execute('insert into public.tool_documents(id,app_id,title,content,schema_version) values (%s,%s,%s,%s,1)',(doc,app,'synthetic',Jsonb(content)))
            restored,text=client.execute('select content,content::text from public.tool_documents where id=%s',(doc,)).fetchone()
            assert restored==content
            assert text!=json.dumps(content,ensure_ascii=False,indent=2)
            checks.append(app+' JSONB semantic roundtrip; byte formatting intentionally differs')
finally:
    admin.execute('delete from auth.users where id=%s',(owner,));admin.close()
print(json.dumps({'passed':len(checks),'checks':checks}))
