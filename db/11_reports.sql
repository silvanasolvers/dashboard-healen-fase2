-- ============================================================
-- HEALEN OS · 11 · Reportes y caja por RANGO DE FECHAS
-- Agregaciones server-side para que el UI NO recalcule: una RPC devuelve
-- todo lo que la vista necesita (totales, desgloses, series) ya computado.
-- Filtran por [p_from, p_to] (null = sin límite). Datos financieros ⇒ require_staff.
-- DEBE correr DESPUÉS de 01–10.
-- ============================================================

-- (finance_entries ya tiene idx_finance_date(entry_date) y sales idx_sales_date:
--  un btree single-column sirve igual para el range scan en ambos sentidos.)

-- ---------- Resumen de caja (Contabilidad) ----------
create or replace function dash_finance_summary(p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  perform require_staff();
  with f as (
    select * from v_dashboard_finance
    where (p_from is null or date >= p_from) and (p_to is null or date <= p_to)
  ),
  inc as (select * from f where kind = 'Ingreso' and scope = 'Empresa'),
  expe as (select * from f where kind = 'Gasto'),
  rec as (
    select *, (coalesce("invoiceValue", value) - coalesce("paidValue", 0)) as bal
    from f
    where kind = 'Ingreso'
      and (status in ('Pendiente', 'Vencido') or "paymentMethod" = 'Pendiente' or category ilike '%cobrar%')
  ),
  recp as (select * from rec where bal > 0.005)
  select jsonb_build_object(
    'income',            (select coalesce(sum(value), 0) from inc),
    'income_count',      (select count(*) from inc),
    'income_clients',    (select count(distinct person) from inc),
    'ticket_avg',        (select case when count(*) > 0 then sum(value) / count(*) else 0 end from inc),
    'expenses',          (select coalesce(sum(value), 0) from expe),
    'expenses_company',  (select coalesce(sum(value), 0) from expe where scope = 'Empresa'),
    'personal_out',      (select coalesce(sum(value), 0) from f where scope <> 'Empresa'),
    'supports_with',     (select count(*) from expe where attachment is not null or "attachmentUrl" is not null),
    'supports_total',    (select count(*) from expe),
    'receivable',        (select coalesce(sum(bal), 0) from recp),
    'receivable_invoiced', (select coalesce(sum(coalesce("invoiceValue", value)), 0) from recp),
    'receivable_paid',   (select coalesce(sum(coalesce("paidValue", 0)), 0) from recp),
    'receivable_overdue', (select coalesce(sum(bal), 0) from recp where status = 'Vencido'),
    'income_by_category', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                           from (select coalesce(nullif(category, ''), 'Sin categoría') k, sum(value) v from inc group by 1) q),
    'income_by_payment', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                          from (select "paymentMethod" k, sum(value) v from inc group by 1) q),
    'expense_by_center', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                          from (select coalesce(nullif("costCenter", ''), '-') k, sum(value) v from expe group by 1) q),
    'expense_by_payment', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                           from (select "paymentMethod" k, sum(value) v from expe group by 1) q),
    'receivable_by_status', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
                             from (select status k, sum(bal) v from recp group by 1) q)
  ) into result;
  return result;
end $$;
comment on function dash_finance_summary is 'Totales y desgloses de caja para un rango de fechas (Contabilidad), ya agregados. Staff-only.';

-- ---------- Analítica (Reportes) ----------
create or replace function dash_analytics(p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  perform require_staff();
  -- CTE `f` referenciado varias veces ⇒ Postgres lo materializa una vez:
  -- la vista UNION se escanea UNA sola vez para todas las agregaciones.
  with f as (
    select kind, scope, category, value, date
    from v_dashboard_finance
    where (p_from is null or date >= p_from) and (p_to is null or date <= p_to)
  ),
  agg as (
    select
      coalesce(sum(value) filter (where kind = 'Ingreso' and scope = 'Empresa'), 0) as ci,
      coalesce(sum(value) filter (where kind = 'Gasto'   and scope = 'Empresa'), 0) as ce,
      coalesce(sum(value) filter (where scope <> 'Empresa'), 0)                     as po
    from f
  )
  select jsonb_build_object(
    'company_income', agg.ci,
    'company_expenses', agg.ce,
    'net_profit', agg.ci - agg.ce,
    'personal_out', agg.po,
    'margin_pct', case when agg.ci > 0 then round(((agg.ci - agg.ce) / agg.ci) * 100) else 0 end,
    'vip_count', (select count(*) from v_client_360 where tier = 'VIP'),
    'active_patients', (select count(*) from clients where active),
    'stock_value', (select coalesce(sum(quantity_remaining * unit_cost), 0) from inventory_lots where active),
    'expenses_by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) order by v desc), '[]'::jsonb)
      from (select coalesce(nullif(category, ''), 'Sin categoría') k, sum(value) v
            from f where kind = 'Gasto' and scope = 'Empresa' group by 1) q),
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', ym, 'income', income, 'expenses', expenses, 'profit', income - expenses) order by ym), '[]'::jsonb)
      from (select to_char(date_trunc('month', date), 'YYYY-MM') ym,
                   coalesce(sum(value) filter (where kind = 'Ingreso' and scope = 'Empresa'), 0) income,
                   coalesce(sum(value) filter (where kind = 'Gasto' and scope = 'Empresa'), 0) expenses
            from f group by 1) m)
  ) into result from agg;
  return result;
end $$;
comment on function dash_analytics is 'KPIs + serie mensual + gastos por categoría para un rango (Reportes), ya agregados. Staff-only.';

-- ---------- Grants + hardening (PII/finanzas: staff-only) ----------
grant execute on function dash_finance_summary(date, date) to authenticated;
grant execute on function dash_analytics(date, date) to authenticated;
revoke execute on function dash_finance_summary(date, date) from public, anon;
revoke execute on function dash_analytics(date, date) from public, anon;
