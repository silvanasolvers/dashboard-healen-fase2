-- ============================================================
-- HEALEN OS · 07 · Capa dashboard
-- Vistas con la forma exacta que consume el front (camelCase) +
-- RPCs 1:1 con cada formulario. Mantiene el cliente delgado.
-- ============================================================

-- ---------- Pacientes (1 fila por cliente, su tratamiento vigente) ----------
create or replace view v_dashboard_patients as
select distinct on (c.id)
  c.code                                              as id,
  c.full_name                                         as name,
  t.name                                              as plan,
  t.sale_price                                        as "saleValue",
  cl.tier                                             as tier,
  t.start_date                                        as "startDate",
  t.end_date                                          as "endDate",
  greatest((t.end_date - current_date), 0)            as "daysLeft",
  greatest((t.end_date - t.start_date), 1)            as "totalDays",
  t.weekly_serum                                      as "weeklySerum",
  coalesce(t.serum_day, '-')                          as "serumDay",
  case t.status when 'activo' then 'Activo'
                when 'por_finalizar' then 'Por finalizar'
                when 'finalizado' then 'Finalizado'
                else 'Activo' end                     as status,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', ti.name,
      'dose', ti.dose,
      'endsInDays', greatest((ti.ends_on - current_date), 0),
      'status', case ti.status when 'por_finalizar' then 'Por finalizar'
                               when 'finalizado' then 'Finalizado' else 'Activo' end
    ) order by ti.ends_on)
    from treatment_items ti where ti.treatment_id = t.id
  ), '[]'::jsonb)                                      as peptides
from clients c
join treatments t on t.client_id = c.id
join v_client_360 cl on cl.id = c.id
where c.active
order by c.id, (t.status = 'activo') desc, t.end_date nulls last;
comment on view v_dashboard_patients is 'Pacientes con su tratamiento vigente, en la forma del tipo Patient del front (camelCase, peptides jsonb).';

-- ---------- Inventario (1 fila por producto, forma InventoryItem) ----------
create or replace view v_dashboard_inventory as
select
  p.sku                                               as id,
  p.id                                                as "productId",
  p.name                                              as product,
  initcap(p.category::text)                           as type,
  ps.stock                                            as stock,
  p.min_stock                                         as minimum,
  p.unit                                              as unit,
  coalesce((
    select l.lot_code from inventory_lots l
    where l.product_id = p.id and l.active and l.quantity_remaining > 0
    order by l.expiration_date nulls last, l.received_at limit 1
  ), '-')                                             as lot,
  ps.next_expiration                                  as expiration,
  coalesce((select s.name from suppliers s where s.id = p.reorder_supplier_id), '-') as supplier,
  coalesce((
    select l.unit_cost from inventory_lots l
    where l.product_id = p.id and l.active and l.quantity_remaining > 0
    order by l.expiration_date nulls last, l.received_at limit 1
  ), 0)                                               as "unitCost",
  ps.status                                           as status,
  ps.signal                                           as signal,
  ps.stock_value                                      as "stockValue"
from products p
join v_product_stock ps on ps.id = p.id
where p.active
order by p.name;
comment on view v_dashboard_inventory is 'Inventario por producto en la forma del tipo InventoryItem (stock/lote/vencimiento del lote FEFO-líder).';

-- ---------- Finanzas (ventas + caja, forma FinanceMovement) ----------
create or replace view v_dashboard_finance as
select
  coalesce(s.code, s.id::text)                        as id,
  'Ingreso'                                           as kind,
  s.sale_date                                         as date,
  c.full_name                                         as person,
  coalesce(tr.name, 'Venta ' || s.code)               as concept,
  case when (s.total - coalesce(pay.paid, 0)) > 0.005 then 'Cuentas por cobrar' else 'Tratamientos' end as category,
  coalesce(pay.paid, 0)                               as value,    -- ingreso = caja efectivamente recibida
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
  coalesce(f.payment_method::text, '-'),
  coalesce(f.cost_center, '-'),
  case f.scope when 'empresa' then 'Empresa' when 'personal' then 'Personal'
               when 'retiro_socio' then 'Retiro socio' else 'Reembolso' end,
  case f.kind when 'gasto' then 'Pagado' else 'Recibido' end,
  null::text, f.attachment_url, f.note
from finance_entries f;
comment on view v_dashboard_finance is 'Movimientos financieros unificados (ventas/cartera + caja) en la forma del tipo FinanceMovement.';

-- ---------- Movimientos de inventario (forma de tarjeta del front) ----------
create or replace view v_dashboard_inventory_movements as
select id, product_id, product, kind, date, quantity, "previousStock", "resultingStock", reason
from (
  select
    m.id::text                                        as id,
    m.product_id,
    p.name                                            as product,
    case m.kind when 'entrada' then 'Entrada' when 'venta' then 'Venta'
                when 'dispensacion' then 'Salida' when 'salida' then 'Salida'
                when 'ajuste' then 'Ajuste' else 'Salida' end as kind,
    m.created_at::date                                as date,
    abs(m.quantity)                                   as quantity,
    -- saldo acumulado a nivel PRODUCTO (no lote), sumando el ledger con signo
    (sum(m.quantity) over w - m.quantity)             as "previousStock",
    sum(m.quantity) over w                            as "resultingStock",
    coalesce(m.reason, m.kind::text)                  as reason,
    m.seq                                             as seq
  from inventory_movements m
  join products p on p.id = m.product_id
  window w as (partition by m.product_id order by m.seq)
) s
order by seq desc;
comment on view v_dashboard_inventory_movements is 'Últimos movimientos con saldo acumulado a nivel producto (previousStock→resultingStock).';

-- ============================================================
-- RPCs 1:1 con los formularios del dashboard
-- ============================================================

-- Crear paciente (cliente + tratamiento + ítem + venta pendiente)
create or replace function dash_create_patient(
  p_name text, p_plan text, p_sale_value numeric default 0,
  p_peptide text default null, p_dose text default null, p_days_left int default 30,
  p_start date default current_date, p_end date default null,
  p_serum_day text default null, p_weekly_serum boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_treat uuid; v_product uuid; v_code text; v_sale text;
begin
  perform require_staff();
  v_code := next_client_code();
  insert into clients(code, full_name, created_by) values (v_code, coalesce(nullif(p_name,''),'Paciente nuevo'), auth.uid()) returning id into v_client;

  insert into treatments(client_id, name, start_date, end_date, status, sale_price, weekly_serum, serum_day, created_by)
    values (v_client, coalesce(nullif(p_plan,''),'Plan personalizado'), p_start,
            coalesce(p_end, current_date + coalesce(p_days_left,30)), 'activo', coalesce(p_sale_value,0),
            coalesce(p_weekly_serum,false), nullif(p_serum_day,''), auth.uid())
    returning id into v_treat;

  if coalesce(nullif(p_peptide,''),'') <> '' then
    select id into v_product from products where lower(name) = lower(p_peptide) and active limit 1;
    insert into treatment_items(treatment_id, product_id, name, dose, planned_quantity, ends_on, status)
      values (v_treat, v_product, p_peptide, nullif(p_dose,''), 0, current_date + coalesce(p_days_left,30), 'activo');
  end if;

  if coalesce(p_sale_value,0) > 0 then
    v_sale := 'VTA-' || lpad(nextval('seq_sale')::text, 4, '0');
    insert into sales(code, client_id, treatment_id, sale_date, subtotal, total, cogs_total, status, created_by)
      values (v_sale, v_client, v_treat, current_date, p_sale_value, p_sale_value, 0, 'pendiente', auth.uid());
  end if;

  return jsonb_build_object('client_id', v_client, 'code', v_code, 'treatment_id', v_treat);
end $$;
comment on function dash_create_patient is 'Alta de paciente desde el dashboard: cliente + tratamiento + ítem + venta pendiente del plan.';

-- Alta/entrada de producto (catálogo + lote inicial)
create or replace function dash_upsert_product(
  p_name text, p_type text default 'peptido', p_stock numeric default 0, p_minimum numeric default 0,
  p_unit text default 'unidades', p_lot text default null, p_expiration date default null,
  p_supplier text default null, p_unit_cost numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_product uuid; v_cat product_category; v_sup uuid;
begin
  perform require_staff();
  begin v_cat := lower(coalesce(p_type,'peptido'))::product_category; exception when others then v_cat := 'otro'; end;

  select id into v_product from products where lower(name) = lower(p_name) limit 1;
  if v_product is null then
    insert into products(name, category, unit, min_stock, created_by)
      values (coalesce(nullif(p_name,''),'Producto nuevo'), v_cat, coalesce(nullif(p_unit,''),'unidades'), coalesce(p_minimum,0), auth.uid())
      returning id into v_product;
  end if;

  if coalesce(p_supplier,'') <> '' then
    select id into v_sup from suppliers where lower(name) = lower(p_supplier) limit 1;
    if v_sup is null then insert into suppliers(name) values (p_supplier) returning id into v_sup; end if;
    update products set reorder_supplier_id = v_sup where id = v_product and reorder_supplier_id is null;
  end if;

  if coalesce(p_stock,0) > 0 then
    perform receive_stock(v_product, coalesce(nullif(p_lot,''), 'L-'||to_char(now(),'YYMMDD')), p_stock, coalesce(p_unit_cost,0), p_expiration, v_sup);
  end if;

  return jsonb_build_object('product_id', v_product);
end $$;
comment on function dash_upsert_product is 'Alta de producto desde el dashboard: crea/usa el catálogo y recibe el lote inicial.';

-- Movimiento de inventario desde el formulario
create or replace function dash_inventory_movement(
  p_product uuid, p_kind text, p_quantity numeric, p_reason text default null, p_date date default current_date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind text := lower(p_kind); v_lot uuid; v_rem numeric;
begin
  perform require_staff();
  if p_quantity is null or p_quantity <= 0 then raise exception 'Cantidad inválida'; end if;

  if v_kind = 'entrada' then
    perform receive_stock(p_product, 'E-'||to_char(now(),'YYMMDDHH24MISS'), p_quantity,
      coalesce((select unit_cost from inventory_lots where product_id=p_product and active order by received_at desc limit 1),0),
      null, null, p_date);
  elsif v_kind in ('salida','venta','merma') then
    perform _consume_fefo(p_product, p_quantity, v_kind::movement_kind, 'manual', null, coalesce(p_reason,'Movimiento'));
  elsif v_kind = 'ajuste' then
    select id, quantity_remaining into v_lot, v_rem from inventory_lots
      where product_id = p_product and active order by expiration_date nulls last, received_at limit 1;
    if v_lot is null then
      perform receive_stock(p_product, 'A-'||to_char(now(),'YYMMDDHH24MISS'), p_quantity, 0, null, null, p_date);
    else
      perform adjust_stock(v_lot, v_rem + p_quantity, coalesce(p_reason,'Ajuste'));
    end if;
  else
    raise exception 'Tipo de movimiento desconocido: %', p_kind;
  end if;

  return jsonb_build_object('ok', true, 'product_id', p_product, 'kind', v_kind);
end $$;
comment on function dash_inventory_movement is 'Movimiento de inventario desde el form: entrada→lote, salida/venta→FEFO, ajuste→suma al lote líder.';

-- Movimiento de caja desde el formulario
create or replace function dash_finance_entry(
  p_kind text, p_scope text default 'empresa', p_category text default null, p_concept text default 'Movimiento',
  p_amount numeric default 0, p_date date default current_date, p_cost_center text default 'Operacion',
  p_payment_method text default 'transferencia', p_person text default null,
  p_attachment_url text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind finance_kind; v_scope finance_scope; v_pm payment_method; v_id uuid;
begin
  perform require_staff();
  v_kind := case lower(p_kind) when 'gasto' then 'gasto' else 'ingreso' end::finance_kind;
  begin v_scope := lower(coalesce(p_scope,'empresa'))::finance_scope; exception when others then v_scope := 'empresa'; end;
  begin v_pm := lower(replace(coalesce(p_payment_method,'transferencia'),' ','_'))::payment_method; exception when others then v_pm := 'otro'; end;

  insert into finance_entries(kind, scope, category, concept, amount, entry_date, cost_center, payment_method, person, attachment_url, note, reference_type, created_by)
    values (v_kind, v_scope, p_category, coalesce(nullif(p_concept,''),'Movimiento'), coalesce(p_amount,0), p_date, p_cost_center, v_pm, p_person, p_attachment_url, p_note, 'manual', auth.uid())
    returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;
comment on function dash_finance_entry is 'Registra un movimiento de caja (ingreso/gasto) desde el formulario del dashboard.';

-- Permisos para el rol authenticated (RPC vía anon+login)
grant select on v_dashboard_patients, v_dashboard_inventory, v_dashboard_finance, v_dashboard_inventory_movements to authenticated;
grant execute on function dash_create_patient, dash_upsert_product, dash_inventory_movement, dash_finance_entry to authenticated;

alter view v_dashboard_patients set (security_invoker = on);
alter view v_dashboard_inventory set (security_invoker = on);
alter view v_dashboard_finance set (security_invoker = on);
alter view v_dashboard_inventory_movements set (security_invoker = on);
