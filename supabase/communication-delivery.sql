-- GeoRafidain secure request communication, notifications, and delivery workflow
-- Apply after schema.sql, security-hardening.sql, admin-workflow.sql, and quote-workflow.sql.

begin;

create table if not exists public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('client', 'admin')),
  body text not null check (char_length(body) between 2 and 3000),
  created_at timestamptz not null default now()
);

create table if not exists public.request_deliverables (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  object_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  mime_type text not null,
  version_label text not null check (char_length(version_label) between 2 and 80),
  delivery_note text check (delivery_note is null or char_length(delivery_note) <= 1200),
  created_at timestamptz not null default now()
);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.service_requests(id) on delete cascade,
  notification_type text not null check (notification_type in ('message', 'status', 'quote', 'delivery')),
  title text not null check (char_length(title) between 2 and 160),
  body text not null check (char_length(body) between 2 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists request_messages_request_created_idx
  on public.request_messages (request_id, created_at);
create index if not exists request_deliverables_request_created_idx
  on public.request_deliverables (request_id, created_at desc);
create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id, read_at, created_at desc);

alter table public.request_messages enable row level security;
alter table public.request_deliverables enable row level security;
alter table public.user_notifications enable row level security;

drop policy if exists request_messages_read_participants on public.request_messages;
create policy request_messages_read_participants
  on public.request_messages for select to authenticated
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

drop policy if exists request_deliverables_read_participants on public.request_deliverables;
create policy request_deliverables_read_participants
  on public.request_deliverables for select to authenticated
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

drop policy if exists notifications_read_own on public.user_notifications;
create policy notifications_read_own
  on public.user_notifications for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.request_messages, public.request_deliverables, public.user_notifications
  from anon, authenticated;
grant select on public.request_messages, public.request_deliverables, public.user_notifications
  to authenticated;

create or replace function public.send_request_message(
  p_request_id uuid,
  p_body text
)
returns public.request_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  clean_body text := btrim(coalesce(p_body, ''));
  request_owner uuid;
  actor_role text;
  created_message public.request_messages;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if char_length(clean_body) < 2 or char_length(clean_body) > 3000 then
    raise exception 'INVALID_MESSAGE_BODY' using errcode = '22023';
  end if;

  select request.user_id into request_owner
  from public.service_requests request
  where request.id = p_request_id;

  if request_owner is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  select account.role into actor_role
  from public.profiles account
  where account.id = current_user_id;

  if actor_role = 'admin' then
    if not coalesce((select private.admin_mfa_ok()), false) then
      raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
    end if;
  elsif request_owner = current_user_id then
    actor_role := 'client';
  else
    raise exception 'REQUEST_ACCESS_DENIED' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.request_messages message
    where message.sender_id = current_user_id
      and message.created_at > now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'MESSAGE_RATE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.request_messages (request_id, sender_id, sender_role, body)
  values (p_request_id, current_user_id, actor_role, clean_body)
  returning * into created_message;

  if actor_role = 'admin' then
    insert into public.user_notifications
      (user_id, request_id, notification_type, title, body)
    values
      (request_owner, p_request_id, 'message', 'رسالة جديدة من جيو الرافدين', left(clean_body, 500));
  else
    insert into public.user_notifications
      (user_id, request_id, notification_type, title, body)
    select account.id, p_request_id, 'message', 'رسالة جديدة من العميل', left(clean_body, 500)
    from public.profiles account
    where account.role = 'admin';
  end if;

  return created_message;
end;
$$;

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

  update public.user_notifications notification
  set read_at = coalesce(notification.read_at, now())
  where notification.user_id = current_user_id
    and (p_notification_id is null or notification.id = p_notification_id);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.admin_register_request_deliverable(
  p_request_id uuid,
  p_object_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_mime_type text,
  p_version_label text,
  p_delivery_note text default null
)
returns public.request_deliverables
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_owner uuid;
  clean_path text := btrim(coalesce(p_object_path, ''));
  clean_name text := btrim(coalesce(p_original_name, ''));
  clean_version text := btrim(coalesce(p_version_label, ''));
  clean_note text := nullif(btrim(coalesce(p_delivery_note, '')), '');
  created_delivery public.request_deliverables;
begin
  if not coalesce((select private.is_admin()), false)
     or not coalesce((select private.admin_mfa_ok()), false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;

  select request.user_id into request_owner
  from public.service_requests request
  where request.id = p_request_id;

  if request_owner is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if clean_path = ''
     or split_part(clean_path, '/', 1) <> request_owner::text
     or split_part(clean_path, '/', 2) <> p_request_id::text then
    raise exception 'INVALID_DELIVERABLE_PATH' using errcode = '22023';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 255 then
    raise exception 'INVALID_DELIVERABLE_NAME' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 52428800 then
    raise exception 'INVALID_DELIVERABLE_SIZE' using errcode = '22023';
  end if;
  if p_mime_type not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/zip',
    'image/jpeg', 'image/png', 'image/tiff',
    'application/geo+json', 'application/json',
    'application/geopackage+sqlite3',
    'application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz'
  ) then
    raise exception 'INVALID_DELIVERABLE_TYPE' using errcode = '22023';
  end if;
  if char_length(clean_version) < 2 or char_length(clean_version) > 80 then
    raise exception 'INVALID_VERSION_LABEL' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1200 then
    raise exception 'DELIVERY_NOTE_TOO_LONG' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'request-deliverables' and object.name = clean_path
  ) then
    raise exception 'DELIVERABLE_OBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.request_deliverables
    (request_id, uploaded_by, object_path, original_name, size_bytes, mime_type, version_label, delivery_note)
  values
    (p_request_id, current_user_id, clean_path, clean_name, p_size_bytes, p_mime_type, clean_version, clean_note)
  returning * into created_delivery;

  insert into public.user_notifications
    (user_id, request_id, notification_type, title, body)
  values
    (request_owner, p_request_id, 'delivery', 'مخرجات جديدة جاهزة',
     'تمت إضافة ' || clean_version || ' إلى ملفات تسليم الطلب.');

  return created_delivery;
end;
$$;

create or replace function private.notify_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  note_title text;
  note_body text;
begin
  if old.quote_status is distinct from new.quote_status then
    if new.quote_status = 'pending' then
      insert into public.user_notifications
        (user_id, request_id, notification_type, title, body)
      values
        (new.user_id, new.id, 'quote', 'وصل عرض سعر جديد',
         'راجع السعر ونطاق العمل وموعد التسليم ثم سجّل قرارك.');
    elsif new.quote_status in ('accepted', 'rejected') then
      note_title := case when new.quote_status = 'accepted' then 'قَبِل العميل عرض السعر' else 'رفض العميل عرض السعر' end;
      note_body := 'تم تسجيل قرار العميل للطلب ' || new.request_number || '.';
      insert into public.user_notifications
        (user_id, request_id, notification_type, title, body)
      select account.id, new.id, 'quote', note_title, note_body
      from public.profiles account
      where account.role = 'admin';
    end if;
  elsif old.status is distinct from new.status then
    note_title := 'تحديث حالة الطلب';
    note_body := case new.status
      when 'reviewing' then 'انتقل طلبك إلى مرحلة المراجعة.'
      when 'in_progress' then 'بدأ تنفيذ طلبك.'
      when 'completed' then 'اكتمل تنفيذ طلبك.'
      else 'تم تحديث حالة طلبك.'
    end;
    insert into public.user_notifications
      (user_id, request_id, notification_type, title, body)
    values (new.user_id, new.id, 'status', note_title, note_body);
  end if;
  return new;
end;
$$;

revoke all on function private.notify_request_update()
  from public, anon, authenticated, service_role;

drop trigger if exists service_requests_notify_update on public.service_requests;
create trigger service_requests_notify_update
  after update of status, quote_status on public.service_requests
  for each row execute procedure private.notify_request_update();

revoke all on function public.send_request_message(uuid, text)
  from public, anon;
revoke all on function public.mark_notifications_read(uuid)
  from public, anon;
revoke all on function public.admin_register_request_deliverable(uuid, text, text, bigint, text, text, text)
  from public, anon;
grant execute on function public.send_request_message(uuid, text) to authenticated;
grant execute on function public.mark_notifications_read(uuid) to authenticated;
grant execute on function public.admin_register_request_deliverable(uuid, text, text, bigint, text, text, text)
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-deliverables',
  'request-deliverables',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/zip',
    'image/jpeg', 'image/png', 'image/tiff',
    'application/geo+json', 'application/json',
    'application/geopackage+sqlite3',
    'application/vnd.google-earth.kml+xml', 'application/vnd.google-earth.kmz'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_request_deliverables_read on storage.objects;
create policy storage_request_deliverables_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-deliverables'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((select private.is_admin()) and (select private.admin_mfa_ok()))
    )
  );

drop policy if exists storage_request_deliverables_insert on storage.objects;
create policy storage_request_deliverables_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-deliverables'
    and (select private.is_admin())
    and (select private.admin_mfa_ok())
  );

drop policy if exists storage_request_deliverables_delete on storage.objects;
create policy storage_request_deliverables_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-deliverables'
    and (select private.is_admin())
    and (select private.admin_mfa_ok())
  );

commit;

select
  to_regclass('public.request_messages') is not null as messages_ready,
  to_regclass('public.request_deliverables') is not null as deliverables_ready,
  to_regclass('public.user_notifications') is not null as notifications_ready,
  to_regprocedure('public.send_request_message(uuid,text)') is not null as message_rpc_ready,
  to_regprocedure('public.admin_register_request_deliverable(uuid,text,text,bigint,text,text,text)') is not null as delivery_rpc_ready,
  exists (select 1 from storage.buckets where id = 'request-deliverables' and public = false) as private_bucket_ready;
