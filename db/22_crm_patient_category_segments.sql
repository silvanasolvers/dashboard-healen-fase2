-- ============================================================
-- HEALEN OS · 22 · Paciente como categoría CRM + segmentos
-- ============================================================
-- Un paciente es un perfil activo de `clients` vinculado 1:1 al CRM. No
-- requiere tratamiento. Los tratamientos y demás señales clínicas/comerciales
-- son subsegmentos superpuestos para campañas, nunca categorías excluyentes.

-- ---------- Catálogo de segmentos y asignaciones manuales ----------
create table if not exists crm_campaign_segments (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique
                          check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name                  text not null,
  description           text,
  campaign_type         text not null default 'seguimiento',
  cadence               text not null default 'manual',
  rule_key              text not null
                          check (rule_key in (
                            'active_treatment', 'ending_treatment', 'reactivation',
                            'no_treatment', 'birthday_month', 'lifetime_value',
                            'inactive_contact', 'treatment_name', 'manual'
                          )),
  rule_config           jsonb not null default '{}'::jsonb,
  priority              integer not null default 100,
  enabled               boolean not null default true,
  is_system             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id)
);
comment on table crm_campaign_segments is
  'Reglas reutilizables para campañas de pacientes. Un paciente puede pertenecer a varios segmentos simultáneamente.';

create table if not exists crm_patient_segment_assignments (
  id                    uuid primary key default gen_random_uuid(),
  contact_id            uuid not null references crm_contacts(id) on delete cascade,
  segment_id            uuid not null references crm_campaign_segments(id) on delete cascade,
  active                boolean not null default true,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  unique (contact_id, segment_id)
);
comment on table crm_patient_segment_assignments is
  'Asignaciones manuales para segmentos con rule_key=manual; complementan los segmentos automáticos.';

create index if not exists idx_crm_campaign_segments_enabled
  on crm_campaign_segments(priority, name) where enabled;
create index if not exists idx_crm_patient_segment_assignments_contact
  on crm_patient_segment_assignments(contact_id) where active;

insert into crm_campaign_segments(
  code, name, description, campaign_type, cadence, rule_key, rule_config, priority, is_system
) values
  (
    'tratamiento_activo', 'Tratamiento activo',
    'Pacientes con al menos un tratamiento activo o por finalizar.',
    'educacion_retencion', 'mensual', 'active_treatment', '{}'::jsonb, 10, true
  ),
  (
    'por_finalizar_30d', 'Tratamiento por finalizar',
    'Pacientes cuyo tratamiento activo termina en los próximos 30 días.',
    'renovacion', 'semanal', 'ending_treatment', '{"days": 30}'::jsonb, 20, true
  ),
  (
    'reactivacion', 'Reactivación',
    'Pacientes con historial de tratamiento pero sin uno activo.',
    'reactivacion', 'mensual', 'reactivation', '{}'::jsonb, 30, true
  ),
  (
    'sin_tratamiento', 'Paciente sin tratamiento',
    'Pacientes creados o vinculados que todavía no tienen tratamiento.',
    'bienvenida_calificacion', 'semanal', 'no_treatment', '{}'::jsonb, 40, true
  ),
  (
    'cumpleanos_mes', 'Cumpleaños del mes',
    'Pacientes que cumplen años durante el mes actual.',
    'fidelizacion', 'diaria', 'birthday_month', '{}'::jsonb, 50, true
  ),
  (
    'vip', 'Paciente VIP',
    'Pacientes con ventas acumuladas desde $8.000.000.',
    'fidelizacion', 'mensual', 'lifetime_value', '{"minimum": 8000000}'::jsonb, 60, true
  ),
  (
    'sin_contacto_45d', 'Sin contacto reciente',
    'Pacientes sin actividad de contacto durante 45 días.',
    'seguimiento', 'semanal', 'inactive_contact', '{"days": 45}'::jsonb, 70, true
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  campaign_type = excluded.campaign_type,
  cadence = excluded.cadence,
  rule_key = excluded.rule_key,
  rule_config = excluded.rule_config,
  priority = excluded.priority,
  is_system = true;

-- Importaciones históricas pueden haber creado códigos por delante de
-- seq_client. El generador salta cualquier código ocupado de forma segura.
create or replace function next_client_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  loop
    v_code := 'HLN-' || lpad(nextval('seq_client')::text, 3, '0');
    exit when not exists (select 1 from clients where code = v_code);
  end loop;
  return v_code;
end $$;

-- ---------- Paciente ya no depende de treatments ----------
create or replace function crm_assert_patient_has_treatment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.contact_type = 'patient'::crm_contact_type then
    if new.client_id is null then
      raise exception 'Un contacto paciente debe estar vinculado a una ficha de paciente'
        using errcode = '23514';
    end if;
    if not exists (select 1 from clients c where c.id = new.client_id and c.active) then
      raise exception 'La ficha de paciente vinculada no existe o está inactiva'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- Conserva los triggers históricos, pero nunca degrada a un paciente cuando
-- finaliza o se elimina su último tratamiento.
create or replace function crm_downgrade_contact_without_treatment()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

comment on table crm_contacts is
  'Directorio CRM. contact_type=patient significa vínculo 1:1 con una ficha activa de clients; los tratamientos son atributos y segmentos separados.';

-- ---------- Todo nuevo cliente obtiene una ficha CRM ----------
create or replace function crm_sync_new_client_contact()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
  v_promoted text := nullif(current_setting('healen.crm_promote_contact', true), '');
begin
  if not new.active then return new; end if;

  if v_promoted is not null then
    begin
      v_contact := v_promoted::uuid;
    exception when invalid_text_representation then
      v_contact := null;
    end;
  end if;

  if v_contact is not null then
    update crm_contacts set
      display_name = new.full_name,
      primary_phone = coalesce(new.phone, primary_phone),
      primary_email = coalesce(crm_normalize_email(new.email), primary_email),
      contact_type = 'patient',
      lifecycle_stage = 'patient',
      client_id = new.id,
      match_status = 'matched',
      match_method = 'crm_patient_promotion',
      match_confidence = 1
    where id = v_contact and active and client_id is null;
    if found then return new; end if;
  end if;

  insert into crm_contacts(
    display_name, primary_phone, primary_email, contact_type, lifecycle_stage,
    client_id, match_status, match_method, match_confidence, source, active,
    metadata, created_by
  ) values (
    new.full_name, new.phone, crm_normalize_email(new.email), 'patient', 'patient',
    new.id, 'matched', 'client_created', 1, 'patient_registry', true,
    jsonb_build_object('syncedFromClient', true), new.created_by
  )
  on conflict (client_id) where client_id is not null do update set
    display_name = excluded.display_name,
    primary_phone = coalesce(excluded.primary_phone, crm_contacts.primary_phone),
    primary_email = coalesce(excluded.primary_email, crm_contacts.primary_email),
    contact_type = 'patient',
    lifecycle_stage = 'patient',
    match_status = 'matched';

  return new;
end $$;

drop trigger if exists trg_clients_create_crm_patient on clients;
create trigger trg_clients_create_crm_patient
  after insert on clients
  for each row execute function crm_sync_new_client_contact();

-- ---------- Backfill: todos los pacientes actuales aparecen en CRM ----------
do $$
declare
  v_client clients%rowtype;
  v_contact uuid;
  v_candidates uuid[];
begin
  -- Primero corrige vínculos existentes; la ficha de clients es la identidad
  -- canónica y el CRM conserva datos que falten en ella.
  update crm_contacts cc set
    display_name = c.full_name,
    primary_phone = coalesce(c.phone, cc.primary_phone),
    primary_email = coalesce(crm_normalize_email(c.email), cc.primary_email),
    contact_type = 'patient',
    lifecycle_stage = 'patient',
    match_status = 'matched',
    match_method = coalesce(cc.match_method, 'existing_client_link'),
    match_confidence = coalesce(cc.match_confidence, 1)
  from clients c
  where c.id = cc.client_id and c.active and cc.active;

  -- Completa en clients los datos que solo estaban en el CRM.
  update clients c set
    phone = coalesce(c.phone, cc.primary_phone),
    email = coalesce(crm_normalize_email(c.email), crm_normalize_email(cc.primary_email)),
    updated_at = case
      when (c.phone is null and cc.primary_phone is not null)
        or (c.email is null and cc.primary_email is not null)
      then now() else c.updated_at end
  from crm_contacts cc
  where cc.client_id = c.id and cc.active;

  for v_client in
    select c.* from clients c
    where c.active
      and not exists (
        select 1 from crm_contacts cc where cc.client_id = c.id and cc.active
      )
    order by c.created_at, c.id
  loop
    select coalesce(array_agg(candidate.id order by candidate.id), '{}'::uuid[])
      into v_candidates
    from (
      select distinct cc.id
      from crm_contacts cc
      where cc.active and cc.client_id is null
        and (
          (
            crm_normalize_phone(v_client.phone) is not null
            and crm_normalize_phone(cc.primary_phone) = crm_normalize_phone(v_client.phone)
          )
          or (
            crm_normalize_email(v_client.email) is not null
            and crm_normalize_email(cc.primary_email) = crm_normalize_email(v_client.email)
          )
        )
    ) candidate;

    v_contact := null;
    if cardinality(v_candidates) = 1 then
      v_contact := v_candidates[1];
      update crm_contacts set
        display_name = v_client.full_name,
        primary_phone = coalesce(v_client.phone, primary_phone),
        primary_email = coalesce(crm_normalize_email(v_client.email), primary_email),
        contact_type = 'patient',
        lifecycle_stage = 'patient',
        client_id = v_client.id,
        match_status = 'matched',
        match_method = 'backfill_exact_phone_or_email',
        match_confidence = 1
      where id = v_contact;
    else
      insert into crm_contacts(
        display_name, primary_phone, primary_email, contact_type, lifecycle_stage,
        client_id, match_status, match_method, match_confidence, source, active,
        metadata, created_by
      ) values (
        v_client.full_name, v_client.phone, crm_normalize_email(v_client.email),
        'patient', 'patient', v_client.id, 'matched', 'patient_registry_backfill',
        1, 'patient_registry', true,
        jsonb_build_object(
          'backfilled', true,
          'exactContactCandidates', cardinality(v_candidates)
        ),
        v_client.created_by
      )
      returning id into v_contact;
    end if;

    insert into crm_change_audit(entity_type, entity_id, action, new_data, metadata, actor_id)
    values (
      'crm_contact', v_contact, 'patient_registry_backfill',
      crm_contact_snapshot(v_contact),
      jsonb_build_object(
        'clientId', v_client.id,
        'matchedExistingContact', cardinality(v_candidates) = 1,
        'exactContactCandidates', cardinality(v_candidates)
      ),
      null
    );
  end loop;

  -- Identidades primarias, sin apropiarse de un valor que ya pertenezca a otro
  -- contacto: el conflicto queda visible pero no rompe el backfill.
  insert into crm_contact_identities(
    contact_id, kind, identity_value, normalized_value, value_hash,
    is_primary, verified, source
  )
  select
    cc.id, 'phone', cc.primary_phone, crm_normalize_phone(cc.primary_phone),
    crm_identity_hash('phone', cc.primary_phone), true, true, 'patient_registry'
  from crm_contacts cc
  where cc.active and cc.contact_type = 'patient'
    and crm_normalize_phone(cc.primary_phone) is not null
  on conflict (kind, value_hash) do nothing;

  insert into crm_contact_identities(
    contact_id, kind, identity_value, normalized_value, value_hash,
    is_primary, verified, source
  )
  select
    cc.id, 'email', cc.primary_email, crm_normalize_email(cc.primary_email),
    crm_identity_hash('email', cc.primary_email), true, true, 'patient_registry'
  from crm_contacts cc
  where cc.active and cc.contact_type = 'patient'
    and crm_normalize_email(cc.primary_email) is not null
  on conflict (kind, value_hash) do nothing;
end $$;

-- La pestaña Pacientes debe mostrar la misma población que la categoría CRM,
-- incluso antes de que exista un tratamiento.
create or replace view v_dashboard_patients as
select
  c.code                                              as id,
  c.full_name                                         as name,
  c.document_id                                       as "documentId",
  coalesce(t.name, 'Sin tratamiento activo')          as plan,
  coalesce(t.sale_price, 0)                           as "saleValue",
  case
    when coalesce(fin.total_sales, 0) >= 8000000 then 'VIP'
    when coalesce(fin.total_sales, 0) >= 4000000 then 'Alto'
    when coalesce(fin.total_sales, 0) >= 1500000 then 'Medio'
    else 'Basico'
  end                                                 as tier,
  coalesce(t.start_date, c.created_at::date)          as "startDate",
  coalesce(t.end_date, current_date)                  as "endDate",
  case when t.end_date is null then 0
    else greatest((t.end_date - current_date), 0) end as "daysLeft",
  greatest(
    coalesce(t.end_date, current_date) - coalesce(t.start_date, c.created_at::date),
    1
  )                                                   as "totalDays",
  coalesce(t.weekly_serum, false)                     as "weeklySerum",
  coalesce(t.serum_day, '-')                          as "serumDay",
  case
    when t.id is null then 'Finalizado'
    when t.status = 'activo' then 'Activo'
    when t.status = 'por_finalizar' then 'Por finalizar'
    when t.status = 'finalizado' then 'Finalizado'
    else 'Activo'
  end                                                 as status,
  c.id                                                as "clientUuid",
  t.id                                                as "treatmentId",
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', ti.name,
      'dose', coalesce(ti.dose, ''),
      'route', ti.route,
      'endsInDays', greatest((coalesce(ti.ends_on, current_date) - current_date), 0),
      'status', case ti.status when 'por_finalizar' then 'Por finalizar'
                               when 'finalizado' then 'Finalizado' else 'Activo' end
    ) order by ti.ends_on nulls last)
    from treatment_items ti where ti.treatment_id = t.id
  ), '[]'::jsonb)                                     as peptides
from clients c
left join lateral (
  select tr.*
  from treatments tr
  where tr.client_id = c.id
  order by (tr.status = 'activo') desc, tr.end_date desc nulls last, tr.created_at desc
  limit 1
) t on true
left join lateral (
  select coalesce(sum(s.total), 0) as total_sales
  from sales s
  where s.client_id = c.id and s.status <> 'anulada'
) fin on true
where c.active
order by c.code;

comment on view v_dashboard_patients is
  'Todos los pacientes activos, incluso sin tratamiento; el último tratamiento se resume cuando existe.';
alter view v_dashboard_patients set (security_invoker = on);

create or replace view v_dashboard_patients_due_soon as
select
  id, name, plan, "saleValue", tier, "startDate", "endDate", "daysLeft",
  "totalDays", "weeklySerum", "serumDay", status, "clientUuid",
  "treatmentId", peptides
from v_dashboard_patients
where "daysLeft" between 0 and 7
  and status in ('Activo', 'Por finalizar')
order by "daysLeft", "endDate", name;
alter view v_dashboard_patients_due_soon set (security_invoker = on);

-- ---------- Segmentos automáticos y manuales, siempre recalculados ----------
create or replace view v_crm_patient_segment_memberships as
with patient_base as (
  select
    cc.id as contact_id,
    c.id as client_id,
    c.birthdate,
    cc.last_contact_at,
    treatment_stats.treatment_count,
    treatment_stats.active_treatment_count,
    treatment_stats.next_treatment_end,
    finance_stats.lifetime_value
  from clients c
  join crm_contacts cc
    on cc.client_id = c.id and cc.active and cc.contact_type = 'patient'
  left join lateral (
    select
      count(*)::integer as treatment_count,
      count(*) filter (where t.status in ('activo', 'por_finalizar'))::integer
        as active_treatment_count,
      min(t.end_date) filter (
        where t.status in ('activo', 'por_finalizar') and t.end_date >= current_date
      ) as next_treatment_end
    from treatments t
    where t.client_id = c.id
  ) treatment_stats on true
  left join lateral (
    select coalesce(sum(s.total) filter (where s.status <> 'anulada'), 0) as lifetime_value
    from sales s
    where s.client_id = c.id
  ) finance_stats on true
  where c.active
), automatic_memberships as (
  select
    pb.contact_id,
    pb.client_id,
    seg.id as segment_id,
    seg.code,
    seg.name,
    seg.campaign_type,
    seg.cadence,
    seg.priority,
    case seg.rule_key
      when 'active_treatment' then
        pb.active_treatment_count::text || ' tratamiento(s) activo(s)'
      when 'ending_treatment' then
        'Finaliza el ' || to_char(pb.next_treatment_end, 'YYYY-MM-DD')
      when 'reactivation' then
        'Tiene historial clínico y ningún tratamiento activo'
      when 'no_treatment' then
        'Ficha de paciente sin tratamiento registrado'
      when 'birthday_month' then
        'Cumpleaños ' || to_char(pb.birthdate, 'DD/MM')
      when 'lifetime_value' then
        'Valor acumulado $' || trim(to_char(pb.lifetime_value, 'FM999G999G999G990'))
      when 'inactive_contact' then
        'Sin contacto desde ' || coalesce(to_char(pb.last_contact_at, 'YYYY-MM-DD'), 'el registro')
      when 'treatment_name' then
        'Coincide con el tipo de tratamiento configurado'
      else 'Regla automática'
    end as reason,
    'automatic'::text as membership_source
  from patient_base pb
  join crm_campaign_segments seg on seg.enabled and seg.rule_key <> 'manual'
  where case seg.rule_key
    when 'active_treatment' then pb.active_treatment_count > 0
    when 'ending_treatment' then
      pb.next_treatment_end between current_date
        and current_date + greatest(coalesce((seg.rule_config->>'days')::integer, 30), 0)
    when 'reactivation' then pb.treatment_count > 0 and pb.active_treatment_count = 0
    when 'no_treatment' then pb.treatment_count = 0
    when 'birthday_month' then
      pb.birthdate is not null and extract(month from pb.birthdate) = extract(month from current_date)
    when 'lifetime_value' then
      pb.lifetime_value >= greatest(coalesce((seg.rule_config->>'minimum')::numeric, 0), 0)
    when 'inactive_contact' then
      pb.last_contact_at is null
      or pb.last_contact_at < now() - make_interval(
        days => greatest(coalesce((seg.rule_config->>'days')::integer, 45), 0)
      )
    when 'treatment_name' then exists (
      select 1 from treatments named_treatment
      where named_treatment.client_id = pb.client_id
        and named_treatment.name ilike
          '%' || replace(replace(coalesce(seg.rule_config->>'contains', ''), '%', '\%'), '_', '\_') || '%'
    )
    else false
  end
), manual_memberships as (
  select
    assignment.contact_id,
    cc.client_id,
    seg.id as segment_id,
    seg.code,
    seg.name,
    seg.campaign_type,
    seg.cadence,
    seg.priority,
    coalesce(nullif(trim(assignment.note), ''), 'Asignación manual') as reason,
    'manual'::text as membership_source
  from crm_patient_segment_assignments assignment
  join crm_campaign_segments seg
    on seg.id = assignment.segment_id and seg.enabled and seg.rule_key = 'manual'
  join crm_contacts cc
    on cc.id = assignment.contact_id and cc.active and cc.contact_type = 'patient'
  join clients c on c.id = cc.client_id and c.active
  where assignment.active
)
select * from automatic_memberships
union all
select * from manual_memberships;

comment on view v_crm_patient_segment_memberships is
  'Membresías actuales para campañas. Se recalculan desde tratamientos, cumpleaños, ventas, actividad y asignaciones manuales.';
alter view v_crm_patient_segment_memberships set (security_invoker = on);

-- ---------- Vista CRM: categoría estable + señales clínicas separadas ----------
create or replace view v_crm_contacts as
select
  c.id,
  case
    when lower(trim(c.display_name)) in (
      'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
      'sin nombre', 'unknown'
    ) and nullif(trim(client.full_name), '') is not null
      then client.full_name
    else c.display_name
  end                                                        as display_name,
  c.primary_phone,
  c.primary_email,
  c.city,
  c.contact_type,
  c.lifecycle_stage,
  c.client_id,
  client.code                                                as client_code,
  client.full_name                                           as client_name,
  (treatment_stats.treatment_count > 0)                      as has_treatment,
  treatment_stats.treatment_count,
  treatment_stats.active_treatment_count,
  c.match_status,
  c.match_method,
  c.match_confidence,
  c.first_contact_at,
  c.last_contact_at,
  c.last_summary,
  c.tags,
  c.owner_id,
  owner.full_name                                            as owner_name,
  c.active,
  c.lock_version,
  c.created_at,
  c.updated_at,
  opportunity_stats.opportunity_count,
  opportunity_stats.open_opportunity_count,
  coalesce(current_opportunity.stage, 'unclassified'::crm_opportunity_stage)
                                                               as current_opportunity_stage,
  current_opportunity.next_action_at,
  coalesce(identities.items, '[]'::jsonb)                     as identities,
  coalesce(segments.items, '[]'::jsonb)                       as patient_segments
from crm_contacts c
left join clients client on client.id = c.client_id
left join profiles owner on owner.id = c.owner_id
left join lateral (
  select
    count(*)::integer as treatment_count,
    count(*) filter (where t.status in ('activo','por_finalizar'))::integer
      as active_treatment_count
  from treatments t where t.client_id = c.client_id
) treatment_stats on true
left join lateral (
  select
    count(*)::integer as opportunity_count,
    count(*) filter (where o.active and o.stage not in ('converted','lost'))::integer
      as open_opportunity_count
  from crm_opportunities o where o.contact_id = c.id
) opportunity_stats on true
left join lateral (
  select o.stage, o.next_action_at
  from crm_opportunities o where o.contact_id = c.id and o.active
  order by o.updated_at desc, o.created_at desc, o.id desc limit 1
) current_opportunity on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'kind', i.kind,
    'value', i.identity_value,
    'is_primary', i.is_primary,
    'verified', i.verified
  ) order by i.is_primary desc, i.kind, i.normalized_value) as items
  from crm_contact_identities i where i.contact_id = c.id
) identities on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'code', membership.code,
    'name', membership.name,
    'campaignType', membership.campaign_type,
    'cadence', membership.cadence,
    'reason', membership.reason,
    'source', membership.membership_source
  ) order by membership.priority, membership.name) as items
  from v_crm_patient_segment_memberships membership
  where membership.contact_id = c.id
) segments on true
where c.active;

comment on view v_crm_contacts is
  'Directorio CRM activo. Paciente depende del vínculo con clients; tratamientos y segmentos se exponen por separado.';
alter view v_crm_contacts set (security_invoker = on);

-- ---------- Edición CRM: promover crea/vincula paciente y sincroniza identidad ----------
create or replace function crm_update_contact(
  p_contact uuid,
  p_expected_version bigint,
  p_display_name text,
  p_phone text default null,
  p_email text default null,
  p_city text default null,
  p_contact_type text default 'unknown',
  p_summary text default null,
  p_tags text[] default '{}'::text[]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contact crm_contacts%rowtype;
  v_client clients%rowtype;
  v_type crm_contact_type;
  v_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Contacto WhatsApp'), 180);
  v_phone text := left(nullif(trim(p_phone), ''), 80);
  v_email text := left(crm_normalize_email(p_email), 254);
  v_city text := left(nullif(trim(p_city), ''), 120);
  v_summary text := left(nullif(trim(p_summary), ''), 4000);
  v_tags text[];
  v_old jsonb;
  v_new jsonb;
  v_clients uuid[];
  v_client_id uuid;
  v_created_client boolean := false;
  v_final_phone text;
  v_final_email text;
begin
  perform require_staff();

  select * into v_contact from crm_contacts where id = p_contact for update;
  if not found or not v_contact.active then raise exception 'Contacto CRM no encontrado'; end if;
  if v_contact.lock_version <> p_expected_version then
    raise exception 'El contacto cambió; actualiza la ficha antes de guardar' using errcode = '40001';
  end if;

  begin
    v_type := lower(trim(coalesce(p_contact_type, 'unknown')))::crm_contact_type;
  exception when invalid_text_representation then
    raise exception 'Clasificación CRM inválida';
  end;

  if v_contact.client_id is not null and v_type <> 'patient' then
    raise exception 'La ficha ya está vinculada como paciente; puedes editar sus datos, no degradarla a contacto';
  end if;

  if crm_normalize_phone(v_phone) is not null and (
    exists (
      select 1 from crm_contact_identities i
      where i.kind in ('phone','whatsapp_pn')
        and i.normalized_value = crm_normalize_phone(v_phone)
        and i.contact_id <> p_contact
    ) or exists (
      select 1 from crm_contacts c
      where c.id <> p_contact and c.active
        and crm_normalize_phone(c.primary_phone) = crm_normalize_phone(v_phone)
    )
  ) then
    raise exception 'Ese teléfono ya pertenece a otro contacto CRM';
  end if;
  if v_email is not null and (
    exists (
      select 1 from crm_contact_identities i
      where i.kind = 'email' and i.normalized_value = v_email
        and i.contact_id <> p_contact
    ) or exists (
      select 1 from crm_contacts c
      where c.id <> p_contact and c.active
        and crm_normalize_email(c.primary_email) = v_email
    )
  ) then
    raise exception 'Ese correo ya pertenece a otro contacto CRM';
  end if;

  select coalesce(array_agg(tag order by tag), '{}'::text[]) into v_tags
  from (
    select distinct left(trim(value), 80) tag
    from unnest(coalesce(p_tags, '{}'::text[])) value
    where nullif(trim(value), '') is not null
    limit 30
  ) cleaned;

  v_old := crm_contact_snapshot(p_contact);

  if v_type = 'patient' then
    if lower(trim(v_name)) in (
      'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
      'sin nombre', 'unknown'
    ) or v_name !~ '[[:alpha:]]' then
      raise exception 'Completa el nombre antes de crear la ficha de paciente';
    end if;

    v_client_id := v_contact.client_id;
    if v_client_id is null then
      select coalesce(array_agg(distinct candidate.id order by candidate.id), '{}'::uuid[])
        into v_clients
      from clients candidate
      where candidate.active and (
        (
          crm_normalize_phone(v_phone) is not null
          and crm_normalize_phone(candidate.phone) = crm_normalize_phone(v_phone)
        )
        or (
          v_email is not null
          and crm_normalize_email(candidate.email) = v_email
        )
      );

      if cardinality(v_clients) > 1 then
        raise exception 'Hay varios pacientes con esa identidad; revisa teléfono y correo antes de vincular';
      elsif cardinality(v_clients) = 1 then
        v_client_id := v_clients[1];
        if exists (
          select 1 from crm_contacts other
          where other.client_id = v_client_id and other.active and other.id <> p_contact
        ) then
          raise exception 'Ese paciente ya está vinculado a otro contacto CRM';
        end if;
      else
        perform set_config('healen.crm_promote_contact', p_contact::text, true);
        insert into clients(code, full_name, phone, email, active, created_by)
        values (next_client_code(), v_name, v_phone, v_email, true, auth.uid())
        returning id into v_client_id;
        v_created_client := true;
      end if;
    end if;

    select * into v_client from clients where id = v_client_id and active for update;
    if not found then raise exception 'La ficha de paciente vinculada no existe o está inactiva'; end if;

    v_final_phone := case
      when v_contact.client_id is not null then v_phone
      else coalesce(v_phone, v_client.phone, v_contact.primary_phone)
    end;
    v_final_email := case
      when v_contact.client_id is not null then v_email
      else coalesce(v_email, crm_normalize_email(v_client.email), crm_normalize_email(v_contact.primary_email))
    end;

    update clients set
      full_name = v_name,
      phone = v_final_phone,
      email = v_final_email,
      updated_at = now()
    where id = v_client_id;

    update crm_contacts set
      display_name = v_name,
      primary_phone = v_final_phone,
      primary_email = v_final_email,
      city = v_city,
      contact_type = 'patient',
      lifecycle_stage = 'patient',
      client_id = v_client_id,
      match_status = 'matched',
      match_method = case when v_created_client then 'crm_patient_created'
        else coalesce(match_method, 'crm_patient_linked') end,
      match_confidence = 1,
      last_summary = v_summary,
      tags = v_tags
    where id = p_contact;

    update crm_opportunities set
      stage = 'converted',
      closed_at = coalesce(closed_at, now())
    where contact_id = p_contact and active and stage not in ('converted', 'lost');
  else
    update crm_contacts set
      display_name = v_name,
      primary_phone = v_phone,
      primary_email = v_email,
      city = v_city,
      contact_type = v_type,
      lifecycle_stage = v_type::text,
      last_summary = v_summary,
      tags = v_tags
    where id = p_contact;
  end if;

  update crm_contact_identities set
    is_primary = false,
    verified = false
  where contact_id = p_contact and kind in ('phone','email') and is_primary;

  select primary_phone, primary_email into v_final_phone, v_final_email
  from crm_contacts where id = p_contact;

  if crm_normalize_phone(v_final_phone) is not null then
    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash, is_primary, verified, source
    ) values (
      p_contact, 'phone', v_final_phone, crm_normalize_phone(v_final_phone),
      crm_identity_hash('phone', v_final_phone), true, true, 'manual_staff'
    ) on conflict (kind, value_hash) do update set
      identity_value = excluded.identity_value,
      normalized_value = excluded.normalized_value,
      is_primary = true,
      verified = true,
      source = 'manual_staff'
    where crm_contact_identities.contact_id = excluded.contact_id;
    if not found then raise exception 'Ese teléfono ya pertenece a otro contacto CRM'; end if;
  end if;
  if v_final_email is not null then
    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash, is_primary, verified, source
    ) values (
      p_contact, 'email', v_final_email, crm_normalize_email(v_final_email),
      crm_identity_hash('email', v_final_email), true, true, 'manual_staff'
    ) on conflict (kind, value_hash) do update set
      identity_value = excluded.identity_value,
      normalized_value = excluded.normalized_value,
      is_primary = true,
      verified = true,
      source = 'manual_staff'
    where crm_contact_identities.contact_id = excluded.contact_id;
    if not found then raise exception 'Ese correo ya pertenece a otro contacto CRM'; end if;
  end if;

  v_new := crm_contact_snapshot(p_contact);
  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  values (
    'crm_contact', p_contact,
    case when v_type = 'patient' and v_contact.contact_type <> 'patient'
      then 'promoted_to_patient' else 'manual_update' end,
    v_old, v_new,
    jsonb_build_object(
      'source', 'dashboard',
      'clientId', v_client_id,
      'clientCreated', v_created_client,
      'identitySynced', v_type = 'patient'
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'contact_id', p_contact,
    'client_id', v_client_id,
    'client_created', v_created_client,
    'contact_type', v_type,
    'lock_version', (select lock_version from crm_contacts where id = p_contact)
  );
end $$;

-- Ediciones desde la ficha clínica también mantienen CRM y clients iguales.
create or replace function dash_update_client(
  p_client uuid,
  p_full_name text default null,
  p_document_id text default null,
  p_phone text default null,
  p_email text default null,
  p_birthdate date default null,
  p_address text default null,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
  v_name text;
  v_phone text := nullif(trim(p_phone), '');
  v_email text := crm_normalize_email(p_email);
begin
  perform require_staff();
  if p_full_name is not null and trim(p_full_name) = '' then
    raise exception 'El nombre no puede estar vacío';
  end if;

  select cc.id into v_contact
  from crm_contacts cc where cc.client_id = p_client and cc.active
  for update;

  if v_contact is not null and crm_normalize_phone(v_phone) is not null and (
    exists (
      select 1 from crm_contacts other
      where other.id <> v_contact and other.active
        and crm_normalize_phone(other.primary_phone) = crm_normalize_phone(v_phone)
    )
    or exists (
      select 1 from crm_contact_identities i
      where i.contact_id <> v_contact
        and i.kind in ('phone', 'whatsapp_pn')
        and i.normalized_value = crm_normalize_phone(v_phone)
    )
  ) then
    raise exception 'Ese teléfono ya pertenece a otro contacto CRM';
  end if;
  if v_contact is not null and v_email is not null and (
    exists (
      select 1 from crm_contacts other
      where other.id <> v_contact and other.active
        and crm_normalize_email(other.primary_email) = v_email
    )
    or exists (
      select 1 from crm_contact_identities i
      where i.contact_id <> v_contact
        and i.kind = 'email'
        and i.normalized_value = v_email
    )
  ) then
    raise exception 'Ese correo ya pertenece a otro contacto CRM';
  end if;

  update clients set
    full_name   = coalesce(nullif(trim(p_full_name), ''), full_name),
    document_id = nullif(trim(p_document_id), ''),
    phone       = v_phone,
    email       = v_email,
    birthdate   = p_birthdate,
    address     = nullif(trim(p_address), ''),
    notes       = nullif(trim(p_notes), ''),
    updated_at  = now()
  where id = p_client and active
  returning full_name into v_name;
  if not found then raise exception 'Paciente no encontrado'; end if;

  if v_contact is not null then
    update crm_contacts set
      display_name = v_name,
      primary_phone = v_phone,
      primary_email = v_email,
      contact_type = 'patient',
      lifecycle_stage = 'patient',
      match_status = 'matched'
    where id = v_contact;

    update crm_contact_identities set
      is_primary = false,
      verified = false
    where contact_id = v_contact and kind in ('phone', 'email') and is_primary;

    if crm_normalize_phone(v_phone) is not null then
      insert into crm_contact_identities(
        contact_id, kind, identity_value, normalized_value, value_hash,
        is_primary, verified, source
      ) values (
        v_contact, 'phone', v_phone, crm_normalize_phone(v_phone),
        crm_identity_hash('phone', v_phone), true, true, 'patient_profile'
      )
      on conflict (kind, value_hash) do update set
        identity_value = excluded.identity_value,
        normalized_value = excluded.normalized_value,
        is_primary = true,
        verified = true,
        source = 'patient_profile'
      where crm_contact_identities.contact_id = excluded.contact_id;
    end if;

    if v_email is not null then
      insert into crm_contact_identities(
        contact_id, kind, identity_value, normalized_value, value_hash,
        is_primary, verified, source
      ) values (
        v_contact, 'email', v_email, v_email,
        crm_identity_hash('email', v_email), true, true, 'patient_profile'
      )
      on conflict (kind, value_hash) do update set
        identity_value = excluded.identity_value,
        normalized_value = excluded.normalized_value,
        is_primary = true,
        verified = true,
        source = 'patient_profile'
      where crm_contact_identities.contact_id = excluded.contact_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'contact_id', v_contact);
end $$;

-- El pipeline sigue siendo comercial. Convertir una oportunidad no crea un
-- paciente, y un paciente nunca se degrada por mover accidentalmente una etapa.
create or replace function crm_move_pipeline(
  p_contact uuid,
  p_stage text,
  p_expected_version bigint,
  p_next_action_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contact crm_contacts%rowtype;
  v_stage crm_opportunity_stage;
  v_opportunity crm_opportunities%rowtype;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb;
begin
  perform require_staff();

  begin
    v_stage := lower(trim(coalesce(p_stage, '')))::crm_opportunity_stage;
  exception when invalid_text_representation then
    raise exception 'Etapa de pipeline inválida';
  end;

  select * into v_contact from crm_contacts where id = p_contact for update;
  if not found or not v_contact.active then raise exception 'Contacto CRM no encontrado'; end if;
  if v_contact.lock_version <> p_expected_version then
    raise exception 'El contacto cambió; actualiza el CRM antes de moverlo' using errcode = '40001';
  end if;
  if v_contact.contact_type = 'patient' or v_contact.client_id is not null then
    raise exception 'Los pacientes usan segmentos de campañas y permanecen fuera del pipeline comercial';
  end if;
  if v_contact.contact_type in ('staff', 'supplier', 'partner', 'personal') then
    raise exception 'Este tipo de contacto no pertenece al pipeline comercial';
  end if;

  select * into v_opportunity
  from crm_opportunities
  where contact_id = p_contact and active
  order by updated_at desc, created_at desc, id desc
  limit 1 for update;

  if found then
    v_old := to_jsonb(v_opportunity);
    update crm_opportunities set
      stage = v_stage,
      next_action_at = p_next_action_at,
      closed_at = case when v_stage in ('converted','lost')
        then coalesce(closed_at, now()) else null end
    where id = v_opportunity.id
    returning * into v_opportunity;
  else
    insert into crm_opportunities(
      contact_id, title, stage, next_action_at, source_record_key, created_by
    ) values (
      p_contact, 'Seguimiento comercial', v_stage, p_next_action_at,
      'manual:' || p_contact::text, auth.uid()
    )
    returning * into v_opportunity;
  end if;

  update crm_contacts set
    contact_type = 'lead',
    lifecycle_stage = 'lead'
  where id = p_contact
  returning * into v_contact;

  v_new := to_jsonb(v_opportunity);
  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  values (
    'crm_opportunity', v_opportunity.id, 'pipeline_move', v_old, v_new,
    jsonb_build_object('contactId', p_contact, 'source', 'dashboard'), auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'contact_id', p_contact,
    'opportunity_id', v_opportunity.id,
    'stage', v_stage,
    'next_action_at', v_opportunity.next_action_at,
    'contact_lock_version', v_contact.lock_version
  );
end $$;

-- ---------- Listado ligero: filtros de categoría y campaña en servidor ----------
drop function if exists crm_list_contacts(integer, integer, text, text, text);
drop function if exists crm_list_contacts(integer, integer, text, text, text, text);

create or replace function crm_list_contacts(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default null,
  p_contact_type text default 'all',
  p_stage text default 'all',
  p_segment text default 'all'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 250));
  v_offset bigint;
  v_search text := left(nullif(trim(coalesce(p_search, '')), ''), 200);
  v_search_pattern text;
  v_type text := lower(trim(coalesce(p_contact_type, 'all')));
  v_stage text := lower(trim(coalesce(p_stage, 'all')));
  v_segment text := lower(trim(coalesce(p_segment, 'all')));
  v_result jsonb;
begin
  perform require_staff();
  v_offset := (v_page::bigint - 1) * v_page_size::bigint;
  v_search_pattern := case when v_search is null then null else
    '%' || replace(replace(replace(lower(v_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  with treatment_stats as materialized (
    select
      t.client_id,
      count(*)::integer as treatment_count,
      count(*) filter (where t.status in ('activo','por_finalizar'))::integer
        as active_treatment_count
    from treatments t
    group by t.client_id
  ), current_opportunity as materialized (
    select distinct on (o.contact_id)
      o.contact_id, o.stage, o.next_action_at
    from crm_opportunities o
    where o.active
    order by o.contact_id, o.updated_at desc, o.created_at desc, o.id desc
  ), patient_segment_stats as materialized (
    select
      membership.contact_id,
      array_agg(membership.code order by membership.priority, membership.name) as segment_codes,
      jsonb_agg(jsonb_build_object(
        'code', membership.code,
        'name', membership.name,
        'campaignType', membership.campaign_type,
        'cadence', membership.cadence,
        'reason', membership.reason,
        'source', membership.membership_source
      ) order by membership.priority, membership.name) as patient_segments
    from v_crm_patient_segment_memberships membership
    group by membership.contact_id
  ), base as materialized (
    select
      c.id,
      case
        when lower(trim(c.display_name)) in (
          'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
          'sin nombre', 'unknown'
        ) and nullif(trim(client.full_name), '') is not null
          then client.full_name
        else c.display_name
      end as display_name,
      c.primary_phone,
      c.primary_email,
      c.city,
      c.contact_type,
      c.lifecycle_stage,
      c.client_id,
      client.code as client_code,
      client.full_name as client_name,
      (coalesce(ts.treatment_count, 0) > 0) as has_treatment,
      coalesce(ts.treatment_count, 0)::integer as treatment_count,
      coalesce(ts.active_treatment_count, 0)::integer as active_treatment_count,
      c.match_status,
      c.match_method,
      c.match_confidence,
      c.first_contact_at,
      c.last_contact_at,
      c.last_summary,
      c.tags,
      c.owner_id,
      owner.full_name as owner_name,
      c.active,
      c.lock_version,
      c.created_at,
      c.updated_at,
      coalesce(co.stage, 'unclassified'::crm_opportunity_stage) as current_opportunity_stage,
      co.next_action_at,
      c.search_text,
      coalesce(pss.segment_codes, '{}'::text[]) as segment_codes,
      coalesce(pss.patient_segments, '[]'::jsonb) as patient_segments
    from crm_contacts c
    left join clients client on client.id = c.client_id
    left join profiles owner on owner.id = c.owner_id
    left join treatment_stats ts on ts.client_id = c.client_id
    left join current_opportunity co on co.contact_id = c.id
    left join patient_segment_stats pss on pss.contact_id = c.id
    where c.active
  ), useful as materialized (
    select * from base b
    where b.contact_type = 'patient'
      or (
        nullif(trim(b.display_name), '') is not null
        and lower(trim(b.display_name)) not in (
          'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
          'sin nombre', 'unknown'
        )
      )
      or nullif(trim(b.primary_phone), '') is not null
      or nullif(trim(b.primary_email), '') is not null
  ), filtered as materialized (
    select * from useful u
    where (
      v_search is null
      or u.search_text ilike v_search_pattern escape '\'
      or lower(array_to_string(coalesce(u.tags, '{}'::text[]), ' ')) ilike v_search_pattern escape '\'
      or lower(coalesce(u.client_name, '')) ilike v_search_pattern escape '\'
      or lower(coalesce(u.owner_name, '')) ilike v_search_pattern escape '\'
    )
    and (
      v_type = 'all'
      or (v_type in ('patient', 'patients') and u.contact_type = 'patient')
      or (v_type not in ('patient', 'patients') and u.contact_type::text = v_type)
    )
    and (v_stage = 'all' or u.current_opportunity_stage::text = v_stage)
    and (v_segment = 'all' or v_segment = any(u.segment_codes))
  ), paged_ids as materialized (
    select * from filtered
    order by last_contact_at desc nulls last, lower(display_name), id
    offset v_offset limit v_page_size
  ), opportunity_stats as materialized (
    select
      o.contact_id,
      count(*)::integer as opportunity_count,
      count(*) filter (where o.active and o.stage not in ('converted','lost'))::integer
        as open_opportunity_count
    from crm_opportunities o
    join paged_ids p on p.id = o.contact_id
    group by o.contact_id
  ), paged as materialized (
    select
      p.*,
      coalesce(os.opportunity_count, 0)::integer as opportunity_count,
      coalesce(os.open_opportunity_count, 0)::integer as open_opportunity_count
    from paged_ids p
    left join opportunity_stats os on os.contact_id = p.id
  ), totals as (
    select
      (select count(*)::integer from useful) as contacts,
      (select count(*)::integer from useful where contact_type = 'lead') as leads,
      (select count(*)::integer from useful where contact_type = 'patient') as patients,
      (select count(*)::integer from useful
        where contact_type = 'lead'
          and current_opportunity_stage not in ('lost','converted')) as active_pipeline,
      (select count(*)::integer from crm_import_candidates
        where status = 'pending' and candidate_type <> 'contact_upsert') as reviews,
      (select count(*)::integer from filtered) as filtered_total,
      (select count(*)::integer from paged) as returned
  )
  select jsonb_build_object(
    'ok', true,
    'page', v_page,
    'page_size', v_page_size,
    'filtered_total', totals.filtered_total,
    'has_more', (v_offset + totals.returned) < totals.filtered_total,
    'counts', jsonb_build_object(
      'contacts', totals.contacts,
      'leads', totals.leads,
      'patients', totals.patients,
      'active_pipeline', totals.active_pipeline,
      'reviews', totals.reviews
    ),
    'contacts', coalesce((
      select jsonb_agg(
        (to_jsonb(p) - 'search_text' - 'segment_codes')
        order by p.last_contact_at desc nulls last, lower(p.display_name), p.id
      )
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals;

  return v_result;
end $$;

comment on function crm_list_contacts(integer, integer, text, text, text, text) is
  'Lista CRM paginada, filtrable por categoría Paciente y segmentos de campañas superpuestos.';

-- ---------- Seguridad ----------
do $$
declare t text;
begin
  foreach t in array array[
    'crm_campaign_segments', 'crm_patient_segment_assignments'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists staff_all on %I;', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff());',
      t
    );
  end loop;
end $$;

revoke all on crm_campaign_segments, crm_patient_segment_assignments
  from public, anon, authenticated;
grant select on crm_campaign_segments, crm_patient_segment_assignments to authenticated;
revoke all on v_crm_patient_segment_memberships from public, anon;
grant select on v_crm_patient_segment_memberships to authenticated;

revoke all on function crm_sync_new_client_contact() from public, anon, authenticated;
revoke all on function crm_assert_patient_has_treatment() from public, anon, authenticated;
revoke all on function crm_downgrade_contact_without_treatment() from public, anon, authenticated;
revoke all on function crm_update_contact(uuid, bigint, text, text, text, text, text, text, text[])
  from public, anon;
grant execute on function crm_update_contact(uuid, bigint, text, text, text, text, text, text, text[])
  to authenticated;
revoke all on function dash_update_client(uuid, text, text, text, text, date, text, text)
  from public, anon;
grant execute on function dash_update_client(uuid, text, text, text, text, date, text, text)
  to authenticated;
revoke all on function crm_move_pipeline(uuid, text, bigint, timestamptz)
  from public, anon;
grant execute on function crm_move_pipeline(uuid, text, bigint, timestamptz)
  to authenticated;
revoke all on function crm_list_contacts(integer, integer, text, text, text, text)
  from public, anon;
grant execute on function crm_list_contacts(integer, integer, text, text, text, text)
  to authenticated;
