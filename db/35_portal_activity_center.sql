-- Patient-safe notification center. Basics remains the source of truth; the
-- portal receives only its linked client's published operational messages.

-- Keep the signed bridge allowlist in the same migration that introduces the
-- activity actions. Without this replacement portal-core rejects the request
-- before either scoped RPC can run.
alter table public.portal_core_request_receipts
  drop constraint if exists portal_core_request_receipts_action_check;
alter table public.portal_core_request_receipts
  add constraint portal_core_request_receipts_action_check check (action in (
    'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
    'billing', 'create_checkout', 'payment_status', 'rewards', 'submit_checkin',
    'request_appointment', 'confirm_appointment', 'request_profile_change',
    'request_records', 'redeem_reward', 'document_url',
    'document_upload_prepare', 'document_upload_complete',
    'activity', 'mark_notification_read'
  ));

create or replace function public.portal_core_register_request(
  p_request_id uuid,
  p_portal_user_id uuid,
  p_client_id uuid,
  p_action text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in (
    'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
    'billing', 'create_checkout', 'payment_status', 'rewards', 'submit_checkin',
    'request_appointment', 'confirm_appointment', 'request_profile_change',
    'request_records', 'redeem_reward', 'document_url',
    'document_upload_prepare', 'document_upload_complete',
    'activity', 'mark_notification_read'
  ) or p_expires_at <= now() or p_expires_at > now() + interval '2 minutes'
     or not exists (select 1 from public.clients c where c.id = p_client_id and c.active) then
    return false;
  end if;
  delete from public.portal_core_request_receipts where expires_at < now() - interval '10 minutes';
  insert into public.portal_core_request_receipts(request_id, portal_user_id, client_id, action, expires_at)
  values (p_request_id, p_portal_user_id, p_client_id, p_action, p_expires_at);
  return true;
exception when unique_violation then return false;
end;
$$;

create or replace function public.portal_core_get_activity(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid,
  p_params jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((p_params->>'limit')::integer, 20), 1), 50);
  v_cursor jsonb := nullif(p_params->>'cursor', '')::jsonb;
  v_cursor_at timestamptz := nullif(v_cursor->>'createdAt', '')::timestamptz;
  v_cursor_id uuid := nullif(v_cursor->>'id', '')::uuid;
  v_items jsonb;
  v_unread integer;
  v_last_at timestamptz;
  v_last_id uuid;
  v_next text;
begin
  if not public.portal_core_request_valid(p_request_id, p_portal_user_id, p_client_id, 'activity') then
    raise exception 'Solicitud inválida' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'kind', n.kind,
    'title', n.title,
    'detail', n.body,
    'tone', n.tone,
    'actionPath', case when n.action_path ~ '^/(inicio|mi-plan|progreso|check-in|citas|documentos|planes|pagos|recompensas|perfil)([/?#].*)?$' then n.action_path else null end,
    'readAt', n.read_at,
    'occurredAt', n.created_at
  ) order by n.created_at desc, n.id desc), '[]'::jsonb)
  into v_items
  from (
    select *
    from public.portal_notifications
    where client_id = p_client_id
      and (v_cursor is null or (created_at, id) < (v_cursor_at, v_cursor_id))
    order by created_at desc, id desc
    limit v_limit
  ) n;

  select n.created_at, n.id
  into v_last_at, v_last_id
  from public.portal_notifications n
  where n.client_id = p_client_id
    and (v_cursor is null or (n.created_at, n.id) < (v_cursor_at, v_cursor_id))
  order by n.created_at desc, n.id desc
  limit 1 offset greatest(v_limit - 1, 0);

  select count(*)::integer into v_unread
  from public.portal_notifications
  where client_id = p_client_id and read_at is null;

  if v_last_at is not null and exists (
    select 1 from public.portal_notifications
    where client_id = p_client_id and (created_at, id) < (v_last_at, v_last_id)
  ) then
    v_next := jsonb_build_object('createdAt', v_last_at, 'id', v_last_id)::text;
  end if;

  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action, metadata)
  values (p_request_id, p_portal_user_id, p_client_id, 'activity', jsonb_build_object('limit', v_limit));

  return jsonb_build_object('items', v_items, 'unreadCount', v_unread, 'nextCursor', v_next);
end
$$;

create or replace function public.portal_core_mark_notification_read(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid,
  p_params jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all boolean := coalesce((p_params->>'all')::boolean, false);
  v_notification uuid := nullif(p_params->>'notificationId', '')::uuid;
  v_changed integer := 0;
  v_unread integer := 0;
begin
  if not public.portal_core_request_valid(p_request_id, p_portal_user_id, p_client_id, 'mark_notification_read') then
    raise exception 'Solicitud inválida' using errcode = '42501';
  end if;
  if not v_all and v_notification is null then
    raise exception 'Notificación requerida' using errcode = '22023';
  end if;

  if v_all then
    update public.portal_notifications set read_at = now()
    where client_id = p_client_id and read_at is null;
  else
    update public.portal_notifications set read_at = coalesce(read_at, now())
    where id = v_notification and client_id = p_client_id and read_at is null;
  end if;
  get diagnostics v_changed = row_count;

  select count(*)::integer into v_unread
  from public.portal_notifications
  where client_id = p_client_id and read_at is null;

  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action, metadata)
  values (
    p_request_id,
    p_portal_user_id,
    p_client_id,
    'mark_notification_read',
    jsonb_strip_nulls(jsonb_build_object('all', v_all, 'notificationId', v_notification, 'changed', v_changed))
  );

  return jsonb_build_object('ok', true, 'changed', v_changed, 'unreadCount', v_unread);
end
$$;

revoke all on function public.portal_core_get_activity(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.portal_core_mark_notification_read(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.portal_core_register_request(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.portal_core_get_activity(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.portal_core_mark_notification_read(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.portal_core_register_request(uuid, uuid, uuid, text, timestamptz) to service_role;
