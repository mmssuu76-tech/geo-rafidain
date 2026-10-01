-- GeoRafidain researcher cloud workspaces
-- Apply once in the Supabase SQL Editor after the base schema.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.research_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  summary text check (summary is null or char_length(summary) <= 1200),
  study_area text check (study_area is null or char_length(study_area) <= 240),
  stage text not null default 'planning'
    check (stage in ('idea', 'planning', 'data_collection', 'analysis', 'writing', 'review', 'completed')),
  workspace_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(workspace_data) = 'object' and octet_length(workspace_data::text) <= 1000000),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_projects_user_updated_idx
  on public.research_projects (user_id, updated_at desc);
create index if not exists research_projects_user_stage_idx
  on public.research_projects (user_id, stage);

create or replace function private.touch_research_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

revoke all on function private.touch_research_project()
  from public, anon, authenticated, service_role;

drop trigger if exists research_projects_updated_at on public.research_projects;
create trigger research_projects_updated_at
  before update on public.research_projects
  for each row execute procedure private.touch_research_project();

alter table public.research_projects enable row level security;

drop policy if exists research_projects_read_own on public.research_projects;
create policy research_projects_read_own
  on public.research_projects for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists research_projects_insert_own on public.research_projects;
create policy research_projects_insert_own
  on public.research_projects for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists research_projects_update_own on public.research_projects;
create policy research_projects_update_own
  on public.research_projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists research_projects_delete_own on public.research_projects;
create policy research_projects_delete_own
  on public.research_projects for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.research_projects from anon;
grant select, insert, update, delete on public.research_projects to authenticated;

comment on table public.research_projects is
  'Private per-user research workspace snapshots protected by row-level security.';

commit;

select
  to_regclass('public.research_projects') is not null as research_projects_ready,
  (select relrowsecurity from pg_class where oid = 'public.research_projects'::regclass) as rls_enabled;
