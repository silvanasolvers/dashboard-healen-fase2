-- Healen OS · Pacientes y CRM comparten una sola identidad
-- Ejecutar después de 22_crm_patient_category_segments.sql.

-- Sincroniza cualquier alta o edición de clients con su contacto CRM 1:1.
-- Conserva identidades adicionales de WhatsApp y solo reemplaza los datos
-- primarios (nombre, teléfono y correo).
create or replace function crm_sync_new_client_contact()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
  v_promoted text := nullif(current_setting('healen.crm_promote_contact', true), '');
  v_candidates uuid[];
  v_phone text := nullif(trim(new.phone), '');
  v_email text := crm_normalize_email(new.email);
  v_before jsonb;
begin
  select cc.id into v_contact
  from crm_contacts cc
  where cc.client_id = new.id
  order by cc.active desc, cc.updated_at desc, cc.id
  limit 1
  for update;

  if not new.active then
    if v_contact is not null then
      v_before := crm_contact_snapshot(v_contact);
      update crm_contacts
      set active = false,
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('syncedFromClient', true, 'clientInactive', true)
      where id = v_contact;
      insert into crm_change_audit(
        entity_type, entity_id, action, old_data, new_data, metadata, actor_id
      ) values (
        'crm_contact', v_contact, 'client_identity_sync',
        v_before, crm_contact_snapshot(v_contact),
        jsonb_build_object('source', 'clients_trigger', 'operation', tg_op),
        auth.uid()
      );
    end if;
    return new;
  end if;

  if v_contact is null and tg_op = 'INSERT' and v_promoted is not null then
    begin
      v_contact := v_promoted::uuid;
    exception when invalid_text_representation then
      v_contact := null;
    end;
  end if;

  -- Si el alta llegó desde Pacientes, reutiliza un único contacto exacto en
  -- vez de crear una segunda ficha para el mismo teléfono o correo.
  if v_contact is null and (crm_normalize_phone(v_phone) is not null or v_email is not null) then
    select coalesce(array_agg(candidate.id order by candidate.id), '{}'::uuid[])
      into v_candidates
    from (
      select distinct cc.id
      from crm_contacts cc
      where cc.active
        and cc.client_id is null
        and (
          (
            crm_normalize_phone(v_phone) is not null
            and (
              crm_normalize_phone(cc.primary_phone) = crm_normalize_phone(v_phone)
              or exists (
                select 1
                from crm_contact_identities i
                where i.contact_id = cc.id
                  and i.kind = 'phone'
                  and i.normalized_value = crm_normalize_phone(v_phone)
              )
            )
          )
          or (
            v_email is not null
            and (
              crm_normalize_email(cc.primary_email) = v_email
              or exists (
                select 1
                from crm_contact_identities i
                where i.contact_id = cc.id
                  and i.kind = 'email'
                  and i.normalized_value = v_email
              )
            )
          )
        )
    ) candidate;

    if cardinality(v_candidates) > 1 then
      raise exception 'Hay varios contactos CRM con ese teléfono o correo; revisa los duplicados antes de crear el paciente';
    elsif cardinality(v_candidates) = 1 then
      v_contact := v_candidates[1];
    end if;
  end if;

  if v_contact is not null then
    v_before := crm_contact_snapshot(v_contact);
  end if;

  if crm_normalize_phone(v_phone) is not null and exists (
    select 1
    from crm_contacts other
    where other.active
      and other.id <> coalesce(v_contact, '00000000-0000-0000-0000-000000000000'::uuid)
      and crm_normalize_phone(other.primary_phone) = crm_normalize_phone(v_phone)
  ) then
    raise exception 'Ese teléfono ya pertenece a otro contacto CRM';
  end if;

  if v_email is not null and exists (
    select 1
    from crm_contacts other
    where other.active
      and other.id <> coalesce(v_contact, '00000000-0000-0000-0000-000000000000'::uuid)
      and crm_normalize_email(other.primary_email) = v_email
  ) then
    raise exception 'Ese correo ya pertenece a otro contacto CRM';
  end if;

  if v_contact is not null then
    update crm_contacts
    set display_name = new.full_name,
        primary_phone = v_phone,
        primary_email = v_email,
        contact_type = 'patient',
        lifecycle_stage = 'patient',
        client_id = new.id,
        match_status = 'matched',
        match_method = case
          when client_id is null then 'client_identity_match'
          else coalesce(match_method, 'client_identity_sync')
        end,
        match_confidence = 1,
        source = coalesce(source, 'patient_registry'),
        active = true,
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('syncedFromClient', true, 'clientInactive', false)
    where id = v_contact;
  else
    insert into crm_contacts(
      display_name, primary_phone, primary_email, contact_type, lifecycle_stage,
      client_id, match_status, match_method, match_confidence, source, active,
      metadata, created_by
    ) values (
      new.full_name, v_phone, v_email, 'patient', 'patient',
      new.id, 'matched', 'client_created', 1, 'patient_registry', true,
      jsonb_build_object('syncedFromClient', true), new.created_by
    )
    returning id into v_contact;
  end if;

  update crm_opportunities
  set stage = 'converted',
      closed_at = coalesce(closed_at, now())
  where contact_id = v_contact
    and active
    and stage not in ('converted', 'lost');

  update crm_contact_identities
  set is_primary = false,
      verified = false
  where contact_id = v_contact
    and kind in ('phone', 'email')
    and is_primary;

  -- Una identidad retenida por una ficha ya archivada puede trasladarse al
  -- paciente canónico; las identidades de contactos activos nunca se toman.
  if crm_normalize_phone(v_phone) is not null then
    update crm_contact_identities identity
    set contact_id = v_contact,
        is_primary = false,
        verified = false,
        source = 'patient_registry'
    from crm_contacts owner
    where identity.contact_id = owner.id
      and not owner.active
      and identity.kind = 'phone'
      and identity.value_hash = crm_identity_hash('phone', v_phone);

    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash,
      is_primary, verified, source
    ) values (
      v_contact, 'phone', v_phone, crm_normalize_phone(v_phone),
      crm_identity_hash('phone', v_phone), true, true, 'patient_registry'
    )
    on conflict (kind, value_hash) do update set
      identity_value = excluded.identity_value,
      normalized_value = excluded.normalized_value,
      is_primary = true,
      verified = true,
      source = 'patient_registry'
    where crm_contact_identities.contact_id = excluded.contact_id;
  end if;

  if v_email is not null then
    update crm_contact_identities identity
    set contact_id = v_contact,
        is_primary = false,
        verified = false,
        source = 'patient_registry'
    from crm_contacts owner
    where identity.contact_id = owner.id
      and not owner.active
      and identity.kind = 'email'
      and identity.value_hash = crm_identity_hash('email', v_email);

    insert into crm_contact_identities(
      contact_id, kind, identity_value, normalized_value, value_hash,
      is_primary, verified, source
    ) values (
      v_contact, 'email', v_email, v_email,
      crm_identity_hash('email', v_email), true, true, 'patient_registry'
    )
    on conflict (kind, value_hash) do update set
      identity_value = excluded.identity_value,
      normalized_value = excluded.normalized_value,
      is_primary = true,
      verified = true,
      source = 'patient_registry'
    where crm_contact_identities.contact_id = excluded.contact_id;
  end if;

  insert into crm_change_audit(
    entity_type, entity_id, action, old_data, new_data, metadata, actor_id
  ) values (
    'crm_contact', v_contact, 'client_identity_sync',
    v_before, crm_contact_snapshot(v_contact),
    jsonb_build_object(
      'source', 'clients_trigger',
      'operation', tg_op,
      'clientId', new.id
    ),
    auth.uid()
  );

  return new;
end $$;

drop trigger if exists trg_clients_create_crm_patient on clients;
create trigger trg_clients_create_crm_patient
  after insert or update of full_name, phone, email, active on clients
  for each row execute function crm_sync_new_client_contact();

-- La creación de paciente captura desde el inicio la identidad que compartirá
-- con CRM. Los parámetros nuevos quedan al final para mantener compatibilidad.
drop function if exists dash_create_patient(
  text, text, numeric, text, text, integer, date, date, text, boolean
);

create function dash_create_patient(
  p_name text,
  p_plan text,
  p_sale_value numeric default 0,
  p_peptide text default null,
  p_dose text default null,
  p_days_left int default 30,
  p_start date default current_date,
  p_end date default null,
  p_serum_day text default null,
  p_weekly_serum boolean default false,
  p_phone text default null,
  p_email text default null,
  p_document_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_contact uuid;
  v_treat uuid;
  v_product uuid;
  v_code text;
  v_sale text;
  v_phone text := nullif(trim(p_phone), '');
  v_email text := crm_normalize_email(p_email);
begin
  perform require_staff();
  if nullif(trim(p_name), '') is null then
    raise exception 'El nombre del paciente es obligatorio';
  end if;
  if crm_normalize_phone(v_phone) is not null and exists (
    select 1 from clients c
    where c.active and crm_normalize_phone(c.phone) = crm_normalize_phone(v_phone)
  ) then
    raise exception 'Ya existe un paciente con ese teléfono';
  end if;
  if v_email is not null and exists (
    select 1 from clients c
    where c.active and crm_normalize_email(c.email) = v_email
  ) then
    raise exception 'Ya existe un paciente con ese correo';
  end if;

  v_code := next_client_code();
  insert into clients(
    code, full_name, document_id, phone, email, created_by
  ) values (
    v_code, trim(p_name), nullif(trim(p_document_id), ''), v_phone, v_email, auth.uid()
  )
  returning id into v_client;

  select id into v_contact
  from crm_contacts
  where client_id = v_client and active;

  insert into treatments(
    client_id, name, start_date, end_date, status, sale_price,
    weekly_serum, serum_day, created_by
  ) values (
    v_client, coalesce(nullif(trim(p_plan), ''), 'Plan personalizado'), p_start,
    coalesce(p_end, current_date + coalesce(p_days_left, 30)), 'activo',
    coalesce(p_sale_value, 0), coalesce(p_weekly_serum, false),
    nullif(trim(p_serum_day), ''), auth.uid()
  )
  returning id into v_treat;

  if nullif(trim(p_peptide), '') is not null then
    select id into v_product
    from products
    where lower(name) = lower(trim(p_peptide)) and active
    limit 1;
    insert into treatment_items(
      treatment_id, product_id, name, dose, planned_quantity, ends_on, status
    ) values (
      v_treat, v_product, trim(p_peptide), nullif(trim(p_dose), ''), 0,
      current_date + coalesce(p_days_left, 30), 'activo'
    );
  end if;

  if coalesce(p_sale_value, 0) > 0 then
    v_sale := 'VTA-' || lpad(nextval('seq_sale')::text, 4, '0');
    insert into sales(
      code, client_id, treatment_id, sale_date, subtotal, total,
      cogs_total, status, created_by
    ) values (
      v_sale, v_client, v_treat, current_date, p_sale_value, p_sale_value,
      0, 'pendiente', auth.uid()
    );
  end if;

  return jsonb_build_object(
    'client_id', v_client,
    'contact_id', v_contact,
    'code', v_code,
    'treatment_id', v_treat
  );
end $$;

comment on function dash_create_patient(
  text, text, numeric, text, text, integer, date, date, text, boolean,
  text, text, text
) is
  'Alta de paciente con identidad compartida entre clients y CRM, más tratamiento y venta opcional.';

-- Teléfono y correo también viajan en la carga principal de Pacientes para que
-- la lista sea útil sin tener que abrir cada ficha.
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
  case
    when t.end_date is null then 0
    else greatest((t.end_date - current_date), 0)
  end                                                 as "daysLeft",
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
    from treatment_items ti
    where ti.treatment_id = t.id
  ), '[]'::jsonb)                                     as peptides,
  c.phone                                             as phone,
  c.email                                             as email
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
  'Todos los pacientes activos con teléfono y correo compartidos con CRM; el último tratamiento se resume cuando existe.';
alter view v_dashboard_patients set (security_invoker = on);

-- Backfill seguro: si una ficha canónica carece de teléfono/correo, recupera el
-- valor de su contacto paciente y deja que el trigger replique el resultado.
update clients client
set phone = coalesce(client.phone, contact.primary_phone),
    email = coalesce(crm_normalize_email(client.email), crm_normalize_email(contact.primary_email)),
    updated_at = now()
from crm_contacts contact
where contact.client_id = client.id
  and contact.active
  and contact.contact_type = 'patient'
  and (
    (client.phone is null and contact.primary_phone is not null)
    or (client.email is null and contact.primary_email is not null)
  );

revoke all on function crm_sync_new_client_contact() from public, anon, authenticated;
revoke all on function dash_create_patient(
  text, text, numeric, text, text, integer, date, date, text, boolean,
  text, text, text
) from public, anon;
grant execute on function dash_create_patient(
  text, text, numeric, text, text, integer, date, date, text, boolean,
  text, text, text
) to authenticated;

notify pgrst, 'reload schema';
