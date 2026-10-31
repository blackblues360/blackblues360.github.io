"""Fallback: real local PostgreSQL, with a MINIMAL Auth compatibility fixture.

This is NOT a Supabase/Auth/REST deployment test. Use only a fresh local test cluster.
pgTAP source must be downloaded separately from the pgTAP maintainer.
"""
import argparse
import json
import os
import pathlib
import re
import sys
import psycopg

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,required=True)
parser.add_argument('--pgtap-source',required=True)
parser.add_argument('--pgtap-version',required=True)
args=parser.parse_args()
source=pathlib.Path(__file__).resolve().parent.parent
os.environ['PGCLIENTENCODING']='UTF8'
connection=psycopg.connect(host='127.0.0.1',port=args.port,user='postgres',dbname='postgres',autocommit=True)
def sql(text):
    output=[]
    with connection.cursor() as cursor:
        cursor.execute(text)
        while True:
            if cursor.description:
                output.extend(str(row[0]) for row in cursor.fetchall() if row[0] is not None)
            if not cursor.nextset(): break
    return '\n'.join(output)
if sql("select count(*) from information_schema.tables where table_schema in ('auth','public') and table_name in ('users','profiles','anniversaries','tool_documents');").strip()!='0':
    sys.exit('Refusing bootstrap: this is not an empty database.')
sql("""
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
grant usage on schema auth to anon,authenticated;
create function auth.uid() returns uuid language sql stable as $$
select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create schema extensions;
grant usage on schema extensions to anon,authenticated;
""")
tap=pathlib.Path(args.pgtap_source).read_text(encoding='utf-8')
tap=tap.replace('__VERSION__',args.pgtap_version).replace('__OS__',os.name)
sql('set search_path=extensions,public;\n'+tap)
for file in sorted((source/'sql').glob('*.sql')):
    sql(file.read_text(encoding='utf-8'))
    print(f'APPLIED: {file.name}',flush=True)
output=sql((source/'tests/permissions.test.sql').read_text(encoding='utf-8'))
print(output)
assert not re.search(r'^not ok\b',output,re.M),'pgTAP assertion failed'
plan=re.search(r'^1\.\.(\d+)\s*$',output,re.M)
passed=len(re.findall(r'^ok \d+\b',output,re.M))
assert plan and int(plan.group(1))==passed,'pgTAP plan or assertion count mismatch'
print(json.dumps({'pgtap_passed':passed,'environment':'PostgreSQL with minimal Auth fixture; not full Supabase'}))
