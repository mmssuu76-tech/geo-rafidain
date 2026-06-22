-- GeoRafidain: move internal SECURITY DEFINER helpers out of the exposed API schema.
-- Apply after schema.sql, security-hardening.sql, admin-workflow.sql and gis-file-formats.sql.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    execute 'alter function public.is_admin() set schema private';
  end if;
  if to_regprocedure('public.can_create_request()') is not null then
    execute 'alter function public.can_create_request() set schema private';
  end if;
  if to_regprocedure('public.owns_request(uuid)') is not null then
    execute 'alter function public.owns_request(uuid) set schema private';
  end if;
  if to_regprocedure('public.admin_mfa_ok()') is not null then
    execute 'alter function public.admin_mfa_ok() set schema private';
  end if;
  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'alter function public.handle_new_user() set schema private';
  end if;
  if to_regprocedure('public.assign_request_number()') is not null then
    execute 'alter function public.assign_request_number() set schema private';
  end if;
  if to_regprocedure('public.log_request_admin_action()') is not null then
    execute 'alter function public.log_request_admin_action() set schema private';
  end if;
end
$$;

revoke all on function private.is_admin() from public, anon, service_role;
revoke all on function private.can_create_request() from public, anon, service_role;
revoke all on function private.owns_request(uuid) from public, anon, service_role;
revoke all on function private.admin_mfa_ok() from public, anon, service_role;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_create_request() to authenticated;
grant execute on function private.owns_request(uuid) to authenticated;
grant execute on function private.admin_mfa_ok() to authenticated;

revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function private.assign_request_number() from public, anon, authenticated, service_role;
revoke all on function private.log_request_admin_action() from public, anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end
$$;

commit;

select
  (select count(*) = 7
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in (
       'is_admin', 'can_create_request', 'owns_request', 'admin_mfa_ok',
       'handle_new_user', 'assign_request_number', 'log_request_admin_action'
     )) as internal_functions_private,
  coalesce(
    not has_function_privilege(
      'anon', to_regprocedure('public.rls_auto_enable()'), 'EXECUTE'
    ),
    true
  ) as rls_event_function_closed,
  has_function_privilege('authenticated', 'private.is_admin()', 'EXECUTE') as rls_helpers_ready;
