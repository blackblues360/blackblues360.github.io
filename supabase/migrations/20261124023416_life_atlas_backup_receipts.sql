begin;
create table public.life_atlas_backup_receipts (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null,
 local_revision bigint not null,
 checksum text not null,
 saved_at timestamptz not null default clock_timestamp()
);
alter table public.life_atlas_backup_receipts enable row level security;
revoke all on public.life_atlas_backup_receipts from public,anon,authenticated;
insert into public.life_atlas_backup_receipts(id,user_id,device_id,local_revision,checksum) select id,user_id,device_id,local_revision,checksum from public.life_atlas_backups;
create or replace function public.save_life_atlas_backup(p_id uuid,p_device_id uuid,p_revision bigint,p_payload text,p_checksum text)
returns uuid language plpgsql security definer set search_path='' as $$
declare who uuid := auth.uid(); body jsonb; existing public.life_atlas_backups; captured timestamptz; receipt public.life_atlas_backup_receipts;
begin
  if who is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_device_id is null or p_revision is null or p_revision<0 or p_payload is null or octet_length(p_payload)>5242880 or p_checksum is null or p_checksum<>encode(sha256(convert_to(p_payload,'UTF8')),'hex') then
    raise exception 'Invalid backup or checksum' using errcode='23514';
  end if;
  body := p_payload::jsonb;
  captured := (body->>'createdAt')::timestamptz;
  if captured is null or captured>clock_timestamp()+interval '5 minutes' then raise exception 'Invalid snapshot time' using errcode='23514'; end if;
  if body->>'format' is distinct from 'life-atlas-cloud-backup' or body->>'owner' is distinct from who::text or body->>'deviceId' is distinct from p_device_id::text or body->'data'->>'revision' is distinct from p_revision::text or body->'data'->>'version' is distinct from '1' or jsonb_typeof(body->'data'->'entities') is distinct from 'array' or jsonb_typeof(body->'data'->'events') is distinct from 'array' then
    raise exception 'Invalid backup envelope' using errcode='23514';
  end if;
  if exists(select 1 from unnest(array['lifecycles','relations','plans','audit']) as k where jsonb_typeof(body->'data'->k) is distinct from 'array') then raise exception 'Incomplete snapshot' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(who::text,0));
  select * into receipt from public.life_atlas_backup_receipts where id=p_id;
  if found then
    if receipt.user_id<>who or receipt.device_id<>p_device_id or receipt.local_revision<>p_revision or receipt.checksum<>p_checksum then raise exception 'Backup identity conflict' using errcode='23505'; end if;
    if not exists(select 1 from public.life_atlas_backups where id=p_id and user_id=who) then raise exception 'Expired backup request' using errcode='22023'; end if;
  end if;
  select * into existing from public.life_atlas_backups where id=p_id;
  if found then
    if existing.user_id<>who or existing.device_id<>p_device_id or existing.local_revision<>p_revision or existing.checksum<>p_checksum or existing.payload<>p_payload then raise exception 'Backup identity conflict' using errcode='23505'; end if;
    return p_id;
  end if;
  if (select count(*) from public.life_atlas_backups where user_id=who)>=20 and captured<(select min(created_at) from public.life_atlas_backups where user_id=who) then raise exception 'Expired backup request' using errcode='22023'; end if;
  if exists(select 1 from public.life_atlas_backups where user_id=who and created_at>clock_timestamp()-interval '5 seconds') then raise exception 'Backup rate limit; retry later' using errcode='54000'; end if;
  insert into public.life_atlas_backup_receipts(id,user_id,device_id,local_revision,checksum) values(p_id,who,p_device_id,p_revision,p_checksum);
  insert into public.life_atlas_backups(id,user_id,device_id,local_revision,payload,checksum) values(p_id,who,p_device_id,p_revision,p_payload,p_checksum);
  delete from public.life_atlas_backups where user_id=who and id in (select id from public.life_atlas_backups where user_id=who order by created_at desc,id desc offset 20);
  return p_id;
end;
$$;
commit;
