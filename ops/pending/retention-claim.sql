begin;
set local lock_timeout = '3s';

alter table public.service_requests
  add column retention_token uuid,
  add column retention_lease_until timestamptz,
  add constraint retention_claim_complete check ((retention_token is null) = (retention_lease_until is null));

-- Direct client writes cannot choose or release a token. The existing grants are column scoped.
create function private.guard_claimed_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.retention_token is not null then
    raise exception 'RETENTION_IN_PROGRESS' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger retention_freeze_update before update of status,completed_at,id,user_id
  on public.service_requests for each row execute function private.guard_claimed_request();
create trigger retention_freeze_delete before delete on public.service_requests
  for each row execute function private.guard_claimed_request();

-- Hold a shared row lock until the metadata or Storage INSERT commits.
create function private.request_open_for_upload(rid uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform 1 from public.service_requests where id=rid and retention_token is null for share;
  return found;
end $$;
revoke all on function private.request_open_for_upload(uuid) from public,anon;
grant execute on function private.request_open_for_upload(uuid) to authenticated;

create function private.guard_attachment_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.request_open_for_upload(new.request_id) then
    raise exception 'RETENTION_IN_PROGRESS' using errcode='55000';
  end if;
  if tg_op='UPDATE' and old.request_id<>new.request_id then
    if not private.request_open_for_upload(old.request_id) then
      raise exception 'RETENTION_IN_PROGRESS' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
create trigger retention_file_write before insert or update on public.request_files
  for each row execute function private.guard_attachment_write();
create trigger retention_delivery_write before insert or update on public.request_deliverables
  for each row execute function private.guard_attachment_write();
create policy retention_storage_insert on storage.objects as restrictive for insert to authenticated
  with check (case when bucket_id not in ('request-files','request-deliverables') then true
    when split_part(name,'/',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.request_open_for_upload(split_part(name,'/',2)::uuid)
    else false end);

create policy retention_storage_delete on storage.objects as restrictive for delete to authenticated
  using (case when bucket_id not in ('request-files','request-deliverables') then true
    when split_part(name,'/',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.request_open_for_upload(split_part(name,'/',2)::uuid)
    else false end);

create function public.claim_retention_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  claimed public.service_requests%rowtype;
  paths jsonb;
begin
  update public.service_requests set retention_token=gen_random_uuid(), retention_lease_until=clock_timestamp()+interval '30 minutes'
    where id=p_id and status='completed' and completed_at<clock_timestamp()-interval '90 days'
      and (retention_token is null or retention_lease_until<clock_timestamp())
    returning * into claimed;
  if not found then return null; end if;
  -- Include uploaded objects even when their registration had not yet completed.
  select jsonb_build_object(
    'request_files',coalesce(jsonb_agg(jsonb_build_object('object_path',path) order by path) filter(where bucket='request-files'),'[]'::jsonb),
    'request_deliverables',coalesce(jsonb_agg(jsonb_build_object('object_path',path) order by path) filter(where bucket='request-deliverables'),'[]'::jsonb)
  ) into paths from (
    select 'request-files' as bucket,object_path as path from public.request_files where request_id=p_id
    union select 'request-deliverables',object_path from public.request_deliverables where request_id=p_id
    union select bucket_id,name from storage.objects where bucket_id in ('request-files','request-deliverables')
      and starts_with(name,claimed.user_id::text||'/'||p_id::text||'/')
  ) all_paths;
  return paths||jsonb_build_object('id',p_id,'user_id',claimed.user_id,'token',claimed.retention_token);
end $$;

create function public.finish_retention_request(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare request_owner uuid;
begin
  select user_id into request_owner from public.service_requests where id=p_id and retention_token=p_token
    and status='completed' and completed_at<clock_timestamp()-interval '90 days' for update;
  if not found then return false; end if;
  if exists(select 1 from storage.objects where bucket_id in ('request-files','request-deliverables')
    and starts_with(name,request_owner::text||'/'||p_id::text||'/')) then return false; end if;
  update public.service_requests set retention_token=null,retention_lease_until=null where id=p_id;
  delete from public.service_requests where id=p_id;
  return found;
end $$;
revoke all on function public.claim_retention_request(uuid),public.finish_retention_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_retention_request(uuid),public.finish_retention_request(uuid,uuid) to service_role;
revoke all on function private.guard_claimed_request(),private.guard_attachment_write() from public,anon,authenticated;
commit;
