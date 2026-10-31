begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id) values ('43333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
-- No end-user claim while creating bounded synthetic fixtures.
select set_config('request.jwt.claims','{}',true);
insert into public.anniversaries(user_id,title,event_date)
select '43333333-3333-4333-8333-333333333333','fixture-'||n,date '2026-01-01' from generate_series(1,1000) n;
insert into public.tool_documents(user_id,app_id,title,content,schema_version)
select '43333333-3333-4333-8333-333333333333','plate-layout','fixture-'||n,
 '{"version":1,"plate":{"type":"6","title":""},"labels":[],"wells":{},"ui":{}}',1 from generate_series(1,1000) n;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"43333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
select is((select count(*)::int from public.anniversaries),1000,'1000 records are accepted');
select throws_ok($$insert into public.anniversaries(title,event_date) values ('over count','2026-01-01')$$,'54000',null,'1001st anniversary rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) values ('plate-layout','over count','{"version":1,"plate":{"type":"6","title":""},"labels":[],"wells":{},"ui":{}}',1)$$,'54000',null,'1001st document rejected');
select is((select count(*)::int from public.delete_anniversary((select id from public.anniversaries limit 1),1)),1,'deletion still works at count cap');
select throws_ok($$insert into public.anniversaries(title,event_date) values ('soft deletion does not remove count','2026-01-01')$$,'54000',null,'soft deleted records retain quota usage');
reset role;
select set_config('request.jwt.claims','{}',true);
with base as (select '{"version":1,"plate":{"type":"6","title":""},"labels":[],"wells":{},"ui":{},"padding":""}'::jsonb c)
insert into public.tool_documents(user_id,app_id,title,content,schema_version)
select '44444444-4444-4444-8444-444444444444','plate-layout','size-'||n,
 jsonb_set(c,'{padding}',to_jsonb(repeat('x',(case when n<=20 then 5000000 else 4857600 end)-octet_length(c::text)))),1
from base,generate_series(1,21) n;
select is((select sum(octet_length(content::text))::bigint from public.tool_documents where user_id='44444444-4444-4444-8444-444444444444'),104857600::bigint,'exactly 100 MiB accepted');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) values ('plate-layout','over bytes','{"version":1,"plate":{"type":"6","title":""},"labels":[],"wells":{},"ui":{}}',1)$$,'54000',null,'additional bytes beyond 100 MiB rejected');
reset role;
select * from finish();
rollback;
