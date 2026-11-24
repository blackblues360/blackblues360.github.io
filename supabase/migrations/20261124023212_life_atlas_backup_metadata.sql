begin;
create view public.life_atlas_backup_versions with (security_invoker=true) as
select id,user_id,device_id,local_revision,checksum,created_at,
       payload::jsonb->>'createdAt' as captured_at
from public.life_atlas_backups;
revoke all on public.life_atlas_backup_versions from public,anon,authenticated;
grant select on public.life_atlas_backup_versions to authenticated;
commit;
