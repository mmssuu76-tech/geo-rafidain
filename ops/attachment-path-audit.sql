-- READ ONLY: run only in an authorized review session before any migration.
-- Legacy invalid paths may become inaccessible after the stricter policies.
with checked as (
  select o.bucket_id, o.name,
    exists (
      select 1 from public.service_requests r
      where r.id = case when o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]*$'
                        then split_part(o.name,'/',2)::uuid else null end
        and r.user_id::text = split_part(o.name,'/',1)
    ) as valid_parent
  from storage.objects o
  where o.bucket_id in ('request-files','request-deliverables')
), delivery_meta as (
  select d.object_path, r.id as request_id, r.user_id
  from public.request_deliverables d
  join public.service_requests r on r.id = d.request_id
), file_meta as (
  select f.object_path, f.request_id, f.owner_id, r.user_id
  from public.request_files f join public.service_requests r on r.id = f.request_id
)
select 'storage:' || bucket_id as scope, count(*) as total,
       count(*) filter (where not valid_parent) as invalid_path_or_parent,
       count(*) filter (where name !~* '[.](pdf|docx|xlsx|csv|jpg|jpeg|png|tif|tiff|geojson|json|gpkg|zip|kml|kmz)$') as unsupported_extension
from checked group by bucket_id
union all
select 'metadata:request-deliverables', count(*), count(*) filter (
  where object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]*$' or split_part(object_path,'/',1) <> user_id::text
    or split_part(object_path,'/',2) <> request_id::text),
  count(*) filter (where object_path !~* '[.](pdf|docx|xlsx|csv|jpg|jpeg|png|tif|tiff|geojson|json|gpkg|zip|kml|kmz)$') from delivery_meta
union all
select 'metadata:request-files', count(*), count(*) filter (
  where object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]*$' or owner_id <> user_id
    or split_part(object_path,'/',1) <> user_id::text
    or split_part(object_path,'/',2) <> request_id::text),
  count(*) filter (where object_path !~* '[.](pdf|docx|xlsx|csv|jpg|jpeg|png|tif|tiff|geojson|json|gpkg|zip|kml|kmz)$') from file_meta;
