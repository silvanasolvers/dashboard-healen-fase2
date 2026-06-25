-- ============================================================
-- HEALEN OS · 09 · Recetar = checkout
-- Receta clínica rápida (dosis, vía de ingesta, frecuencia, duración) que
-- además cobra (venta + margen) y descuenta inventario, en un solo acto.
-- ============================================================

-- Columnas de receta/defaults se definen en 02_tables.sql (esquema base).

-- ---------- Catálogo para el prescriptor (producto + stock + defaults) ----------
create or replace view v_prescribe_catalog as
select
  p.id                       as "productId",
  p.name,
  p.category::text           as category,
  p.unit,
  p.sale_price               as "salePrice",
  p.default_dose             as "defaultDose",
  p.default_route            as "defaultRoute",
  p.default_frequency        as "defaultFrequency",
  p.default_duration_days    as "defaultDurationDays",
  coalesce(p.default_quantity, 1) as "defaultQuantity",
  ps.stock,
  ps.signal,
  ps.status,
  -- costo del lote FEFO-líder, para estimar margen en vivo en el cliente
  coalesce((
    select l.unit_cost from inventory_lots l
    where l.product_id = p.id and l.active and l.quantity_remaining > 0
    order by l.expiration_date nulls last, l.received_at limit 1
  ), 0)                          as "unitCost"
from products p
join v_product_stock ps on ps.id = p.id
where p.active
order by p.name;
comment on view v_prescribe_catalog is 'Catálogo para el flujo de recetar: producto, precio, stock con semáforo y defaults de dosis/vía/frecuencia/duración.';
grant select on v_prescribe_catalog to authenticated;
alter view v_prescribe_catalog set (security_invoker = on);

-- ---------- RPC: recetar + cobrar en un acto ----------
-- p_items: [{ product_id, name, dose, route, frequency, duration_days, quantity, unit_price }]
-- - Crea (o usa) un tratamiento y agrega un treatment_item por línea (la receta clínica).
-- - Si p_charge: crea una venta con las líneas que tienen producto+cantidad, descuenta
--   inventario FEFO (margen automático) y opcionalmente abona.
create or replace function prescribe_checkout(
  p_client uuid,
  p_items jsonb,
  p_treatment uuid default null,
  p_plan_name text default null,
  p_charge boolean default true,
  p_payment numeric default 0,
  p_method payment_method default 'efectivo',
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_treat uuid := p_treatment;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_dur int;
  v_ends date;
  v_max_end date := current_date;
  v_sale uuid;
  v_code text;
  v_fefo jsonb;
  v_subtotal numeric := 0;
  v_cogs numeric := 0;
  v_lines int := 0;
begin
  perform require_staff();
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La receta no tiene productos';
  end if;
  if p_client is null then raise exception 'Falta el paciente'; end if;

  -- Tratamiento: anexar al vigente (p_treatment) o crear uno nuevo si no hay.
  if v_treat is null then
    insert into treatments(client_id, name, start_date, status, created_by)
      values (p_client, coalesce(nullif(p_plan_name,''), 'Receta ' || to_char(current_date,'DD/MM/YYYY')), current_date, 'activo', auth.uid())
      returning id into v_treat;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := nullif(v_item->>'product_id','')::uuid;
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_dur := nullif(v_item->>'duration_days','')::int;
    v_ends := case when v_dur is not null then current_date + v_dur else null end;
    if v_ends is not null and v_ends > v_max_end then v_max_end := v_ends; end if;
    v_price := coalesce(nullif(v_item->>'unit_price','')::numeric,
                        (select sale_price from products where id = v_product), 0);

    -- Validación de integridad: nada negativo en la receta clínica ni en el cobro.
    if v_qty < 0 then raise exception 'Cantidad inválida (%) en la receta', v_qty; end if;
    if v_price < 0 then raise exception 'Precio inválido (%) en la receta', v_price; end if;

    -- Línea de receta (clínico) — siempre.
    insert into treatment_items(treatment_id, product_id, name, dose, route, schedule,
                                planned_quantity, duration_days, ends_on, unit_price, instructions, status)
      values (v_treat, v_product,
              coalesce(nullif(v_item->>'name',''), (select name from products where id = v_product), 'Indicación'),
              nullif(v_item->>'dose',''), nullif(v_item->>'route',''), nullif(v_item->>'frequency',''),
              v_qty, v_dur, v_ends, v_price, nullif(v_item->>'instructions',''), 'activo');
    v_lines := v_lines + 1;

    -- Línea de venta + descuento de inventario — solo si hay producto, cantidad y se cobra.
    -- La cabecera de venta se crea PEREZOSAMENTE en la primera línea cobrable: si la
    -- receta es solo-clínica (sin productos cobrables) no se genera venta fantasma.
    if p_charge and v_product is not null and v_qty > 0 then
      if v_sale is null then
        v_code := 'VTA-' || lpad(nextval('seq_sale')::text, 4, '0');
        insert into sales(code, client_id, treatment_id, sale_date, status, notes, created_by)
          values (v_code, p_client, v_treat, current_date, 'pendiente', p_notes, auth.uid())
          returning id into v_sale;
      end if;
      v_fefo := _consume_fefo(v_product, v_qty, 'venta', 'sale', v_sale, 'Receta ' || coalesce(v_code,''));
      insert into sale_items(sale_id, product_id, lot_id, quantity, unit_price, unit_cost)
        values (v_sale, v_product, (v_fefo->>'first_lot')::uuid, v_qty, v_price, (v_fefo->>'avg_cost')::numeric);
      v_subtotal := v_subtotal + v_qty * v_price;
      v_cogs := v_cogs + (v_fefo->>'total_cost')::numeric;
    end if;
  end loop;

  -- Extender la fecha fin del tratamiento sin acortarla nunca (anexar receta).
  update treatments
    set end_date = greatest(coalesce(end_date, current_date), v_max_end, current_date),
        status = 'activo'
    where id = v_treat;

  if v_sale is not null then
    update sales set
      subtotal = v_subtotal, total = v_subtotal, cogs_total = v_cogs,
      due_date = case when coalesce(p_payment,0) < v_subtotal then current_date + 15 else null end
      where id = v_sale;
    if coalesce(p_payment,0) > 0 then
      insert into payments(client_id, sale_id, amount, method, created_by)
        values (p_client, v_sale, least(p_payment, v_subtotal), p_method, auth.uid());
    else
      perform recompute_sale_status(v_sale);
    end if;
  end if;

  return jsonb_build_object(
    'treatment_id', v_treat,
    'sale_id', v_sale,
    'code', v_code,
    'lines', v_lines,
    'subtotal', v_subtotal,
    'cogs', v_cogs,
    'margin', v_subtotal - v_cogs,
    'paid', least(coalesce(p_payment,0), v_subtotal),
    'balance', v_subtotal - least(coalesce(p_payment,0), v_subtotal)
  );
end $$;
comment on function prescribe_checkout is 'Receta + checkout en un acto: crea/usa tratamiento, agrega ítems (dosis/vía/frecuencia/duración) y, si p_charge, vende con descuento FEFO + margen y abono opcional.';

-- Hardening: revocar de anon/PUBLIC (creada después de 08) y otorgar solo a staff.
revoke execute on function prescribe_checkout(uuid, jsonb, uuid, text, boolean, numeric, payment_method, text) from public, anon;
grant execute on function prescribe_checkout(uuid, jsonb, uuid, text, boolean, numeric, payment_method, text) to authenticated;

-- Nota: v_dashboard_patients (con clientUuid, treatmentId y route en peptides) se define
-- en 07_dashboard.sql como fuente única.
