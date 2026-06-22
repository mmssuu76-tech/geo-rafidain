-- GeoRafidain admin workflow upgrade
-- Apply once after schema.sql and security-hardening.sql.

begin;

alter table public.service_requests
  add column if not exists quoted_price_iqd bigint,
  add column if not exists progress_percent smallint not null default 0,
  add column if not exists expected_delivery_date date,
  add column if not exists admin_message text;

alter table public.service_requests
  drop constraint if exists service_requests_quoted_price_check,
  add constraint service_requests_quoted_price_check
    check (quoted_price_iqd is null or quoted_price_iqd between 0 and 1000000000),
  drop constraint if exists service_requests_progress_check,
  add constraint service_requests_progress_check
    check (progress_percent between 0 and 100),
  drop constraint if exists service_requests_admin_message_check,
  add constraint service_requests_admin_message_check
    check (admin_message is null or char_length(admin_message) <= 2000);

alter table public.admin_audit_logs
  add column if not exists changes jsonb;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check,
  add constraint admin_audit_logs_action_check
    check (action in ('status_changed', 'workflow_updated', 'request_deleted'));

create or replace function private.log_request_admin_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_set jsonb;
begin
  if tg_op = 'UPDATE' then
    change_set := jsonb_strip_nulls(jsonb_build_object(
      'quoted_price_iqd', case when old.quoted_price_iqd is distinct from new.quoted_price_iqd then jsonb_build_object('old', old.quoted_price_iqd, 'new', new.quoted_price_iqd) end,
      'progress_percent', case when old.progress_percent is distinct from new.progress_percent then jsonb_build_object('old', old.progress_percent, 'new', new.progress_percent) end,
      'expected_delivery_date', case when old.expected_delivery_date is distinct from new.expected_delivery_date then jsonb_build_object('old', old.expected_delivery_date, 'new', new.expected_delivery_date) end,
      'admin_message', case when old.admin_message is distinct from new.admin_message then jsonb_build_object('changed', true) end
    ));

    if old.status is distinct from new.status then
      insert into public.admin_audit_logs
        (admin_id, action, entity_id, old_status, new_status, changes)
      values ((select auth.uid()), 'status_changed', new.id, old.status, new.status, nullif(change_set, '{}'::jsonb));
    elsif change_set <> '{}'::jsonb then
      insert into public.admin_audit_logs
        (admin_id, action, entity_id, old_status, new_status, changes)
      values ((select auth.uid()), 'workflow_updated', new.id, old.status, new.status, change_set);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.admin_audit_logs
      (admin_id, action, entity_id, old_status)
    values ((select auth.uid()), 'request_deleted', old.id, old.status);
    return old;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists service_requests_admin_audit_update on public.service_requests;
create trigger service_requests_admin_audit_update
  after update of status, quoted_price_iqd, progress_percent, expected_delivery_date, admin_message
  on public.service_requests
  for each row execute procedure private.log_request_admin_action();

revoke all on function private.log_request_admin_action()
  from public, anon, authenticated, service_role;

revoke update on public.service_requests from authenticated;
grant update (status, quoted_price_iqd, progress_percent, expected_delivery_date, admin_message)
  on public.service_requests to authenticated;

commit;

select
  count(*) = 5 as workflow_columns_ready
from information_schema.columns
where table_schema = 'public'
  and table_name = 'service_requests'
  and column_name in ('status', 'quoted_price_iqd', 'progress_percent', 'expected_delivery_date', 'admin_message');
