-- ============================================================
-- HEALEN OS · 20 · Matching CRM con semántica de tratamiento activo
--
-- Propaga la regla de paciente activo a staging y aplicación de matches.
-- Los tratamientos históricos conservan client_id, pero no se presentan
-- como paciente activo durante la revisión.
-- ============================================================

begin;

create or replace function crm_apply_candidate_internal(p_candidate uuid, p_actor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_candidate            crm_import_candidates%rowtype;
  v_proposed             jsonb;
  v_fields               jsonb;
  v_identities           jsonb;
  v_hints                jsonb;
  v_activity             jsonb;
  v_phones               text[] := '{}';
  v_emails               text[] := '{}';
  v_identity_contacts    uuid[] := '{}';
  v_client_ids           uuid[] := '{}';
  v_contact_id           uuid;
  v_linked_contact       uuid;
  v_client_id            uuid;
  v_contact_client       uuid;
  v_source_type          crm_contact_type;
  v_effective_type       crm_contact_type;
  v_final_type           crm_contact_type;
  v_name                 text;
  v_phone                text;
  v_email                text;
  v_city                 text;
  v_stage_text           text;
  v_stage                crm_opportunity_stage;
  v_tags                 text[] := '{}';
  v_first                timestamptz;
  v_last                 timestamptz;
  v_identity             jsonb;
  v_kind                 text;
  v_value                text;
  v_normalized           text;
  v_hash                 text;
  v_lock_key             text;
  v_phone_match          boolean := false;
  v_email_match          boolean := false;
  v_client_has_treatment boolean := false;
  v_client_ever_treated  boolean := false;
  v_is_staff             boolean := false;
  v_is_supplier          boolean := false;
  v_match_status         text := 'unmatched';
  v_match_method         text;
  v_old                  jsonb := '{}'::jsonb;
  v_new                  jsonb;
begin
  perform require_staff();

  select * into v_candidate from crm_import_candidates where id = p_candidate for update;
  if not found then raise exception 'Candidato CRM no encontrado'; end if;
  if v_candidate.status <> 'pending' then raise exception 'El candidato CRM ya fue revisado'; end if;
  if v_candidate.candidate_type not in ('contact_upsert','contact_checked','contact_match','contact_match_conflict') then
    raise exception 'Tipo de candidato no soportado';
  end if;
  if v_candidate.candidate_type = 'contact_upsert' then
    raise exception 'El candidato debe pasar por crm_stage_import_matches antes de aplicarse'
      using errcode = '40001';
  end if;

  v_proposed   := v_candidate.proposed_data;
  v_fields     := case when jsonb_typeof(v_proposed->'fields') = 'object' then v_proposed->'fields' else '{}'::jsonb end;
  v_identities := case when jsonb_typeof(v_proposed->'identities') = 'array' then v_proposed->'identities' else '[]'::jsonb end;
  v_hints      := case when jsonb_typeof(v_proposed->'matchHints') = 'object' then v_proposed->'matchHints' else '{}'::jsonb end;
  v_activity   := case when jsonb_typeof(v_proposed->'activitySummary') = 'object' then v_proposed->'activitySummary' else '{}'::jsonb end;

  select coalesce(array_agg(distinct phone order by phone), '{}'::text[]) into v_phones
  from (
    select crm_normalize_phone(i.value->>'e164') as phone
    from jsonb_array_elements(v_identities) i(value)
    union
    select crm_normalize_phone(h.value) as phone
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_hints->'e164') = 'array' then v_hints->'e164' else '[]'::jsonb end
    ) h(value)
  ) phones where phone is not null;

  select coalesce(array_agg(distinct email order by email), '{}'::text[]) into v_emails
  from (
    select crm_normalize_email(h.value) as email
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_hints->'emails') = 'array' then v_hints->'emails' else '[]'::jsonb end
    ) h(value)
  ) emails where email is not null;

  -- Serializa aprobaciones que compartan cualquier identidad exacta. Los
  -- locks se toman en orden estable para evitar carreras y deadlocks.
  for v_lock_key in
    select lock_key from (
      select 'phone:' || value as lock_key from unnest(v_phones) value
      union
      select 'email:' || value as lock_key from unnest(v_emails) value
      union
      select
        case lower(coalesce(i.value->>'type',''))
          when 'whatsapp_pn' then 'whatsapp_pn:'
          when 'whatsapp_lid' then 'whatsapp_lid:'
          else 'whatsapp_jid:' end
        || crm_normalize_identity(
          case lower(coalesce(i.value->>'type',''))
            when 'whatsapp_pn' then 'whatsapp_pn'
            when 'whatsapp_lid' then 'whatsapp_lid'
            else 'whatsapp_jid' end,
          i.value->>'value'
        ) as lock_key
      from jsonb_array_elements(v_identities) i(value)
    ) locks where lock_key is not null order by lock_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  end loop;

  -- Contacto existente: solo identidades exactas. Un nombre no participa.
  select coalesce(array_agg(distinct ci.contact_id order by ci.contact_id), '{}'::uuid[])
  into v_identity_contacts
  from crm_contact_identities ci
  where (ci.kind = 'phone' and ci.normalized_value = any(v_phones))
     or (ci.kind = 'email' and ci.normalized_value = any(v_emails))
     or exists (
       select 1 from jsonb_array_elements(v_identities) i(value)
       where ci.kind = case lower(coalesce(i.value->>'type',''))
           when 'whatsapp_pn' then 'whatsapp_pn'
           when 'whatsapp_lid' then 'whatsapp_lid'
           else 'whatsapp_jid' end
         and ci.normalized_value = crm_normalize_identity(
           case lower(coalesce(i.value->>'type',''))
             when 'whatsapp_pn' then 'whatsapp_pn'
             when 'whatsapp_lid' then 'whatsapp_lid'
             else 'whatsapp_jid' end,
           i.value->>'value'
         )
     );
  if coalesce(array_length(v_identity_contacts, 1), 0) > 1 then
    raise exception 'Conflicto: una identidad exacta pertenece a varios contactos CRM';
  end if;
  v_contact_id := v_identity_contacts[1];

  -- Recalcula el set exacto, pero la decisión humana queda ligada al estado
  -- mostrado por staging. Si cambió, obliga a volver a preparar/revisar.
  select coalesce(array_agg(distinct c.id order by c.id), '{}'::uuid[])
  into v_client_ids
  from clients c
  where (
      (crm_normalize_phone(c.phone) is not null and crm_normalize_phone(c.phone) = any(v_phones))
      or (crm_normalize_email(c.email) is not null and crm_normalize_email(c.email) = any(v_emails))
    );

  if v_candidate.candidate_type = 'contact_match_conflict' then
    -- El CTA explícito es "Importar sin vincular": nunca elige un client,
    -- aunque el set haya cambiado desde que se mostró el conflicto.
    v_client_id := null;
    v_match_status := 'conflict';
    v_match_method := 'manual_unlinked_conflict';
  elsif v_candidate.candidate_type = 'contact_checked' then
    if coalesce(array_length(v_client_ids, 1), 0) <> 0 then
      raise exception 'Las coincidencias cambiaron; vuelve a preparar la bandeja'
        using errcode = '40001';
    end if;
  elsif v_candidate.candidate_type = 'contact_match' then
    if coalesce(array_length(v_client_ids, 1), 0) <> 1
       or v_candidate.matched_client_id is null
       or v_client_ids[1] <> v_candidate.matched_client_id then
      raise exception 'El registro sugerido cambió; vuelve a preparar la bandeja'
        using errcode = '40001';
    end if;
    v_client_id := v_candidate.matched_client_id;
  end if;

  if v_client_id is not null then
    select id into v_linked_contact
    from crm_contacts where client_id = v_client_id for update;
    if v_contact_id is not null and v_linked_contact is not null and v_contact_id <> v_linked_contact then
      raise exception 'Conflicto: la identidad y el paciente exacto apuntan a contactos distintos';
    end if;
    v_contact_id := coalesce(v_contact_id, v_linked_contact);
    select
      crm_normalize_phone(c.phone) = any(v_phones),
      crm_normalize_email(c.email) = any(v_emails)
    into v_phone_match, v_email_match
    from clients c where c.id = v_client_id;
    v_match_status := 'matched';
    select exists (
      select 1 from treatments t
      where t.client_id = v_client_id
        and t.status in ('activo', 'por_finalizar')
    )
      into v_client_has_treatment;
    select exists (select 1 from treatments t where t.client_id = v_client_id)
      into v_client_ever_treated;
    v_match_method := case when v_phone_match and v_email_match then 'exact_phone_email'
                           when v_phone_match then 'exact_phone'
                           else 'exact_email' end;
  end if;

  if v_contact_id is not null then
    select client_id into v_contact_client
    from crm_contacts where id = v_contact_id for update;
    if v_contact_client is not null and v_client_id is not null and v_contact_client <> v_client_id then
      raise exception 'Conflicto: el contacto ya está vinculado a otro paciente';
    end if;
    v_old := coalesce(crm_contact_snapshot(v_contact_id), '{}'::jsonb);
  end if;

  v_source_type := crm_map_contact_type(v_proposed->>'contactType');
  -- Ni siquiera una fuente que envíe "patient" puede saltarse el match de treatment.
  if v_source_type = 'patient' and not v_client_has_treatment then v_source_type := 'lead'; end if;

  select exists (
    select 1 from profiles p where p.active
      and crm_normalize_phone(p.phone) is not null
      and crm_normalize_phone(p.phone) = any(v_phones)
  ) into v_is_staff;
  select exists (
    select 1 from suppliers s where s.active and (
      (crm_normalize_phone(s.phone) is not null and crm_normalize_phone(s.phone) = any(v_phones))
      or (crm_normalize_email(s.email) is not null and crm_normalize_email(s.email) = any(v_emails))
    )
  ) into v_is_supplier;

  v_effective_type := case when v_client_has_treatment then 'patient'::crm_contact_type
                           when v_is_staff then 'staff'::crm_contact_type
                           when v_is_supplier then 'supplier'::crm_contact_type
                           when v_client_id is not null then 'lead'::crm_contact_type
                           else v_source_type end;
  v_name  := left(nullif(trim(v_fields->>'name'), ''), 200);
  v_phone := v_phones[1];
  -- Se conserva como dato propuesto/aprobado, pero no se usa como identidad
  -- automática porque puede ser un correo de tercero mencionado en el chat.
  v_email := crm_normalize_email(v_fields->>'email');
  v_city  := left(nullif(trim(v_fields->>'city'), ''), 120);
  v_tags  := crm_json_text_array(v_fields->'interests');
  begin v_first := nullif(v_activity->>'firstMessageAt', '')::timestamptz;
  exception when others then v_first := null; end;
  begin v_last := nullif(v_activity->>'lastMessageAt', '')::timestamptz;
  exception when others then v_last := null; end;
  v_stage_text := lower(coalesce(nullif(v_fields->>'suggestedStage',''), 'unclassified'));
  if v_stage_text not in (
    'new','contacted','interested','qualified','appointment_pending',
    'appointment_scheduled','converted','follow_up','lost','unclassified'
  ) then v_stage_text := 'unclassified'; end if;
  v_stage := v_stage_text::crm_opportunity_stage;

  if v_contact_id is null then
    insert into crm_contacts(
      display_name, primary_phone, primary_email, city, contact_type,
      lifecycle_stage, client_id, match_status, match_method, match_confidence,
      first_contact_at, last_contact_at, tags, source, metadata, created_by
    ) values (
      coalesce(v_name, v_phone, v_email, 'Contacto WhatsApp'),
      v_phone, v_email, v_city, v_effective_type,
      case when v_client_has_treatment then 'patient'
           when v_client_ever_treated then 'recovery'
           when v_client_id is not null then 'lead' else v_effective_type::text end,
      v_client_id, v_match_status, v_match_method,
      case when v_client_id is not null then 1 else null end,
      v_first, v_last, v_tags, 'whatsapp_history_read_only',
      jsonb_build_object(
        'lastImportCandidate', v_candidate.id,
        'sourceContactType', coalesce(v_proposed->>'sourceContactType', v_proposed->>'contactType')
      ),
      p_actor
    ) returning id into v_contact_id;
  else
    update crm_contacts c set
      display_name = case when c.display_name in ('', 'Contacto sin nombre', 'Contacto WhatsApp')
        then coalesce(v_name, c.display_name) else c.display_name end,
      primary_phone = coalesce(c.primary_phone, v_phone),
      primary_email = coalesce(c.primary_email, v_email),
      city = coalesce(c.city, v_city),
      contact_type = case
        when v_client_has_treatment then 'patient'::crm_contact_type
        when v_is_staff then 'staff'::crm_contact_type
        when v_is_supplier and c.contact_type not in ('patient','staff') then 'supplier'::crm_contact_type
        when v_client_id is not null then 'lead'::crm_contact_type
        when c.contact_type in ('unknown','other','group_only') then v_effective_type
        else c.contact_type end,
      lifecycle_stage = case when v_client_has_treatment then 'patient'
        when v_client_ever_treated then 'recovery'
        when v_client_id is not null then 'lead' else c.lifecycle_stage end,
      client_id = coalesce(c.client_id, v_client_id),
      match_status = case when v_client_id is not null or v_match_status = 'conflict'
        then v_match_status else c.match_status end,
      match_method = coalesce(v_match_method, c.match_method),
      match_confidence = case when v_client_id is not null then 1 else c.match_confidence end,
      first_contact_at = case when c.first_contact_at is null then v_first
        when v_first is null then c.first_contact_at else least(c.first_contact_at, v_first) end,
      last_contact_at = case when c.last_contact_at is null then v_last
        when v_last is null then c.last_contact_at else greatest(c.last_contact_at, v_last) end,
      tags = coalesce((select array_agg(distinct tag order by tag)
        from unnest(c.tags || v_tags) tag), '{}'::text[]),
      metadata = c.metadata || jsonb_build_object(
        'lastImportCandidate', v_candidate.id,
        'sourceContactType', coalesce(v_proposed->>'sourceContactType', v_proposed->>'contactType')
      )
    where c.id = v_contact_id;
  end if;

  -- Alias WhatsApp exactos; conflictos no reasignan identidades silenciosamente.
  for v_identity in select value from jsonb_array_elements(v_identities) loop
    v_kind := case lower(coalesce(v_identity->>'type',''))
      when 'whatsapp_pn' then 'whatsapp_pn'
      when 'whatsapp_lid' then 'whatsapp_lid'
      else 'whatsapp_jid' end;
    v_value := nullif(trim(v_identity->>'value'), '');
    v_normalized := crm_normalize_identity(v_kind, v_value);
    v_hash := crm_identity_hash(v_kind, v_value);
    if v_normalized is not null and v_hash is not null then
      insert into crm_contact_identities(
        contact_id, kind, identity_value, normalized_value, value_hash, verified
      )
      values (v_contact_id, v_kind, v_value, v_normalized, v_hash, true)
      on conflict (kind, value_hash) do nothing;
    end if;
  end loop;

  foreach v_value in array v_phones loop
    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash, is_primary, verified
    )
    values (
      v_contact_id, 'phone', v_value, v_value, crm_identity_hash('phone', v_value),
      v_value = v_phone, true
    )
    on conflict (kind, value_hash) do nothing;
  end loop;
  foreach v_value in array v_emails loop
    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash, is_primary, verified
    )
    values (
      v_contact_id, 'email', v_value, v_value, crm_identity_hash('email', v_value),
      v_value = v_email, true
    )
    on conflict (kind, value_hash) do nothing;
  end loop;

  select contact_type into v_final_type from crm_contacts where id = v_contact_id;
  if v_final_type = 'lead' then
    insert into crm_opportunities(
      contact_id, stage, interests, source_record_key, created_by
    ) values (
      v_contact_id, v_stage, v_tags, v_candidate.source_record_key, p_actor
    )
    on conflict (contact_id, source_record_key) do update set
      stage = excluded.stage,
      interests = excluded.interests;
  end if;

  v_new := coalesce(crm_contact_snapshot(v_contact_id), '{}'::jsonb);
  update crm_import_candidates set
    contact_id = v_contact_id,
    matched_client_id = v_client_id,
    match_status = v_match_status,
    current_data = v_old
  where id = v_candidate.id;

  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  values (
    'crm_contact', v_contact_id, 'candidate_apply', v_old, v_new,
    jsonb_build_object(
      'candidateId', v_candidate.id,
      'matchPolicy', 'exact_identity_and_treatment_only',
      'nameMatchUsed', false
    ),
    p_actor
  );
  return v_contact_id;
end $$;

create or replace function crm_stage_import_matches(
  p_import_run uuid,
  p_limit integer default 500,
  p_dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit      integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_candidate  record;
  v_clients    uuid[];
  v_client     record;
  v_base       jsonb;
  v_scanned    integer := 0;
  v_unique     integer := 0;
  v_conflicts  integer := 0;
  v_staged     integer := 0;
begin
  perform require_staff();
  if not exists (select 1 from crm_import_runs where id = p_import_run) then
    raise exception 'Corrida CRM no encontrada';
  end if;
  for v_candidate in
    select id, proposed_data from crm_import_candidates
    where import_run_id = p_import_run and status = 'pending'
      and candidate_type in ('contact_upsert','contact_checked','contact_match','contact_match_conflict')
    order by created_at, id limit v_limit
    for update skip locked
  loop
    v_scanned := v_scanned + 1;
    v_base := v_candidate.proposed_data
      - 'client_id' - 'client_name' - 'client_code'
      - 'client_has_treatment' - 'client_conflict_count';
    v_clients := crm_candidate_exact_clients(v_candidate.proposed_data);
    if coalesce(array_length(v_clients, 1), 0) = 1 then
      v_unique := v_unique + 1;
      if not coalesce(p_dry_run, true) then
        select c.id, c.full_name, c.code, c.phone, c.email,
          exists (
            select 1 from treatments t
            where t.client_id = c.id
              and t.status in ('activo', 'por_finalizar')
          ) as has_treatment
        into v_client from clients c where c.id = v_clients[1];
        update crm_import_candidates set
          candidate_type = 'contact_match', matched_client_id = v_client.id,
          match_status = 'suggested',
          proposed_data = v_base || jsonb_build_object(
            'client_id', v_client.id, 'client_name', v_client.full_name,
            'client_code', v_client.code, 'client_has_treatment', v_client.has_treatment
          ),
          current_data = jsonb_strip_nulls(jsonb_build_object(
            'full_name', v_client.full_name, 'phone', v_client.phone,
            'email', v_client.email, 'client_code', v_client.code,
            'client_has_treatment', v_client.has_treatment
          ))
        where id = v_candidate.id and status = 'pending';
        v_staged := v_staged + 1;
      end if;
    elsif coalesce(array_length(v_clients, 1), 0) > 1 then
      v_conflicts := v_conflicts + 1;
      if not coalesce(p_dry_run, true) then
        update crm_import_candidates set
          candidate_type = 'contact_match_conflict', match_status = 'conflict', matched_client_id = null,
          proposed_data = v_base || jsonb_build_object(
            'client_conflict_count', array_length(v_clients, 1)
          ),
          current_data = '{}'::jsonb
        where id = v_candidate.id and status = 'pending';
        v_staged := v_staged + 1;
      end if;
    elsif not coalesce(p_dry_run, true) then
      update crm_import_candidates set
        candidate_type = 'contact_checked', match_status = 'unmatched',
        matched_client_id = null, proposed_data = v_base, current_data = '{}'::jsonb
      where id = v_candidate.id and status = 'pending';
      v_staged := v_staged + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'ok', true, 'dry_run', coalesce(p_dry_run, true), 'scanned', v_scanned,
    'unique_exact_matches', v_unique, 'conflicts', v_conflicts, 'staged', v_staged,
    'name_matching', false, 'patient_requires_treatment', true,
    'links_unique_clients_without_treatment_as_leads', true,
    'writes_contacts', false, 'writes_clients', false, 'writes_treatments', false
  );
end $$;

-- Corrige candidatos pendientes preparados antes de esta migración.
with active_match as (
  select candidate.id,
         exists (
           select 1 from treatments t
           where t.client_id = candidate.matched_client_id
             and t.status in ('activo', 'por_finalizar')
         ) as has_active_treatment
  from crm_import_candidates candidate
  where candidate.status = 'pending'
    and candidate.matched_client_id is not null
)
update crm_import_candidates candidate set
  proposed_data = jsonb_set(candidate.proposed_data, '{client_has_treatment}',
    to_jsonb(active_match.has_active_treatment), true),
  current_data = jsonb_set(candidate.current_data, '{client_has_treatment}',
    to_jsonb(active_match.has_active_treatment), true)
from active_match
where candidate.id = active_match.id;

comment on function crm_apply_candidate_internal(uuid, uuid) is
  'Aplica candidatos CRM; paciente significa tratamiento activo/por finalizar. Históricos quedan vinculados en recuperación.';
comment on function crm_stage_import_matches(uuid, integer, boolean) is
  'Stage exacto por identidad; client_has_treatment significa tratamiento activo/por finalizar.';

revoke execute on function crm_apply_candidate_internal(uuid, uuid) from public, anon, authenticated;
revoke execute on function crm_stage_import_matches(uuid, integer, boolean) from public, anon;
grant execute on function crm_stage_import_matches(uuid, integer, boolean) to authenticated;

commit;
