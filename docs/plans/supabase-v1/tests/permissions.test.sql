-- pgTAP in an isolated local Supabase instance, never production. Stage A: 69 assertions passed.
-- Administrator is used ONLY for fixtures, role switching, account deletion and its cleanup verification.
-- All application assertions execute as anon/authenticated with RLS enabled.
begin;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
-- Shape-valid ASCII content for the JSONB-text storage boundary, not a tool import fixture.
create temporary table document_size_cases(name text,content jsonb);
with base as (select '{"version":1,"name":"size","author":"","date":"2026-10-30","revision":"v1.0","groups":[],"blocks":[],"notes":[],"layout":{},"padding":""}'::jsonb c)
insert into document_size_cases
select 'boundary',jsonb_set(c,'{padding}',to_jsonb(repeat('x',5000000-octet_length(c::text)))) from base;
insert into document_size_cases select 'oversize',jsonb_set(content,'{padding}',to_jsonb((content->>'padding')||'x')) from document_size_cases where name='boundary';
grant select on document_size_cases to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
insert into public.profiles(id,display_name) values (auth.uid(),'B');
insert into public.anniversaries(id,title,event_date) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B',date '2024-02-29');
insert into public.tool_documents(id,app_id,title,content,schema_version) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','plate-layout','B','{"version":1,"plate":{"type":"6","title":""},"wells":{"A1":null,"A2":null,"A3":null,"B1":null,"B2":null,"B3":null},"labels":[],"ui":{}}',1);

reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
select throws_ok('select * from public.profiles','42501',null,'anonymous profiles blocked');
select throws_ok('select * from public.anniversaries','42501',null,'anonymous anniversaries blocked');
select throws_ok('select * from public.tool_documents','42501',null,'anonymous documents blocked');
select throws_ok($$select public.delete_tool_document('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1)$$,'42501',null,'anonymous RPC blocked');
select throws_ok($$select public.save_tool_document('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'x','{}',1)$$,'42501',null,'anonymous save RPC blocked');

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((select count(*)::int from public.profiles),0,'A cannot read B profile');
select is((select count(*)::int from public.anniversaries),0,'A cannot read B dates');
select is((select count(*)::int from public.tool_documents),0,'A cannot read B documents');
with x as (update public.profiles set display_name='attack' where id='22222222-2222-4222-8222-222222222222' returning id)
select is((select count(*)::int from x),0,'cross profile update zero');
with x as (delete from public.profiles where id='22222222-2222-4222-8222-222222222222' returning id)
select is((select count(*)::int from x),0,'cross profile delete zero');
with x as (update public.anniversaries set title='attack' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id)
select is((select count(*)::int from x),0,'cross date update zero');
with x as (delete from public.anniversaries where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id)
select is((select count(*)::int from x),0,'cross date delete zero');
select is((select count(*)::int from public.save_tool_document('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'attack','{}',1)),0,'cross document RPC save zero');
select is((select count(*)::int from public.delete_tool_document('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1)),0,'cross document RPC delete zero');
select throws_ok($$insert into public.profiles(id) values ('22222222-2222-4222-8222-222222222222')$$,'42501',null,'forged profile rejected');
select throws_ok($$insert into public.anniversaries(user_id,title,event_date) values ('22222222-2222-4222-8222-222222222222','forged','2026-01-01')$$,'42501',null,'forged date owner rejected');
select throws_ok($$insert into public.tool_documents(user_id,app_id,title,content,schema_version) select '22222222-2222-4222-8222-222222222222','plate-layout','forged','{"version":1,"plate":{"type":"6","title":""},"wells":{},"labels":[],"ui":{}}',1$$,'42501',null,'forged document owner rejected');

insert into public.profiles(id,display_name) values(auth.uid(),'A');
insert into public.anniversaries(id,title,event_date) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A','2024-02-29');
insert into public.tool_documents(id,app_id,title,content,schema_version) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sop-timeline','A','{"version":1,"name":"A","author":"","date":"2026-10-29","revision":"v1.0","groups":[],"blocks":[],"notes":[],"layout":{}}',1);
select is((select count(*)::int from public.profiles),1,'A reads own profile');
select is((select count(*)::int from public.anniversaries),1,'A reads own dates');
select is((select count(*)::int from public.tool_documents),1,'A reads own documents');
select lives_ok($$update public.profiles set display_name='A2' where id=auth.uid()$$,'own profile update');
select lives_ok($$update public.anniversaries set notes='A2' where user_id=auth.uid()$$,'own date update');
select throws_ok($$update public.profiles set id='22222222-2222-4222-8222-222222222222' where id=auth.uid()$$,'42501',null,'profile identity immutable');
select throws_ok($$update public.anniversaries set user_id='22222222-2222-4222-8222-222222222222' where user_id=auth.uid()$$,'42501',null,'date owner immutable');
select throws_ok($$update public.tool_documents set user_id='22222222-2222-4222-8222-222222222222' where user_id=auth.uid()$$,'42501',null,'document owner immutable');
select throws_ok($$update public.tool_documents set title='bypass' where user_id=auth.uid()$$,'42501',null,'direct save bypass blocked');
select throws_ok($$delete from public.tool_documents where user_id=auth.uid()$$,'42501',null,'direct delete bypass blocked');
select throws_ok($$insert into public.anniversaries(title,event_date) values (' ','2026-01-01')$$,'23514',null,'blank title rejected');
select throws_ok($$insert into public.anniversaries(title,event_date) values (chr(9)||chr(10),'2026-01-01')$$,'23514',null,'whitespace title rejected');
select throws_ok($$insert into public.anniversaries(title,event_date) values (repeat(' ',201)||'x','2026-01-01')$$,'23514',null,'actual title length bounded');
select throws_ok($$insert into public.anniversaries(title,event_date) values ('bad','2025-02-29')$$,'22008',null,'invalid leap date rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) values ('unknown','x','{}',1)$$,'23514',null,'illegal app rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) values ('plate-layout','x','{}',1)$$,'23514',null,'bad document shape rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) values ('sop-timeline','x','[]',1)$$,'23514',null,'array document rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) values ('sop-timeline','x','{"version":2}',2)$$,'23514',null,'future schema rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version,revision) values ('plate-layout','x','{}',1,99)$$,'42501',null,'client revision injection rejected');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version,deleted_at) values ('plate-layout','x','{}',1,now())$$,'42501',null,'client deleted_at injection rejected');
select throws_ok($$select public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'x','{}',1)$$,'22023',null,'null save revision rejected');
select throws_ok($$select public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'x','{}',1)$$,'22023',null,'zero save revision rejected');
select throws_ok($$select public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',-1,'x','{}',1)$$,'22023',null,'negative save revision rejected');
select throws_ok($$select public.delete_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null)$$,'22023',null,'null delete revision rejected');
select throws_ok($$select public.delete_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0)$$,'22023',null,'zero delete revision rejected');
select throws_ok($$select public.delete_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',-1)$$,'22023',null,'negative delete revision rejected');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'x','{}',1)$$,'42501',null,'save without identity rejected');
select throws_ok($$select public.delete_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1)$$,'42501',null,'delete without identity rejected');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((select octet_length(content::text) from document_size_cases where name='boundary'),5000000,'fixture is exactly 5MB JSONB text');
select lives_ok($$insert into public.tool_documents(id,app_id,title,content,schema_version) select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','sop-timeline','boundary',content,1 from document_size_cases where name='boundary'$$,'5MB content accepted');
select throws_ok($$insert into public.tool_documents(app_id,title,content,schema_version) select 'sop-timeline','oversize',content,1 from document_size_cases where name='oversize'$$,'23514',null,'5MB plus one byte rejected');
select throws_ok($$select public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'oversize',(select content from document_size_cases where name='oversize'),1)$$,'23514',null,'RPC update enforces storage limit');
select is((select revision::int from public.tool_documents where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),1,'failed oversize write leaves revision unchanged');
select is((select count(*)::int from public.delete_tool_document('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1)),1,'remove size fixture from visible documents');
select throws_ok($$select public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'bad','{}',1)$$,'23514',null,'RPC enforces shape');
select is((select revision::int from public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'saved',(select content from public.tool_documents where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),1)),2,'CAS succeeds and increments');
select is((select count(*)::int from public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'stale','{}',1)),0,'stale save zero');
select is((select title from public.tool_documents where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'saved','conflict leaves content metadata intact');
select is((select count(*)::int from public.delete_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1)),0,'stale delete zero');
select is((select count(*)::int from public.delete_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2)),1,'own current delete succeeds');
select is((select count(*)::int from public.tool_documents),0,'soft deleted document invisible');
select is((select count(*)::int from public.save_tool_document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',3,'revive','{}',1)),0,'deleted document cannot be saved');
select throws_ok($$insert into public.tool_documents(id,app_id,title,content,schema_version) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','plate-layout','retry','{"version":1,"plate":{"type":"6","title":""},"wells":{},"labels":[],"ui":{}}',1)$$,'23505',null,'deleted id cannot be reinserted');
with x as (delete from public.anniversaries where user_id=auth.uid() returning id)
select is((select count(*)::int from x),1,'own date delete');
with x as (delete from public.profiles where id=auth.uid() returning id)
select is((select count(*)::int from x),1,'own profile delete');

-- Assert B data survived all cross-account operations, with B's ordinary role.
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select display_name from public.profiles),'B','B profile intact');
select is((select title from public.anniversaries),'B','B date intact');
select is((select revision::int from public.tool_documents),1,'B document intact');
-- Trusted administrative account deletion only; not a user-facing client path.
reset role;
delete from auth.users where id='22222222-2222-4222-8222-222222222222';
delete from auth.users where id='11111111-1111-4111-8111-111111111111';
-- Fixture cleanup verification must inspect physical rows: RLS would hide soft-deleted rows anyway.
select is((select count(*)::int from public.tool_documents where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),0,'soft-deleted fixture physically cascades');
set local role authenticated;
select is((select count(*)::int from public.profiles),0,'profile cascades');
select is((select count(*)::int from public.anniversaries),0,'dates cascade');
select is((select count(*)::int from public.tool_documents),0,'documents cascade');
reset role;
select * from finish();
rollback;
