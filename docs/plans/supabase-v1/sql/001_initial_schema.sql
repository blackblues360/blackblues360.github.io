-- REVIEW CANDIDATE. Validated locally in stage A; never deployed to a cloud database.
-- Run 001 -> 002 -> 003 in that order after review. No IF NOT EXISTS masking drift.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.anniversaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200 and title ~ '[^[:space:]]'),
  event_date date not null check (event_date between date '0001-01-01' and date '9999-12-31'),
  repeat_annually boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tool_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app_id text not null check (app_id in ('plate-layout', 'sop-timeline')),
  title text not null check (char_length(title) between 1 and 1000 and title ~ '[^[:space:]]'),
  content jsonb not null,
  schema_version integer not null check (schema_version = 1),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_size check (octet_length(content::text) <= 5000000)
);
alter table public.profiles enable row level security;
alter table public.anniversaries enable row level security;
alter table public.tool_documents enable row level security;
revoke all on public.profiles, public.anniversaries, public.tool_documents from public, anon, authenticated;

create function public.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger anniversaries_touch before update on public.anniversaries for each row execute function public.touch_updated_at();
create trigger documents_touch before update on public.tool_documents for each row execute function public.touch_updated_at();
commit;
