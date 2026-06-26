-- ============================================================
-- HEALEN OS · 15 · Planes (plantillas reutilizables de receta)
-- Un "plan" = nombre + lista de productos con su config clínica (dosis, vía,
-- frecuencia, duración, cantidad, precio). Se gestiona desde Inventario y se
-- APLICA al recetar para cargar todas las líneas de un clic.
-- Reusa products, v_product_stock, is_staff(), require_staff(), set_updated_at().
-- DEBE correr DESPUÉS de 01–14. Correr: HEALEN_SBP=... python3 db/run.py
-- ============================================================

-- ---------- Cabecera reutilizable ----------
create table if not exists plan_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                          -- "Regeneracion celular base"
  notes       text,                                   -- nota opcional para el staff
  active      boolean not null default true,          -- soft-delete: archiva, no borra (protege auditoría)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
comment on table plan_templates is 'Plantilla reutilizable de receta (nombre + lista de productos con config clínica). Molde que se aplica al recetar; NO es un tratamiento vendido.';
-- nombre único entre planes activos (case-insensitive)
create unique index if not exists idx_plan_name_active on plan_templates(lower(name)) where active;

-- ---------- Una línea por producto del plan ----------
create table if not exists plan_template_items (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references plan_templates(id) on delete cascade,   -- borrar plan borra líneas
  product_id     uuid references products(id) on delete set null,                 -- producto borrado => null, la línea sobrevive
  name           text not null,                        -- SNAPSHOT del nombre (sobrevive a product_id null o renombrado)
  dose           text,
  route          text,                                 -- vía: subcutanea, oral... (dominio de ROUTES)
  frequency      text,                                 -- diario, semanal... (clave 'frequency' = la que usa p_items)
  duration_days  integer,
  quantity       numeric(12,2) not null default 1,     -- unidades planeadas (sin tope de stock: es un molde)
  unit_price     numeric(14,2),                        -- NULL = precio del día (sale_price vigente al aplicar); valor = congelado
  instructions   text,
  position       integer not null default 0,           -- orden de las tarjetas en el constructor
  created_at     timestamptz not null default now()
);
comment on table plan_template_items is 'Producto + config clínica dentro de un plan. name es snapshot; unit_price NULL = precio dinámico (sale_price actual al aplicar). frequency usa la misma clave que p_items de prescribe_checkout.';
comment on column plan_template_items.product_id is 'FK ON DELETE SET NULL: si borran el producto la línea queda como indicación sin stock; el name snapshot la identifica.';
create index if not exists idx_plan_items_plan on plan_template_items(plan_id, position);
create index if not exists idx_plan_items_product on plan_template_items(product_id);

-- ---------- RLS staff-only (el loop de 05_security.sql tiene lista FIJA: aquí explícito) ----------
alter table plan_templates enable row level security;
alter table plan_template_items enable row level security;
drop policy if exists staff_all on plan_templates;
create policy staff_all on plan_templates for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists staff_all on plan_template_items;
create policy staff_all on plan_template_items for all to authenticated using (is_staff()) with check (is_staff());

-- ---------- updated_at trigger (reusa set_updated_at() de 01) ----------
drop trigger if exists trg_plan_templates_updated on plan_templates;
create trigger trg_plan_templates_updated before update on plan_templates for each row execute function set_updated_at();

-- ============================================================
-- Vista v_plans: un row por plan con items jsonb embebido (sin N+1).
-- items ya trae effective_price, sale_price y stock para pintar total/semáforo
-- en la card y en el constructor sin pedir el catálogo aparte.
-- ============================================================
create or replace view v_plans as
select
  pt.id,
  pt.name,
  pt.notes,
  coalesce(it.item_count, 0)                              as "itemCount",
  coalesce(it.total_estimated, 0)                         as "totalEstimated",   -- sum(quantity * precio efectivo HOY)
  coalesce(it.has_dynamic_price, false)                   as "hasDynamicPrice",  -- algún unit_price NULL => total es estimado
  coalesce(it.has_missing_product, false)                 as "hasMissingProduct",-- algún product_id NULL (producto borrado)
  coalesce(it.lines, '[]'::jsonb)                         as items,
  pt.updated_at                                           as "updatedAt"
from plan_templates pt
left join lateral (
  select
    count(*)                                                       as item_count,
    bool_or(i.unit_price is null)                                  as has_dynamic_price,
    bool_or(i.product_id is null)                                  as has_missing_product,
    sum(i.quantity * coalesce(i.unit_price, p.sale_price, 0))      as total_estimated,
    jsonb_agg(jsonb_build_object(
      'product_id',     i.product_id,
      'name',           i.name,
      'dose',           i.dose,
      'route',          i.route,
      'frequency',      i.frequency,
      'duration_days',  i.duration_days,
      'quantity',       i.quantity,
      'unit_price',     i.unit_price,                              -- NULL viaja tal cual => front sabe que es dinámico
      'effective_price',coalesce(i.unit_price, p.sale_price, 0),   -- precio que se usaría HOY
      'sale_price',     coalesce(p.sale_price, 0),
      'instructions',   i.instructions,
      'stock',          coalesce(ps.stock, 0),
      'signal',         coalesce(ps.signal, 'danger'),
      'unit',           coalesce(p.unit, 'unidades'),
      'unit_cost',      coalesce((
                          select l.unit_cost from inventory_lots l
                          where l.product_id = i.product_id and l.active and l.quantity_remaining > 0
                          order by l.expiration_date nulls last, l.received_at limit 1), 0),
      'missing',        (i.product_id is null)
    ) order by i.position) filter (where i.id is not null)        as lines
  from plan_template_items i
  left join products p        on p.id = i.product_id
  left join v_product_stock ps on ps.id = i.product_id
  where i.plan_id = pt.id
) it on true
where pt.active
order by pt.name;
comment on view v_plans is 'Planes con items jsonb embebido (precio efectivo HOY, stock y costo), conteo, total estimado y flags (precio dinámico / producto faltante) para listar en Inventario y aplicar al recetar.';
alter view v_plans set (security_invoker = on);
grant select on v_plans to authenticated;

-- ============================================================
-- RPC dash_save_plan: upsert atómico de cabecera + reemplazo total de items
-- (crea Y edita). p_items = MISMO shape que prescribe_checkout.
-- ============================================================
create or replace function dash_save_plan(
  p_plan uuid default null,            -- null = crear, uuid = editar
  p_name text default '',
  p_notes text default null,
  p_items jsonb default '[]'           -- [{product_id,name,dose,route,frequency,duration_days,quantity,unit_price,instructions}]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan uuid := p_plan; v_item jsonb; v_pos int := 0; v_product uuid; v_qty numeric; v_price numeric;
begin
  perform require_staff();
  if coalesce(nullif(trim(p_name),''),'') = '' then raise exception 'El plan necesita un nombre'; end if;

  if v_plan is null then
    insert into plan_templates(name, notes, created_by)
      values (trim(p_name), nullif(p_notes,''), auth.uid())
      returning id into v_plan;
  else
    update plan_templates set name = trim(p_name), notes = nullif(p_notes,''), active = true
      where id = v_plan;
    if not found then raise exception 'Plan no encontrado'; end if;
    delete from plan_template_items where plan_id = v_plan;   -- reemplazo total: el front manda la lista entera
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_product := nullif(v_item->>'product_id','')::uuid;
    v_qty     := coalesce((v_item->>'quantity')::numeric, 1);
    v_price   := nullif(v_item->>'unit_price','')::numeric;     -- vacío => NULL => precio del día
    if v_qty < 0 then raise exception 'Cantidad inválida en el plan'; end if;
    if v_price is not null and v_price < 0 then raise exception 'Precio inválido en el plan'; end if;
    insert into plan_template_items(plan_id, product_id, name, dose, route, frequency,
                                    duration_days, quantity, unit_price, instructions, position)
      values (v_plan, v_product,
              coalesce(nullif(v_item->>'name',''),
                       (select name from products where id = v_product),
                       'Indicacion'),
              nullif(v_item->>'dose',''), nullif(v_item->>'route',''), nullif(v_item->>'frequency',''),
              nullif(v_item->>'duration_days','')::int, v_qty, v_price,
              nullif(v_item->>'instructions',''), v_pos);
    v_pos := v_pos + 1;
  end loop;

  return jsonb_build_object('plan_id', v_plan, 'items', v_pos);
end $$;
comment on function dash_save_plan is 'Crea o edita un plan-plantilla: upsert de cabecera + reemplazo total de items (mismo shape de p_items que prescribe_checkout).';

-- ============================================================
-- RPC dash_delete_plan: soft-delete (active=false) para preservar histórico.
-- ============================================================
create or replace function dash_delete_plan(p_plan uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  update plan_templates set active = false where id = p_plan;
  if not found then raise exception 'Plan no encontrado'; end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function dash_delete_plan is 'Archiva un plan-plantilla (soft-delete). No borra duro para preservar auditoría.';

-- ---------- Grants + hardening (staff-only, mismo cierre que 07/08/09/12) ----------
grant execute on function dash_save_plan(uuid, text, text, jsonb) to authenticated;
grant execute on function dash_delete_plan(uuid) to authenticated;
revoke execute on function dash_save_plan(uuid, text, text, jsonb) from public, anon;
revoke execute on function dash_delete_plan(uuid) from public, anon;

-- ============================================================
-- Seed: un plan demo (idempotente por nombre) para ver la feature de inmediato.
-- ============================================================
do $$
declare v_plan uuid;
begin
  if not exists (select 1 from plan_templates where lower(name)=lower('Plan regenerativo base') and active) then
    insert into plan_templates(name, notes) values ('Plan regenerativo base', 'Protocolo de arranque 8 semanas') returning id into v_plan;
    insert into plan_template_items(plan_id, product_id, name, dose, route, frequency, duration_days, quantity, unit_price, position)
    select v_plan, p.id, p.name,
           coalesce(p.default_dose,'250 mg'), coalesce(p.default_route,'subcutanea'),
           coalesce(p.default_frequency,'semanal'), coalesce(p.default_duration_days,56),
           coalesce(p.default_quantity,1), null,                    -- precio del día
           row_number() over (order by p.name) - 1
    from products p where p.active order by p.name limit 2;
  end if;
end $$;
