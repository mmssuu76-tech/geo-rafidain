-- PHV1-SEC-012: read-only catalog and aggregate audit for the selected project.
-- Do not paste sensitive user rows, paths, token contents or query parameters into reports.
-- This file contains SELECT only; execute as a read-only catalog check.

select 'rls' as object_type,
       schemaname || '.' || tablename as object_name,
       rowsecurity::text as detail
from pg_tables
where schemaname = 'public'
  and tablename in ('service_requests', 'user_notifications', 'request_messages',
                    'request_quote_events', 'request_files', 'request_deliverables')
union all
select 'bucket', id, case when public then 'PUBLIC' else 'PRIVATE' end
from storage.buckets
where id in ('request-files', 'request-deliverables')
order by object_type, object_name;

select n.nspname || '.' || p.proname as rpc,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_send_service_quote', 'respond_to_service_quote',
                    'send_request_message', 'mark_notifications_read',
                    'admin_register_request_deliverable')
order by rpc;

select 'service_requests' as relation, count(*)::bigint as rows_count from public.service_requests
union all select 'user_notifications', count(*) from public.user_notifications
union all select 'request_messages', count(*) from public.request_messages
union all select 'request_quote_events', count(*) from public.request_quote_events
union all select 'request_files', count(*) from public.request_files
union all select 'request_deliverables', count(*) from public.request_deliverables
union all select 'request-files objects', count(*) from storage.objects where bucket_id = 'request-files'
union all select 'request-deliverables objects', count(*) from storage.objects where bucket_id = 'request-deliverables';
