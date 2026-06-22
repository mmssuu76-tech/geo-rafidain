-- GeoRafidain: enable common, bounded GIS file formats.
-- Safe to run once after security-hardening.sql.

begin;

alter table public.request_files
  drop constraint if exists request_files_allowed_mime_check;

alter table public.request_files
  add constraint request_files_allowed_mime_check
  check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'application/geo+json',
    'application/json',
    'application/geopackage+sqlite3',
    'application/zip',
    'application/vnd.google-earth.kml+xml',
    'application/vnd.google-earth.kmz'
  ));

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'application/geo+json',
      'application/json',
      'application/geopackage+sqlite3',
      'application/zip',
      'application/vnd.google-earth.kml+xml',
      'application/vnd.google-earth.kmz'
    ]::text[]
where id = 'request-files';

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

commit;

select
  'request-files' as bucket,
  file_size_limit = 10485760 as size_limit_ready,
  'application/geo+json' = any(allowed_mime_types) as geojson_ready,
  'application/geopackage+sqlite3' = any(allowed_mime_types) as geopackage_ready,
  'application/zip' = any(allowed_mime_types) as zipped_shapefile_ready
from storage.buckets
where id = 'request-files';
