begin;

create table public.plate_label_libraries (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  content jsonb not null check (
    octet_length(content::text) <= 524288
    and case when jsonb_typeof(content->'groups') = 'array' then jsonb_array_length(content->'groups') <= 40 else false end
    and case when jsonb_typeof(content->'labels') = 'array' then jsonb_array_length(content->'labels') <= 500 else false end
  )
);

alter table public.plate_label_libraries enable row level security;
revoke all on public.plate_label_libraries from public, anon, authenticated;
grant select, insert, update on public.plate_label_libraries to authenticated;
grant select on public.plate_label_libraries to service_role;

create policy plate_library_select on public.plate_label_libraries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy plate_library_insert on public.plate_label_libraries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy plate_library_update on public.plate_label_libraries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

commit;
