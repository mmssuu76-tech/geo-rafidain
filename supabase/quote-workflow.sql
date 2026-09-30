-- GeoRafidain secure quotation workflow
-- Apply once after schema.sql, security-hardening.sql, and admin-workflow.sql.

begin;

alter table public.service_requests
  add column if not exists quote_status text not null default 'not_sent',
  add column if not exists quote_scope text,
  add column if not exists quote_sent_at timestamptz,
  add column if not exists quote_decided_at timestamptz,
  add column if not exists quote_client_note text;

alter table public.service_requests
  drop constraint if exists service_requests_quote_status_check,
  add constraint service_requests_quote_status_check
    check (quote_status in ('not_sent', 'pending', 'accepted', 'rejected', 'withdrawn')),
  drop constraint if exists service_requests_quote_scope_check,
  add constraint service_requests_quote_scope_check
    check (quote_scope is null or char_length(quote_scope) between 20 and 4000),
  drop constraint if exists service_requests_quote_client_note_check,
  add constraint service_requests_quote_client_note_check
    check (quote_client_note is null or char_length(quote_client_note) <= 1000);

update public.service_requests
set quote_status = 'pending',
    quote_sent_at = coalesce(quote_sent_at, updated_at, created_at)
where quote_status = 'not_sent'
  and quoted_price_iqd is not null
  and expected_delivery_date is not null;

create table if not exists public.request_quote_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.service_requests(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('sent', 'accepted', 'rejected')),
  quoted_price_iqd bigint,
  expected_delivery_date date,
  quote_scope text,
  client_note text,
  created_at timestamptz not null default now()
);

create index if not exists request_quote_events_request_created_idx
  on public.request_quote_events (request_id, created_at desc);

alter table public.request_quote_events enable row level security;

drop policy if exists quote_events_read_own_or_admin on public.request_quote_events;
create policy quote_events_read_own_or_admin
  on public.request_quote_events for select to authenticated
  using (
    exists (
      select 1
      from public.service_requests request
      where request.id = request_id
        and (
          request.user_id = (select auth.uid())
          or ((select private.is_admin()) and (select private.admin_mfa_ok()))
        )
    )
  );

revoke all on public.request_quote_events from anon, authenticated;
grant select on public.request_quote_events to authenticated;

create or replace function public.admin_send_service_quote(
  p_request_id uuid,
  p_price_iqd bigint,
  p_delivery_date date,
  p_scope text,
  p_admin_message text default null
)
returns public.service_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_request public.service_requests;
  clean_scope text := btrim(coalesce(p_scope, ''));
  clean_message text := nullif(btrim(coalesce(p_admin_message, '')), '');
begin
  if not coalesce((select private.is_admin()), false)
     or not coalesce((select private.admin_mfa_ok()), false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;
  if p_price_iqd is null or p_price_iqd < 1000 or p_price_iqd > 1000000000 then
    raise exception 'INVALID_QUOTE_PRICE' using errcode = '22023';
  end if;
  if p_delivery_date is null or p_delivery_date < current_date then
    raise exception 'INVALID_QUOTE_DELIVERY_DATE' using errcode = '22023';
  end if;
  if char_length(clean_scope) < 20 or char_length(clean_scope) > 4000 then
    raise exception 'INVALID_QUOTE_SCOPE' using errcode = '22023';
  end if;
  if clean_message is not null and char_length(clean_message) > 2000 then
    raise exception 'ADMIN_MESSAGE_TOO_LONG' using errcode = '22023';
  end if;

  update public.service_requests
  set quoted_price_iqd = p_price_iqd,
      expected_delivery_date = p_delivery_date,
      quote_scope = clean_scope,
      quote_status = 'pending',
      quote_sent_at = now(),
      quote_decided_at = null,
      quote_client_note = null,
      admin_message = clean_message,
      status = case when status = 'new' then 'reviewing' else status end
  where id = p_request_id
  returning * into updated_request;

  if updated_request.id is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.request_quote_events
    (request_id, actor_id, action, quoted_price_iqd, expected_delivery_date, quote_scope)
  values
    (updated_request.id, (select auth.uid()), 'sent', p_price_iqd, p_delivery_date, clean_scope);

  return updated_request;
end;
$$;

create or replace function public.respond_to_service_quote(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns public.service_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  clean_decision text := lower(btrim(coalesce(p_decision, '')));
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  updated_request public.service_requests;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if clean_decision not in ('accepted', 'rejected') then
    raise exception 'INVALID_QUOTE_DECISION' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'CLIENT_NOTE_TOO_LONG' using errcode = '22023';
  end if;

  update public.service_requests
  set quote_status = clean_decision,
      quote_decided_at = now(),
      quote_client_note = clean_note
  where id = p_request_id
    and user_id = current_user_id
    and quote_status = 'pending'
  returning * into updated_request;

  if updated_request.id is null then
    raise exception 'QUOTE_NOT_PENDING_OR_NOT_OWNED' using errcode = '42501';
  end if;

  insert into public.request_quote_events
    (request_id, actor_id, action, quoted_price_iqd, expected_delivery_date, quote_scope, client_note)
  values
    (updated_request.id, current_user_id, clean_decision, updated_request.quoted_price_iqd,
     updated_request.expected_delivery_date, updated_request.quote_scope, clean_note);

  return updated_request;
end;
$$;

revoke all on function public.admin_send_service_quote(uuid, bigint, date, text, text)
  from public, anon;
revoke all on function public.respond_to_service_quote(uuid, text, text)
  from public, anon;
grant execute on function public.admin_send_service_quote(uuid, bigint, date, text, text)
  to authenticated;
grant execute on function public.respond_to_service_quote(uuid, text, text)
  to authenticated;

commit;

select
  count(*) = 5 as quote_columns_ready
from information_schema.columns
where table_schema = 'public'
  and table_name = 'service_requests'
  and column_name in ('quote_status', 'quote_scope', 'quote_sent_at', 'quote_decided_at', 'quote_client_note');
