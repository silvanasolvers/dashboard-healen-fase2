-- ============================================================
-- HEALEN OS · 19 · Limpieza reversible del directorio CRM
-- ============================================================
-- Un ID técnico de WhatsApp y fechas de actividad no convierten por sí solos
-- un registro en un contacto útil. Esta migración archiva esos registros sin
-- borrar su trazabilidad y evita que contactos inactivos aparezcan en el CRM.

create or replace function crm_archive_empty_contacts(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := '{}'::uuid[];
  v_count integer := 0;
begin
  perform require_staff();

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into v_ids
  from crm_contacts c
  where c.active
    and c.client_id is null
    and c.contact_type in ('unknown', 'group_only', 'other', 'lead')
    and lower(trim(c.display_name)) in (
      'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
      'sin nombre', 'unknown'
    )
    and nullif(trim(c.primary_phone), '') is null
    and nullif(trim(c.primary_email), '') is null
    and nullif(trim(c.city), '') is null
    and nullif(trim(c.last_summary), '') is null
    and c.owner_id is null
    and coalesce(cardinality(c.tags), 0) = 0;

  v_count := coalesce(cardinality(v_ids), 0);

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('ok', true, 'dry_run', true, 'would_archive', v_count);
  end if;

  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  select
    'crm_contact', c.id, 'empty_contact_archived',
    crm_contact_snapshot(c.id),
    jsonb_build_object('active', false),
    jsonb_build_object(
      'reason', 'Sin nombre, teléfono, correo, ciudad, resumen ni etiquetas; la oportunidad era automática',
      'reversible', true
    ),
    auth.uid()
  from crm_contacts c
  where c.id = any(v_ids);

  update crm_opportunities set active = false
  where contact_id = any(v_ids) and active;

  update crm_contacts set active = false
  where id = any(v_ids) and active;

  return jsonb_build_object('ok', true, 'dry_run', false, 'archived', v_count);
end $$;

revoke all on function crm_archive_empty_contacts(boolean) from public, anon;
grant execute on function crm_archive_empty_contacts(boolean) to authenticated;

create or replace view v_crm_contacts as
select
  c.id,
  c.display_name,
  c.primary_phone,
  c.primary_email,
  c.city,
  case
    when treatment_stats.treatment_count > 0 then 'patient'::crm_contact_type
    when c.contact_type = 'patient' then 'lead'::crm_contact_type
    else c.contact_type
  end                                                     as contact_type,
  case when treatment_stats.treatment_count = 0 and c.lifecycle_stage = 'patient'
    then 'lead' else c.lifecycle_stage end                 as lifecycle_stage,
  c.client_id,
  client.code                                             as client_code,
  client.full_name                                        as client_name,
  (treatment_stats.treatment_count > 0)                   as has_treatment,
  treatment_stats.treatment_count,
  treatment_stats.active_treatment_count,
  case when treatment_stats.treatment_count > 0 then 'matched' else c.match_status end as match_status,
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
  coalesce(identities.items, '[]'::jsonb)                  as identities
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
where c.active;

comment on view v_crm_contacts is 'Directorio CRM activo. has_treatment/treatment_count son la única fuente de verdad para mostrar Paciente.';
alter view v_crm_contacts set (security_invoker = on);
revoke all on v_crm_contacts from public, anon;
grant select on v_crm_contacts to authenticated;
