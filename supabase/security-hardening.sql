-- GeoRafidain security hardening migration
-- Apply once after schema.sql. Safe to run again.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter table public.service_requests
  add column if not exists completed_at timestamptz;

update public.service_requests
set completed_at = coalesce(completed_at, updated_at, created_at)
where status = 'completed' and completed_at is null;

create index if not exists service_requests_completed_idx
  on public.service_requests (completed_at)
  where completed_at is not null;

create or replace function private.can_create_request()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.service_requests
    where user_id = (select auth.uid())
      and created_at >= now() - interval '1 hour') < 5;
$$;

revoke all on function private.can_create_request() from public, anon, service_role;
grant execute on function private.can_create_request() to authenticated;

create or replace function private.owns_request(request_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.service_requests
    where id = request_uuid and user_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_request(uuid) from public, anon, service_role;
grant execute on function private.owns_request(uuid) to authenticated;

create or replace function private.admin_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1 from auth.mfa_factors
      where user_id = (select auth.uid()) and status = 'verified'
    )
    or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$$;

revoke all on function private.admin_mfa_ok() from public, anon, service_role;
grant execute on function private.admin_mfa_ok() to authenticated;

create or replace function private.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.request_number := 'GR-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  new.user_id := (select auth.uid());
  new.status := 'new';
  new.created_at := now();
  new.updated_at := now();
  new.completed_at := null;
  return new;
end;
$$;

revoke all on function private.assign_request_number()
  from public, anon, authenticated, service_role;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'request_files_allowed_mime_check'
      and conrelid = 'public.request_files'::regclass
  ) then
    alter table public.request_files add constraint request_files_allowed_mime_check
    check (mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'image/jpeg', 'image/png', 'image/tiff',
      'application/geo+json', 'application/json',
      'application/geopackage+sqlite3', 'application/zip',
      'application/vnd.google-earth.kml+xml',
      'application/vnd.google-earth.kmz'
    )) not valid;
  end if;
end $$;

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('status_changed', 'request_deleted')),
  entity_id uuid not null,
  old_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists audit_logs_admin_read on public.admin_audit_logs;
create policy audit_logs_admin_read
  on public.admin_audit_logs for select to authenticated
  using ((select private.is_admin()) and (select private.admin_mfa_ok()));

create or replace function private.log_request_admin_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.admin_audit_logs
      (admin_id, action, entity_id, old_status, new_status)
    values ((select auth.uid()), 'status_changed', new.id, old.status, new.status);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.admin_audit_logs
      (admin_id, action, entity_id, old_status)
    values ((select auth.uid()), 'request_deleted', old.id, old.status);
    return old;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.log_request_admin_action()
  from public, anon, authenticated, service_role;

drop trigger if exists service_requests_admin_audit_update on public.service_requests;
create trigger service_requests_admin_audit_update
  after update of status on public.service_requests
  for each row execute procedure private.log_request_admin_action();

drop trigger if exists service_requests_admin_audit_delete on public.service_requests;
create trigger service_requests_admin_audit_delete
  before delete on public.service_requests
  for each row execute procedure private.log_request_admin_action();

drop policy if exists profiles_read_own_or_admin on public.profiles;
create policy profiles_read_own_or_admin
  on public.profiles for select to authenticated
  using (
    (select auth.uid()) = id
    or ((select private.is_admin()) and (select private.admin_mfa_ok()))
  );

drop policy if exists requests_read_own_or_admin on public.service_requests;
create policy requests_read_own_or_admin
  on public.service_requests for select to authenticated
  using (
    (select auth.uid()) = user_id
    or ((select private.is_admin()) and (select private.admin_mfa_ok()))
  );

drop policy if exists requests_insert_own on public.service_requests;
create policy requests_insert_own
  on public.service_requests for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'new'
    and (select private.can_create_request())
  );

drop policy if exists requests_admin_update on public.service_requests;
create policy requests_admin_update
  on public.service_requests for update to authenticated
  using ((select private.is_admin()) and (select private.admin_mfa_ok()))
  with check ((select private.is_admin()) and (select private.admin_mfa_ok()));

drop policy if exists requests_admin_delete on public.service_requests;
create policy requests_admin_delete
  on public.service_requests for delete to authenticated
  using ((select private.is_admin()) and (select private.admin_mfa_ok()));

drop policy if exists request_files_read_own_or_admin on public.request_files;
create policy request_files_read_own_or_admin
  on public.request_files for select to authenticated
  using (
    (select auth.uid()) = owner_id
    or ((select private.is_admin()) and (select private.admin_mfa_ok()))
  );

drop policy if exists request_files_insert_own on public.request_files;
create policy request_files_insert_own
  on public.request_files for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (select private.owns_request(request_id))
  );

drop policy if exists request_files_delete_own_or_admin on public.request_files;
create policy request_files_delete_own_or_admin
  on public.request_files for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    or ((select private.is_admin()) and (select private.admin_mfa_ok()))
  );

revoke insert, update on public.service_requests from authenticated;
grant insert (id, user_id, name, contact, service, study_area, description, deadline)
  on public.service_requests to authenticated;
grant update (status, quoted_price_iqd, progress_percent, expected_delivery_date, admin_message)
  on public.service_requests to authenticated;

revoke insert on public.request_files from authenticated;
grant insert (request_id, owner_id, object_path, original_name, size_bytes, mime_type)
  on public.request_files to authenticated;

revoke all on public.admin_audit_logs from anon;
revoke insert, update, delete on public.admin_audit_logs from authenticated;
grant select on public.admin_audit_logs to authenticated;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'image/jpeg', 'image/png', 'image/tiff',
      'application/geo+json', 'application/json',
      'application/geopackage+sqlite3', 'application/zip',
      'application/vnd.google-earth.kml+xml',
      'application/vnd.google-earth.kmz'
    ]::text[]
where id = 'request-files';

drop policy if exists storage_request_files_read on storage.objects;
create policy storage_request_files_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((select private.is_admin()) and (select private.admin_mfa_ok()))
    )
  );

drop policy if exists storage_request_files_insert on storage.objects;
create policy storage_request_files_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = any(array[
      'pdf','docx','xlsx','csv','jpg','jpeg','png','tif','tiff',
      'geojson','json','gpkg','zip','kml','kmz'
    ]::text[])
    and case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (select private.owns_request(((storage.foldername(name))[2])::uuid))
      else false
    end
  );

drop policy if exists storage_request_files_delete on storage.objects;
create policy storage_request_files_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((select private.is_admin()) and (select private.admin_mfa_ok()))
    )
  );

create or replace view public.admin_retention_queue
with (security_invoker = true)
as
select id, request_number, completed_at,
       completed_at + interval '90 days' as delete_after
from public.service_requests
where status = 'completed' and completed_at is not null;

revoke all on public.admin_retention_queue from anon;
grant select on public.admin_retention_queue to authenticated;

commit;
