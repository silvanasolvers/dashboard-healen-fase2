-- ============================================================
-- HEALEN OS · 10 · Historia clínica viva
-- La ficha del paciente "a la mano": notas clínicas persistentes (incl.
-- alergias / recomendaciones / hitos), línea de tiempo UNIFICADA sobre hechos
-- reales (tratamientos, ventas, abonos, dosis, notas), revenue en el tiempo y
-- un resumen vivo (valor de vida, saldo, última visita, tier).
-- Próximos pasos NO se guardan: el front los deriva en vivo de estos datos, así
-- se auto-gestionan a medida que pasan los días o entra una venta.
-- DEBE correr DESPUÉS de 01–09.
-- ============================================================

-- ---------- Tipo de nota ----------
do $$ begin
  create type clinical_note_kind as enum ('nota','alergia','recomendacion','hito','seguimiento');
exception when duplicate_object then null; end $$;

-- ---------- Notas clínicas ----------
create table if not exists clinical_notes (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  treatment_id uuid references treatments(id) on delete set null,
  kind         clinical_note_kind not null default 'nota',
  body         text not null,
  pinned       boolean not null default false,            -- fijadas arriba (alergias)
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
comment on table clinical_notes is 'Notas clínicas por paciente (notas, alergias, recomendaciones, hitos, seguimientos). La historia a la mano.';
create index if not exists idx_notes_client on clinical_notes(client_id, created_at desc);

alter table clinical_notes enable row level security;
drop policy if exists staff_all on clinical_notes;
create policy staff_all on clinical_notes for all to authenticated using (is_staff()) with check (is_staff());

-- ============================================================
-- Vistas (security_invoker: respetan la RLS del que consulta)
-- ============================================================

-- Notas con autor, fijadas primero
create or replace view v_patient_notes as
select
  n.id, n.client_id, n.treatment_id,
  n.kind::text                          as kind,
  n.body, n.pinned, n.created_at,
  coalesce(pr.full_name, 'Equipo Healen') as author
from clinical_notes n
left join profiles pr on pr.id = n.created_by;
comment on view v_patient_notes is 'Notas clínicas con autor (el front ordena: fijadas primero, luego recientes).';
alter view v_patient_notes set (security_invoker = on);

-- Línea de tiempo UNIFICADA por paciente (hechos reales; el front filtra por client_id y ordena por ts)
create or replace view v_patient_timeline as
  select t.client_id, t.start_date::timestamptz as ts, t.start_date as date,
         'tratamiento'::text as category, 'Inicio de tratamiento'::text as title,
         t.name as detail, t.sale_price as amount, 'success'::text as tone
  from treatments t
union all
  select s.client_id, s.created_at as ts, s.sale_date as date,
         'venta'::text, ('Venta ' || coalesce(s.code, ''))::text,
         coalesce(tr.name, 'Venta de productos') as detail, s.total as amount,
         case when s.status = 'pagada' then 'success'
              when s.status = 'vencida' then 'danger'
              else 'neutral' end::text
  from sales s
  left join treatments tr on tr.id = s.treatment_id
  where s.status <> 'anulada'
union all
  select p.client_id, p.paid_at as ts, p.paid_at::date as date,
         'abono'::text, 'Abono recibido'::text,
         initcap(replace(p.method::text, '_', ' ')) as detail, p.amount as amount, 'success'::text
  from payments p
  where p.client_id is not null
union all
  select t.client_id, d.dispensed_at as ts, d.dispensed_at::date as date,
         'dosis'::text, ('Dosis: ' || coalesce(ti.name, 'producto'))::text,
         coalesce(d.notes, 'Entrega de dosis') as detail, null::numeric as amount, 'neutral'::text
  from treatment_dispensations d
  join treatment_items ti on ti.id = d.treatment_item_id
  join treatments t on t.id = ti.treatment_id
union all
  select n.client_id, n.created_at as ts, n.created_at::date as date,
         ('nota_' || n.kind::text)::text,
         case n.kind when 'alergia' then 'Alergia registrada'
                     when 'recomendacion' then 'Recomendación'
                     when 'hito' then 'Hito / logro'
                     when 'seguimiento' then 'Seguimiento'
                     else 'Nota clínica' end::text,
         n.body as detail, null::numeric as amount,
         case n.kind when 'alergia' then 'danger'
                     when 'hito' then 'success'
                     when 'recomendacion' then 'warning'
                     else 'neutral' end::text
  from clinical_notes n;
comment on view v_patient_timeline is 'Historia unificada por paciente: tratamientos, ventas, abonos, dosis y notas (ordenar por ts desc).';
alter view v_patient_timeline set (security_invoker = on);

-- Revenue en el tiempo: ingreso (abonos) por mes y paciente
create or replace view v_patient_revenue as
select
  p.client_id,
  date_trunc('month', p.paid_at)::date as month,
  sum(p.amount)                        as income,
  count(*)                             as payments
from payments p
where p.client_id is not null
group by p.client_id, date_trunc('month', p.paid_at);
comment on view v_patient_revenue is 'Revenue por mes y por paciente (suma de abonos).';
alter view v_patient_revenue set (security_invoker = on);

-- Resumen vivo del paciente (valor de vida, saldo, última visita, tier)
drop view if exists v_patient_summary;
create view v_patient_summary as
select
  c.id as client_id, c.code, c.full_name, c.document_id, c.phone, c.email, c.birthdate, c.address, c.notes,
  coalesce(s.total_purchased, 0)                              as total_purchased,
  coalesce(pay.total_paid, 0)                                 as total_paid,
  coalesce(s.total_purchased, 0) - coalesce(pay.total_paid, 0) as balance,
  coalesce(s.sales_count, 0)                                  as sales_count,
  s.last_sale,
  coalesce(t.active_treatments, 0)                            as active_treatments,
  case when coalesce(s.total_purchased, 0) >= 6000000 then 'VIP'
       when coalesce(s.total_purchased, 0) >= 3500000 then 'Alto'
       when coalesce(s.total_purchased, 0) >= 1500000 then 'Medio'
       else 'Basico' end                                      as tier
from clients c
left join (
  select client_id, sum(total) as total_purchased, count(*) as sales_count, max(sale_date) as last_sale
  from sales where status <> 'anulada' group by client_id
) s on s.client_id = c.id
left join (
  select client_id, sum(amount) as total_paid from payments group by client_id
) pay on pay.client_id = c.id
left join (
  select client_id, count(*) filter (where status in ('activo','por_finalizar')) as active_treatments
  from treatments group by client_id
) t on t.client_id = c.id;
comment on view v_patient_summary is 'Resumen vivo por paciente para la ficha clínica (valor de vida, saldo, última venta, tier).';
alter view v_patient_summary set (security_invoker = on);

-- ============================================================
-- RPCs (SECURITY DEFINER + require_staff)
-- ============================================================

create or replace function dash_add_note(
  p_client uuid, p_body text, p_kind text default 'nota',
  p_treatment uuid default null, p_pinned boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind clinical_note_kind; v_id uuid; v_pin boolean;
begin
  perform require_staff();
  if coalesce(nullif(trim(p_body), ''), '') = '' then raise exception 'La nota no puede estar vacía'; end if;
  begin v_kind := lower(coalesce(p_kind, 'nota'))::clinical_note_kind; exception when others then v_kind := 'nota'; end;
  v_pin := coalesce(p_pinned, v_kind = 'alergia');     -- alergias se fijan por defecto
  insert into clinical_notes(client_id, treatment_id, kind, body, pinned, created_by)
    values (p_client, p_treatment, v_kind, trim(p_body), v_pin, auth.uid())
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'kind', v_kind::text, 'pinned', v_pin);
end $$;
comment on function dash_add_note is 'Agrega una nota clínica (nota/alergia/recomendacion/hito/seguimiento). Las alergias se fijan por defecto.';

create or replace function dash_delete_note(p_note uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  delete from clinical_notes where id = p_note;
  return jsonb_build_object('ok', true);
end $$;
comment on function dash_delete_note is 'Elimina una nota clínica.';

-- Editar la ficha de datos del paciente (contacto + demografía). PII: solo staff.
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
begin
  perform require_staff();
  if p_full_name is not null and trim(p_full_name) = '' then
    raise exception 'El nombre no puede estar vacío';
  end if;
  update clients set
    full_name   = coalesce(nullif(trim(p_full_name), ''), full_name),  -- requerido: no se borra
    document_id = nullif(trim(p_document_id), ''),
    phone       = nullif(trim(p_phone), ''),
    email       = nullif(trim(p_email), ''),
    birthdate   = p_birthdate,
    address     = nullif(trim(p_address), ''),
    notes       = nullif(trim(p_notes), ''),
    updated_at  = now()
  where id = p_client;
  return jsonb_build_object('ok', true);
end $$;
comment on function dash_update_client is 'Actualiza la ficha de datos del paciente (nombre, documento, contacto, nacimiento, dirección, notas de ficha).';

-- ---------- Grants + hardening (igual que 08) ----------
grant select on v_patient_notes, v_patient_timeline, v_patient_revenue, v_patient_summary to authenticated;
grant execute on function dash_add_note(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function dash_delete_note(uuid) to authenticated;
grant execute on function dash_update_client(uuid, text, text, text, text, date, text, text) to authenticated;
revoke execute on function dash_add_note(uuid, text, text, uuid, boolean) from public, anon;
revoke execute on function dash_delete_note(uuid) from public, anon;
revoke execute on function dash_update_client(uuid, text, text, text, text, date, text, text) from public, anon;

-- ============================================================
-- Seed demo (idempotente): notas para que la ficha muestre contenido real
-- ============================================================
do $$
declare v uuid;
begin
  select id into v from clients where code = 'HLN-001';
  if v is not null and not exists (select 1 from clinical_notes where client_id = v) then
    insert into clinical_notes(client_id, kind, body, pinned) values
      (v, 'alergia', 'Alergia a lidocaína — evitar anestésicos locales con lidocaína en aplicaciones.', true),
      (v, 'recomendacion', 'Reforzar hidratación 48h post-suero NAD+. Control de presión arterial antes de cada sesión.', false),
      (v, 'hito', 'Completó el primer ciclo de regeneración celular con excelente respuesta clínica.', false),
      (v, 'nota', 'Reporta mejor energía y calidad de sueño desde la semana 3. Continuar plan sin cambios.', false);
  end if;

  select id into v from clients where code = 'HLN-002';
  if v is not null and not exists (select 1 from clinical_notes where client_id = v) then
    insert into clinical_notes(client_id, kind, body, pinned) values
      (v, 'alergia', 'Sensibilidad a sulfas. Verificar excipientes antes de prescribir.', true),
      (v, 'seguimiento', 'Tratamiento anti-inflamatorio próximo a cerrar: confirmar continuidad y recompra de Thymosin Alpha.', false);
  end if;

  select id into v from clients where code = 'HLN-003';
  if v is not null and not exists (select 1 from clinical_notes where client_id = v) then
    insert into clinical_notes(client_id, kind, body, pinned) values
      (v, 'recomendacion', 'Plan de energía y metabolismo: combinar Semaglutida con acompañamiento nutricional.', false),
      (v, 'nota', 'Buena adherencia. Sin eventos adversos reportados.', false);
  end if;

  select id into v from clients where code = 'HLN-004';
  if v is not null and not exists (select 1 from clinical_notes where client_id = v) then
    insert into clinical_notes(client_id, kind, body, pinned) values
      (v, 'hito', 'Paciente VIP: dos ciclos de longevidad completados con seguimiento impecable.', false),
      (v, 'recomendacion', 'Mantener suero revitalizante semanal los lunes. Próxima revisión de biomarcadores en 30 días.', false);
  end if;
end $$;

-- Demografía demo (idempotente: solo si está sin registrar) para que la ficha se vea llena.
update clients set document_id = '1018456712', birthdate = '1991-03-12', address = 'Cra 11 #93-45, Bogotá'
  where code = 'HLN-001' and document_id is null;
update clients set document_id = '1037889201', birthdate = '1986-09-27', address = 'Cl 70 #5-20, Medellín'
  where code = 'HLN-002' and document_id is null;
update clients set document_id = '71654329',   birthdate = '1979-01-05', address = 'Av 6N #28-12, Cali'
  where code = 'HLN-003' and document_id is null;
update clients set document_id = '1144028765', birthdate = '1994-07-19', address = 'Cra 43A #18-95, Medellín'
  where code = 'HLN-004' and document_id is null;
