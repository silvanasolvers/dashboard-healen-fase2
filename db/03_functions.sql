-- ============================================================
-- HEALEN OS · 03 · Motor de inventario (FEFO) y operaciones
-- Funciones SECURITY DEFINER: encapsulan la lógica para llamarlas como RPC.
-- ============================================================

create sequence if not exists seq_sale;
create sequence if not exists seq_client;

-- ---------- Núcleo FEFO: consumir stock de un producto ----------
-- Descuenta p_qty del producto recorriendo lotes por vencimiento (primero el que
-- vence antes). Escribe un movimiento por lote tocado y devuelve costo y lote líder.
create or replace function _consume_fefo(
  p_product uuid, p_qty numeric, p_kind movement_kind,
  p_ref_type text, p_ref_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_need numeric := p_qty;
  v_total_cost numeric := 0;
  v_first_lot uuid;
  v_take numeric;
  r record;
begin
  perform require_staff();
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cantidad inválida (%) para consumir inventario', p_qty;
  end if;

  for r in
    select id, quantity_remaining, unit_cost
    from inventory_lots
    where product_id = p_product and active and quantity_remaining > 0
    order by expiration_date nulls last, received_at, created_at
    for update
  loop
    exit when v_need <= 0;
    v_take := least(v_need, r.quantity_remaining);

    update inventory_lots
      set quantity_remaining = quantity_remaining - v_take
      where id = r.id;

    insert into inventory_movements(product_id, lot_id, kind, quantity, balance_after, unit_cost, reason, reference_type, reference_id, created_by)
      values (p_product, r.id, p_kind, -v_take, r.quantity_remaining - v_take, r.unit_cost, p_reason, p_ref_type, p_ref_id, auth.uid());

    v_total_cost := v_total_cost + v_take * r.unit_cost;
    if v_first_lot is null then v_first_lot := r.id; end if;
    v_need := v_need - v_take;
  end loop;

  if v_need > 0 then
    raise exception 'Stock insuficiente: faltan % unidades del producto %', v_need, p_product
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'total_cost', v_total_cost,
    'avg_cost', round(v_total_cost / p_qty, 2),
    'first_lot', v_first_lot
  );
end $$;
comment on function _consume_fefo is 'Núcleo del inventario vivo: descuenta stock FEFO, escribe movimientos y devuelve {total_cost, avg_cost, first_lot}. Lanza error si no hay stock.';

-- ---------- Recibir stock (entrada / compra) ----------
create or replace function receive_stock(
  p_product uuid, p_lot_code text, p_qty numeric, p_unit_cost numeric default 0,
  p_expiration date default null, p_supplier uuid default null, p_received_at date default current_date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_lot uuid;
begin
  perform require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'Cantidad de entrada inválida (%)', p_qty; end if;

  insert into inventory_lots(product_id, lot_code, expiration_date, quantity_received, quantity_remaining, unit_cost, supplier_id, received_at, created_by)
    values (p_product, coalesce(nullif(p_lot_code,''), 'S/L-'||to_char(now(),'YYMMDDHH24MI')), p_expiration, p_qty, p_qty, coalesce(p_unit_cost,0), p_supplier, p_received_at, auth.uid())
  on conflict (product_id, lot_code) do update set
    quantity_received  = inventory_lots.quantity_received + excluded.quantity_received,
    quantity_remaining = inventory_lots.quantity_remaining + excluded.quantity_remaining,
    -- costo promedio ponderado sobre el remanente (no re-valúa las unidades viejas al costo nuevo)
    unit_cost          = case
      when (inventory_lots.quantity_remaining + excluded.quantity_remaining) > 0 then
        round((inventory_lots.quantity_remaining * inventory_lots.unit_cost
             + excluded.quantity_remaining * excluded.unit_cost)
            / (inventory_lots.quantity_remaining + excluded.quantity_remaining), 2)
      else excluded.unit_cost end,
    expiration_date    = coalesce(excluded.expiration_date, inventory_lots.expiration_date),
    active             = true
  returning id into v_lot;

  insert into inventory_movements(product_id, lot_id, kind, quantity, balance_after, unit_cost, reason, reference_type, reference_id, created_by)
    select p_product, v_lot, 'entrada', p_qty, quantity_remaining, p_unit_cost, 'Entrada de stock', 'lot', v_lot, auth.uid()
    from inventory_lots where id = v_lot;

  return v_lot;
end $$;
comment on function receive_stock is 'Registra entrada de stock en un lote (lo crea o le suma). Deja movimiento entrada. Devuelve el lote.';

-- ---------- Recalcular estado de una venta según pagos ----------
create or replace function recompute_sale_status(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_due date; v_status sale_status; v_current sale_status;
begin
  select total, due_date, status into v_total, v_due, v_current from sales where id = p_sale;
  if v_current = 'anulada' then return; end if;
  select coalesce(sum(amount),0) into v_paid from payments where sale_id = p_sale;

  if v_total <= 0 or v_paid >= v_total then v_status := 'pagada';   -- sin saldo: cerrada
  elsif v_paid > 0 then v_status := 'parcial';
  else v_status := 'pendiente';
  end if;
  if v_status <> 'pagada' and v_due is not null and v_due < current_date then
    v_status := 'vencida';
  end if;

  update sales set status = v_status where id = p_sale;
end $$;

create or replace function _trg_payment_status() returns trigger language plpgsql as $$
begin
  perform recompute_sale_status(coalesce(new.sale_id, old.sale_id));
  return null;
end $$;

drop trigger if exists trg_payment_status on payments;
create trigger trg_payment_status after insert or update or delete on payments
  for each row execute function _trg_payment_status();

-- ---------- Registrar venta (descuenta inventario + margen automático) ----------
-- p_items: jsonb array [{ "product_id": uuid, "quantity": n, "unit_price": n? }]
create or replace function register_sale(
  p_client uuid,
  p_items jsonb,
  p_sale_date date default current_date,
  p_due_date date default null,
  p_payment numeric default 0,
  p_method payment_method default 'transferencia',
  p_treatment uuid default null,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid;
  v_code text;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_fefo jsonb;
  v_subtotal numeric := 0;
  v_cogs numeric := 0;
begin
  perform require_staff();
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene ítems';
  end if;

  v_code := 'VTA-' || lpad(nextval('seq_sale')::text, 4, '0');
  insert into sales(code, client_id, treatment_id, sale_date, due_date, status, notes, created_by)
    values (v_code, p_client, p_treatment, p_sale_date, p_due_date, 'pendiente', p_notes, auth.uid())
    returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_price := coalesce((v_item->>'unit_price')::numeric, (select sale_price from products where id = v_product));

    v_fefo := _consume_fefo(v_product, v_qty, 'venta', 'sale', v_sale, 'Venta '||v_code);

    insert into sale_items(sale_id, product_id, lot_id, quantity, unit_price, unit_cost)
      values (v_sale, v_product, (v_fefo->>'first_lot')::uuid, v_qty, coalesce(v_price,0), (v_fefo->>'avg_cost')::numeric);

    v_subtotal := v_subtotal + v_qty * coalesce(v_price,0);
    v_cogs := v_cogs + (v_fefo->>'total_cost')::numeric;
  end loop;

  update sales set subtotal = v_subtotal, total = v_subtotal, cogs_total = v_cogs where id = v_sale;

  if coalesce(p_payment,0) > 0 then
    insert into payments(client_id, sale_id, amount, method, created_by)
      values (p_client, v_sale, p_payment, p_method, auth.uid());
  else
    perform recompute_sale_status(v_sale);
  end if;

  return jsonb_build_object(
    'sale_id', v_sale, 'code', v_code, 'subtotal', v_subtotal,
    'cogs', v_cogs, 'margin', v_subtotal - v_cogs,
    'paid', coalesce(p_payment,0), 'balance', v_subtotal - coalesce(p_payment,0)
  );
end $$;
comment on function register_sale is 'Registra una venta completa: descuenta inventario FEFO, captura costo, calcula margen y opcionalmente abona. Devuelve resumen.';

-- ---------- Dispensar dosis de un tratamiento ----------
create or replace function dispense_treatment(
  p_item uuid, p_qty numeric, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_product uuid; v_fefo jsonb; v_disp uuid;
begin
  perform require_staff();
  select product_id into v_product from treatment_items where id = p_item;
  if v_product is null then
    raise exception 'El ítem de tratamiento % no tiene producto de inventario asociado', p_item;
  end if;

  v_fefo := _consume_fefo(v_product, p_qty, 'dispensacion', 'dispensation', p_item, 'Dispensación tratamiento');

  insert into treatment_dispensations(treatment_item_id, product_id, lot_id, quantity, unit_cost, notes, created_by)
    values (p_item, v_product, (v_fefo->>'first_lot')::uuid, p_qty, (v_fefo->>'avg_cost')::numeric, p_notes, auth.uid())
    returning id into v_disp;

  update treatment_items set dispensed_quantity = dispensed_quantity + p_qty where id = p_item;

  return jsonb_build_object('dispensation_id', v_disp, 'product_id', v_product, 'quantity', p_qty, 'cost', (v_fefo->>'total_cost')::numeric);
end $$;
comment on function dispense_treatment is 'Entrega una dosis de un ítem de tratamiento: descuenta inventario FEFO y sube dispensed_quantity.';

-- ---------- Registrar pago / abono ----------
create or replace function record_payment(
  p_sale uuid, p_amount numeric, p_method payment_method default 'transferencia', p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_total numeric; v_paid numeric;
begin
  perform require_staff();
  select client_id, total into v_client, v_total from sales where id = p_sale;
  insert into payments(client_id, sale_id, amount, method, note, created_by)
    values (v_client, p_sale, p_amount, p_method, p_note, auth.uid());
  select coalesce(sum(amount),0) into v_paid from payments where sale_id = p_sale;
  return jsonb_build_object('sale_id', p_sale, 'total', v_total, 'paid', v_paid, 'balance', v_total - v_paid);
end $$;
comment on function record_payment is 'Abona a una venta; el trigger recalcula el estado (parcial/pagada/vencida).';

-- ---------- Ajuste de inventario ----------
create or replace function adjust_stock(
  p_lot uuid, p_new_remaining numeric, p_reason text default 'Ajuste manual'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_product uuid; v_old numeric; v_delta numeric;
begin
  perform require_staff();
  if p_new_remaining is null or p_new_remaining < 0 then
    raise exception 'El stock ajustado no puede ser negativo (%)', p_new_remaining using errcode = 'check_violation';
  end if;
  select product_id, quantity_remaining into v_product, v_old from inventory_lots where id = p_lot for update;
  if v_product is null then raise exception 'Lote % no existe', p_lot; end if;
  v_delta := p_new_remaining - v_old;
  update inventory_lots set quantity_remaining = p_new_remaining where id = p_lot;
  insert into inventory_movements(product_id, lot_id, kind, quantity, balance_after, reason, reference_type, reference_id, created_by)
    values (v_product, p_lot, 'ajuste', v_delta, p_new_remaining, p_reason, 'manual', p_lot, auth.uid());
  return jsonb_build_object('lot_id', p_lot, 'previous', v_old, 'new', p_new_remaining, 'delta', v_delta);
end $$;
comment on function adjust_stock is 'Fija el stock restante de un lote y deja movimiento de ajuste con la diferencia.';

-- ---------- Generador de código de cliente ----------
create or replace function next_client_code()
returns text language sql security definer set search_path = public as $$
  select 'HLN-' || lpad(nextval('seq_client')::text, 3, '0');
$$;
