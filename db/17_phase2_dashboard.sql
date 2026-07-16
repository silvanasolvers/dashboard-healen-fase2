-- ============================================================
-- HEALEN OS · 17 · Phase 2 dashboard support
-- Shows all clients after Excel migration, adds persistent appointments,
-- and reports cash by real payment date instead of sale date.
-- ============================================================

-- ---------- Pacientes: all active clients, with latest treatment when present ----------
drop view if exists v_dashboard_patients cascade;
create view v_dashboard_patients as
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
  case when t.end_date is null then 0 else greatest((t.end_date - current_date), 0) end as "daysLeft",
  greatest(coalesce(t.end_date, current_date) - coalesce(t.start_date, c.created_at::date), 1) as "totalDays",
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
  ), '[]'::jsonb)                                      as peptides
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
comment on view v_dashboard_patients is 'All active clients for Phase 2, including patients without active/current treatment; latest treatment is summarized when present.';
alter view v_dashboard_patients set (security_invoker = on);

create or replace view v_dashboard_patients_due_soon as
select id, name, plan, "saleValue", tier, "startDate", "endDate", "daysLeft", "totalDays",
       "weeklySerum", "serumDay", status, "clientUuid", "treatmentId", peptides
from v_dashboard_patients
where "daysLeft" between 0 and 7
  and status in ('Activo', 'Por finalizar')
order by "daysLeft", "endDate", name;
alter view v_dashboard_patients_due_soon set (security_invoker = on);

-- ---------- Agenda persistente ----------
drop view if exists v_dashboard_appointments;
create view v_dashboard_appointments as
select
  a.id::text                                           as id,
  a.starts_at::date                                    as date,
  to_char(a.starts_at at time zone 'UTC', 'HH24:MI')   as time,
  coalesce(nullif(a.service, ''), case when a.event_type = 'operativo' then 'Evento operativo' else 'Cita clínica' end) as title,
  coalesce(a.notes, '')                                as detail,
  case when a.event_type = 'operativo' then 'consulta'
       when a.service ilike '%suero%' then 'suero'
       when a.service ilike '%pept%' then 'peptido'
       else 'consulta' end                             as kind,
  c.code                                               as "patientId",
  c.id                                                 as "clientUuid",
  c.full_name                                          as "patientName",
  c.document_id                                        as "documentId",
  a.event_type                                         as "eventType",
  a.status                                             as status,
  case when a.status in ('cancelada','vencida') then 'danger'
       when a.starts_at::date < current_date then 'ok'
       when a.starts_at::date = current_date then 'brand'
       else 'warn' end                                 as tone,
  a.source_original_date                               as "sourceOriginalDate",
  a.source_corrected_date                              as "sourceCorrectedDate"
from appointments a
left join clients c on c.id = a.client_id
order by a.starts_at nulls last, a.created_at;
comment on view v_dashboard_appointments is 'Persistent agenda/events imported from Excel and future operational appointments, consumable by the React Agenda view.';
alter view v_dashboard_appointments set (security_invoker = on);

-- ---------- Finanzas: one row per payment on paid_at + unpaid receivables + manual finance ----------
create or replace view v_dashboard_finance as
select
  p.id::text                                           as id,
  'Ingreso'                                           as kind,
  p.paid_at::date                                     as date,
  c.full_name                                         as person,
  coalesce(tr.name, 'Abono ' || coalesce(s.code, 'venta')) as concept,
  case when (s.total - coalesce(pay_total.paid, 0)) > 0.005 then 'Cuentas por cobrar' else 'Tratamientos' end as category,
  p.amount                                            as value,
  s.total                                             as "invoiceValue",
  coalesce(pay_total.paid, 0)                         as "paidValue",
  s.due_date                                          as "dueDate",
  coalesce(initcap(replace(p.method::text, '_', ' ')), 'Pendiente') as "paymentMethod",
  'Operacion'                                         as "costCenter",
  'Empresa'                                           as scope,
  'Recibido'                                          as status,
  null::text                                          as attachment,
  null::text                                          as "attachmentUrl",
  coalesce(p.note, s.notes)                           as note
from payments p
join sales s on s.id = p.sale_id
left join clients c on c.id = p.client_id
left join treatments tr on tr.id = s.treatment_id
left join (
  select sale_id, sum(amount) as paid from payments group by sale_id
) pay_total on pay_total.sale_id = s.id
where s.status <> 'anulada'
union all
select
  coalesce(s.code, s.id::text)                        as id,
  'Ingreso'                                           as kind,
  s.sale_date                                         as date,
  c.full_name                                         as person,
  coalesce(tr.name, 'Venta ' || s.code)               as concept,
  'Cuentas por cobrar'                                as category,
  0                                                   as value,
  s.total                                             as "invoiceValue",
  coalesce(pay_total.paid, 0)                         as "paidValue",
  s.due_date                                          as "dueDate",
  'Pendiente'                                         as "paymentMethod",
  'Operacion'                                         as "costCenter",
  'Empresa'                                           as scope,
  case s.status when 'vencida' then 'Vencido' else 'Pendiente' end as status,
  null::text                                          as attachment,
  null::text                                          as "attachmentUrl",
  s.notes                                             as note
from sales s
left join clients c on c.id = s.client_id
left join treatments tr on tr.id = s.treatment_id
left join (
  select sale_id, sum(amount) as paid from payments group by sale_id
) pay_total on pay_total.sale_id = s.id
where s.status <> 'anulada'
  and (s.total - coalesce(pay_total.paid, 0)) > 0.005
union all
select
  f.id::text,
  case f.kind when 'ingreso' then 'Ingreso' else 'Gasto' end,
  f.entry_date, f.person, f.concept, coalesce(f.category, ''),
  f.amount, f.amount, f.amount, null::date,
  coalesce(initcap(replace(f.payment_method::text, '_', ' ')), '-'),
  coalesce(f.cost_center, '-'),
  case f.scope when 'empresa' then 'Empresa' when 'personal' then 'Personal'
               when 'retiro_socio' then 'Retiro socio' else 'Reembolso' end,
  case f.kind when 'gasto' then 'Pagado' else 'Recibido' end,
  null::text, f.attachment_url, f.note
from finance_entries f
where coalesce(f.reference_type, 'manual') <> 'sale';
comment on view v_dashboard_finance is 'Finance movements using real payment dates, explicit receivable rows, and manual cash entries excluding sale-linked duplicates.';
alter view v_dashboard_finance set (security_invoker = on);

-- ---------- Dossier completo por paciente: relaciones, tratamientos, ventas, pagos y agenda ----------
drop view if exists v_patient_related;
create view v_patient_related as
select
  c.id as client_id,
  coalesce(treatments.items, '[]'::jsonb) as treatments,
  coalesce(sales.items, '[]'::jsonb) as sales,
  coalesce(appointments.items, '[]'::jsonb) as appointments,
  coalesce(relationships.items, '[]'::jsonb) as relationships
from clients c
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'startDate', t.start_date,
    'endDate', t.end_date,
    'status', t.status,
    'salePrice', t.sale_price,
    'weeklySerum', t.weekly_serum,
    'serumDay', t.serum_day,
    'notes', t.notes,
    'items', coalesce(ti.items, '[]'::jsonb)
  ) order by t.start_date desc nulls last, t.created_at desc) as items
  from treatments t
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', ti.id,
      'name', ti.name,
      'dose', ti.dose,
      'route', ti.route,
      'schedule', ti.schedule,
      'plannedQuantity', ti.planned_quantity,
      'dispensedQuantity', ti.dispensed_quantity,
      'startsOn', ti.starts_on,
      'endsOn', ti.ends_on,
      'status', ti.status,
      'unitPrice', ti.unit_price,
      'instructions', ti.instructions
    ) order by ti.starts_on nulls last, ti.created_at) as items
    from treatment_items ti
    where ti.treatment_id = t.id
  ) ti on true
  where t.client_id = c.id
) treatments on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'id', s.id,
    'code', s.code,
    'treatmentId', s.treatment_id,
    'saleDate', s.sale_date,
    'total', s.total,
    'subtotal', s.subtotal,
    'cogsTotal', s.cogs_total,
    'margin', s.margin,
    'dueDate', s.due_date,
    'status', s.status,
    'notes', s.notes,
    'paid', coalesce(pay.paid, 0),
    'balance', greatest(s.total - coalesce(pay.paid, 0), 0),
    'payments', coalesce(pay.items, '[]'::jsonb)
  ) order by s.sale_date desc nulls last, s.created_at desc) as items
  from sales s
  left join lateral (
    select sum(p.amount) as paid,
           jsonb_agg(jsonb_build_object(
             'id', p.id,
             'amount', p.amount,
             'method', p.method,
             'paidAt', p.paid_at,
             'note', p.note
           ) order by p.paid_at) as items
    from payments p
    where p.sale_id = s.id
  ) pay on true
  where s.client_id = c.id
) sales on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'eventType', a.event_type,
    'status', a.status,
    'service', a.service,
    'notes', a.notes,
    'sourceOriginalDate', a.source_original_date,
    'sourceCorrectedDate', a.source_corrected_date
  ) order by a.starts_at desc nulls last, a.created_at desc) as items
  from appointments a
  where a.client_id = c.id
) appointments on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'id', r.id,
    'relationshipType', r.relationship_type,
    'notes', r.notes,
    'relatedClientId', other.id,
    'relatedCode', other.code,
    'relatedName', other.full_name,
    'direction', case when r.client_id = c.id then 'principal' else 'relacionado' end
  ) order by other.full_name) as items
  from patient_relationships r
  join clients other on other.id = case when r.client_id = c.id then r.related_client_id else r.client_id end
  where r.client_id = c.id or r.related_client_id = c.id
) relationships on true
where c.active;
comment on view v_patient_related is 'Complete patient-related dossier arrays for Phase 2: treatments/items, sales/payments, appointments, and relationships/beneficiaries.';
alter view v_patient_related set (security_invoker = on);

-- ---------- RLS hardening for Phase 2 additive tables ----------
alter table if exists appointments enable row level security;
alter table if exists patient_relationships enable row level security;
alter table if exists import_batches enable row level security;
alter table if exists import_source_map enable row level security;

drop policy if exists staff_all on appointments;
create policy staff_all on appointments for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_all on patient_relationships;
create policy staff_all on patient_relationships for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_all on import_batches;
create policy staff_all on import_batches for all to authenticated using (is_staff()) with check (is_staff());

drop policy if exists staff_all on import_source_map;
create policy staff_all on import_source_map for all to authenticated using (is_staff()) with check (is_staff());
