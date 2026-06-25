-- ============================================================
-- HEALEN OS · 04 · Vistas (lectura valiosa para dashboard y agentes)
-- ============================================================

-- ---------- Stock por producto (con semáforo y valor) ----------
create or replace view v_product_stock as
select
  p.id, p.sku, p.name, p.category, p.unit, p.min_stock, p.sale_price, p.active,
  coalesce(sum(l.quantity_remaining), 0)                                  as stock,
  coalesce(sum(l.quantity_remaining * l.unit_cost), 0)                    as stock_value,
  min(l.expiration_date) filter (where l.quantity_remaining > 0)          as next_expiration,
  count(l.id) filter (where l.quantity_remaining > 0)                     as active_lots,
  case
    when coalesce(sum(l.quantity_remaining), 0) <= 0 then 'danger'
    when coalesce(sum(l.quantity_remaining), 0) <= p.min_stock then 'warn'
    when min(l.expiration_date) filter (where l.quantity_remaining > 0) <= current_date + 30 then 'warn'
    else 'ok'
  end                                                                     as signal,
  case
    when coalesce(sum(l.quantity_remaining), 0) <= 0 then 'Agotado'
    when coalesce(sum(l.quantity_remaining), 0) <= p.min_stock then 'Bajo stock'
    when min(l.expiration_date) filter (where l.quantity_remaining > 0) <= current_date + 30 then 'Proximo a vencer'
    else 'Disponible'
  end                                                                     as status
from products p
left join inventory_lots l on l.product_id = p.id and l.active
group by p.id;
comment on view v_product_stock is 'Stock vivo por producto: cantidad, valor, próximo vencimiento y semáforo (ok/warn/danger).';

-- ---------- Productos que requieren atención ----------
create or replace view v_low_stock as
select * from v_product_stock where active and signal <> 'ok' order by signal desc, stock asc;
comment on view v_low_stock is 'Productos bajo mínimo, agotados o próximos a vencer. Lista de reposición.';

-- ---------- Lotes próximos a vencer ----------
create or replace view v_expiring_lots as
select l.id, l.product_id, p.name as product_name, l.lot_code, l.expiration_date,
       l.quantity_remaining, l.unit_cost, (l.expiration_date - current_date) as days_to_expire
from inventory_lots l
join products p on p.id = l.product_id
where l.active and l.quantity_remaining > 0 and l.expiration_date is not null
  and l.expiration_date <= current_date + 60
order by l.expiration_date;
comment on view v_expiring_lots is 'Lotes con stock que vencen dentro de 60 días.';

-- ---------- Libro mayor de inventario (movimientos legibles) ----------
create or replace view v_inventory_ledger as
select m.id, m.created_at, m.kind, m.quantity, m.balance_after, m.unit_cost, m.reason,
       m.reference_type, m.reference_id, m.product_id, p.name as product_name,
       m.lot_id, l.lot_code
from inventory_movements m
join products p on p.id = m.product_id
left join inventory_lots l on l.id = m.lot_id
order by m.created_at desc;
comment on view v_inventory_ledger is 'Historial cronológico de todos los movimientos de inventario, con nombres.';

-- ---------- Cliente 360 (valor de vida, saldo, tier) ----------
create or replace view v_client_360 as
select
  c.id, c.code, c.full_name, c.document_id, c.phone, c.email, c.active, c.created_at,
  coalesce(s.total_purchased, 0)                                          as total_purchased,
  coalesce(pay.total_paid, 0)                                            as total_paid,
  coalesce(s.total_purchased, 0) - coalesce(pay.total_paid, 0)           as balance,
  coalesce(s.sales_count, 0)                                            as sales_count,
  s.last_sale,
  coalesce(t.active_treatments, 0)                                     as active_treatments,
  case
    when coalesce(s.total_purchased, 0) >= 6000000 then 'VIP'
    when coalesce(s.total_purchased, 0) >= 3500000 then 'Alto'
    when coalesce(s.total_purchased, 0) >= 1500000 then 'Medio'
    else 'Basico'
  end                                                                   as tier
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
comment on view v_client_360 is 'Resumen por cliente: valor de vida, saldo, tratamientos activos y tier (VIP/Alto/Medio/Básico) automático.';

-- ---------- Tablero de tratamientos (con semáforo de días) ----------
create or replace view v_treatment_board as
select
  t.id, t.client_id, c.full_name as client_name, c.code as client_code,
  t.name, t.start_date, t.end_date, t.status, t.sale_price, t.weekly_serum, t.serum_day,
  (t.end_date - current_date)                          as days_left,
  signal_by_days((t.end_date - current_date)::int)     as signal,
  coalesce(it.item_count, 0)                           as item_count,
  coalesce(it.ending_soon, 0)                          as ending_soon
from treatments t
join clients c on c.id = t.client_id
left join (
  select treatment_id, count(*) as item_count,
         count(*) filter (where ends_on is not null and (ends_on - current_date) <= 5) as ending_soon
  from treatment_items group by treatment_id
) it on it.treatment_id = t.id;
comment on view v_treatment_board is 'Tratamientos con días restantes y semáforo. Base de la pared de urgencia del dashboard.';

-- ---------- Ítems de tratamiento (alertas paciente↔inventario) ----------
create or replace view v_treatment_item_status as
select
  ti.id, ti.treatment_id, ti.product_id, ti.name, ti.dose, ti.schedule,
  ti.planned_quantity, ti.dispensed_quantity,
  greatest(ti.planned_quantity - ti.dispensed_quantity, 0)               as remaining_quantity,
  ti.ends_on, (ti.ends_on - current_date)                                as days_left,
  signal_by_days((ti.ends_on - current_date)::int)                       as days_signal,
  ti.status,
  t.client_id, c.full_name as client_name, c.code as client_code, t.name as plan,
  ps.stock as product_stock, ps.signal as stock_signal, ps.unit as product_unit
from treatment_items ti
join treatments t on t.id = ti.treatment_id
join clients c on c.id = t.client_id
left join v_product_stock ps on ps.id = ti.product_id;
comment on view v_treatment_item_status is 'Cada péptido/suero con días restantes y stock del producto vinculado. Tablero de alertas.';

-- ---------- Cuentas por cobrar ----------
create or replace view v_accounts_receivable as
select
  s.id, s.code, s.client_id, c.full_name as client_name, c.code as client_code,
  s.total, coalesce(pay.paid, 0) as paid, s.total - coalesce(pay.paid, 0) as balance,
  s.sale_date, s.due_date, (current_date - s.due_date) as days_overdue, s.status
from sales s
join clients c on c.id = s.client_id
left join (select sale_id, sum(amount) as paid from payments group by sale_id) pay on pay.sale_id = s.id
where s.status <> 'anulada' and (s.total - coalesce(pay.paid, 0)) > 0.005
order by s.due_date nulls last;
comment on view v_accounts_receivable is 'Ventas con saldo pendiente: facturado, abonado, saldo, vencimiento y días en mora.';

-- ---------- Libro de caja unificado (ventas + gastos/retiros) ----------
create or replace view v_finance_ledger as
select p.id, 'venta'::text as source, p.paid_at::date as entry_date,
       'ingreso'::text as kind, 'empresa'::text as scope, 'Ventas'::text as category,
       coalesce(s.code,'Venta') as concept, c.full_name as person, p.amount, p.method::text as payment_method
from payments p
join sales s on s.id = p.sale_id
left join clients c on c.id = p.client_id
union all
select f.id, 'caja'::text as source, f.entry_date,
       f.kind::text, f.scope::text, coalesce(f.category,''), f.concept, f.person, f.amount, f.payment_method::text
from finance_entries f;
comment on view v_finance_ledger is 'Flujo de dinero unificado: abonos de ventas (ingreso empresa) + movimientos de caja (gastos, compras, retiros de socio).';

-- ---------- Resumen de caja (totales para tarjetas) ----------
create or replace view v_cashflow_summary as
select
  company_income,
  company_expenses,
  company_income - company_expenses as net_profit,
  personal_out,
  receivable_balance
from (
  select
    coalesce(sum(amount) filter (where kind = 'ingreso' and scope = 'empresa'), 0) as company_income,
    coalesce(sum(amount) filter (where kind = 'gasto'   and scope = 'empresa'), 0) as company_expenses,
    coalesce(sum(amount) filter (where kind = 'gasto'   and scope in ('personal','retiro_socio')), 0) as personal_out
  from v_finance_ledger
) base,
lateral (select coalesce(sum(balance), 0) as receivable_balance from v_accounts_receivable) ar;
comment on view v_cashflow_summary is 'Totales de caja: ingreso empresa, gasto empresa, utilidad real, retiros personales y cartera por cobrar.';
