-- ============================================================
-- HEALEN OS · 19 · Ciclo CRM ↔ pacientes activos ↔ recuperación
--
-- Regla de negocio:
--   * Paciente = cliente con al menos un tratamiento activo/por finalizar.
--   * Tratamiento histórico sin ninguno activo = recuperación en CRM.
--   * Lead sin tratamiento = solo CRM.
--   * La identidad CRM ↔ clients se conserva en todas las etapas.
-- ============================================================

begin;

-- ---------- Pacientes: solo tratamientos clínicamente activos ----------
create or replace view public.v_dashboard_patients as
select
  c.code                                              as id,
  c.full_name                                         as name,
  c.document_id                                       as "documentId",
  t.name                                              as plan,
  coalesce(t.sale_price, 0)                           as "saleValue",
  case
    when coalesce(fin.total_sales, 0) >= 8000000 then 'VIP'
    when coalesce(fin.total_sales, 0) >= 4000000 then 'Alto'
    when coalesce(fin.total_sales, 0) >= 1500000 then 'Medio'
    else 'Basico'
  end                                                 as tier,
  t.start_date                                        as "startDate",
  coalesce(t.end_date, current_date)                  as "endDate",
  case when t.end_date is null then 0 else greatest((t.end_date - current_date), 0) end as "daysLeft",
  greatest(coalesce(t.end_date, current_date) - t.start_date, 1) as "totalDays",
  coalesce(t.weekly_serum, false)                     as "weeklySerum",
  coalesce(t.serum_day, '-')                          as "serumDay",
  case when t.status = 'por_finalizar' then 'Por finalizar' else 'Activo' end as status,
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
  ), '[]'::jsonb)                                     as peptides,
  c.phone                                             as phone,
  c.email                                             as email
from clients c
join lateral (
  select tr.*
  from treatments tr
  where tr.client_id = c.id
    and tr.status in ('activo', 'por_finalizar')
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

comment on view public.v_dashboard_patients is
  'Pacientes clínicamente activos: clientes habilitados con tratamiento activo o por finalizar. Leads y pacientes históricos quedan fuera.';
alter view public.v_dashboard_patients set (security_invoker = on);

-- ---------- CRM: paciente activo vs. recuperación ----------
create or replace view public.v_crm_contacts as
select
  c.id,
  c.display_name,
  c.primary_phone,
  c.primary_email,
  c.city,
  case
    when treatment_stats.active_treatment_count > 0 then 'patient'::crm_contact_type
    when treatment_stats.treatment_count > 0 then 'lead'::crm_contact_type
    when c.contact_type = 'patient' then 'lead'::crm_contact_type
    else c.contact_type
  end                                                     as contact_type,
  case
    when treatment_stats.active_treatment_count > 0 then 'patient'
    when treatment_stats.treatment_count > 0 then 'recovery'
    when c.lifecycle_stage = 'patient' then 'lead'
    else c.lifecycle_stage
  end                                                     as lifecycle_stage,
  c.client_id,
  client.code                                             as client_code,
  client.full_name                                        as client_name,
  (treatment_stats.active_treatment_count > 0)            as has_treatment,
  treatment_stats.treatment_count,
  treatment_stats.active_treatment_count,
  case when c.client_id is not null then 'matched' else c.match_status end as match_status,
  c.match_method,
  c.match_confidence,
  c.first_contact_at,
  c.last_contact_at,
  c.last_summary,
  c.tags,
  c.owner_id,
  owner.full_name                                         as owner_name,
  c.active,
  c.lock_version,
  c.created_at,
  c.updated_at,
  opportunity_stats.opportunity_count,
  opportunity_stats.open_opportunity_count,
  coalesce(current_opportunity.stage, 'unclassified'::crm_opportunity_stage) as current_opportunity_stage,
  current_opportunity.next_action_at,
  coalesce(identities.items, '[]'::jsonb)                 as identities,
  coalesce(segments.items, '[]'::jsonb)                   as patient_segments
from crm_contacts c
left join clients client on client.id = c.client_id
left join profiles owner on owner.id = c.owner_id
left join lateral (
  select
    count(*)::integer as treatment_count,
    count(*) filter (where t.status in ('activo','por_finalizar'))::integer as active_treatment_count
  from treatments t where t.client_id = c.client_id
) treatment_stats on true
left join lateral (
  select
    count(*)::integer as opportunity_count,
    count(*) filter (where o.active and o.stage not in ('converted','lost'))::integer as open_opportunity_count
  from crm_opportunities o where o.contact_id = c.id
) opportunity_stats on true
left join lateral (
  select o.stage, o.next_action_at
  from crm_opportunities o where o.contact_id = c.id and o.active
  order by o.updated_at desc, o.created_at desc limit 1
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

comment on view public.v_crm_contacts is
  'CRM relacionado con clients: has_treatment significa tratamiento activo; tratamiento solo histórico deriva lifecycle_stage=recovery sin perder client_id.';
alter view public.v_crm_contacts set (security_invoker = on);

-- ---------- Invariantes para escrituras futuras ----------
create or replace function public.crm_assert_patient_has_treatment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.contact_type = 'patient'::crm_contact_type then
    if new.client_id is null then
      raise exception 'Un contacto solo puede ser paciente si tiene un tratamiento activo'
        using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('crm-patient:' || new.client_id::text, 0));
    if not exists (
      select 1 from treatments t
      where t.client_id = new.client_id
        and t.status in ('activo', 'por_finalizar')
    ) then
      -- Compatibilidad con importaciones antiguas que proponían patient por
      -- cualquier tratamiento histórico: se corrige al ciclo real antes de guardar.
      new.contact_type := 'lead'::crm_contact_type;
      new.lifecycle_stage := case
        when exists (select 1 from treatments t where t.client_id = new.client_id)
          then 'recovery'
        else 'lead'
      end;
    end if;
  end if;
  return new;
end $$;

create or replace function public.crm_sync_contact_treatment_lifecycle()
returns trigger language plpgsql set search_path = public as $$
declare
  v_client uuid;
  v_target_type crm_contact_type;
  v_target_stage text;
begin
  for v_client in
    select distinct affected.client_id
    from (
      select case when tg_op <> 'INSERT' then old.client_id end as client_id
      union all
      select case when tg_op <> 'DELETE' then new.client_id end
    ) affected
    where affected.client_id is not null
  loop
    perform pg_advisory_xact_lock(hashtextextended('crm-patient:' || v_client::text, 0));
    if exists (
      select 1 from treatments t
      where t.client_id = v_client
        and t.status in ('activo', 'por_finalizar')
    ) then
      v_target_type := 'patient'::crm_contact_type;
      v_target_stage := 'patient';
    elsif exists (select 1 from treatments t where t.client_id = v_client) then
      v_target_type := 'lead'::crm_contact_type;
      v_target_stage := 'recovery';
    else
      v_target_type := 'lead'::crm_contact_type;
      v_target_stage := 'lead';
    end if;

    update crm_contacts set
      contact_type = v_target_type,
      lifecycle_stage = v_target_stage
    where client_id = v_client
      and (contact_type is distinct from v_target_type
        or lifecycle_stage is distinct from v_target_stage);
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Inserción, reactivación, finalización, cancelación o traslado mantienen
-- sincronizado el estado almacenado además de la clasificación derivada en la vista.
drop trigger if exists trg_crm_treatment_delete_sync on treatments;
drop trigger if exists trg_crm_treatment_insert_sync on treatments;
drop trigger if exists trg_crm_treatment_move_sync on treatments;
create trigger trg_crm_treatment_insert_sync
  after insert on treatments
  for each row execute function crm_sync_contact_treatment_lifecycle();
create trigger trg_crm_treatment_delete_sync
  after delete on treatments
  for each row execute function crm_sync_contact_treatment_lifecycle();
create trigger trg_crm_treatment_move_sync
  after update of client_id, status on treatments
  for each row
  when (old.client_id is distinct from new.client_id or old.status is distinct from new.status)
  execute function crm_sync_contact_treatment_lifecycle();

revoke execute on function crm_sync_contact_treatment_lifecycle() from public, anon, authenticated;
drop function if exists public.crm_downgrade_contact_without_treatment();

commit;
