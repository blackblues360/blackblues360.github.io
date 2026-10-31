-- Phase C: retain used IDs while removing permanently deleted document bodies.
begin;
alter table public.tool_documents add column purged_at timestamptz;
alter table public.tool_documents drop constraint document_shape;
alter table public.tool_documents add constraint document_shape check (
  (purged_at is null and public.document_shape_valid(app_id,schema_version,content))
  or (purged_at is not null and deleted_at is not null and title='[permanently deleted]' and content='{}'::jsonb)
);
revoke insert(user_id) on public.tool_documents from authenticated;

create function public.list_deleted_tool_documents()
returns table(id uuid,app_id text,title text,revision bigint,deleted_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  return query select d.id,d.app_id,d.title,d.revision,d.deleted_at,d.updated_at from public.tool_documents d
    where d.user_id=auth.uid() and d.deleted_at is not null and d.purged_at is null order by d.deleted_at desc,d.id;
end;
$$;
create function public.restore_tool_document(p_id uuid,p_expected_revision bigint)
returns setof public.tool_documents language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid revision' using errcode='22023';end if;
  return query update public.tool_documents d set deleted_at=null,revision=d.revision+1
    where d.id=p_id and d.user_id=auth.uid() and d.deleted_at is not null and d.purged_at is null and d.revision=p_expected_revision returning d.*;
end;
$$;
create function public.purge_tool_document(p_id uuid,p_expected_revision bigint)
returns setof uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid revision' using errcode='22023';end if;
  return query update public.tool_documents d set title='[permanently deleted]',content='{}'::jsonb,purged_at=clock_timestamp(),revision=d.revision+1
    where d.id=p_id and d.user_id=auth.uid() and d.deleted_at is not null and d.purged_at is null and d.revision=p_expected_revision returning d.id;
end;
$$;
revoke all on function public.list_deleted_tool_documents() from public,anon,authenticated;
revoke all on function public.restore_tool_document(uuid,bigint) from public,anon,authenticated;
revoke all on function public.purge_tool_document(uuid,bigint) from public,anon,authenticated;
grant execute on function public.list_deleted_tool_documents() to authenticated;
grant execute on function public.restore_tool_document(uuid,bigint) to authenticated;
grant execute on function public.purge_tool_document(uuid,bigint) to authenticated;
-- Existing quotas count retained IDs, including purged records. Purging returns
-- content bytes but does not open an unbounded stream of unmetered tombstones.
commit;
