-- Rollback-only synthetic cloud smoke test; separate from the pgTAP test directory.
begin;
select set_config('request.jwt.claims','{}',true);
insert into auth.users(id) values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.profiles(id,display_name) values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A'),('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B');
insert into public.anniversaries(id,user_id,title,event_date) values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A','2024-02-29'),('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B','2024-02-29');
insert into public.tool_documents(id,user_id,app_id,title,content,schema_version)
select id,id,'plate-layout','fixture','{"version":1,"plate":{"type":"6","title":""},"labels":[],"wells":{},"ui":{}}',1
from auth.users where id in ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
do $$begin
  if (select count(*) from public.anniversaries)<>1 or (select count(*) from public.profiles)<>1 or (select count(*) from public.tool_documents)<>1 then raise exception 'owner read isolation failed'; end if;
  begin update public.anniversaries set title='bypass';raise exception 'direct anniversary update allowed';exception when insufficient_privilege then null;end;
  begin update public.tool_documents set revision=99;raise exception 'direct document revision update allowed';exception when insufficient_privilege then null;end;
  begin delete from public.anniversaries;raise exception 'direct anniversary deletion allowed';exception when insufficient_privilege then null;end;
  begin insert into public.anniversaries(user_id,title,event_date) values ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','forged','2026-01-01');raise exception 'forged owner allowed';exception when insufficient_privilege then null;end;
  if (select count(*) from public.save_anniversary('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'forged','2026-01-01',false,''))<>0 then raise exception 'cross-owner RPC allowed';end if;
  if (select count(*) from public.delete_anniversary('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1))<>0 then raise exception 'cross-owner deletion allowed';end if;
  if (select revision from public.save_anniversary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'winner','2024-02-29',true,''))<>2 then raise exception 'CAS save failed';end if;
  if (select count(*) from public.save_anniversary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'stale','2026-01-01',false,''))<>0 then raise exception 'stale revision allowed';end if;
  if (select count(*) from public.delete_anniversary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2))<>1 then raise exception 'CAS delete failed';end if;
  if (select count(*) from public.save_anniversary('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',3,'revive','2026-01-01',false,''))<>0 then raise exception 'deleted record revived';end if;
  if (select count(*) from public.save_tool_document('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'forged','{}',1))<>0 then raise exception 'document RPC bypassed ownership';end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$begin
  begin perform * from public.anniversaries;raise exception 'anonymous read allowed';exception when insufficient_privilege then null;end;
  begin perform public.delete_anniversary('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1);raise exception 'anonymous RPC allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','anniversaries','tool_documents') and c.relrowsecurity)<>3 then raise exception 'RLS missing';end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_anniversary','delete_anniversary','save_tool_document','delete_tool_document') and (not p.prosecdef or pg_get_userbyid(p.proowner)<>'postgres' or not coalesce('search_path=""'=any(p.proconfig),false) or has_function_privilege('anon',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute'))) then raise exception 'function owner/config/execute ACL mismatch';end if;
  if exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('anniversaries','tool_documents') and a.attnum>0 and not a.attisdropped and has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')) then raise exception 'direct column UPDATE grant survived';end if;
end $$;
rollback;
select 'phase_b_cloud_smoke_completed' as result;
