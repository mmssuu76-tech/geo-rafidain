begin;

create or replace function private.admin_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1 from auth.mfa_factors
      where user_id = (select auth.uid()) and status = 'verified'
    )
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$$;

revoke all on function private.admin_mfa_ok() from public, anon, service_role;
grant execute on function private.admin_mfa_ok() to authenticated;

-- Enforce new metadata writes immediately. Review existing rows before validation.
alter table public.request_files
  add constraint request_files_scoped_object_path
  check (
    split_part(object_path, '/', 1) = owner_id::text
    and split_part(object_path, '/', 2) = request_id::text
    and object_path ~ '^[^/]+/[^/]+/[A-Za-z0-9_-][A-Za-z0-9._-]*$'
  ) not valid;

commit;
