-- ============================================================
-- HEALEN OS · 29 · Portal Core bridge (Basics)
--
-- Basics remains the only clinical source of truth. Patient browsers never
-- receive access to these functions: only the local service_role used by the
-- portal-core Edge Function may execute them.
-- ============================================================

begin;

-- Publication is explicit and defaults closed for all existing records.
alter table public.treatments
  add column if not exists portal_visibility text not null default 'internal'
  check (portal_visibility in ('internal', 'patient_published'));
alter table public.treatments add column if not exists portal_published_at timestamptz;
alter table public.treatments add column if not exists portal_published_by uuid references auth.users(id);

alter table public.treatment_items
  add column if not exists portal_visibility text not null default 'internal'
  check (portal_visibility in ('internal', 'patient_published'));
alter table public.treatment_items add column if not exists portal_published_at timestamptz;
alter table public.treatment_items add column if not exists portal_published_by uuid references auth.users(id);

alter table public.appointments add column if not exists visible_to_patient boolean not null default false;
alter table public.patient_milestones add column if not exists visible_to_patient boolean not null default false;
alter table public.patient_milestones add column if not exists patient_can_complete boolean not null default false;

create table if not exists public.portal_core_request_receipts (
  request_id uuid primary key,
  portal_user_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  action text not null check (action in ('home', 'treatment', 'appointments')),
  expires_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists public.portal_core_access_audit (
  id bigint generated always as identity primary key,
  request_id uuid,
  portal_user_id uuid,
  client_id uuid references public.clients(id) on delete set null,
  action text not null,
  success boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_portal_core_audit_client_time
  on public.portal_core_access_audit(client_id, occurred_at desc);
create index if not exists idx_portal_core_receipts_expiry
  on public.portal_core_request_receipts(expires_at);

alter table public.portal_core_request_receipts enable row level security;
alter table public.portal_core_access_audit enable row level security;
revoke all on table public.portal_core_request_receipts, public.portal_core_access_audit
  from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_core_request_receipts,
  public.portal_core_access_audit to service_role;
grant usage, select on sequence public.portal_core_access_audit_id_seq to service_role;

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
  if p_action not in ('home', 'treatment', 'appointments')
     or p_expires_at <= now()
     or p_expires_at > now() + interval '2 minutes'
     or not exists (
       select 1 from public.clients c where c.id = p_client_id and c.active
     ) then
    return false;
  end if;

  delete from public.portal_core_request_receipts where expires_at < now() - interval '10 minutes';
  insert into public.portal_core_request_receipts(request_id, portal_user_id, client_id, action, expires_at)
  values (p_request_id, p_portal_user_id, p_client_id, p_action, p_expires_at);
  return true;
exception when unique_violation then
  return false;
end;
$$;

create or replace function public.portal_core_treatment_snapshot(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'phase', coalesce((
        select m.phase
        from public.patient_milestones m
        where m.client_id = t.client_id and m.treatment_id = t.id and m.active
          and m.visible_to_patient
        order by m.pinned desc, m.position, m.target_date nulls last
        limit 1
      ), 'Tratamiento'),
      'startsOn', t.start_date,
      'endsOn', t.end_date,
      'progress', case
        when t.end_date is null or t.end_date <= t.start_date then 0
        else greatest(0, least(100, round(
          100.0 * (current_date - t.start_date) / nullif(t.end_date - t.start_date, 0)
        )))
      end,
      'status', case
        when t.status::text = 'por_finalizar' then 'ending'
        when t.status::text = 'finalizado' then 'completed'
        else 'active'
      end,
      'nextAction', (
        select m.title
        from public.patient_milestones m
        where m.client_id = t.client_id and m.treatment_id = t.id and m.active
          and m.visible_to_patient and m.status in ('pendiente', 'en_progreso')
        order by m.pinned desc, m.target_date nulls last, m.position
        limit 1
      ),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'dose', i.dose,
          'frequency', i.schedule,
          'route', i.route,
          'instructions', i.instructions,
          'startsOn', i.starts_on,
          'endsOn', i.ends_on,
          'progress', case
            when i.planned_quantity > 0 then greatest(0, least(100, round(100.0 * i.dispensed_quantity / i.planned_quantity)))
            else 0
          end
        ) order by i.starts_on nulls last, i.created_at)
        from public.treatment_items i
        where i.treatment_id = t.id and i.portal_visibility = 'patient_published'
      ), '[]'::jsonb)
    )
    from public.treatments t
    where t.client_id = p_client_id
      and t.portal_visibility = 'patient_published'
      and t.status::text in ('activo', 'por_finalizar', 'finalizado')
    order by
      case when t.status::text in ('activo', 'por_finalizar') then 0 else 1 end,
      t.start_date desc
    limit 1
  ), 'null'::jsonb);
$$;

create or replace function public.portal_core_get_home(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_treatment jsonb;
  v_appointment jsonb;
begin
  if not exists (
    select 1 from public.portal_core_request_receipts r
    where r.request_id = p_request_id
      and r.portal_user_id = p_portal_user_id
      and r.client_id = p_client_id
      and r.action = 'home'
      and r.expires_at > now()
  ) then
    raise exception 'Solicitud inválida' using errcode = '42501';
  end if;

  select * into v_client from public.clients where id = p_client_id and active;
  if v_client.id is null then
    raise exception 'Paciente no disponible' using errcode = '42501';
  end if;

  v_treatment := public.portal_core_treatment_snapshot(p_client_id);
  select jsonb_build_object(
    'id', a.id,
    'title', coalesce(a.service, 'Cita Healen'),
    'startsAt', a.starts_at,
    'location', null,
    'status', a.status
  ) into v_appointment
  from public.appointments a
  where a.client_id = p_client_id
    and a.visible_to_patient
    and a.starts_at >= now()
    and a.status not in ('cancelada', 'vencida')
  order by a.starts_at
  limit 1;

  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action)
  values (p_request_id, p_portal_user_id, p_client_id, 'home');

  return jsonb_build_object(
    'identity', jsonb_strip_nulls(jsonb_build_object(
      'displayName', v_client.full_name,
      'initials', upper(left(v_client.full_name, 1)),
      'email', v_client.email,
      'phone', v_client.phone,
      'address', v_client.address
    )),
    'treatment', v_treatment,
    'nextAppointment', v_appointment,
    'pendingCheckin', null,
    'alerts', '[]'::jsonb,
    'points', 0,
    'nextReward', null
  );
end;
$$;

create or replace function public.portal_core_get_treatment(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.portal_core_request_receipts r
    where r.request_id = p_request_id and r.portal_user_id = p_portal_user_id
      and r.client_id = p_client_id and r.action = 'treatment' and r.expires_at > now()
  ) then raise exception 'Solicitud inválida' using errcode = '42501'; end if;
  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action)
  values (p_request_id, p_portal_user_id, p_client_id, 'treatment');
  return public.portal_core_treatment_snapshot(p_client_id);
end;
$$;

create or replace function public.portal_core_get_appointments(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not exists (
    select 1 from public.portal_core_request_receipts r
    where r.request_id = p_request_id and r.portal_user_id = p_portal_user_id
      and r.client_id = p_client_id and r.action = 'appointments' and r.expires_at > now()
  ) then raise exception 'Solicitud inválida' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'title', coalesce(a.service, 'Cita Healen'),
    'startsAt', a.starts_at,
    'location', null,
    'status', a.status
  ) order by a.starts_at desc), '[]'::jsonb) into v_result
  from public.appointments a
  where a.client_id = p_client_id and a.visible_to_patient;
  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action)
  values (p_request_id, p_portal_user_id, p_client_id, 'appointments');
  return v_result;
end;
$$;

create or replace function public.dash_portal_publish_treatment(
  p_treatment uuid,
  p_publish boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_visibility text := case when p_publish then 'patient_published' else 'internal' end;
begin
  if auth.uid() is null or not public.is_staff() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role in ('admin', 'medico')
  ) then raise exception 'Se requiere autorización clínica' using errcode = '42501'; end if;
  update public.treatments
  set portal_visibility = v_visibility,
      portal_published_at = case when p_publish then now() else null end,
      portal_published_by = case when p_publish then auth.uid() else null end
  where id = p_treatment returning client_id into v_client;
  if v_client is null then raise exception 'Tratamiento no encontrado' using errcode = '22023'; end if;
  update public.treatment_items
  set portal_visibility = v_visibility,
      portal_published_at = case when p_publish then now() else null end,
      portal_published_by = case when p_publish then auth.uid() else null end
  where treatment_id = p_treatment;
  insert into public.portal_core_access_audit(portal_user_id, client_id, action, metadata)
  values (auth.uid(), v_client, case when p_publish then 'treatment_published' else 'treatment_unpublished' end,
    jsonb_build_object('treatmentId', p_treatment));
  return jsonb_build_object('id', p_treatment, 'published', p_publish);
end;
$$;

revoke all on function public.portal_core_register_request(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.portal_core_treatment_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.portal_core_get_home(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.portal_core_get_treatment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.portal_core_get_appointments(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.dash_portal_publish_treatment(uuid, boolean) from public, anon, authenticated;

grant execute on function public.portal_core_register_request(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.portal_core_get_home(uuid, uuid, uuid) to service_role;
grant execute on function public.portal_core_get_treatment(uuid, uuid, uuid) to service_role;
grant execute on function public.portal_core_get_appointments(uuid, uuid, uuid) to service_role;
grant execute on function public.dash_portal_publish_treatment(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
