-- REVIEW ONLY: pending PHV1-FIX-003 SQL. Do not run against production.
-- Requires the existing schema and the strict private.admin_mfa_ok() helper.
begin;
set local lock_timeout = '2s';

-- A notification recipient is not necessarily the owner of its request.
-- Admin notifications require MFA. Clients may only see notifications for their own requests.
-- Request-less notifications have no proven client ownership and are denied to clients.
drop policy if exists notifications_read_own on public.user_notifications;
create policy notifications_read_own
  on public.user_notifications for select to authenticated
  using (
    user_id = (select auth.uid())
    and case when (select private.is_admin())
      then (select private.admin_mfa_ok())
      else request_id is not null and private.owns_request(request_id)
    end
  );

create or replace function public.mark_notifications_read(
  p_notification_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  affected integer;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if (select private.is_admin())
     and not coalesce((select private.admin_mfa_ok()), false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS: enforce the same access predicate explicitly.
  update public.user_notifications notification
  set read_at = coalesce(notification.read_at, now())
  where notification.user_id = current_user_id
    and case when (select private.is_admin())
      then (select private.admin_mfa_ok())
      else notification.request_id is not null
           and private.owns_request(notification.request_id)
    end
    and (p_notification_id is null or notification.id = p_notification_id);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mark_notifications_read(uuid) from public, anon;
grant execute on function public.mark_notifications_read(uuid) to authenticated;
commit;
