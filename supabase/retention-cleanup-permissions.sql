grant usage on schema public to service_role;

grant select, delete
on table public.service_requests
to service_role;

grant select
on table public.request_files
to service_role;

grant select
on table public.request_deliverables
to service_role;

select
  has_table_privilege('service_role', 'public.service_requests', 'SELECT') as service_requests_select,
  has_table_privilege('service_role', 'public.service_requests', 'DELETE') as service_requests_delete,
  has_table_privilege('service_role', 'public.request_files', 'SELECT') as request_files_select,
  has_table_privilege('service_role', 'public.request_deliverables', 'SELECT') as request_deliverables_select;
