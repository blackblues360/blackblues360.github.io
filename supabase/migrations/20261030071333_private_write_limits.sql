-- Proposed invite-beta limits; local validation first, cloud deployment needs review.
begin;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.write_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  writes integer not null check(writes>0)
);
alter table private.write_limits enable row level security;
revoke all on private.write_limits from public,anon,authenticated;

create function private.check_write_limits() returns trigger
language plpgsql security definer set search_path='' as $$
declare doc_count bigint; total_bytes bigint; old_bytes bigint:=0; new_bytes bigint:=0; used integer;
begin
  if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'owner mismatch' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.user_id<>new.user_id then raise exception 'owner immutable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,197));
  if tg_table_name='tool_documents' then
    select count(*),coalesce(sum(octet_length(content::text)),0) into doc_count,total_bytes from public.tool_documents where user_id=new.user_id;
    new_bytes:=octet_length(new.content::text);
    if tg_op='UPDATE' then old_bytes:=octet_length(old.content::text); end if;
    if (tg_op='INSERT' and doc_count>=1000) or (new_bytes>old_bytes and total_bytes-old_bytes+new_bytes>104857600) then
      raise exception 'user_storage_limit' using errcode='54000';
    end if;
  elsif tg_op='INSERT' then
    select count(*) into doc_count from public.anniversaries where user_id=new.user_id;
    if doc_count>=1000 then raise exception 'user_record_limit' using errcode='54000'; end if;
  end if;
  -- Privileged fixture/restore writes have no end-user claim; ordinary API writes do.
  if auth.uid() is not null then
    insert into private.write_limits(user_id,window_start,writes) values(new.user_id,date_trunc('minute',clock_timestamp()),1)
    on conflict(user_id) do update set
      writes=case when private.write_limits.window_start=excluded.window_start then private.write_limits.writes+1 else 1 end,
      window_start=excluded.window_start returning writes into used;
    if used>120 then raise exception 'write_rate_limited' using errcode='54000'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.check_write_limits() from public,anon,authenticated;
create trigger documents_limits before insert or update on public.tool_documents for each row execute function private.check_write_limits();
create trigger anniversaries_limits before insert or update on public.anniversaries for each row execute function private.check_write_limits();
commit;
