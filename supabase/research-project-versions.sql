-- GeoRafidain immutable research-project version history
-- Apply after supabase/research-workspaces.sql.

begin;

create table if not exists public.research_project_versions (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null check (char_length(title) between 3 and 160),
  summary text check (summary is null or char_length(summary) <= 1200),
  study_area text check (study_area is null or char_length(study_area) <= 240),
  stage text not null
    check (stage in ('idea', 'planning', 'data_collection', 'analysis', 'writing', 'review', 'completed')),
  workspace_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(workspace_data) = 'object' and octet_length(workspace_data::text) <= 1000000),
  saved_at timestamptz not null default now(),
  unique (project_id, version)
);

create index if not exists research_project_versions_project_idx
  on public.research_project_versions (project_id, version desc);
create index if not exists research_project_versions_user_saved_idx
  on public.research_project_versions (user_id, saved_at desc);

alter table public.research_project_versions enable row level security;

drop policy if exists research_project_versions_read_own on public.research_project_versions;
create policy research_project_versions_read_own
  on public.research_project_versions for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.research_project_versions from public, anon, authenticated;
grant select on public.research_project_versions to authenticated;

create or replace function private.capture_research_project_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.research_project_versions
    (project_id, user_id, version, title, summary, study_area, stage, workspace_data, saved_at)
  values
    (new.id, new.user_id, new.version, new.title, new.summary, new.study_area, new.stage, new.workspace_data, new.updated_at)
  on conflict (project_id, version) do nothing;
  return new;
end;
$$;

revoke all on function private.capture_research_project_version()
  from public, anon, authenticated, service_role;

drop trigger if exists research_projects_capture_version on public.research_projects;
create trigger research_projects_capture_version
  after insert or update on public.research_projects
  for each row execute procedure private.capture_research_project_version();

-- Preserve the current state of projects that existed before version history was enabled.
insert into public.research_project_versions
  (project_id, user_id, version, title, summary, study_area, stage, workspace_data, saved_at)
select
  id, user_id, version, title, summary, study_area, stage, workspace_data, updated_at
from public.research_projects
on conflict (project_id, version) do nothing;

create or replace function public.restore_research_project_version(
  p_project_id uuid,
  p_version integer,
  p_expected_version integer
)
returns public.research_projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.research_project_versions;
  restored public.research_projects;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into saved
  from public.research_project_versions
  where project_id = p_project_id
    and user_id = (select auth.uid())
    and version = p_version;

  if not found then
    raise exception 'RESEARCH_PROJECT_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.research_projects
  set title = saved.title,
      summary = saved.summary,
      study_area = saved.study_area,
      stage = saved.stage,
      workspace_data = saved.workspace_data
  where id = p_project_id
    and user_id = (select auth.uid())
    and version = p_expected_version
  returning * into restored;

  if not found then
    raise exception 'RESEARCH_PROJECT_CONFLICT' using errcode = '40001';
  end if;

  return restored;
end;
$$;

revoke all on function public.restore_research_project_version(uuid, integer, integer)
  from public, anon;
grant execute on function public.restore_research_project_version(uuid, integer, integer)
  to authenticated;

comment on table public.research_project_versions is
  'Immutable per-user snapshots for safe research-project history and recovery.';

commit;

select
  to_regclass('public.research_project_versions') is not null as version_history_ready,
  (select relrowsecurity from pg_class where oid = 'public.research_project_versions'::regclass) as rls_enabled,
  exists (
    select 1 from pg_trigger
    where tgname = 'research_projects_capture_version'
      and not tgisinternal
  ) as capture_trigger_ready;
