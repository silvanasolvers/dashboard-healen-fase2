-- ============================================================
-- HEALEN OS · 16 · CRM de contactos WhatsApp
--
-- Principios de seguridad:
--   * Un contacto CRM NO es paciente por el contenido de una conversación.
--   * Solo un match exacto (teléfono WhatsApp o email verificado) contra un cliente que tenga al
--     menos un tratamiento permite mostrarlo como paciente.
--   * Los nombres nunca producen matches automáticos.
--   * La ingesta entra primero a staging; aplicar y mezclar son operaciones
--     separadas, auditadas y con dry-run por defecto.
--   * No se almacenan cuerpos ni fragmentos de mensajes como evidencia.
--
-- DEBE correr después de 01–15. Nunca requiere 06_seed.sql.
-- ============================================================

-- ---------- Enums propios del CRM ----------
do $$ begin
  create type crm_contact_type as enum (
    'unknown', 'lead', 'patient', 'supplier', 'staff', 'partner',
    'personal', 'group_only', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type crm_opportunity_stage as enum (
    'new', 'contacted', 'interested', 'qualified',
    'appointment_pending', 'appointment_scheduled', 'converted',
    'follow_up', 'lost', 'unclassified'
  );
exception when duplicate_object then null; end $$;

-- ---------- Helpers determinísticos ----------
create or replace function crm_normalize_phone(p_value text)
returns text language plpgsql immutable set search_path = public as $$
declare v_digits text;
begin
  v_digits := regexp_replace(coalesce(trim(p_value), ''), '[^0-9]', '', 'g');
  if v_digits = '' then return null; end if;
  if left(v_digits, 2) = '00' then v_digits := substr(v_digits, 3); end if;
  -- Números móviles colombianos locales: 3001234567 -> +573001234567.
  if length(v_digits) = 10 and left(v_digits, 1) = '3' then
    return '+57' || v_digits;
  end if;
  return '+' || v_digits;
end $$;

create or replace function crm_normalize_email(p_value text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(trim(coalesce(p_value, ''))), '');
$$;

create or replace function crm_normalize_identity(p_kind text, p_value text)
returns text language plpgsql immutable set search_path = public as $$
declare v_kind text := lower(trim(coalesce(p_kind, '')));
declare v_value text := lower(trim(coalesce(p_value, '')));
begin
  if v_kind = 'phone' then return crm_normalize_phone(v_value); end if;
  if v_kind = 'email' then return crm_normalize_email(v_value); end if;
  if v_value = '' then return null; end if;
  -- Elimina el device suffix de JIDs multidispositivo sin cambiar PN/LID.
  return regexp_replace(v_value, ':[0-9]+@', '@');
end $$;

create or replace function crm_identity_hash(p_kind text, p_value text)
returns text language sql immutable set search_path = public as $$
  select case when crm_normalize_identity(p_kind, p_value) is null then null
    else encode(extensions.digest(crm_normalize_identity(p_kind, p_value), 'sha256'), 'hex') end;
$$;

create or replace function crm_json_text_array(p_value jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct trim(v) order by trim(v)) filter (where trim(v) <> ''), '{}'::text[])
  from jsonb_array_elements_text(
    case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
  ) as x(v);
$$;

create or replace function crm_map_contact_type(p_value text)
returns crm_contact_type language plpgsql immutable set search_path = public as $$
declare v text := lower(trim(coalesce(p_value, 'unknown')));
begin
  if v in ('vendor', 'provider', 'proveedor') then return 'supplier'; end if;
  if v = 'patient_candidate' then return 'lead'; end if;
  if v in ('unknown','lead','patient','supplier','staff','partner','personal','group_only','other') then
    return v::crm_contact_type;
  end if;
  return 'other';
end $$;

-- ---------- Contactos e identidades ----------
create table if not exists crm_contacts (
  id                    uuid primary key default gen_random_uuid(),
  display_name          text not null default 'Contacto sin nombre',
  primary_phone         text,
  primary_email         text,
  city                  text,
  contact_type          crm_contact_type not null default 'unknown',
  lifecycle_stage       text not null default 'new',
  client_id             uuid references clients(id) on delete set null,
  match_status          text not null default 'unmatched'
                          check (match_status in ('unmatched','suggested','matched','conflict','rejected')),
  match_method          text,
  match_confidence      numeric(5,4) check (match_confidence between 0 and 1),
  first_contact_at      timestamptz,
  last_contact_at       timestamptz,
  last_summary          text,
  tags                  text[] not null default '{}',
  owner_id              uuid references profiles(id) on delete set null,
  source                text not null default 'manual',
  active                boolean not null default true,
  metadata              jsonb not null default '{}'::jsonb,
  lock_version          bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  constraint crm_contacts_patient_client_ck
    check (contact_type <> 'patient'::crm_contact_type or client_id is not null)
);
comment on table crm_contacts is 'Directorio CRM. La condición de paciente se deriva en v_crm_contacts de treatments; nunca del chat.';

do $$ begin
  alter table crm_contacts add constraint crm_contacts_patient_client_ck
    check (contact_type <> 'patient'::crm_contact_type or client_id is not null);
exception when duplicate_object then null; end $$;

create unique index if not exists uq_crm_contacts_client
  on crm_contacts(client_id) where client_id is not null;
create index if not exists idx_crm_contacts_type on crm_contacts(contact_type) where active;
create index if not exists idx_crm_contacts_activity on crm_contacts(last_contact_at desc nulls last);
create index if not exists idx_crm_contacts_phone on crm_contacts(crm_normalize_phone(primary_phone))
  where primary_phone is not null;
create index if not exists idx_crm_contacts_email on crm_contacts(crm_normalize_email(primary_email))
  where primary_email is not null;

create table if not exists crm_contact_identities (
  id                    uuid primary key default gen_random_uuid(),
  contact_id            uuid not null references crm_contacts(id) on delete cascade,
  kind                  text not null check (kind in ('whatsapp_pn','whatsapp_lid','whatsapp_jid','phone','email')),
  identity_value        text not null,
  normalized_value      text not null,
  value_hash            text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  source                text not null default 'whatsapp_history_read_only',
  is_primary            boolean not null default false,
  verified              boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (kind, value_hash)
);
comment on table crm_contact_identities is 'Alias exactos PN/LID/JID/teléfono/email. El hash se usa para deduplicar; el valor claro queda bajo RLS staff-only.';
create index if not exists idx_crm_identities_contact on crm_contact_identities(contact_id);
create index if not exists idx_crm_identities_normalized on crm_contact_identities(kind, normalized_value);

-- ---------- Pipeline comercial ----------
create table if not exists crm_opportunities (
  id                    uuid primary key default gen_random_uuid(),
  contact_id            uuid not null references crm_contacts(id) on delete cascade,
  title                 text not null default 'Conversación WhatsApp',
  stage                 crm_opportunity_stage not null default 'new',
  interests             text[] not null default '{}',
  estimated_value       numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  owner_id              uuid references profiles(id) on delete set null,
  next_action_at        timestamptz,
  closed_at             timestamptz,
  lost_reason           text,
  source_record_key     text,
  active                boolean not null default true,
  lock_version          bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  unique (contact_id, source_record_key)
);
comment on table crm_opportunities is 'Embudo comercial separado del dominio clínico. Solo leads se muestran en el pipeline del front.';
create index if not exists idx_crm_opportunities_contact on crm_opportunities(contact_id);
create index if not exists idx_crm_opportunities_stage on crm_opportunities(stage) where active;
create index if not exists idx_crm_opportunities_next on crm_opportunities(next_action_at) where active;

-- ---------- Staging de importación ----------
create table if not exists crm_import_runs (
  id                    uuid primary key default gen_random_uuid(),
  external_run_id       text not null,
  source                text not null,
  idempotency_key       text not null unique,
  source_checksum       text not null,
  payload_checksum      text not null check (payload_checksum ~ '^[0-9a-f]{64}$'),
  schema_version        integer not null,
  config                jsonb not null default '{}'::jsonb,
  status                text not null default 'ingested'
                          check (status in ('ingested','applying','completed','failed')),
  candidates_received   integer not null default 0,
  candidates_applied    integer not null default 0,
  candidates_rejected   integer not null default 0,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  created_by            uuid references auth.users(id),
  unique (source, external_run_id)
);
comment on table crm_import_runs is 'Ejecuciones idempotentes. Verifica checksum de fuente y del arreglo real recibido; nunca guarda el archivo crudo de conversaciones.';

create table if not exists crm_import_candidates (
  id                    uuid primary key default gen_random_uuid(),
  import_run_id         uuid not null references crm_import_runs(id) on delete cascade,
  source_record_key     text not null,
  candidate_type        text not null default 'contact_upsert',
  status                text not null default 'pending'
                          check (status in ('pending','approved','rejected')),
  contact_id            uuid references crm_contacts(id) on delete set null,
  matched_client_id     uuid references clients(id) on delete set null,
  match_status          text not null default 'unmatched'
                          check (match_status in ('unmatched','suggested','matched','conflict','rejected')),
  current_data          jsonb not null default '{}'::jsonb,
  proposed_data         jsonb not null,
  confidence            numeric(5,4) not null default 0 check (confidence between 0 and 1),
  reason                text,
  lock_version          bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  reviewed_at           timestamptz,
  reviewed_by           uuid references profiles(id) on delete set null,
  review_note           text,
  unique (import_run_id, source_record_key)
);
comment on table crm_import_candidates is 'Propuestas revisables. Aprobar crea/actualiza CRM, pero nunca crea clientes ni tratamientos.';
create index if not exists idx_crm_candidates_queue on crm_import_candidates(status, confidence desc, created_at);
create index if not exists idx_crm_candidates_contact on crm_import_candidates(contact_id);

create table if not exists crm_contact_evidence (
  id                    uuid primary key default gen_random_uuid(),
  candidate_id          uuid not null references crm_import_candidates(id) on delete cascade,
  field_name            text,
  message_id            text,
  message_hash          text check (message_hash is null or message_hash ~ '^[0-9a-f]{64}$'),
  source_hash           text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  observed_at           timestamptz,
  direction             text check (direction is null or direction in ('incoming','outgoing')),
  source                text,
  created_at            timestamptz not null default now(),
  check (message_id is not null or message_hash is not null or source_hash is not null)
);
comment on table crm_contact_evidence is 'Referencias hash/ID para auditoría. Por diseño no tiene columna de cuerpo, extracto o preview.';
create index if not exists idx_crm_evidence_candidate on crm_contact_evidence(candidate_id);
create unique index if not exists uq_crm_evidence_reference on crm_contact_evidence(
  candidate_id,
  coalesce(field_name, ''),
  coalesce(message_id, ''),
  coalesce(message_hash, ''),
  coalesce(source_hash, '')
);

create table if not exists crm_change_audit (
  id                    bigint generated always as identity primary key,
  entity_type           text not null,
  entity_id             uuid,
  action                text not null,
  old_data              jsonb,
  new_data              jsonb,
  metadata              jsonb not null default '{}'::jsonb,
  actor_id              uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now()
);
comment on table crm_change_audit is 'Bitácora append-only de decisiones, matches y merges CRM. No contiene cuerpos de WhatsApp.';
create index if not exists idx_crm_audit_entity on crm_change_audit(entity_type, entity_id, created_at desc);

-- ---------- updated_at + optimistic locking ----------
create or replace function crm_bump_lock_version()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.lock_version := old.lock_version + 1;
  return new;
end $$;

drop trigger if exists trg_crm_contacts_lock on crm_contacts;
create trigger trg_crm_contacts_lock before update on crm_contacts
  for each row execute function crm_bump_lock_version();
drop trigger if exists trg_crm_opportunities_lock on crm_opportunities;
create trigger trg_crm_opportunities_lock before update on crm_opportunities
  for each row execute function crm_bump_lock_version();
drop trigger if exists trg_crm_candidates_lock on crm_import_candidates;
create trigger trg_crm_candidates_lock before update on crm_import_candidates
  for each row execute function crm_bump_lock_version();

create or replace function crm_assert_patient_has_treatment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.contact_type = 'patient'::crm_contact_type then
    if new.client_id is null then
      raise exception 'Un contacto solo puede ser paciente si tiene un tratamiento real'
        using errcode = '23514';
    end if;
    -- Comparte el mismo candado que DELETE/MOVE de treatments. Así una baja
    -- concurrente del último tratamiento no puede dejar un paciente huérfano.
    perform pg_advisory_xact_lock(hashtextextended('crm-patient:' || new.client_id::text, 0));
    if not exists (
      select 1 from treatments t where t.client_id = new.client_id
    ) then
      raise exception 'Un contacto solo puede ser paciente si tiene un tratamiento real'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_contact_patient_guard_insert on crm_contacts;
create trigger trg_crm_contact_patient_guard_insert before insert on crm_contacts
  for each row execute function crm_assert_patient_has_treatment();
drop trigger if exists trg_crm_contact_patient_guard_update on crm_contacts;
create trigger trg_crm_contact_patient_guard_update before update of contact_type, client_id on crm_contacts
  for each row execute function crm_assert_patient_has_treatment();

create or replace function crm_downgrade_contact_without_treatment()
returns trigger language plpgsql set search_path = public as $$
declare v_client uuid := old.client_id;
begin
  if v_client is not null then
    perform pg_advisory_xact_lock(hashtextextended('crm-patient:' || v_client::text, 0));
  end if;
  if v_client is not null and not exists (select 1 from treatments t where t.client_id = v_client) then
    update crm_contacts set
      contact_type = case when contact_type = 'patient'::crm_contact_type
        then 'lead'::crm_contact_type else contact_type end,
      lifecycle_stage = case when lifecycle_stage = 'patient' then 'lead' else lifecycle_stage end
    where client_id = v_client;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_crm_treatment_delete_sync on treatments;
create trigger trg_crm_treatment_delete_sync after delete on treatments
  for each row execute function crm_downgrade_contact_without_treatment();
drop trigger if exists trg_crm_treatment_move_sync on treatments;
create trigger trg_crm_treatment_move_sync after update of client_id on treatments
  for each row when (old.client_id is distinct from new.client_id)
  execute function crm_downgrade_contact_without_treatment();

-- ============================================================
-- Ingesta a staging. No crea contactos y no toca clients/treatments.
-- Shape esperado: extractor tools/whatsapp_crm schemaVersion=1.
-- ============================================================
create or replace function crm_sanitize_proposed_data(p_data jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_fields             jsonb := case when jsonb_typeof(p_data->'fields') = 'object'
    then p_data->'fields' else '{}'::jsonb end;
  v_confidence         jsonb := case when jsonb_typeof(p_data->'fieldConfidence') = 'object'
    then p_data->'fieldConfidence' else '{}'::jsonb end;
  v_activity           jsonb := case when jsonb_typeof(p_data->'activitySummary') = 'object'
    then p_data->'activitySummary' else '{}'::jsonb end;
  v_hints              jsonb := case when jsonb_typeof(p_data->'matchHints') = 'object'
    then p_data->'matchHints' else '{}'::jsonb end;
  v_classification     jsonb := case when jsonb_typeof(p_data->'classification') = 'object'
    then p_data->'classification' else '{}'::jsonb end;
  v_identities         jsonb := '[]'::jsonb;
  v_interests          jsonb := '[]'::jsonb;
  v_hint_phones        jsonb := '[]'::jsonb;
  v_source_kinds       jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'proposedData CRM inválido';
  end if;
  if jsonb_typeof(p_data->'identities') = 'array'
     and jsonb_array_length(p_data->'identities') > 100 then
    raise exception 'proposedData contiene demasiadas identidades';
  end if;

  -- Lista blanca recursiva: se reconstruye cada objeto y arreglo. Ninguna
  -- clave desconocida (transcript/content/message/etc.) llega a staging.
  select coalesce(jsonb_agg(clean.item order by clean.position), '[]'::jsonb)
  into v_identities
  from (
    select e.position, jsonb_strip_nulls(jsonb_build_object(
      'type', lower(e.value->>'type'),
      'value', left(nullif(trim(e.value->>'value'), ''), 300),
      'valueHash', case when lower(coalesce(e.value->>'valueHash','')) ~ '^[0-9a-f]{64}$'
        then lower(e.value->>'valueHash') end,
      'e164', case when coalesce(e.value->>'e164','') ~ '^\+[0-9]{6,15}$'
        then e.value->>'e164' end,
      'e164Hash', case when lower(coalesce(e.value->>'e164Hash','')) ~ '^[0-9a-f]{64}$'
        then lower(e.value->>'e164Hash') end
    )) as item
    from jsonb_array_elements(
      case when jsonb_typeof(p_data->'identities') = 'array'
        then p_data->'identities' else '[]'::jsonb end
    ) with ordinality e(value, position)
    where jsonb_typeof(e.value) = 'object'
      and lower(coalesce(e.value->>'type','')) in ('whatsapp_pn','whatsapp_lid','whatsapp_jid')
      and nullif(trim(e.value->>'value'), '') is not null
      and length(e.value->>'value') <= 300
      and e.value->>'value' ~ '^[A-Za-z0-9._+:-]{1,180}@[A-Za-z0-9.-]{1,100}$'
  ) clean;

  select coalesce(jsonb_agg(clean.value order by clean.value), '[]'::jsonb)
  into v_interests
  from (
    select distinct left(trim(e.value), 80) as value
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_fields->'interests') = 'array'
        then v_fields->'interests' else '[]'::jsonb end
    ) e(value)
    where trim(e.value) in (
      'weight_management','peptides','iv_therapy','longevity',
      'hormone_therapy','aesthetic_medicine','wellness_assessment'
    )
    limit 50
  ) clean;

  select coalesce(jsonb_agg(clean.value order by clean.value), '[]'::jsonb)
  into v_hint_phones
  from (
    select distinct e.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_hints->'e164') = 'array' then v_hints->'e164' else '[]'::jsonb end
    ) e(value)
    where e.value ~ '^\+[0-9]{6,15}$'
    limit 50
  ) clean;

  select coalesce(jsonb_agg(clean.value order by clean.value), '[]'::jsonb)
  into v_source_kinds
  from (
    select distinct left(trim(e.value), 60) as value
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_data->'sourceKinds') = 'array'
        then p_data->'sourceKinds' else '[]'::jsonb end
    ) e(value)
    where trim(e.value) in ('catalog_contact','catalog_chat','history_message')
    limit 20
  ) clean;

  return jsonb_strip_nulls(jsonb_build_object(
    'contactType', case when lower(coalesce(p_data->>'contactType','')) in (
      'unknown','lead','supplier','staff','partner','personal','group_only','other'
    ) then lower(p_data->>'contactType') else 'unknown' end,
    'sourceContactType', case when lower(coalesce(p_data->>'sourceContactType','')) in (
      'unknown','lead','vendor','supplier','staff','partner','personal','group_only','other'
    ) then lower(p_data->>'sourceContactType') else 'unknown' end,
    'identities', v_identities,
    'fields', jsonb_strip_nulls(jsonb_build_object(
      'name', case when length(coalesce(v_fields->>'name','')) <= 80
        and coalesce(v_fields->>'name','') !~ '[\r\n]'
        then nullif(trim(v_fields->>'name'), '') end,
      'email', case when length(coalesce(v_fields->>'email','')) <= 254
        and coalesce(v_fields->>'email','') !~ '[[:space:]]'
        and coalesce(v_fields->>'email','') like '%@%'
        then lower(nullif(trim(v_fields->>'email'), '')) end,
      'interests', v_interests,
      'suggestedStage', case when lower(coalesce(v_fields->>'suggestedStage','')) in (
        'new','contacted','interested','qualified','appointment_pending',
        'appointment_scheduled','converted','follow_up','lost','unclassified'
      ) then lower(v_fields->>'suggestedStage') else 'unclassified' end
    )),
    'fieldConfidence', jsonb_strip_nulls(jsonb_build_object(
      'name', case when jsonb_typeof(v_confidence->'name') = 'number' then v_confidence->'name' end,
      'email', case when jsonb_typeof(v_confidence->'email') = 'number' then v_confidence->'email' end,
      'interests', case when jsonb_typeof(v_confidence->'interests') = 'number' then v_confidence->'interests' end,
      'suggestedStage', case when jsonb_typeof(v_confidence->'suggestedStage') = 'number'
        then v_confidence->'suggestedStage' end
    )),
    'activitySummary', jsonb_strip_nulls(jsonb_build_object(
      'firstMessageAt', case when coalesce(v_activity->>'firstMessageAt','')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?$' then v_activity->>'firstMessageAt' end,
      'lastMessageAt', case when coalesce(v_activity->>'lastMessageAt','')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?$' then v_activity->>'lastMessageAt' end,
      'messageCount', case when jsonb_typeof(v_activity->'messageCount') = 'number' then v_activity->'messageCount' end,
      'incomingCount', case when jsonb_typeof(v_activity->'incomingCount') = 'number' then v_activity->'incomingCount' end,
      'outgoingCount', case when jsonb_typeof(v_activity->'outgoingCount') = 'number' then v_activity->'outgoingCount' end,
      'directMessageCount', case when jsonb_typeof(v_activity->'directMessageCount') = 'number' then v_activity->'directMessageCount' end,
      'groupMessageCount', case when jsonb_typeof(v_activity->'groupMessageCount') = 'number' then v_activity->'groupMessageCount' end,
      'directThreadCount', case when jsonb_typeof(v_activity->'directThreadCount') = 'number' then v_activity->'directThreadCount' end,
      'groupThreadCount', case when jsonb_typeof(v_activity->'groupThreadCount') = 'number' then v_activity->'groupThreadCount' end
    )),
    'matchHints', jsonb_build_object(
      'e164', v_hint_phones,
      -- Los correos extraídos del texto son datos propuestos, no identidades
      -- verificadas. Schema v1 solo permite auto-match por teléfono WhatsApp.
      'emails', '[]'::jsonb,
      'automaticMatchAllowed', to_jsonb(jsonb_array_length(v_hint_phones) > 0),
      'nameOnlyMatchAllowed', false
    ),
    'classification', jsonb_strip_nulls(jsonb_build_object(
      'reason', case when coalesce(v_classification->>'reason','') in (
        'exact_rule_match','has_direct_conversation',
        'group_participant_without_direct_conversation','catalog_or_reference_only'
      ) then v_classification->>'reason' else 'catalog_or_reference_only' end,
      'patientStatus', 'requires_database_treatment_match',
      'patientInferredFromMessages', false
    )),
    'sourceKinds', v_source_kinds
  ));
end $$;

create or replace function crm_ingest_candidates(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_schema             integer;
  v_run                jsonb;
  v_external_run       text;
  v_source             text;
  v_idempotency        text;
  v_checksum           text;
  v_payload_checksum   text;
  v_run_id             uuid;
  v_existing_checksum  text;
  v_existing_payload   text;
  v_existing_total     integer;
  v_existing_source    text;
  v_existing_external  text;
  v_run_status         text;
  v_run_applied        integer;
  v_run_rejected       integer;
  v_candidate_total    integer;
  v_candidate          jsonb;
  v_proposed           jsonb;
  v_candidate_id       uuid;
  v_source_key         text;
  v_existing_status    text;
  v_evidence           jsonb;
  v_observed           timestamptz;
  v_count              integer;
  v_inserted           integer := 0;
  v_updated            integer := 0;
  v_skipped            integer := 0;
  v_evidence_count     integer := 0;
  v_reason             text;
begin
  perform require_staff();

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload CRM inválido';
  end if;
  if octet_length(p_payload::text) > 30 * 1024 * 1024 then
    raise exception 'Payload CRM excede 30 MB';
  end if;
  -- Defensa fail-closed: el contrato jamás acepta cuerpos, previews ni texto crudo.
  if p_payload::text ~* '"(body|message|message_body|messagebody|conversation|transcript|content|last_message_preview|lastmessagepreview|raw_text|rawtext)"[[:space:]]*:' then
    raise exception 'Payload CRM contiene una clave de mensaje no permitida';
  end if;

  begin v_schema := (p_payload->>'schemaVersion')::integer;
  exception when others then raise exception 'schemaVersion CRM inválido'; end;
  if v_schema <> 1 then raise exception 'schemaVersion CRM no soportado: %', v_schema; end if;

  v_run := p_payload->'run';
  if jsonb_typeof(v_run) <> 'object' then raise exception 'run CRM inválido'; end if;
  v_external_run := nullif(trim(v_run->>'id'), '');
  v_source       := nullif(trim(v_run->>'source'), '');
  v_idempotency  := nullif(trim(v_run->>'idempotencyKey'), '');
  v_checksum     := lower(nullif(trim(v_run->>'sourceChecksum'), ''));
  if v_external_run is null or v_external_run !~ '^[0-9a-f]{64}$' then raise exception 'run.id inválido'; end if;
  if v_source <> 'whatsapp_history_read_only' then raise exception 'Fuente CRM no permitida'; end if;
  if v_idempotency is null or v_idempotency !~ '^[0-9a-f]{64}$' then raise exception 'idempotencyKey inválido'; end if;
  if v_checksum is null or v_checksum !~ '^[0-9a-f]{64}$' then raise exception 'sourceChecksum inválido'; end if;
  if jsonb_typeof(p_payload->'candidates') <> 'array' then raise exception 'candidates debe ser un arreglo'; end if;
  v_candidate_total := jsonb_array_length(p_payload->'candidates');
  if v_candidate_total > 5000 then raise exception 'Una corrida admite máximo 5000 candidatos'; end if;
  v_payload_checksum := encode(
    extensions.digest((p_payload->'candidates')::text, 'sha256'), 'hex'
  );

  select id, source_checksum, payload_checksum, candidates_received, source,
         external_run_id, status, candidates_applied, candidates_rejected
  into v_run_id, v_existing_checksum, v_existing_payload, v_existing_total,
       v_existing_source, v_existing_external, v_run_status, v_run_applied, v_run_rejected
  from crm_import_runs where idempotency_key = v_idempotency for update;
  if found then
    if v_existing_checksum <> v_checksum or v_existing_source <> v_source
       or v_existing_external <> v_external_run
       or v_existing_payload <> v_payload_checksum
       or v_existing_total <> v_candidate_total then
      raise exception 'La llave idempotente ya existe con otra fuente, conteo o payload';
    end if;
    -- Replay puro: no degrada status, no reabre una corrida y no duplica audit.
    return jsonb_build_object(
      'ok', true, 'replay', true,
      'import_run_id', v_run_id, 'run_id', v_run_id,
      'status', v_run_status, 'total', v_candidate_total,
      'inserted', 0, 'updated', 0, 'skipped', v_candidate_total,
      'applied', v_run_applied, 'rejected', v_run_rejected,
      'evidence_references', 0,
      'writes_clients', false, 'writes_treatments', false
    );
  else
    insert into crm_import_runs(
      external_run_id, source, idempotency_key, source_checksum, payload_checksum, schema_version,
      config, status, candidates_received, created_by
    ) values (
      v_external_run, v_source, v_idempotency, v_checksum, v_payload_checksum, v_schema,
      jsonb_build_object(
        'generator', jsonb_strip_nulls(jsonb_build_object(
          'name', left(nullif(trim(v_run->'config'->'generator'->>'name'), ''), 60),
          'version', left(nullif(trim(v_run->'config'->'generator'->>'version'), ''), 30)
        )),
        'includeCatalogOnly', case when jsonb_typeof(v_run->'config'->'includeCatalogOnly') = 'boolean'
          then v_run->'config'->'includeCatalogOnly' else 'false'::jsonb end,
        'maxEvidencePerField', case when jsonb_typeof(v_run->'config'->'maxEvidencePerField') = 'number'
          then v_run->'config'->'maxEvidencePerField' else '0'::jsonb end,
        'patientClassificationPolicy', 'database_treatment_match_only'
      ),
      'ingested', v_candidate_total, auth.uid()
    ) returning id into v_run_id;
  end if;

  for v_candidate in select value from jsonb_array_elements(p_payload->'candidates') loop
    if jsonb_typeof(v_candidate) <> 'object' then raise exception 'Candidato CRM inválido'; end if;
    v_source_key := nullif(trim(v_candidate->>'sourceRecordKey'), '');
    if v_source_key is null or v_source_key !~ '^whatsapp:[0-9a-f]{64}$' then
      raise exception 'sourceRecordKey inválido';
    end if;
    if coalesce(v_candidate->>'candidateType', '') <> 'contact_upsert' then
      raise exception 'candidateType CRM no soportado';
    end if;
    if jsonb_typeof(v_candidate->'proposedData') <> 'object' then
      raise exception 'proposedData CRM inválido';
    end if;
    if v_candidate::text ~* '"(body|message|message_body|messagebody|conversation|transcript|content|last_message_preview|lastmessagepreview|raw_text|rawtext)"[[:space:]]*:' then
      raise exception 'Un candidato contiene texto de mensaje no permitido';
    end if;
    v_proposed := crm_sanitize_proposed_data(v_candidate->'proposedData');
    v_reason := case when coalesce(v_candidate->>'reason','') in (
      'exact_rule_match','has_direct_conversation',
      'group_participant_without_direct_conversation','catalog_or_reference_only'
    ) then v_candidate->>'reason' else 'catalog_or_reference_only' end;

    select id, status into v_candidate_id, v_existing_status
    from crm_import_candidates
    where import_run_id = v_run_id and source_record_key = v_source_key
    for update;

    if not found then
      insert into crm_import_candidates(
        import_run_id, source_record_key, candidate_type, proposed_data,
        confidence, reason
      ) values (
        v_run_id, v_source_key, 'contact_upsert', v_proposed,
        greatest(0, least(1, coalesce((v_candidate->>'confidence')::numeric, 0))),
        v_reason
      ) returning id into v_candidate_id;
      v_existing_status := 'pending';
      v_inserted := v_inserted + 1;
    elsif v_existing_status = 'pending' then
      update crm_import_candidates set
        candidate_type = 'contact_upsert',
        proposed_data = v_proposed,
        confidence = greatest(0, least(1, coalesce((v_candidate->>'confidence')::numeric, 0))),
        reason = v_reason,
        matched_client_id = null,
        match_status = 'unmatched'
      where id = v_candidate_id;
      delete from crm_contact_evidence where candidate_id = v_candidate_id;
      v_updated := v_updated + 1;
    else
      v_skipped := v_skipped + 1;
    end if;

    if v_existing_status = 'pending' then
      for v_evidence in
        select e.value
        from jsonb_array_elements(
          case when jsonb_typeof(v_candidate->'evidence') = 'array'
            then v_candidate->'evidence' else '[]'::jsonb end
        ) with ordinality as e(value, position)
        where e.position <= 64
      loop
        if jsonb_typeof(v_evidence) <> 'object' then continue; end if;
        v_observed := null;
        begin
          if nullif(v_evidence->>'timestamp', '') is not null then
            v_observed := (v_evidence->>'timestamp')::timestamptz;
          end if;
        exception when others then v_observed := null; end;

        insert into crm_contact_evidence(
          candidate_id, field_name, message_id, message_hash, source_hash,
          observed_at, direction, source
        )
        select
          v_candidate_id,
          case when v_evidence->>'field' in ('name','email','interests','suggestedStage')
            then v_evidence->>'field' end,
          case when coalesce(v_evidence->>'messageId','') ~ '^[A-Za-z0-9_.:@/+=-]{1,200}$'
            then v_evidence->>'messageId' end,
          case when lower(coalesce(v_evidence->>'messageHash','')) ~ '^[0-9a-f]{64}$'
            then lower(v_evidence->>'messageHash') end,
          case when lower(coalesce(v_evidence->>'sourceHash','')) ~ '^[0-9a-f]{64}$'
            then lower(v_evidence->>'sourceHash') end,
          v_observed,
          case when v_evidence->>'direction' in ('incoming','outgoing')
            then v_evidence->>'direction' end,
          case when v_evidence->>'source' = 'catalog' then 'catalog' end
        where coalesce(v_evidence->>'messageId','') ~ '^[A-Za-z0-9_.:@/+=-]{1,200}$'
           or lower(coalesce(v_evidence->>'messageHash','')) ~ '^[0-9a-f]{64}$'
           or lower(coalesce(v_evidence->>'sourceHash','')) ~ '^[0-9a-f]{64}$'
        on conflict do nothing;
        get diagnostics v_count = row_count;
        v_evidence_count := v_evidence_count + v_count;
      end loop;
    end if;
  end loop;

  update crm_import_runs set candidates_received = v_candidate_total, status = 'ingested'
  where id = v_run_id;

  insert into crm_change_audit(entity_type, entity_id, action, new_data, metadata, actor_id)
  values (
    'crm_import_run', v_run_id, 'ingest',
    jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped),
    jsonb_build_object('evidenceReferences', v_evidence_count, 'schemaVersion', v_schema),
    auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'import_run_id', v_run_id,
    'run_id', v_run_id,
    'total', v_candidate_total,
    'replay', false,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'evidence_references', v_evidence_count,
    'writes_clients', false,
    'writes_treatments', false
  );
end $$;

create or replace function crm_contact_snapshot(p_contact uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'display_name', display_name,
    'primary_phone', primary_phone,
    'primary_email', primary_email,
    'city', city,
    'contact_type', contact_type,
    'lifecycle_stage', lifecycle_stage,
    'client_id', client_id,
    'match_status', match_status,
    'match_method', match_method,
    'first_contact_at', first_contact_at,
    'last_contact_at', last_contact_at,
    'tags', tags
  ) from crm_contacts where id = p_contact;
$$;

-- Aplica UN candidato al CRM. Es interna: las RPC públicas de review/batch
-- controlan autorización, concurrencia y auditoría de la decisión.
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
  v_is_staff             boolean := false;
  v_is_supplier          boolean := false;
  v_match_status         text := 'unmatched';
  v_match_method         text;
  v_old                  jsonb := '{}'::jsonb;
  v_new                  jsonb;
begin
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
    select exists (select 1 from treatments t where t.client_id = v_client_id)
      into v_client_has_treatment;
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

-- ---------- Revisión humana con optimistic locking ----------
create or replace function crm_review_candidate(
  p_candidate uuid,
  p_decision text,
  p_expected_version bigint,
  p_review_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status       text;
  v_version      bigint;
  v_contact      uuid;
  v_new_version  bigint;
  v_import_run   uuid;
  v_remaining    integer;
  v_decision     text := lower(trim(coalesce(p_decision, '')));
begin
  perform require_staff();
  if v_decision not in ('approved','rejected') then
    raise exception 'Decisión CRM inválida';
  end if;
  select status, lock_version, import_run_id into v_status, v_version, v_import_run
  from crm_import_candidates where id = p_candidate for update;
  if not found then raise exception 'Candidato CRM no encontrado'; end if;
  if v_status <> 'pending' then raise exception 'El candidato CRM ya fue revisado'; end if;
  if v_version <> p_expected_version then
    raise exception 'El candidato cambió; actualiza la bandeja antes de decidir' using errcode = '40001';
  end if;

  if v_decision = 'approved' then
    v_contact := crm_apply_candidate_internal(p_candidate, auth.uid());
    update crm_import_candidates set
      status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
      review_note = left(nullif(trim(p_review_note), ''), 1000), contact_id = v_contact
    where id = p_candidate
    returning lock_version into v_new_version;
  else
    update crm_import_candidates set
      status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
      review_note = left(nullif(trim(p_review_note), ''), 1000), match_status = 'rejected'
    where id = p_candidate
    returning lock_version into v_new_version;
  end if;

  insert into crm_change_audit(entity_type, entity_id, action, new_data, metadata, actor_id)
  values (
    'crm_import_candidate', p_candidate, 'review_' || v_decision,
    jsonb_build_object('status', v_decision, 'contact_id', v_contact),
    jsonb_build_object('writesClients', false, 'writesTreatments', false),
    auth.uid()
  );
  select count(*) into v_remaining from crm_import_candidates
  where import_run_id = v_import_run and status = 'pending';
  update crm_import_runs set
    candidates_applied = (select count(*) from crm_import_candidates where import_run_id = v_import_run and status = 'approved'),
    candidates_rejected = (select count(*) from crm_import_candidates where import_run_id = v_import_run and status = 'rejected'),
    status = case when v_remaining = 0 then 'completed' else status end,
    completed_at = case when v_remaining = 0 then now() else completed_at end
  where id = v_import_run;
  return jsonb_build_object(
    'ok', true, 'candidate_id', p_candidate, 'decision', v_decision,
    'contact_id', v_contact, 'lock_version', v_new_version,
    'writes_clients', false, 'writes_treatments', false
  );
end $$;

-- ---------- Aplicación por lotes: canary por defecto, dry-run por defecto ----------
create or replace function crm_apply_import(
  p_import_run uuid,
  p_limit integer default 25,
  p_min_confidence numeric default 0.90,
  p_dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit       integer := greatest(1, least(coalesce(p_limit, 25), 500));
  v_threshold   numeric := greatest(0, least(coalesce(p_min_confidence, 0.90), 1));
  v_candidate   record;
  v_contact     uuid;
  v_eligible    integer;
  v_applied     integer := 0;
  v_failed      integer := 0;
  v_remaining   integer;
  v_types       jsonb := '{}'::jsonb;
begin
  perform require_staff();
  if not exists (select 1 from crm_import_runs where id = p_import_run) then
    raise exception 'Corrida CRM no encontrada';
  end if;
  select count(*) into v_eligible from crm_import_candidates
  where import_run_id = p_import_run and status = 'pending'
    and candidate_type in ('contact_checked','contact_match') and confidence >= v_threshold;
  select coalesce(jsonb_object_agg(contact_type, amount), '{}'::jsonb) into v_types
  from (
    select coalesce(proposed_data->>'contactType','unknown') contact_type, count(*) amount
    from crm_import_candidates
    where import_run_id = p_import_run and status = 'pending'
      and candidate_type in ('contact_checked','contact_match') and confidence >= v_threshold
    group by 1
  ) counts;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'eligible', v_eligible,
      'would_apply', least(v_eligible, v_limit), 'candidate_types', v_types,
      'match_policy', 'exact_whatsapp_phone_or_verified_email_plus_treatment',
      'name_matching', false, 'writes_clients', false, 'writes_treatments', false
    );
  end if;

  update crm_import_runs set status = 'applying' where id = p_import_run;
  for v_candidate in
    select id from crm_import_candidates
    where import_run_id = p_import_run and status = 'pending'
      and candidate_type in ('contact_checked','contact_match') and confidence >= v_threshold
    order by confidence desc, created_at, id
    limit v_limit
  loop
    begin
      v_contact := crm_apply_candidate_internal(v_candidate.id, auth.uid());
      update crm_import_candidates set
        status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), contact_id = v_contact,
        review_note = 'Aplicado por canary/lote controlado'
      where id = v_candidate.id;
      v_applied := v_applied + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into crm_change_audit(entity_type, entity_id, action, metadata, actor_id)
      values (
        'crm_import_candidate', v_candidate.id, 'batch_apply_failed',
        jsonb_build_object('sqlstate', sqlstate), auth.uid()
      );
    end;
  end loop;

  select count(*) into v_remaining from crm_import_candidates
  where import_run_id = p_import_run and status = 'pending';
  update crm_import_runs set
    candidates_applied = (select count(*) from crm_import_candidates where import_run_id = p_import_run and status = 'approved'),
    candidates_rejected = (select count(*) from crm_import_candidates where import_run_id = p_import_run and status = 'rejected'),
    status = case when v_remaining = 0 then 'completed' else 'applying' end,
    completed_at = case when v_remaining = 0 then now() else null end
  where id = p_import_run;

  insert into crm_change_audit(entity_type, entity_id, action, new_data, metadata, actor_id)
  values (
    'crm_import_run', p_import_run, 'batch_apply',
    jsonb_build_object('applied', v_applied, 'failed', v_failed, 'remaining', v_remaining),
    jsonb_build_object('limit', v_limit, 'minConfidence', v_threshold), auth.uid()
  );
  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'applied', v_applied, 'failed', v_failed,
    'remaining', v_remaining, 'writes_clients', false, 'writes_treatments', false
  );
end $$;

-- Reconciliación de contactos CRM ya existentes. Sigue siendo exacta, sin nombre.
create or replace function crm_match_existing_contacts(
  p_limit integer default 100,
  p_dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit       integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_contact     record;
  v_clients     uuid[];
  v_client      uuid;
  v_linked      uuid;
  v_phones      text[];
  v_emails      text[];
  v_has_treatment boolean;
  v_updated     integer;
  v_unique      integer := 0;
  v_conflicts   integer := 0;
  v_applied     integer := 0;
begin
  perform require_staff();
  for v_contact in
    select c0.id, c0.primary_phone, c0.primary_email, c0.contact_type from crm_contacts c0
    where c0.active and c0.client_id is null
      and c0.match_status in ('unmatched','suggested') and (
      c0.primary_phone is not null or exists (
        select 1 from crm_contact_identities i
        where i.contact_id = c0.id and i.kind = 'email' and i.verified
      )
    )
    order by c0.updated_at, c0.id limit v_limit
    for update of c0 skip locked
  loop
    select coalesce(array_agg(distinct phone order by phone), '{}'::text[]) into v_phones
    from (
      select crm_normalize_phone(v_contact.primary_phone) phone
      union
      select normalized_value from crm_contact_identities
        where contact_id = v_contact.id and kind = 'phone'
    ) valueset where phone is not null;
    select coalesce(array_agg(distinct normalized_value order by normalized_value), '{}'::text[]) into v_emails
    from crm_contact_identities
    where contact_id = v_contact.id and kind = 'email' and verified
      and normalized_value is not null;
    select coalesce(array_agg(distinct c.id order by c.id), '{}'::uuid[]) into v_clients
    from clients c
    where (
        (crm_normalize_phone(c.phone) is not null and crm_normalize_phone(c.phone) = any(v_phones))
        or (crm_normalize_email(c.email) is not null and crm_normalize_email(c.email) = any(v_emails))
      );
    if coalesce(array_length(v_clients, 1), 0) = 1 then
      v_unique := v_unique + 1;
      v_client := v_clients[1];
      select exists (select 1 from treatments t where t.client_id = v_client) into v_has_treatment;
      v_linked := null;
      select id into v_linked from crm_contacts where client_id = v_client;
      if v_linked is not null and v_linked <> v_contact.id then
        v_conflicts := v_conflicts + 1;
      elsif not coalesce(p_dry_run, true) then
        update crm_contacts set
          client_id = v_client,
          contact_type = case when v_has_treatment then 'patient'::crm_contact_type
            when v_contact.contact_type in ('staff','supplier','partner','personal') then v_contact.contact_type
            else 'lead'::crm_contact_type end,
          lifecycle_stage = case when v_has_treatment then 'patient' else 'lead' end,
          match_status = 'matched', match_method = 'exact_phone_or_email', match_confidence = 1
        where id = v_contact.id and client_id is null;
        get diagnostics v_updated = row_count;
        if v_updated = 1 then
          insert into crm_change_audit(entity_type, entity_id, action, metadata, actor_id)
          values (
            'crm_contact', v_contact.id, 'exact_client_match',
            jsonb_build_object(
              'nameMatchUsed', false, 'hasTreatment', v_has_treatment,
              'patientRequiresTreatment', true
            ), auth.uid()
          );
          v_applied := v_applied + 1;
        end if;
      end if;
    elsif coalesce(array_length(v_clients, 1), 0) > 1 then
      v_conflicts := v_conflicts + 1;
      if not coalesce(p_dry_run, true) then
        update crm_contacts set match_status = 'conflict', match_method = 'multiple_exact_clients'
        where id = v_contact.id;
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'ok', true, 'dry_run', coalesce(p_dry_run, true), 'unique_exact_matches', v_unique,
    'conflicts', v_conflicts, 'applied', v_applied,
    'name_matching', false, 'patient_requires_treatment', true,
    'writes_clients', false, 'writes_treatments', false
  );
end $$;

-- Merge explícito y parcial hacia clients. No se invoca desde ingest/review/batch.
-- Solo full_name/phone/email; nunca documento, notas clínicas o tratamientos.
drop function if exists crm_merge_client_fields(uuid, text[], boolean, bigint);
create or replace function crm_merge_client_fields(
  p_contact uuid,
  p_fields text[],
  p_allow_overwrite boolean default false,
  p_expected_contact_version bigint default null,
  p_expected_client_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contact       crm_contacts%rowtype;
  v_old_name      text;
  v_old_phone     text;
  v_old_email     text;
  v_new_name      text;
  v_new_phone     text;
  v_new_email     text;
  v_client_updated_at timestamptz;
  v_updated       text[] := '{}';
begin
  perform require_staff();
  if coalesce(array_length(p_fields, 1), 0) = 0 then raise exception 'Selecciona al menos un campo'; end if;
  if exists (
    select 1 from unnest(p_fields) f where f is null or f not in ('full_name','phone','email')
  ) then raise exception 'El merge CRM contiene un campo no permitido'; end if;

  select * into v_contact from crm_contacts where id = p_contact for update;
  if not found then raise exception 'Contacto CRM no encontrado'; end if;
  if coalesce(p_allow_overwrite, false) and p_expected_contact_version is null then
    raise exception 'Sobrescribir requiere la versión esperada del contacto';
  end if;
  if p_expected_contact_version is not null and v_contact.lock_version <> p_expected_contact_version then
    raise exception 'El contacto cambió; actualiza antes de mezclar' using errcode = '40001';
  end if;
  if v_contact.client_id is null or not exists (
    select 1 from treatments t where t.client_id = v_contact.client_id
  ) then raise exception 'Solo se pueden mezclar pacientes con tratamiento real'; end if;

  select full_name, phone, email, updated_at
  into v_old_name, v_old_phone, v_old_email, v_client_updated_at
  from clients where id = v_contact.client_id for update;
  if not found then raise exception 'Paciente vinculado no encontrado'; end if;
  if coalesce(p_allow_overwrite, false) and (
    p_expected_client_updated_at is null or p_expected_client_updated_at is distinct from v_client_updated_at
  ) then
    raise exception 'El paciente cambió; vuelve a revisar antes de sobrescribir' using errcode = '40001';
  end if;
  v_new_name := v_old_name;
  v_new_phone := v_old_phone;
  v_new_email := v_old_email;

  if 'full_name' = any(p_fields) and nullif(trim(v_contact.display_name), '') is not null
     and v_contact.display_name not in ('Contacto sin nombre','Contacto WhatsApp')
     and (coalesce(p_allow_overwrite,false) or nullif(trim(v_old_name),'') is null) then
    v_new_name := trim(v_contact.display_name);
  end if;
  if 'phone' = any(p_fields) and nullif(trim(v_contact.primary_phone), '') is not null
     and (coalesce(p_allow_overwrite,false) or nullif(trim(v_old_phone),'') is null) then
    v_new_phone := trim(v_contact.primary_phone);
  end if;
  if 'email' = any(p_fields) and nullif(trim(v_contact.primary_email), '') is not null
     and (coalesce(p_allow_overwrite,false) or nullif(trim(v_old_email),'') is null) then
    v_new_email := trim(v_contact.primary_email);
  end if;

  if v_new_name is distinct from v_old_name then v_updated := array_append(v_updated, 'full_name'); end if;
  if v_new_phone is distinct from v_old_phone then v_updated := array_append(v_updated, 'phone'); end if;
  if v_new_email is distinct from v_old_email then v_updated := array_append(v_updated, 'email'); end if;
  if coalesce(array_length(v_updated, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'updated_fields', '[]'::jsonb, 'overwrote_existing', false);
  end if;

  update clients set full_name = v_new_name, phone = v_new_phone, email = v_new_email, updated_at = now()
  where id = v_contact.client_id;
  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  values (
    'client', v_contact.client_id, 'explicit_partial_merge',
    jsonb_build_object('full_name', v_old_name, 'phone', v_old_phone, 'email', v_old_email),
    jsonb_build_object('full_name', v_new_name, 'phone', v_new_phone, 'email', v_new_email),
    jsonb_build_object(
      'crmContactId', p_contact, 'updatedFields', to_jsonb(v_updated),
      'allowOverwrite', coalesce(p_allow_overwrite,false),
      'untouched', jsonb_build_array('document_id','birthdate','address','notes','clinical_notes','treatments')
    ), auth.uid()
  );
  return jsonb_build_object(
    'ok', true, 'updated_fields', to_jsonb(v_updated),
    'overwrote_existing', coalesce(p_allow_overwrite,false),
    'writes_treatments', false, 'writes_clinical_notes', false
  );
end $$;

-- Prepara sugerencias visibles en la cola sin crear contactos ni enlaces.
-- Recalcula siempre desde clients+treatments; el resultado staged no es de
-- confianza para aplicar (crm_apply_candidate_internal vuelve a verificarlo).
create or replace function crm_candidate_exact_clients(p_proposed jsonb)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare
  v_identities jsonb := case when jsonb_typeof(p_proposed->'identities') = 'array'
    then p_proposed->'identities' else '[]'::jsonb end;
  v_hints jsonb := case when jsonb_typeof(p_proposed->'matchHints') = 'object'
    then p_proposed->'matchHints' else '{}'::jsonb end;
  v_phones text[] := '{}';
  v_clients uuid[] := '{}';
begin
  select coalesce(array_agg(distinct phone order by phone), '{}'::text[]) into v_phones
  from (
    select crm_normalize_phone(i.value->>'e164') phone from jsonb_array_elements(v_identities) i(value)
    union
    select crm_normalize_phone(h.value) phone
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_hints->'e164') = 'array' then v_hints->'e164' else '[]'::jsonb end
    ) h(value)
  ) valueset where phone is not null;
  select coalesce(array_agg(distinct c.id order by c.id), '{}'::uuid[]) into v_clients
  from clients c
  where crm_normalize_phone(c.phone) is not null
    and crm_normalize_phone(c.phone) = any(v_phones);
  return v_clients;
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
          exists (select 1 from treatments t where t.client_id = c.id) as has_treatment
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

-- ============================================================
-- Vistas para el dashboard
-- ============================================================
drop view if exists v_crm_review_queue;
drop view if exists v_crm_contacts;

create view v_crm_contacts as
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
) identities on true;
comment on view v_crm_contacts is 'Directorio CRM. has_treatment/treatment_count son la única fuente de verdad para mostrar Paciente.';

create view v_crm_review_queue as
select
  candidate.id                                           as candidate_id,
  candidate.import_run_id,
  candidate.contact_id,
  coalesce(
    contact.display_name,
    nullif(candidate.proposed_data->'fields'->>'name',''),
    nullif(candidate.proposed_data->'matchHints'->'e164'->>0,''),
    'Contacto sin nombre'
  )                                                      as contact_name,
  candidate.candidate_type,
  candidate.source_record_key,
  candidate.status,
  case when contact.id is not null then jsonb_strip_nulls(jsonb_build_object(
    'full_name', contact.display_name,
    'phone', contact.primary_phone,
    'email', contact.primary_email,
    'city', contact.city,
    'contact_type', contact.contact_type,
    'lifecycle_stage', contact.lifecycle_stage,
    'client_id', contact.client_id
  )) else candidate.current_data end                       as current_data,
  jsonb_strip_nulls(jsonb_build_object(
    'full_name', candidate.proposed_data->'fields'->>'name',
    'phone', candidate.proposed_data->'matchHints'->'e164'->>0,
    'email', candidate.proposed_data->'fields'->>'email',
    'city', candidate.proposed_data->'fields'->>'city',
    'interests', candidate.proposed_data->'fields'->'interests',
    'suggested_stage', candidate.proposed_data->'fields'->>'suggestedStage',
    'contact_type', candidate.proposed_data->>'contactType',
    'client_id', candidate.proposed_data->>'client_id',
    'client_name', candidate.proposed_data->>'client_name',
    'client_code', candidate.proposed_data->>'client_code',
    'client_has_treatment', candidate.proposed_data->'client_has_treatment',
    'client_conflict_count', candidate.proposed_data->'client_conflict_count'
  ))                                                       as proposed_data,
  candidate.confidence,
  candidate.reason,
  coalesce(evidence.evidence_count, 0)                   as evidence_count,
  candidate.created_at,
  candidate.updated_at,
  candidate.reviewed_at,
  candidate.reviewed_by,
  reviewer.full_name                                     as reviewer_name,
  candidate.review_note,
  candidate.lock_version
from crm_import_candidates candidate
left join crm_contacts contact on contact.id = candidate.contact_id
left join profiles reviewer on reviewer.id = candidate.reviewed_by
left join lateral (
  select count(*)::integer as evidence_count
  from crm_contact_evidence e where e.candidate_id = candidate.id
) evidence on true
where candidate.status = 'pending' and candidate.candidate_type <> 'contact_upsert';
comment on view v_crm_review_queue is 'Bandeja pendiente. Expone conteo de evidencias, nunca cuerpos o previews de mensajes.';

alter view v_crm_contacts set (security_invoker = on);
alter view v_crm_review_queue set (security_invoker = on);

-- ============================================================
-- RLS y grants explícitos (el loop histórico de 05 no conoce estas tablas)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'crm_contacts','crm_contact_identities','crm_opportunities','crm_import_runs',
    'crm_import_candidates','crm_contact_evidence'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists staff_all on %I;', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff());', t
    );
  end loop;
end $$;

alter table crm_change_audit enable row level security;
drop policy if exists staff_read on crm_change_audit;
create policy staff_read on crm_change_audit for select to authenticated using (is_staff());
-- La bitácora es append-only para el browser: solo RPCs SECURITY DEFINER insertan.

revoke all on crm_contacts, crm_contact_identities, crm_opportunities, crm_import_runs,
  crm_import_candidates, crm_contact_evidence, crm_change_audit from public, anon, authenticated;
grant select on crm_contacts, crm_contact_identities, crm_opportunities, crm_import_runs,
  crm_import_candidates, crm_contact_evidence, crm_change_audit to authenticated;
revoke all on v_crm_contacts, v_crm_review_queue from public, anon;
grant select on v_crm_contacts, v_crm_review_queue to authenticated;

-- Helpers/internas no son API pública.
revoke execute on function crm_normalize_phone(text) from public, anon;
revoke execute on function crm_normalize_email(text) from public, anon;
revoke execute on function crm_normalize_identity(text, text) from public, anon;
revoke execute on function crm_identity_hash(text, text) from public, anon;
revoke execute on function crm_json_text_array(jsonb) from public, anon;
revoke execute on function crm_map_contact_type(text) from public, anon;
revoke execute on function crm_sanitize_proposed_data(jsonb) from public, anon, authenticated;
revoke execute on function crm_bump_lock_version() from public, anon, authenticated;
revoke execute on function crm_assert_patient_has_treatment() from public, anon, authenticated;
revoke execute on function crm_downgrade_contact_without_treatment() from public, anon, authenticated;
revoke execute on function crm_contact_snapshot(uuid) from public, anon, authenticated;
revoke execute on function crm_apply_candidate_internal(uuid, uuid) from public, anon, authenticated;
revoke execute on function crm_candidate_exact_clients(jsonb) from public, anon, authenticated;

-- RPCs autorizadas. Todas llaman require_staff() y anon queda revocado.
grant execute on function crm_ingest_candidates(jsonb) to authenticated;
grant execute on function crm_review_candidate(uuid, text, bigint, text) to authenticated;
grant execute on function crm_apply_import(uuid, integer, numeric, boolean) to authenticated;
grant execute on function crm_match_existing_contacts(integer, boolean) to authenticated;
grant execute on function crm_stage_import_matches(uuid, integer, boolean) to authenticated;
grant execute on function crm_merge_client_fields(uuid, text[], boolean, bigint, timestamptz) to authenticated;

revoke execute on function crm_ingest_candidates(jsonb) from public, anon;
revoke execute on function crm_review_candidate(uuid, text, bigint, text) from public, anon;
revoke execute on function crm_apply_import(uuid, integer, numeric, boolean) from public, anon;
revoke execute on function crm_match_existing_contacts(integer, boolean) from public, anon;
revoke execute on function crm_stage_import_matches(uuid, integer, boolean) from public, anon;
revoke execute on function crm_merge_client_fields(uuid, text[], boolean, bigint, timestamptz) from public, anon;

-- Verificación declarativa del invariante principal (la vista también lo impone).
comment on function crm_stage_import_matches(uuid, integer, boolean) is
  'Stage exacto: teléfono WhatsApp contra todos los clients; exige match único y deriva paciente solo si existe treatment. Nunca usa nombre ni correo extraído del chat.';
comment on function crm_merge_client_fields(uuid, text[], boolean, bigint, timestamptz) is
  'Merge humano, parcial y opt-in de nombre/teléfono/email. No toca documento, clínica ni tratamientos.';
