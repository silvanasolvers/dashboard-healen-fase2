-- ============================================================
-- HEALEN OS · 12 · Caja vinculada a clientes/proveedores
-- Los movimientos de caja se pueden asociar de forma RELACIONAL a un cliente
-- (paciente) o a un proveedor, buscándolos en el formulario. Vista v_payees
-- para el autocompletar. DEBE correr DESPUÉS de 01–11.
-- ============================================================

-- finance_entries: enlazar a cliente (supplier_id ya existe en 02_tables).
alter table finance_entries add column if not exists client_id uuid references clients(id) on delete set null;
create index if not exists idx_finance_client on finance_entries(client_id);
create index if not exists idx_finance_supplier on finance_entries(supplier_id);

-- ---------- Pagadores/beneficiarios para el typeahead (clientes + proveedores) ----------
create or replace view v_payees as
  select c.id, 'cliente'::text as kind, c.full_name as name, c.code as ref, c.phone
  from clients c where c.active
  union all
  select s.id, 'proveedor'::text as kind, s.name as name, null::text as ref, s.phone
  from suppliers s where s.active;
comment on view v_payees is 'Clientes + proveedores para autocompletar el campo cliente/proveedor en caja.';
alter view v_payees set (security_invoker = on);
grant select on v_payees to authenticated;

-- ---------- dash_finance_entry: aceptar y guardar client_id / supplier_id ----------
-- La firma cambia (2 params nuevos) ⇒ se elimina la anterior para no dejar overload.
drop function if exists dash_finance_entry(text, text, text, text, numeric, date, text, text, text, text, text);

create or replace function dash_finance_entry(
  p_kind text, p_scope text default 'empresa', p_category text default null, p_concept text default 'Movimiento',
  p_amount numeric default 0, p_date date default current_date, p_cost_center text default 'Operacion',
  p_payment_method text default 'transferencia', p_person text default null,
  p_attachment_url text default null, p_note text default null,
  p_client_id uuid default null, p_supplier_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind finance_kind; v_scope finance_scope; v_pm payment_method; v_id uuid; v_person text;
begin
  perform require_staff();
  v_kind := case lower(p_kind) when 'gasto' then 'gasto' else 'ingreso' end::finance_kind;
  begin v_scope := lower(coalesce(p_scope,'empresa'))::finance_scope; exception when others then v_scope := 'empresa'; end;
  begin v_pm := lower(replace(coalesce(p_payment_method,'transferencia'),' ','_'))::payment_method; exception when others then v_pm := 'otro'; end;
  -- Nombre legible: el del registro vinculado si viene, si no el texto libre.
  v_person := coalesce(
    (select full_name from clients where id = p_client_id),
    (select name from suppliers where id = p_supplier_id),
    nullif(trim(p_person), '')
  );
  insert into finance_entries(
    kind, scope, category, concept, amount, entry_date, cost_center, payment_method,
    person, client_id, supplier_id, attachment_url, note, reference_type, created_by
  ) values (
    v_kind, v_scope, p_category, coalesce(nullif(p_concept,''),'Movimiento'), coalesce(p_amount,0), p_date, p_cost_center, v_pm,
    v_person, p_client_id, p_supplier_id, p_attachment_url, p_note, 'manual', auth.uid()
  ) returning id into v_id;
  return jsonb_build_object('id', v_id, 'person', v_person);
end $$;
comment on function dash_finance_entry is 'Registra un movimiento de caja, opcionalmente vinculado a un cliente o proveedor.';

-- Grants + hardening (staff-only).
grant execute on function dash_finance_entry(text, text, text, text, numeric, date, text, text, text, text, text, uuid, uuid) to authenticated;
revoke execute on function dash_finance_entry(text, text, text, text, numeric, date, text, text, text, text, text, uuid, uuid) from public, anon;

-- ---------- Consistencia: medio de pago de finance_entries con initcap (igual que ventas) ----------
-- Antes los movimientos manuales se veían "transferencia"/"efectivo" en minúscula.
create or replace view v_dashboard_finance as
select
  coalesce(s.code, s.id::text)                        as id,
  'Ingreso'                                           as kind,
  s.sale_date                                         as date,
  c.full_name                                         as person,
  coalesce(tr.name, 'Venta ' || s.code)               as concept,
  case when (s.total - coalesce(pay.paid, 0)) > 0.005 then 'Cuentas por cobrar' else 'Tratamientos' end as category,
  coalesce(pay.paid, 0)                               as value,
  s.total                                             as "invoiceValue",
  coalesce(pay.paid, 0)                               as "paidValue",
  s.due_date                                          as "dueDate",
  coalesce(initcap(replace(pay.method::text, '_', ' ')), 'Pendiente') as "paymentMethod",
  'Operacion'                                         as "costCenter",
  'Empresa'                                           as scope,
  case s.status when 'pagada' then 'Recibido' when 'vencida' then 'Vencido'
                when 'parcial' then 'Pendiente' else 'Pendiente' end as status,
  null::text                                          as attachment,
  null::text                                          as "attachmentUrl",
  s.notes                                             as note
from sales s
left join clients c on c.id = s.client_id
left join treatments tr on tr.id = s.treatment_id
left join (
  select sale_id, sum(amount) as paid, (array_agg(method order by paid_at desc))[1] as method
  from payments group by sale_id
) pay on pay.sale_id = s.id
where s.status <> 'anulada'
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
from finance_entries f;
alter view v_dashboard_finance set (security_invoker = on);
