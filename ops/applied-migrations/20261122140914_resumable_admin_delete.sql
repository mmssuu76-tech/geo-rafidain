begin;
set local lock_timeout = '3s';

-- A manual claim freezes uploads until an MFA-verified administrator finishes.
-- The automated worker takes over expired finite leases only.
create function private.manual_delete_active(request_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() and private.admin_mfa_ok() and exists (
    select 1 from public.service_requests r where r.id=request_id
      and r.retention_lease_until='infinity'::timestamptz and r.retention_token is not null
  );
$$;
revoke all on function private.manual_delete_active(uuid) from public, anon;
grant execute on function private.manual_delete_active(uuid) to authenticated;

alter policy retention_storage_delete on storage.objects using (
  case when bucket_id not in ('request-files','request-deliverables') then true
    when split_part(name,'/',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then case when private.is_admin() then private.manual_delete_active(split_part(name,'/',2)::uuid)
      else private.request_open_for_upload(split_part(name,'/',2)::uuid) end
    else false end
);

create function public.admin_delete_request_step(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.service_requests%rowtype;
  batch jsonb;
begin
  if not coalesce(private.is_admin() and private.admin_mfa_ok(),false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;
  if p_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  select * into r from public.service_requests where id=p_id for update;
  if not found then return jsonb_build_object('done',true); end if;
  if r.retention_token is null then
    -- Reject inconsistent legacy metadata before freezing the row or removing files.
    if exists (select 1 from (
      select object_path from public.request_files where request_id=p_id
      union all select object_path from public.request_deliverables where request_id=p_id
    ) refs where not starts_with(object_path,r.user_id::text||'/'||p_id::text||'/')) then
      raise exception 'INVALID_STORAGE_METADATA';
    end if;
    update public.service_requests set retention_token=gen_random_uuid(),
      retention_lease_until='infinity' where id=p_id;
  elsif r.retention_lease_until <> 'infinity'::timestamptz then
    raise exception 'RETENTION_IN_PROGRESS';
  end if;
  select jsonb_agg(to_jsonb(o) order by bucket_id,name) into batch from (
    select bucket_id,name from storage.objects where bucket_id in ('request-files','request-deliverables')
      and starts_with(name,r.user_id::text||'/'||p_id::text||'/')
    order by bucket_id,name limit 100
  ) o;
  if batch is not null then return jsonb_build_object('done',false,'objects',batch); end if;

  update public.service_requests set retention_token=null,retention_lease_until=null where id=p_id;
  delete from public.service_requests where id=p_id;
  return jsonb_build_object('done',true);
end $$;
revoke all on function public.admin_delete_request_step(uuid) from public, anon;
grant execute on function public.admin_delete_request_step(uuid) to authenticated;
revoke delete on public.service_requests from authenticated;
commit;
