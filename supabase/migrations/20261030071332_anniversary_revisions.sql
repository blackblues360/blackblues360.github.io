-- Phase B: preserve existing records; all writes/deletes use atomic expected revisions.
begin;
alter table public.anniversaries add column revision bigint not null default 1 check (revision > 0);
alter table public.anniversaries add column deleted_at timestamptz;
revoke update,delete on public.anniversaries from authenticated;
revoke update(title,event_date,repeat_annually,notes) on public.anniversaries from authenticated;
drop policy anniversaries_select on public.anniversaries;
create policy anniversaries_select on public.anniversaries for select to authenticated
  using ((select auth.uid())=user_id and deleted_at is null);

create function public.save_anniversary(p_id uuid,p_expected_revision bigint,p_title text,p_event_date date,p_repeat_annually boolean,p_notes text)
returns setof public.anniversaries language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid revision' using errcode='22023'; end if;
  return query update public.anniversaries a set title=p_title,event_date=p_event_date,repeat_annually=p_repeat_annually,notes=p_notes,revision=a.revision+1
    where a.id=p_id and a.user_id=auth.uid() and a.revision=p_expected_revision and a.deleted_at is null returning a.*;
end;
$$;
create function public.delete_anniversary(p_id uuid,p_expected_revision bigint)
returns setof uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid revision' using errcode='22023'; end if;
  return query update public.anniversaries a set deleted_at=clock_timestamp(),revision=a.revision+1
    where a.id=p_id and a.user_id=auth.uid() and a.revision=p_expected_revision and a.deleted_at is null returning a.id;
end;
$$;
revoke all on function public.save_anniversary(uuid,bigint,text,date,boolean,text) from public,anon,authenticated;
revoke all on function public.delete_anniversary(uuid,bigint) from public,anon,authenticated;
grant execute on function public.save_anniversary(uuid,bigint,text,date,boolean,text) to authenticated;
grant execute on function public.delete_anniversary(uuid,bigint) to authenticated;
commit;
