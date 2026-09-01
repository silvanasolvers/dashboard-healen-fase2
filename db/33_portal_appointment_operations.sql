-- ============================================================
-- HEALEN OS · 33 · Operación de citas solicitadas desde portal
--
-- Convierte solicitudes del paciente en una cola operativa segura para
-- recepción. Aceptar crea/reprograma/cancela la cita canónica; rechazar
-- conserva la solicitud y siempre informa al paciente.
-- ============================================================

begin;

alter table public.appointments
  add column if not exists location text;

alter table public.portal_appointment_requests
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists assigned_at timestamptz,
  add column if not exists due_at timestamptz;

update public.portal_appointment_requests
set due_at = coalesce(due_at, created_at + interval '8 hours')
where due_at is null;

create or replace function public.portal_prepare_appointment_request()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.due_at is null then
    new.due_at := coalesce(new.created_at, now()) + interval '8 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists portal_prepare_appointment_request on public.portal_appointment_requests;
create trigger portal_prepare_appointment_request
before insert on public.portal_appointment_requests
for each row execute function public.portal_prepare_appointment_request();

create index if not exists idx_portal_appointment_requests_operations
  on public.portal_appointment_requests(status, due_at, created_at desc);
create index if not exists idx_portal_appointment_requests_assignee_open
  on public.portal_appointment_requests(assigned_to, due_at)
  where status = 'pending';

create or replace function public.portal_core_request_appointment(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid,
  p_params jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_type text := coalesce(p_params->>'kind', 'new');
  v_appointment uuid;
  v_window text := nullif(trim(coalesce(p_params->>'preferredWindow', '')), '');
  v_message text := nullif(trim(coalesce(p_params->>'message', '')), '');
begin
  if not public.portal_core_request_valid(p_request_id, p_portal_user_id, p_client_id, 'request_appointment') then
    raise exception 'Solicitud inválida' using errcode = '42501';
  end if;
  if v_type not in ('new', 'reschedule', 'cancel') then
    raise exception 'Tipo de solicitud inválido' using errcode = '22023';
  end if;
  if nullif(p_params->>'appointmentId', '') is not null then
    v_appointment := (p_params->>'appointmentId')::uuid;
  end if;
  if v_type in ('reschedule', 'cancel') and v_appointment is null then
    raise exception 'Selecciona la cita que quieres modificar' using errcode = '22023';
  end if;
  if v_appointment is not null and not exists (
    select 1 from public.appointments a
    where a.id = v_appointment and a.client_id = p_client_id and a.visible_to_patient
  ) then
    raise exception 'Cita inválida' using errcode = '42501';
  end if;
  if v_type in ('new', 'reschedule') and v_window is null then
    raise exception 'Indica una fecha o franja preferida' using errcode = '22023';
  end if;
  if char_length(coalesce(v_window, '')) > 200 or char_length(coalesce(v_message, '')) > 1000 then
    raise exception 'La solicitud es demasiado larga' using errcode = '22023';
  end if;

  select r.id into v_id
  from public.portal_appointment_requests r
  where r.client_id = p_client_id
    and r.status = 'pending'
    and r.request_type = v_type
    and r.appointment_id is not distinct from v_appointment
  order by r.created_at desc
  limit 1;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  insert into public.portal_appointment_requests(
    client_id, appointment_id, source_request_id, request_type, preferred_window, message
  ) values (
    p_client_id, v_appointment, p_request_id, v_type, left(v_window, 200), left(v_message, 1000)
  ) returning id into v_id;

  insert into public.portal_events(client_id, event_type, resource_type, resource_id)
  values (p_client_id, 'appointment_requested', 'appointment_request', v_id::text);

  return jsonb_build_object('id', v_id, 'duplicate', false);
end;
$$;

create or replace function public.dash_portal_appointment_operations(
  p_scope text default 'open',
  p_limit integer default 100
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_items jsonb;
begin
  perform public.require_staff();
  if p_scope not in ('open', 'new', 'reschedule', 'cancel', 'resolved', 'all') then
    raise exception 'Filtro inválido' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(item order by
    (item->>'isUrgent')::boolean desc,
    (item->>'dueAt')::timestamptz nulls last,
    (item->>'createdAt')::timestamptz desc
  ), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'clientId', r.client_id,
      'patientCode', c.code,
      'patientName', c.full_name,
      'patientPhone', c.phone,
      'patientEmail', c.email,
      'requestType', r.request_type,
      'status', r.status,
      'preferredWindow', r.preferred_window,
      'message', r.message,
      'assignedTo', r.assigned_to,
      'assignedName', assignee.full_name,
      'assignedAt', r.assigned_at,
      'dueAt', coalesce(r.due_at, r.created_at + interval '8 hours'),
      'createdAt', r.created_at,
      'staffResponse', r.staff_response,
      'resolvedAt', r.resolved_at,
      'resolvedByName', resolver.full_name,
      'isOverdue', r.status = 'pending' and coalesce(r.due_at, r.created_at + interval '8 hours') < now(),
      'isUrgent', r.status = 'pending' and r.appointment_id is not null and a.starts_at between now() and now() + interval '24 hours',
      'appointment', case when a.id is null then null else jsonb_build_object(
        'id', a.id,
        'title', coalesce(nullif(a.service, ''), 'Cita Healen'),
        'startsAt', a.starts_at,
        'endsAt', a.ends_at,
        'location', a.location,
        'status', a.status
      ) end
    ) item
    from public.portal_appointment_requests r
    join public.clients c on c.id = r.client_id
    left join public.appointments a on a.id = r.appointment_id
    left join public.profiles assignee on assignee.id = r.assigned_to
    left join public.profiles resolver on resolver.id = r.resolved_by
    where case p_scope
      when 'open' then r.status = 'pending'
      when 'new' then r.status = 'pending' and r.request_type = 'new'
      when 'reschedule' then r.status = 'pending' and r.request_type = 'reschedule'
      when 'cancel' then r.status = 'pending' and r.request_type = 'cancel'
      when 'resolved' then r.status in ('accepted', 'declined', 'resolved')
      else true
    end
    order by
      (r.status = 'pending' and r.appointment_id is not null and a.starts_at between now() and now() + interval '24 hours') desc,
      coalesce(r.due_at, r.created_at + interval '8 hours') nulls last,
      r.created_at desc
    limit v_limit
  ) q;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'open', (select count(*) from public.portal_appointment_requests where status = 'pending'),
      'new', (select count(*) from public.portal_appointment_requests where status = 'pending' and request_type = 'new'),
      'changes', (select count(*) from public.portal_appointment_requests where status = 'pending' and request_type in ('reschedule', 'cancel')),
      'overdue', (select count(*) from public.portal_appointment_requests where status = 'pending' and coalesce(due_at, created_at + interval '8 hours') < now()),
      'resolvedToday', (select count(*) from public.portal_appointment_requests where status in ('accepted','declined','resolved') and resolved_at >= current_date)
    ),
    'items', v_items
  );
end;
$$;

create or replace function public.dash_portal_appointment_action(
  p_request uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request public.portal_appointment_requests%rowtype;
  v_appointment public.appointments%rowtype;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_service text := nullif(trim(coalesce(p_payload->>'service', '')), '');
  v_location text := nullif(trim(coalesce(p_payload->>'location', '')), '');
  v_response text := nullif(trim(coalesce(p_payload->>'response', '')), '');
  v_title text;
  v_body text;
  v_event text;
begin
  perform public.require_staff();

  select * into v_request
  from public.portal_appointment_requests
  where id = p_request
  for update;
  if v_request.id is null then
    raise exception 'Solicitud no encontrada' using errcode = '22023';
  end if;

  if p_action = 'assign_to_me' then
    if v_request.status <> 'pending' then
      raise exception 'Esta solicitud ya fue resuelta' using errcode = '22023';
    end if;
    update public.portal_appointment_requests
    set assigned_to = auth.uid(), assigned_at = now()
    where id = p_request;
    insert into public.portal_access_audit(auth_user_id, client_id, action, resource_type, resource_id)
    values (auth.uid(), v_request.client_id, 'staff_assign_to_me', 'portal_appointment_request', p_request::text);
    return jsonb_build_object('id', p_request, 'action', p_action, 'ok', true);
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Esta solicitud ya fue resuelta' using errcode = '22023';
  end if;
  if p_action not in ('accept', 'decline') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;
  if v_response is null or char_length(v_response) < 8 then
    raise exception 'Escribe una respuesta clara para el paciente' using errcode = '22023';
  end if;

  if p_action = 'decline' then
    update public.portal_appointment_requests
    set status = 'declined', staff_response = left(v_response, 1200), resolved_by = auth.uid(), resolved_at = now(),
        assigned_to = coalesce(assigned_to, auth.uid()), assigned_at = coalesce(assigned_at, now())
    where id = p_request;
    v_title := 'Respuesta a tu solicitud de cita';
    v_body := left(v_response, 1200);
    v_event := 'appointment_request_declined';
  else
    if v_request.request_type in ('new', 'reschedule') then
      begin
        v_starts_at := (p_payload->>'startsAt')::timestamptz;
        v_ends_at := coalesce(nullif(p_payload->>'endsAt', '')::timestamptz, v_starts_at + interval '1 hour');
      exception when others then
        raise exception 'Selecciona una fecha y hora válidas' using errcode = '22023';
      end;
      if v_starts_at < now() + interval '10 minutes' then
        raise exception 'La cita debe quedar programada en el futuro' using errcode = '22023';
      end if;
      if v_ends_at <= v_starts_at or v_ends_at > v_starts_at + interval '8 hours' then
        raise exception 'La duración de la cita no es válida' using errcode = '22023';
      end if;
      if v_service is null or char_length(v_service) > 160 or char_length(coalesce(v_location, '')) > 200 then
        raise exception 'Completa el servicio y revisa la ubicación' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.appointments conflict
        where conflict.client_id = v_request.client_id
          and conflict.id is distinct from v_request.appointment_id
          and conflict.status in ('programada', 'confirmada', 'reprogramacion_solicitada')
          and conflict.starts_at < v_ends_at
          and coalesce(conflict.ends_at, conflict.starts_at + interval '1 hour') > v_starts_at
      ) then
        raise exception 'El paciente ya tiene una cita en ese horario' using errcode = '22023';
      end if;
    end if;

    if v_request.request_type = 'new' then
      insert into public.appointments(
        client_id, starts_at, ends_at, event_type, service, status, location,
        visible_to_patient, created_by, source_system, source_key
      ) values (
        v_request.client_id, v_starts_at, v_ends_at, 'clinico', left(v_service, 160), 'programada',
        left(v_location, 200), true, auth.uid(), 'portal', v_request.id::text
      ) returning * into v_appointment;
      v_title := 'Tu cita fue programada';
      v_body := left(v_response, 1200);
      v_event := 'appointment_scheduled';
    elsif v_request.request_type = 'reschedule' then
      update public.appointments
      set starts_at = v_starts_at, ends_at = v_ends_at, service = left(v_service, 160),
          location = left(v_location, 200), status = 'programada', visible_to_patient = true
      where id = v_request.appointment_id and client_id = v_request.client_id
      returning * into v_appointment;
      if v_appointment.id is null then
        raise exception 'La cita original ya no está disponible' using errcode = '22023';
      end if;
      v_title := 'Tu cita fue reprogramada';
      v_body := left(v_response, 1200);
      v_event := 'appointment_rescheduled';
    else
      update public.appointments
      set status = 'cancelada'
      where id = v_request.appointment_id and client_id = v_request.client_id
        and status not in ('cancelada', 'vencida', 'completada')
      returning * into v_appointment;
      if v_appointment.id is null then
        raise exception 'La cita ya no se puede cancelar' using errcode = '22023';
      end if;
      v_title := 'Tu cita fue cancelada';
      v_body := left(v_response, 1200);
      v_event := 'appointment_cancelled';
    end if;

    update public.portal_appointment_requests
    set appointment_id = coalesce(v_appointment.id, appointment_id), status = 'accepted',
        staff_response = left(v_response, 1200), resolved_by = auth.uid(), resolved_at = now(),
        assigned_to = coalesce(assigned_to, auth.uid()), assigned_at = coalesce(assigned_at, now())
    where id = p_request;
  end if;

  insert into public.portal_notifications(client_id, kind, title, body, tone, action_path)
  values (v_request.client_id, 'appointment', v_title, v_body,
    case when p_action = 'accept' then 'success' else 'info' end, '/citas');
  insert into public.portal_events(client_id, event_type, resource_type, resource_id)
  values (v_request.client_id, v_event, 'appointment_request', p_request::text);
  insert into public.portal_access_audit(auth_user_id, client_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), v_request.client_id, 'staff_' || p_action, 'portal_appointment_request', p_request::text,
    jsonb_build_object('requestType', v_request.request_type, 'appointmentId', coalesce(v_appointment.id, v_request.appointment_id)));

  return jsonb_build_object(
    'id', p_request,
    'appointmentId', coalesce(v_appointment.id, v_request.appointment_id),
    'action', p_action,
    'ok', true
  );
end;
$$;

create or replace function public.portal_core_get_appointments(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if not public.portal_core_request_valid(p_request_id, p_portal_user_id, p_client_id, 'appointments') then
    raise exception 'Solicitud inválida' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'title', coalesce(nullif(a.service, ''), 'Cita Healen'),
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'location', a.location,
    'status', a.status
  ) order by a.starts_at desc), '[]'::jsonb)
  into v_result
  from public.appointments a
  where a.client_id = p_client_id and a.visible_to_patient;
  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action)
  values (p_request_id, p_portal_user_id, p_client_id, 'appointments');
  return v_result;
end;
$$;

revoke all on function public.portal_core_request_appointment(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.portal_core_get_appointments(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.portal_core_request_appointment(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.portal_core_get_appointments(uuid, uuid, uuid) to service_role;

revoke all on function public.dash_portal_appointment_operations(text, integer) from public, anon, authenticated;
revoke all on function public.dash_portal_appointment_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.dash_portal_appointment_operations(text, integer) to authenticated;
grant execute on function public.dash_portal_appointment_action(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
