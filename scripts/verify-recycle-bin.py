"""Production RPC checks with synthetic rows; entire transaction rolls back."""
import json,pathlib,urllib.request
token=(pathlib.Path.home()/'.supabase/access-token').read_text().strip()
query="""
begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n int;c jsonb:='{"version":1,"plate":{"type":"6","title":"synthetic"},"labels":[],"wells":{},"ui":{}}';
begin
insert into auth.users(id) values(a),(b);
perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
set local role authenticated;
insert into public.tool_documents(id,app_id,title,content,schema_version) values(d,'plate-layout','synthetic',c,1);
assert (select user_id=a from public.tool_documents where id=d),'default owner';
select count(*) into n from public.save_tool_document(d,1,'saved',c,1);assert n=1;
select count(*) into n from public.save_tool_document(d,1,'stale',c,1);assert n=0;
select count(*) into n from public.delete_tool_document(d,2);assert n=1;
select count(*) into n from public.list_deleted_tool_documents();assert n=1;
perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
select count(*) into n from public.list_deleted_tool_documents();assert n=0;
select count(*) into n from public.restore_tool_document(d,3);assert n=0;
select count(*) into n from public.purge_tool_document(d,3);assert n=0;
perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
select count(*) into n from public.restore_tool_document(d,3);assert n=1;
select count(*) into n from public.delete_tool_document(d,4);assert n=1;
select count(*) into n from public.purge_tool_document(d,5);assert n=1;
select count(*) into n from public.restore_tool_document(d,6);assert n=0;
begin
insert into public.tool_documents(id,app_id,title,content,schema_version) values(d,'plate-layout','late',c,1);
raise exception 'old ID resurrected';
exception when unique_violation then null;end;
reset role;
assert (select content='{}'::jsonb and purged_at is not null from public.tool_documents where id=d);
set local role anon;
begin perform public.list_deleted_tool_documents();raise exception 'anon execution allowed';exception when insufficient_privilege then null;end;
reset role;
end $$;
rollback;
select 'recycle_bin_rollback_passed' as result;
"""
request=urllib.request.Request('https://api.supabase.com/v1/projects/orjmbavlxuuccxdphepi/database/query',data=json.dumps({'query':query,'read_only':False}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=45) as response:result=json.load(response)
assert 'recycle_bin_rollback_passed' in json.dumps(result)
print(json.dumps({'passed':True,'environment':'production','transaction':'rolled back','checks':['default owner','CAS','trash','cross-account restore/purge denial','restore','purge','old ID','anon denial']}))
