-- ============================================================
-- HEALEN OS · 16 · Hitos clínicos por paciente
-- Checklist/timeline estructurado por paciente, independiente de notas libres.
-- Permite crear hitos, marcarlos completos, omitirlos y hacer soft-delete.
-- DEBE correr DESPUÉS de 01–15.
-- ============================================================

-- ---------- Tabla principal ----------
create table if not exists patient_milestones (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  treatment_id    uuid references treatments(id) on delete set null,

  phase           text not null default 'Fase 1',
  title           text not null,
  description     text,
  category        text not null default 'seguimiento',
  modality        text,

  target_date     date,
  relative_day    integer,

  status          text not null default 'pendiente',
  pinned          boolean not null default false,
  position        integer not null default 0,
  active          boolean not null default true,

  completed_at    timestamptz,
  completed_by    uuid references auth.users(id),
  completion_note text,

  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint patient_milestones_title_not_blank check (length(trim(title)) > 0),
  constraint patient_milestones_status_check check (
    status in ('pendiente', 'en_progreso', 'completado', 'omitido')
  ),
  constraint patient_milestones_category_check check (
    category in (
      'clinico', 'laboratorio', 'tratamiento', 'administrativo',
      'seguimiento', 'educacion', 'renovacion', 'logistica', 'cierre', 'otro'
    )
  )
);
comment on table patient_milestones is 'Hitos clínicos/operativos checkeables por paciente, opcionalmente asociados a tratamiento. No reemplazan notas clínicas; agregan estado, fecha objetivo y auditoría de completion.';
comment on column patient_milestones.relative_day is 'Día relativo desde el inicio del tratamiento/protocolo cuando el hito proviene de una plantilla o cronograma.';

create index if not exists idx_patient_milestones_client on patient_milestones(client_id);
create index if not exists idx_patient_milestones_treatment on patient_milestones(treatment_id);
create index if not exists idx_patient_milestones_client_order on patient_milestones(client_id, pinned desc, position, target_date) where active;
create index if not exists idx_patient_milestones_status_due on patient_milestones(status, target_date) where active;

alter table patient_milestones enable row level security;
drop policy if exists staff_all on patient_milestones;
create policy staff_all on patient_milestones for all to authenticated using (is_staff()) with check (is_staff());

drop trigger if exists trg_patient_milestones_updated on patient_milestones;
create trigger trg_patient_milestones_updated before update on patient_milestones for each row execute function set_updated_at();

-- ============================================================
-- Vistas
-- ============================================================

create or replace view v_patient_milestones as
select
  m.id,
  m.client_id                                     as "clientId",
  m.treatment_id                                  as "treatmentId",
  c.full_name                                     as "patientName",
  t.name                                          as "treatmentName",
  m.phase,
  m.title,
  m.description,
  m.category,
  m.modality,
  m.target_date                                   as "targetDate",
  m.relative_day                                  as "relativeDay",
  case when m.target_date is null then null else m.target_date - current_date end as "daysLeft",
  m.status,
  m.pinned,
  m.position,
  m.completed_at                                  as "completedAt",
  coalesce(pr.full_name, 'Equipo Healen')          as "completedBy",
  m.completion_note                               as "completionNote",
  m.created_at                                    as "createdAt",
  m.updated_at                                    as "updatedAt"
from patient_milestones m
join clients c on c.id = m.client_id
left join treatments t on t.id = m.treatment_id
left join profiles pr on pr.id = m.completed_by
where m.active
order by m.pinned desc, m.position asc, m.target_date asc nulls last, m.created_at asc;
comment on view v_patient_milestones is 'Hitos activos por paciente, en camelCase para el front. Orden: fijados, posición, fecha objetivo.';
alter view v_patient_milestones set (security_invoker = on);

create or replace view v_dashboard_milestones_due as
select *
from v_patient_milestones
where status <> 'completado'
  and "targetDate" is not null
  and "daysLeft" <= 7
order by "daysLeft" asc, "targetDate" asc, "patientName" asc;
comment on view v_dashboard_milestones_due is 'Hitos pendientes/activos próximos o vencidos (<=7 días), para alertas globales futuras.';
alter view v_dashboard_milestones_due set (security_invoker = on);

-- ============================================================
-- RPCs
-- ============================================================

create or replace function dash_add_milestone(
  p_client uuid,
  p_treatment uuid default null,
  p_title text default '',
  p_description text default null,
  p_category text default 'seguimiento',
  p_modality text default null,
  p_target_date date default null,
  p_relative_day integer default null,
  p_phase text default 'Fase 1',
  p_pinned boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_category text := lower(coalesce(nullif(trim(p_category), ''), 'seguimiento'));
  v_position integer;
begin
  perform require_staff();
  if p_client is null then raise exception 'Falta el paciente'; end if;
  if not exists (select 1 from clients where id = p_client and active) then raise exception 'Paciente no encontrado'; end if;
  if coalesce(nullif(trim(p_title), ''), '') = '' then raise exception 'El hito necesita un título'; end if;
  if p_treatment is not null and not exists (select 1 from treatments where id = p_treatment and client_id = p_client) then
    raise exception 'El tratamiento no pertenece al paciente';
  end if;
  if v_category not in ('clinico','laboratorio','tratamiento','administrativo','seguimiento','educacion','renovacion','logistica','cierre','otro') then
    v_category := 'otro';
  end if;

  select coalesce(max(position), -1) + 1 into v_position
  from patient_milestones where client_id = p_client and active;

  insert into patient_milestones(
    client_id, treatment_id, phase, title, description, category, modality,
    target_date, relative_day, pinned, position, created_by
  ) values (
    p_client, p_treatment, coalesce(nullif(trim(p_phase), ''), 'Fase 1'), trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''), v_category, nullif(trim(coalesce(p_modality, '')), ''),
    p_target_date, p_relative_day, coalesce(p_pinned, false), v_position, auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'position', v_position);
end $$;
comment on function dash_add_milestone is 'Crea un hito clínico/operativo checkeable para un paciente.';

create or replace function dash_update_milestone(
  p_milestone uuid,
  p_title text default null,
  p_description text default null,
  p_category text default null,
  p_modality text default null,
  p_target_date date default null,
  p_relative_day integer default null,
  p_phase text default null,
  p_pinned boolean default null,
  p_position integer default null,
  p_status text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_category text;
  v_status text;
begin
  perform require_staff();
  if p_milestone is null then raise exception 'Falta el hito'; end if;

  v_category := case when p_category is null then null else lower(nullif(trim(p_category), '')) end;
  if v_category is not null and v_category not in ('clinico','laboratorio','tratamiento','administrativo','seguimiento','educacion','renovacion','logistica','cierre','otro') then
    v_category := 'otro';
  end if;

  v_status := case when p_status is null then null else lower(nullif(trim(p_status), '')) end;
  if v_status is not null and v_status not in ('pendiente','en_progreso','completado','omitido') then
    raise exception 'Estado de hito inválido: %', p_status;
  end if;
  if p_title is not null and trim(p_title) = '' then raise exception 'El hito necesita un título'; end if;

  update patient_milestones set
    title = coalesce(nullif(trim(coalesce(p_title, title)), ''), title),
    description = case when p_description is null then description else nullif(trim(p_description), '') end,
    category = coalesce(v_category, category),
    modality = case when p_modality is null then modality else nullif(trim(p_modality), '') end,
    target_date = coalesce(p_target_date, target_date),
    relative_day = coalesce(p_relative_day, relative_day),
    phase = coalesce(nullif(trim(coalesce(p_phase, phase)), ''), phase),
    pinned = coalesce(p_pinned, pinned),
    position = coalesce(p_position, position),
    status = coalesce(v_status, status)
  where id = p_milestone and active;

  if not found then raise exception 'Hito no encontrado'; end if;
  return jsonb_build_object('ok', true, 'id', p_milestone);
end $$;
comment on function dash_update_milestone is 'Edita campos estructurados de un hito sin borrar auditoría.';

create or replace function dash_toggle_milestone(
  p_milestone uuid,
  p_done boolean,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  if p_milestone is null then raise exception 'Falta el hito'; end if;

  update patient_milestones set
    status = case when coalesce(p_done, false) then 'completado' else 'pendiente' end,
    completed_at = case when coalesce(p_done, false) then now() else null end,
    completed_by = case when coalesce(p_done, false) then auth.uid() else null end,
    completion_note = case when coalesce(p_done, false) then nullif(trim(coalesce(p_note, '')), '') else null end
  where id = p_milestone and active;

  if not found then raise exception 'Hito no encontrado'; end if;
  return jsonb_build_object('ok', true, 'id', p_milestone, 'done', coalesce(p_done, false));
end $$;
comment on function dash_toggle_milestone is 'Marca o desmarca un hito como completado, guardando auditoría de cierre cuando se completa.';

create or replace function dash_delete_milestone(p_milestone uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  update patient_milestones set active = false where id = p_milestone and active;
  if not found then raise exception 'Hito no encontrado'; end if;
  return jsonb_build_object('ok', true, 'id', p_milestone);
end $$;
comment on function dash_delete_milestone is 'Archiva un hito (soft-delete) para preservar auditoría.';

-- ---------- Grants + hardening ----------
grant select on patient_milestones to authenticated;
grant select on v_patient_milestones, v_dashboard_milestones_due to authenticated;
grant execute on function dash_add_milestone(uuid, uuid, text, text, text, text, date, integer, text, boolean) to authenticated;
grant execute on function dash_update_milestone(uuid, text, text, text, text, date, integer, text, boolean, integer, text) to authenticated;
grant execute on function dash_toggle_milestone(uuid, boolean, text) to authenticated;
grant execute on function dash_delete_milestone(uuid) to authenticated;
revoke execute on function dash_add_milestone(uuid, uuid, text, text, text, text, date, integer, text, boolean) from public, anon;
revoke execute on function dash_update_milestone(uuid, text, text, text, text, date, integer, text, boolean, integer, text) from public, anon;
revoke execute on function dash_toggle_milestone(uuid, boolean, text) from public, anon;
revoke execute on function dash_delete_milestone(uuid) from public, anon;
