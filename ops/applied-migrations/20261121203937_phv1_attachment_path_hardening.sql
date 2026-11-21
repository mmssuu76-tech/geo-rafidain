-- REVIEW ONLY: PHV1-FIX-004. Not an applied migration.
-- Requires a verified legacy-data audit and real Storage API tests before production.
begin;
set local lock_timeout = '2s';

create or replace function public.admin_register_request_deliverable(
  p_request_id uuid,
  p_object_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_mime_type text,
  p_version_label text,
  p_delivery_note text default null
)
returns public.request_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_owner uuid;
  clean_path text := btrim(coalesce(p_object_path, ''));
  clean_name text := btrim(coalesce(p_original_name, ''));
  clean_version text := btrim(coalesce(p_version_label, ''));
  clean_note text := nullif(btrim(coalesce(p_delivery_note, '')), '');
  created_delivery public.request_deliverables;
begin
  if not coalesce((select private.is_admin()), false)
     or not coalesce((select private.admin_mfa_ok()), false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;

  select request.user_id into request_owner
  from public.service_requests request
  where request.id = p_request_id;

  if request_owner is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if clean_path = ''
     or split_part(clean_path, '/', 1) <> request_owner::text
     or split_part(clean_path, '/', 2) <> p_request_id::text
     or clean_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]*$'
     or clean_path !~* '[.](pdf|docx|xlsx|csv|jpg|jpeg|png|tif|tiff|geojson|json|gpkg|zip|kml|kmz)$' then
    raise exception 'INVALID_DELIVERABLE_PATH' using errcode = '22023';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 255 then
    raise exception 'INVALID_DELIVERABLE_NAME' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 52428800 then
    raise exception 'INVALID_DELIVERABLE_SIZE' using errcode = '22023';
  end if;
  if p_mime_type is null or p_mime_type not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/zip',
    'image/jpeg', 'image/png', 'image/tiff',
    'application/geo+json', 'application/json',
    'application/geopackage+sqlite3',
    'application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz'
  ) then
    raise exception 'INVALID_DELIVERABLE_TYPE' using errcode = '22023';
  end if;
  if char_length(clean_version) < 2 or char_length(clean_version) > 80 then
    raise exception 'INVALID_VERSION_LABEL' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1200 then
    raise exception 'DELIVERY_NOTE_TOO_LONG' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'request-deliverables' and object.name = clean_path
  ) then
    raise exception 'DELIVERABLE_OBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.request_deliverables
    (request_id, uploaded_by, object_path, original_name, size_bytes, mime_type, version_label, delivery_note)
  values
    (p_request_id, current_user_id, clean_path, clean_name, p_size_bytes, p_mime_type, clean_version, clean_note)
  returning * into created_delivery;

  insert into public.user_notifications
    (user_id, request_id, notification_type, title, body)
  values
    (request_owner, p_request_id, 'delivery', 'مخرجات جديدة جاهزة',
     'تمت إضافة ' || clean_version || ' إلى ملفات تسليم الطلب.');

  return created_delivery;
end;
$$;

revoke all on function public.admin_register_request_deliverable(uuid,text,text,bigint,text,text,text) from public, anon;
grant execute on function public.admin_register_request_deliverable(uuid,text,text,bigint,text,text,text) to authenticated;

-- A valid storage path is an exact owner UUID / request UUID / filename.
-- Use CASE to avoid casting malformed request UUIDs. Never bypass request RLS.
create or replace function private.request_storage_path_ok(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
         and object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]*$' then
      exists (
        select 1 from public.service_requests r
        where r.id = split_part(object_name, '/', 2)::uuid
          and r.user_id::text = split_part(object_name, '/', 1)
          and case when (select private.is_admin())
            then (select private.admin_mfa_ok())
            else r.user_id = (select auth.uid())
          end
      )
    else false
  end;
$$;
revoke all on function private.request_storage_path_ok(text) from public, anon, service_role;
grant execute on function private.request_storage_path_ok(text) to authenticated;

drop policy if exists storage_request_files_read on storage.objects;
create policy storage_request_files_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and private.request_storage_path_ok(name)
  );

drop policy if exists storage_request_files_insert on storage.objects;
create policy storage_request_files_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and private.request_storage_path_ok(name)
    and name ~* '[.](pdf|docx|xlsx|csv|jpg|jpeg|png|tif|tiff|geojson|json|gpkg|zip|kml|kmz)$'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists storage_request_files_delete on storage.objects;
create policy storage_request_files_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-files'
    and private.request_storage_path_ok(name)
  );

drop policy if exists storage_request_deliverables_read on storage.objects;
create policy storage_request_deliverables_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-deliverables'
    and private.request_storage_path_ok(name)
  );

drop policy if exists storage_request_deliverables_insert on storage.objects;
create policy storage_request_deliverables_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-deliverables'
    and private.request_storage_path_ok(name)
    and name ~* '[.](pdf|docx|xlsx|csv|jpg|jpeg|png|tif|tiff|geojson|json|gpkg|zip|kml|kmz)$'
    and (select private.is_admin())
    and (select private.admin_mfa_ok())
  );

drop policy if exists storage_request_deliverables_delete on storage.objects;
create policy storage_request_deliverables_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-deliverables'
    and private.request_storage_path_ok(name)
    and (select private.is_admin())
    and (select private.admin_mfa_ok())
  );

commit;
