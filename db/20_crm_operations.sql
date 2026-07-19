-- ============================================================
-- HEALEN OS · 20 · Operación diaria del CRM
-- ============================================================
-- Edición y movimientos de pipeline pasan por RPCs staff-only, con bloqueo
-- optimista y bitácora. El navegador mantiene acceso de solo lectura a tablas.

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
    'last_summary', last_summary,
    'tags', tags,
    'owner_id', owner_id,
    'active', active,
    'lock_version', lock_version
  ) from crm_contacts where id = p_contact;
$$;

-- Sigue siendo helper interno: CREATE OR REPLACE conserva privilegios, pero
-- lo revocamos explícitamente para que una instalación parcial no lo exponga.
revoke all on function crm_contact_snapshot(uuid) from public, anon, authenticated;

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
  v_type crm_contact_type;
  v_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Contacto WhatsApp'), 180);
  v_phone text := left(nullif(trim(p_phone), ''), 80);
  v_email text := left(crm_normalize_email(p_email), 254);
  v_city text := left(nullif(trim(p_city), ''), 120);
  v_summary text := left(nullif(trim(p_summary), ''), 4000);
  v_tags text[];
  v_old jsonb;
  v_new jsonb;
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
  if v_type = 'patient' then
    raise exception 'Paciente se deriva de tratamientos y no puede asignarse manualmente';
  end if;
  if crm_normalize_phone(v_phone) is not null and (
    exists (
      select 1 from crm_contact_identities i
      where i.kind in ('phone','whatsapp_pn')
        and i.normalized_value = crm_normalize_phone(v_phone)
        and i.contact_id <> p_contact
    ) or exists (
      select 1 from crm_contacts c
      where c.id <> p_contact
        and crm_normalize_phone(c.primary_phone) = crm_normalize_phone(v_phone)
    )
  ) then
    raise exception 'Ese teléfono ya pertenece a otro contacto CRM';
  end if;
  if v_email is not null and (
    exists (
      select 1 from crm_contact_identities i
      where i.kind = 'email'
        and i.normalized_value = v_email
        and i.contact_id <> p_contact
    ) or exists (
      select 1 from crm_contacts c
      where c.id <> p_contact
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
  update crm_contacts set
    display_name = v_name,
    primary_phone = v_phone,
    primary_email = v_email,
    city = v_city,
    contact_type = case when exists (
      select 1 from treatments t where t.client_id = crm_contacts.client_id
    ) then 'patient'::crm_contact_type else v_type end,
    lifecycle_stage = case when exists (
      select 1 from treatments t where t.client_id = crm_contacts.client_id
    ) then 'patient' else v_type::text end,
    last_summary = v_summary,
    tags = v_tags
  where id = p_contact;

  update crm_contact_identities set
    is_primary = false,
    verified = false
  where contact_id = p_contact and kind in ('phone','email') and is_primary;

  if crm_normalize_phone(v_phone) is not null then
    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash, is_primary, verified, source
    ) values (
      p_contact, 'phone', v_phone, crm_normalize_phone(v_phone),
      crm_identity_hash('phone', v_phone), true, true, 'manual_staff'
    ) on conflict (kind, value_hash) do update set
      identity_value = excluded.identity_value,
      normalized_value = excluded.normalized_value,
      is_primary = true,
      verified = true,
      source = 'manual_staff'
    where crm_contact_identities.contact_id = excluded.contact_id;
    if not found then
      raise exception 'Ese teléfono ya pertenece a otro contacto CRM';
    end if;
  end if;
  if v_email is not null then
    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash, is_primary, verified, source
    ) values (
      p_contact, 'email', v_email, v_email,
      crm_identity_hash('email', v_email), true, true, 'manual_staff'
    ) on conflict (kind, value_hash) do update set
      identity_value = excluded.identity_value,
      normalized_value = excluded.normalized_value,
      is_primary = true,
      verified = true,
      source = 'manual_staff'
    where crm_contact_identities.contact_id = excluded.contact_id;
    if not found then
      raise exception 'Ese correo ya pertenece a otro contacto CRM';
    end if;
  end if;

  v_new := crm_contact_snapshot(p_contact);
  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  values ('crm_contact', p_contact, 'manual_update', v_old, v_new,
    jsonb_build_object('source', 'dashboard'), auth.uid());

  return jsonb_build_object(
    'ok', true,
    'contact_id', p_contact,
    'lock_version', (select lock_version from crm_contacts where id = p_contact)
  );
end $$;

-- La primera versión de esta migración tenía tres argumentos y no exigía
-- lock_version. Eliminarla evita que PostgREST conserve una ruta que pueda
-- saltarse el bloqueo optimista después de actualizar una instalación.
drop function if exists crm_move_pipeline(uuid, text, timestamptz);

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
      closed_at = case when v_stage in ('converted','lost') then coalesce(closed_at, now()) else null end
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

  -- Todo movimiento incrementa el lock del contacto, incluso si su
  -- clasificación no cambia. Así dos movimientos con la misma versión no
  -- pueden sobrescribirse silenciosamente en pacientes o contactos protegidos.
  update crm_contacts set
    contact_type = case
      when not exists (select 1 from treatments t where t.client_id = crm_contacts.client_id)
        and contact_type not in ('staff','supplier','partner','personal')
      then 'lead'::crm_contact_type
      else contact_type
    end,
    lifecycle_stage = case
      when not exists (select 1 from treatments t where t.client_id = crm_contacts.client_id)
        and contact_type not in ('staff','supplier','partner','personal')
      then 'lead'
      else lifecycle_stage
    end
  where id = p_contact
  returning * into v_contact;

  v_new := to_jsonb(v_opportunity);
  insert into crm_change_audit(entity_type, entity_id, action, old_data, new_data, metadata, actor_id)
  values ('crm_opportunity', v_opportunity.id, 'pipeline_move', v_old, v_new,
    jsonb_build_object('contactId', p_contact, 'source', 'dashboard'), auth.uid());

  return jsonb_build_object(
    'ok', true,
    'contact_id', p_contact,
    'opportunity_id', v_opportunity.id,
    'stage', v_stage,
    'next_action_at', v_opportunity.next_action_at,
    'contact_lock_version', v_contact.lock_version
  );
end $$;

revoke all on function crm_update_contact(uuid, bigint, text, text, text, text, text, text, text[]) from public, anon;
revoke all on function crm_move_pipeline(uuid, text, bigint, timestamptz) from public, anon;
grant execute on function crm_update_contact(uuid, bigint, text, text, text, text, text, text, text[]) to authenticated;
grant execute on function crm_move_pipeline(uuid, text, bigint, timestamptz) to authenticated;
