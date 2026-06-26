-- ============================================================
-- HEALEN OS · 14 · Precio de venta + costo (rentabilidad por producto)
-- products.sale_price ya existe en el esquema; hasta ahora el form no lo
-- capturaba. Aquí: el alta/edición de producto setea sale_price, y la vista de
-- inventario expone precio de venta + margen para verlo de un vistazo.
-- Margen % = (venta - costo del lote líder) / venta * 100.
-- DEBE correr DESPUÉS de 01–13. Correr: HEALEN_SBP=... python3 db/run.py
-- ============================================================

-- ---------- Costo de referencia a nivel de producto ----------
-- El costo real (COGS) vive en inventory_lots y solo existe si hay stock. Para que
-- un producto creado SIN stock no pierda su costo (y el margen no mienta 100%),
-- guardamos un costo de referencia en el producto: el margen usa el costo del lote
-- líder si hay stock, y cae a ref_cost si no.
alter table products add column if not exists ref_cost numeric(14,2) not null default 0;
comment on column products.ref_cost is 'Costo de referencia/último ingresado por unidad. Fallback del margen cuando no hay lote con stock.';

-- ---------- v_dashboard_inventory: exponer precio de venta + margen ----------
-- create or replace permite AGREGAR columnas al final (no reordenar). salePrice
-- y marginPct van al final para no romper el orden de columnas existente.
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
  ), p.ref_cost, 0)                                   as "unitCost",
  ps.status                                           as status,
  ps.signal                                           as signal,
  ps.stock_value                                      as "stockValue",
  -- nuevas: precio de venta del catálogo + margen sobre el costo (lote líder o ref_cost)
  coalesce(p.sale_price, 0)                           as "salePrice",
  case when coalesce(p.sale_price,0) > 0 then
    round(((p.sale_price - coalesce((
      select l.unit_cost from inventory_lots l
      where l.product_id = p.id and l.active and l.quantity_remaining > 0
      order by l.expiration_date nulls last, l.received_at limit 1
    ), p.ref_cost, 0)) / p.sale_price) * 100)
  else null end                                       as "marginPct"
from products p
join v_product_stock ps on ps.id = p.id
where p.active
order by p.name;

-- ============================================================
-- dash_upsert_product: ahora setea precio de venta (y min/unidad al re-guardar).
-- Cambia la firma (agrega p_sale_price), así que se elimina la versión vieja de
-- 9 args antes de recrear para no dejar overload colgando.
-- ============================================================
drop function if exists dash_upsert_product(text, text, numeric, numeric, text, text, date, text, numeric);

create or replace function dash_upsert_product(
  p_name text, p_type text default 'peptido', p_stock numeric default 0, p_minimum numeric default 0,
  p_unit text default 'unidades', p_lot text default null, p_expiration date default null,
  p_supplier text default null, p_unit_cost numeric default 0, p_sale_price numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_product uuid; v_cat product_category; v_sup uuid;
begin
  perform require_staff();
  begin v_cat := lower(coalesce(p_type,'peptido'))::product_category; exception when others then v_cat := 'otro'; end;

  select id into v_product from products where lower(name) = lower(p_name) limit 1;
  if v_product is null then
    insert into products(name, category, unit, min_stock, sale_price, ref_cost, created_by)
      values (coalesce(nullif(p_name,''),'Producto nuevo'), v_cat, coalesce(nullif(p_unit,''),'unidades'),
              greatest(coalesce(p_minimum,0),0), greatest(coalesce(p_sale_price,0),0),
              greatest(coalesce(p_unit_cost,0),0), auth.uid())
      returning id into v_product;
  else
    -- producto existente: guardar de nuevo = editar precio/costo/mínimo/unidad (no hay form de edición aparte).
    -- sólo se pisa cada valor si llega uno positivo, para no zapatearlo con 0 al registrar sólo stock.
    update products set
      sale_price = case when coalesce(p_sale_price,0) > 0 then p_sale_price else sale_price end,
      ref_cost   = case when coalesce(p_unit_cost,0)  > 0 then p_unit_cost  else ref_cost   end,
      min_stock  = case when coalesce(p_minimum,0)    > 0 then p_minimum   else min_stock  end,
      unit       = coalesce(nullif(p_unit,''), unit),
      updated_at = now()
    where id = v_product;
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
comment on function dash_upsert_product is 'Alta/edición de producto desde el dashboard: setea precio de venta + mínimo, crea/usa el catálogo y recibe el lote inicial con su costo.';

grant execute on function dash_upsert_product(text, text, numeric, numeric, text, text, date, text, numeric, numeric) to authenticated;
revoke execute on function dash_upsert_product(text, text, numeric, numeric, text, text, date, text, numeric, numeric) from public, anon;
