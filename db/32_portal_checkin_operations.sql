-- ============================================================
-- HEALEN OS · 32 · Operación clínica de check-ins del portal
--
-- Convierte cada check-in en una tarea trazable para el equipo: prioridad,
-- responsable, vencimiento, revisión clínica y respuesta al paciente.
-- ============================================================

begin;

alter table public.portal_checkins
  add column if not exists priority text not null default 'routine',
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists assigned_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists resolved_at timestamptz;

alter table public.portal_checkins
  drop constraint if exists portal_checkins_priority_check;
alter table public.portal_checkins
  add constraint portal_checkins_priority_check
  check (priority in ('routine', 'priority', 'urgent'));

update public.portal_checkins
set priority = case when review_status = 'escalated' then 'urgent' else priority end,
    due_at = coalesce(
      due_at,
      created_at + case when review_status = 'escalated' then interval '4 hours' else interval '24 hours' end
    ),
    resolved_at = case
      when review_status in ('reviewed', 'dismissed') then coalesce(resolved_at, reviewed_at, created_at)
      else null
    end;

create or replace function public.portal_prepare_checkin_operation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.review_status = 'escalated' then
    new.priority := 'urgent';
  end if;
  if new.due_at is null then
    new.due_at := coalesce(new.created_at, now())
      + case when new.review_status = 'escalated' then interval '4 hours' else interval '24 hours' end;
  end if;
  return new;
end;
$$;

drop trigger if exists portal_prepare_checkin_operation on public.portal_checkins;
create trigger portal_prepare_checkin_operation
before insert or update of review_status, priority, due_at on public.portal_checkins
for each row execute function public.portal_prepare_checkin_operation();

create index if not exists idx_portal_checkins_operations
  on public.portal_checkins(review_status, priority, due_at, created_at desc);
create index if not exists idx_portal_checkins_assignee_open
  on public.portal_checkins(assigned_to, due_at)
  where review_status in ('pending', 'escalated');

create or replace function public.dash_portal_checkin_operations(
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
  if p_scope not in ('open', 'priority', 'reviewed', 'all') then
    raise exception 'Filtro inválido' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(item order by
    case item->>'reviewStatus' when 'escalated' then 0 when 'pending' then 1 else 2 end,
    (item->>'dueAt')::timestamptz nulls last,
    (item->>'createdAt')::timestamptz desc
  ), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', c.id,
      'clientId', c.client_id,
      'patientCode', cl.code,
      'patientName', cl.full_name,
      'patientPhone', cl.phone,
      'reviewStatus', c.review_status,
      'priority', c.priority,
      'answers', c.answers,
      'alarmFlags', c.alarm_flags,
      'assignedTo', c.assigned_to,
      'assignedName', assignee.full_name,
      'assignedAt', c.assigned_at,
      'dueAt', coalesce(c.due_at, c.created_at + case when c.review_status='escalated' then interval '4 hours' else interval '24 hours' end),
      'createdAt', c.created_at,
      'reviewedAt', c.reviewed_at,
      'responseToPatient', c.response_to_patient,
      'isOverdue', c.review_status in ('pending','escalated') and coalesce(c.due_at, c.created_at + interval '24 hours') < now()
    ) item
    from public.portal_checkins c
    join public.clients cl on cl.id = c.client_id
    left join public.profiles assignee on assignee.id = c.assigned_to
    where case p_scope
      when 'open' then c.review_status in ('pending', 'escalated')
      when 'priority' then c.review_status = 'escalated' or (c.review_status = 'pending' and c.priority in ('priority','urgent'))
      when 'reviewed' then c.review_status in ('reviewed', 'dismissed')
      else true
    end
    order by
      case c.review_status when 'escalated' then 0 when 'pending' then 1 else 2 end,
      coalesce(c.due_at, c.created_at + interval '24 hours') nulls last,
      c.created_at desc
    limit v_limit
  ) q;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'open', (select count(*) from public.portal_checkins where review_status in ('pending','escalated')),
      'priority', (select count(*) from public.portal_checkins where review_status='escalated' or (review_status='pending' and priority in ('priority','urgent'))),
      'overdue', (select count(*) from public.portal_checkins where review_status in ('pending','escalated') and coalesce(due_at, created_at + interval '24 hours') < now()),
      'reviewedToday', (select count(*) from public.portal_checkins where review_status='reviewed' and reviewed_at >= current_date)
    ),
    'items', v_items
  );
end;
$$;

create or replace function public.dash_portal_checkin_action(
  p_checkin uuid,
  p_action text,
  p_response text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_checkin public.portal_checkins%rowtype;
  v_response text := nullif(trim(coalesce(p_response, '')), '');
  v_is_clinical boolean;
begin
  perform public.require_staff();
  select exists(
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role in ('admin','medico')
  ) into v_is_clinical;

  select * into v_checkin
  from public.portal_checkins
  where id = p_checkin
  for update;
  if v_checkin.id is null then
    raise exception 'Check-in no encontrado' using errcode = '22023';
  end if;

  if p_action = 'assign_to_me' then
    if v_checkin.review_status not in ('pending','escalated') then
      raise exception 'Este check-in ya está cerrado' using errcode = '22023';
    end if;
    update public.portal_checkins
    set assigned_to = auth.uid(), assigned_at = now()
    where id = p_checkin;

  elsif p_action = 'review_complete' then
    if not v_is_clinical then
      raise exception 'Se requiere autorización clínica para cerrar la revisión' using errcode = '42501';
    end if;
    if v_response is null or char_length(v_response) < 10 then
      raise exception 'Escribe una respuesta clara para el paciente' using errcode = '22023';
    end if;
    update public.portal_checkins
    set review_status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
        response_to_patient = left(v_response, 1200), assigned_to = coalesce(assigned_to, auth.uid()),
        assigned_at = coalesce(assigned_at, now()), resolved_at = now()
    where id = p_checkin;

    update public.portal_progress_metrics
    set validated = true, validated_by = auth.uid(), validated_at = now()
    where source_type = 'checkin' and source_id::text = p_checkin::text;

    insert into public.portal_notifications(client_id, kind, title, body, tone, action_path)
    values (v_checkin.client_id, 'checkin_reviewed', 'Tu check-in fue revisado', left(v_response, 1200), 'success', '/progreso');
    insert into public.portal_events(client_id, event_type, resource_type, resource_id)
    values (v_checkin.client_id, 'checkin_reviewed', 'portal_checkin', p_checkin::text);

  elsif p_action = 'dismiss' then
    if not v_is_clinical then
      raise exception 'Se requiere autorización clínica para descartar el check-in' using errcode = '42501';
    end if;
    update public.portal_checkins
    set review_status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now(),
        response_to_patient = v_response, assigned_to = coalesce(assigned_to, auth.uid()),
        assigned_at = coalesce(assigned_at, now()), resolved_at = now()
    where id = p_checkin;
    insert into public.portal_events(client_id, event_type, resource_type, resource_id)
    values (v_checkin.client_id, 'checkin_dismissed', 'portal_checkin', p_checkin::text);
  else
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  insert into public.portal_access_audit(auth_user_id, client_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), v_checkin.client_id, 'staff_' || p_action, 'portal_checkin', p_checkin::text,
    jsonb_build_object('previousStatus', v_checkin.review_status));

  return jsonb_build_object('id', p_checkin, 'action', p_action, 'ok', true);
end;
$$;

create or replace function public.dash_portal_patient_status(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_checkins bigint := 0;
  v_requests bigint := 0;
  v_documents bigint := 0;
  v_ai bigint := 0;
  v_points bigint := 0;
  v_published boolean := false;
begin
  perform public.require_staff();
  if not exists(select 1 from public.clients where id = p_client) then
    raise exception 'Paciente no encontrado' using errcode = '22023';
  end if;
  select count(*) into v_checkins from public.portal_checkins c
  where c.client_id=p_client and c.review_status in ('pending','escalated');
  if to_regclass('public.portal_appointment_requests') is not null then
    select count(*) into v_requests from public.portal_appointment_requests r
    where r.client_id=p_client and r.status='pending';
  end if;
  if to_regclass('public.portal_profile_change_requests') is not null then
    v_requests := v_requests + (select count(*) from public.portal_profile_change_requests r where r.client_id=p_client and r.status='pending');
  end if;
  if to_regclass('public.patient_documents') is not null then
    select count(*) into v_documents from public.patient_documents d
    where d.client_id=p_client and d.review_status='pending_review';
  end if;
  if to_regclass('public.ai_analysis_drafts') is not null then
    select count(*) into v_ai from public.ai_analysis_drafts d
    where d.client_id=p_client and d.review_status='needs_review';
  end if;
  if to_regclass('public.portal_reward_events') is not null then
    select coalesce(sum(e.points),0) into v_points from public.portal_reward_events e where e.client_id=p_client;
  end if;
  select coalesce(bool_or(t.portal_visibility='patient_published'),false) into v_published
  from public.treatments t where t.client_id=p_client and t.status in ('activo','por_finalizar');
  return jsonb_build_object(
    'pendingCheckins', v_checkins,
    'pendingRequests', v_requests,
    'pendingDocuments', v_documents,
    'aiDrafts', v_ai,
    'rewardPoints', v_points,
    'treatmentPublished', v_published
  );
end;
$$;

revoke execute on function public.portal_prepare_checkin_operation() from public, anon, authenticated;
revoke execute on function public.dash_portal_checkin_operations(text, integer) from public, anon;
revoke execute on function public.dash_portal_checkin_action(uuid, text, text) from public, anon;
revoke execute on function public.dash_portal_patient_status(uuid) from public, anon;
grant execute on function public.dash_portal_checkin_operations(text, integer) to authenticated;
grant execute on function public.dash_portal_checkin_action(uuid, text, text) to authenticated;
grant execute on function public.dash_portal_patient_status(uuid) to authenticated;

commit;
