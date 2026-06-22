-- GeoRafidain secure backend schema
-- Run this entire file once in the Supabase SQL Editor.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'client' check (role in ('client', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  contact text not null check (char_length(contact) between 5 and 200),
  service text not null check (char_length(service) between 2 and 160),
  study_area text check (study_area is null or char_length(study_area) <= 240),
  description text not null check (char_length(description) between 20 and 5000),
  deadline date,
  status text not null default 'new' check (status in ('new', 'reviewing', 'in_progress', 'completed')),
  quoted_price_iqd bigint check (quoted_price_iqd is null or quoted_price_iqd between 0 and 1000000000),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  expected_delivery_date date,
  admin_message text check (admin_message is null or char_length(admin_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  mime_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists service_requests_user_created_idx
  on public.service_requests (user_id, created_at desc);
create index if not exists service_requests_status_created_idx
  on public.service_requests (status, created_at desc);
create index if not exists request_files_request_idx
  on public.request_files (request_id);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon, service_role;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user()
  from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure private.handle_new_user();

create or replace function private.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_number is null or new.request_number = '' then
    new.request_number := 'GR-' || to_char(now(), 'YYYYMMDD') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;
  return new;
end;
$$;

revoke all on function private.assign_request_number()
  from public, anon, authenticated, service_role;

drop trigger if exists service_requests_number on public.service_requests;
create trigger service_requests_number
  before insert on public.service_requests
  for each row execute procedure private.assign_request_number();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists service_requests_updated_at on public.service_requests;
create trigger service_requests_updated_at
  before update on public.service_requests
  for each row execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.service_requests enable row level security;
alter table public.request_files enable row level security;

drop policy if exists profiles_read_own_or_admin on public.profiles;
create policy profiles_read_own_or_admin
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select private.is_admin()));

drop policy if exists requests_read_own_or_admin on public.service_requests;
create policy requests_read_own_or_admin
  on public.service_requests for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

drop policy if exists requests_insert_own on public.service_requests;
create policy requests_insert_own
  on public.service_requests for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'new');

drop policy if exists requests_admin_update on public.service_requests;
create policy requests_admin_update
  on public.service_requests for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists requests_admin_delete on public.service_requests;
create policy requests_admin_delete
  on public.service_requests for delete to authenticated
  using ((select private.is_admin()));

drop policy if exists request_files_read_own_or_admin on public.request_files;
create policy request_files_read_own_or_admin
  on public.request_files for select to authenticated
  using ((select auth.uid()) = owner_id or (select private.is_admin()));

drop policy if exists request_files_insert_own on public.request_files;
create policy request_files_insert_own
  on public.request_files for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.service_requests request
      where request.id = request_id and request.user_id = (select auth.uid())
    )
  );

drop policy if exists request_files_delete_own_or_admin on public.request_files;
create policy request_files_delete_own_or_admin
  on public.request_files for delete to authenticated
  using ((select auth.uid()) = owner_id or (select private.is_admin()));

revoke all on public.profiles, public.service_requests, public.request_files from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.service_requests to authenticated;
grant select, insert, delete on public.request_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-files',
  'request-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/zip',
    'image/jpeg', 'image/png', 'image/tiff',
    'application/geo+json', 'application/json',
    'application/geopackage+sqlite3',
    'application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_request_files_read on storage.objects;
create policy storage_request_files_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.is_admin())
    )
  );

drop policy if exists storage_request_files_insert on storage.objects;
create policy storage_request_files_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists storage_request_files_delete on storage.objects;
create policy storage_request_files_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.is_admin())
    )
  );

commit;

-- After your first login, run the following separately with your real email:
-- update public.profiles set role = 'admin' where email = 'you@example.com';
