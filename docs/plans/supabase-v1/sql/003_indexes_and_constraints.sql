-- REVIEW CANDIDATE. Locally validated. Depends on 001 and 002. Coarse format guard, NOT full JS semantic validation.
begin;
create function public.document_shape_valid(app text, v integer, c jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(c) is distinct from 'object' or v is distinct from 1
     or c->'version' is distinct from '1'::jsonb then return false; end if;
  if app = 'plate-layout' then
    return coalesce(jsonb_typeof(c->'plate') = 'object'
      and c->'plate'->>'type' in ('6','12','24','96')
      and jsonb_typeof(c->'plate'->'title') = 'string'
      and jsonb_typeof(c->'wells') = 'object'
      and jsonb_typeof(c->'labels') = 'array'
      and jsonb_typeof(c->'ui') = 'object'
      and jsonb_array_length(c->'labels') <= 96, false);
  elsif app = 'sop-timeline' then
    return coalesce(jsonb_typeof(c->'groups') = 'array' and jsonb_array_length(c->'groups') <= 200
      and jsonb_typeof(c->'blocks') = 'array' and jsonb_array_length(c->'blocks') <= 1000
      and jsonb_typeof(c->'notes') = 'array' and jsonb_array_length(c->'notes') <= 1000
      and jsonb_typeof(c->'layout') = 'object'
      and jsonb_typeof(c->'name') = 'string' and jsonb_typeof(c->'author') = 'string'
      and jsonb_typeof(c->'date') = 'string' and jsonb_typeof(c->'revision') = 'string', false);
  end if;
  return false;
exception when invalid_parameter_value then return false;
end;
$$;
revoke all on function public.document_shape_valid(text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.document_shape_valid(text,integer,jsonb) to authenticated;
alter table public.tool_documents add constraint document_shape check (public.document_shape_valid(app_id,schema_version,content));
create index anniversaries_owner_date on public.anniversaries(user_id,event_date,id);
create index documents_owner_app_updated on public.tool_documents(user_id,app_id,updated_at desc,id);
-- These left prefixes also support owner RLS/FK cascade lookups. profiles already has its PK.

create function public.save_tool_document(p_id uuid, p_expected_revision bigint, p_title text, p_content jsonb, p_schema_version integer)
returns setof public.tool_documents
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'invalid revision' using errcode = '22023'; end if;
  return query update public.tool_documents d
    set title = p_title, content = p_content, schema_version = p_schema_version, revision = d.revision + 1
    where d.id = p_id and d.user_id = auth.uid() and d.revision = p_expected_revision and d.deleted_at is null
    returning d.*;
end;
$$;
create function public.delete_tool_document(p_id uuid, p_expected_revision bigint)
returns setof uuid
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'invalid revision' using errcode = '22023'; end if;
  -- Retain the primary key so a delayed INSERT retry cannot resurrect a deleted ID.
  return query update public.tool_documents d set deleted_at = clock_timestamp(), revision = d.revision + 1
    where d.id = p_id and d.user_id = auth.uid() and d.revision = p_expected_revision and d.deleted_at is null returning d.id;
end;
$$;
revoke all on function public.save_tool_document(uuid,bigint,text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.delete_tool_document(uuid,bigint) from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, delete on public.profiles, public.anniversaries to authenticated;
grant insert(id,display_name), update(display_name) on public.profiles to authenticated;
grant insert(id,user_id,title,event_date,repeat_annually,notes), update(title,event_date,repeat_annually,notes) on public.anniversaries to authenticated;
grant select on public.tool_documents to authenticated;
grant insert(id,user_id,app_id,title,content,schema_version) on public.tool_documents to authenticated;
grant execute on function public.save_tool_document(uuid,bigint,text,jsonb,integer) to authenticated;
grant execute on function public.delete_tool_document(uuid,bigint) to authenticated;
commit;
