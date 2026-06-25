-- ============================================================
-- HEALEN OS · 02 · Tablas del dominio
-- ============================================================

-- ---------- Perfiles / staff (1:1 con auth.users) ----------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        app_role not null default 'recepcion',
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table profiles is 'Staff de Healen. 1:1 con auth.users. El rol controla los permisos RLS.';

-- ---------- Proveedores ----------
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact_name text,
  phone       text,
  email       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table suppliers is 'Proveedores de péptidos, sueros e insumos.';

-- ---------- Productos (catálogo) ----------
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique,
  name          text not null,
  category      product_category not null default 'peptido',
  unit          text not null default 'unidades',          -- viales, kits, ampollas...
  min_stock     numeric(12,2) not null default 0,          -- mínimo para alertar reposición
  sale_price    numeric(14,2) not null default 0,          -- precio de venta sugerido
  reorder_supplier_id uuid references suppliers(id) on delete set null,
  track_expiry  boolean not null default true,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
comment on table products is 'Catálogo de productos. El stock NO vive aquí: se deriva de inventory_lots (ver v_product_stock).';
comment on column products.min_stock is 'Umbral de reposición; por debajo dispara alerta de bajo stock.';

-- ---------- Lotes de inventario (el stock vive aquí) ----------
create table if not exists inventory_lots (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete cascade,
  lot_code           text not null,
  expiration_date    date,
  quantity_received  numeric(12,2) not null default 0,
  quantity_remaining numeric(12,2) not null default 0,
  unit_cost          numeric(14,2) not null default 0,     -- costo unitario de ESTE lote (para COGS/margen)
  supplier_id        uuid references suppliers(id) on delete set null,
  received_at        date not null default current_date,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  unique (product_id, lot_code)
);
comment on table inventory_lots is 'Lotes/batches. quantity_remaining es el stock real; el consumo es FEFO (primero el que vence antes). unit_cost alimenta el margen.';
create index if not exists idx_lots_product on inventory_lots(product_id);
create index if not exists idx_lots_fefo on inventory_lots(product_id, expiration_date nulls last, received_at) where quantity_remaining > 0 and active;

-- ---------- Movimientos de inventario (libro mayor del stock) ----------
create table if not exists inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  lot_id        uuid references inventory_lots(id) on delete set null,
  kind          movement_kind not null,
  quantity      numeric(12,2) not null,                    -- con signo: + entra, - sale
  balance_after numeric(12,2),                              -- quantity_remaining del lote tras el movimiento
  unit_cost     numeric(14,2),
  reason        text,
  reference_type text,                                      -- 'sale' | 'dispensation' | 'manual' | 'lot'
  reference_id  uuid,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
comment on table inventory_movements is 'Libro mayor inmutable de inventario. Toda variación de stock deja un registro auditable (quantity con signo).';
-- seq monotónico: preserva el orden de inserción aunque created_at empate (misma transacción).
alter table inventory_movements add column if not exists seq bigserial;
create index if not exists idx_mov_product on inventory_movements(product_id, created_at desc);
create index if not exists idx_mov_seq on inventory_movements(product_id, seq);
create index if not exists idx_mov_ref on inventory_movements(reference_type, reference_id);

-- ---------- Clientes / pacientes ----------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,                                  -- HLN-001
  full_name   text not null,
  document_id text,
  phone       text,
  email       text,
  birthdate   date,
  address     text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
comment on table clients is 'Perfil de cada paciente. Su tier y valor de vida se derivan de sus ventas (ver v_client_360).';
create index if not exists idx_clients_name on clients(full_name);

-- ---------- Tratamientos (un plan vendido a un cliente) ----------
create table if not exists treatments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,
  start_date   date not null default current_date,
  end_date     date,
  status       treatment_status not null default 'activo',
  sale_price   numeric(14,2) not null default 0,
  weekly_serum boolean not null default false,
  serum_day    text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
comment on table treatments is 'Plan de tratamiento de un paciente (regenerativo, anti-inflamatorio, etc.). days_left se deriva de end_date.';
create index if not exists idx_treatments_client on treatments(client_id);

-- ---------- Ítems del tratamiento (péptidos/sueros del plan) ----------
create table if not exists treatment_items (
  id                 uuid primary key default gen_random_uuid(),
  treatment_id       uuid not null references treatments(id) on delete cascade,
  product_id         uuid references products(id) on delete set null,
  name               text not null,                         -- redundante para histórico aunque cambie el producto
  dose               text,                                  -- '250 mg semanal'
  schedule           text,                                  -- 'semanal', 'diario'...
  planned_quantity   numeric(12,2) not null default 0,      -- unidades totales planeadas
  dispensed_quantity numeric(12,2) not null default 0,      -- ya entregadas
  starts_on          date,
  ends_on            date,                                  -- días restantes = ends_on - hoy
  status             item_status not null default 'activo',
  created_at         timestamptz not null default now()
);
comment on table treatment_items is 'Cada péptido/suero dentro de un tratamiento. Al dispensar dosis se descuenta inventario y sube dispensed_quantity.';
create index if not exists idx_titems_treatment on treatment_items(treatment_id);
create index if not exists idx_titems_product on treatment_items(product_id);

-- ---------- Dispensaciones (cada entrega de dosis descuenta stock) ----------
create table if not exists treatment_dispensations (
  id                uuid primary key default gen_random_uuid(),
  treatment_item_id uuid not null references treatment_items(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,
  lot_id            uuid references inventory_lots(id) on delete set null,
  quantity          numeric(12,2) not null,
  unit_cost         numeric(14,2),
  dispensed_at      timestamptz not null default now(),
  notes             text,
  created_by        uuid references auth.users(id)
);
comment on table treatment_dispensations is 'Registro de cada dosis/entrega física a un paciente; descuenta inventario por FEFO.';
create index if not exists idx_disp_item on treatment_dispensations(treatment_item_id);

-- ---------- Ventas (cabecera) ----------
create table if not exists sales (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,                                  -- VTA-0001
  client_id   uuid references clients(id) on delete set null,
  treatment_id uuid references treatments(id) on delete set null,
  sale_date   date not null default current_date,
  subtotal    numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  cogs_total  numeric(14,2) not null default 0,             -- costo de lo vendido (FEFO)
  margin      numeric(14,2) generated always as (total - cogs_total) stored,
  due_date    date,                                         -- si hay saldo: cuenta por cobrar
  status      sale_status not null default 'pendiente',
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
comment on table sales is 'Cabecera de venta. margin = total - cogs_total (automático). El saldo y estado salen de payments.';
comment on column sales.margin is 'Utilidad bruta automática: total menos costo de mercancía vendida (FEFO).';
create index if not exists idx_sales_client on sales(client_id);
create index if not exists idx_sales_date on sales(sale_date desc);

-- ---------- Ítems de venta (productos vendidos) ----------
create table if not exists sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid not null references products(id) on delete restrict,
  lot_id      uuid references inventory_lots(id) on delete set null,
  quantity    numeric(12,2) not null,
  unit_price  numeric(14,2) not null default 0,
  unit_cost   numeric(14,2) not null default 0,             -- costo capturado al vender
  line_total  numeric(14,2) generated always as (quantity * unit_price) stored,
  line_cogs   numeric(14,2) generated always as (quantity * unit_cost) stored
);
comment on table sale_items is 'Líneas de venta. line_total y line_cogs son columnas generadas. Cada línea descuenta inventario por FEFO.';
create index if not exists idx_saleitems_sale on sale_items(sale_id);

-- ---------- Pagos / abonos ----------
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete set null,
  sale_id     uuid references sales(id) on delete cascade,
  amount      numeric(14,2) not null,
  method      payment_method not null default 'transferencia',
  paid_at     timestamptz not null default now(),
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
comment on table payments is 'Abonos y pagos. El saldo de una venta = total - sum(payments). Recalcula sales.status vía trigger.';
create index if not exists idx_payments_sale on payments(sale_id);

-- ---------- Movimientos financieros (gastos, retiros, ingresos no-venta) ----------
create table if not exists finance_entries (
  id            uuid primary key default gen_random_uuid(),
  kind          finance_kind not null,
  scope         finance_scope not null default 'empresa',
  category      text,
  concept       text not null,
  amount        numeric(14,2) not null,
  entry_date    date not null default current_date,
  cost_center   text,
  payment_method payment_method,
  person        text,                                       -- proveedor o socio
  supplier_id   uuid references suppliers(id) on delete set null,
  reference_type text,                                      -- 'purchase' | 'sale' | 'manual'
  reference_id  uuid,
  attachment_url text,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
comment on table finance_entries is 'Libro de caja para gastos, compras a proveedor y retiros de socio (scope separa empresa de personal). Las ventas de producto viven en sales.';
create index if not exists idx_finance_date on finance_entries(entry_date desc);

-- ---------- Receta clínica: vía de ingesta, duración + defaults por producto ----------
-- (Usados por el flujo recetar=checkout, ver 09_prescribe.sql.)
alter table treatment_items add column if not exists route text;          -- oral, subcutanea, intramuscular...
alter table treatment_items add column if not exists duration_days integer;
alter table treatment_items add column if not exists unit_price numeric(14,2);
alter table treatment_items add column if not exists instructions text;
comment on column treatment_items.route is 'Vía de administración / forma de ingesta (oral, sublingual, subcutanea, intramuscular, intravenosa, topica, nasal, inhalada).';

alter table products add column if not exists default_dose text;
alter table products add column if not exists default_route text;
alter table products add column if not exists default_frequency text;
alter table products add column if not exists default_duration_days integer;
alter table products add column if not exists default_quantity numeric(12,2);
comment on column products.default_dose is 'Dosis sugerida al recetar este producto (auto-rellena la receta).';

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['suppliers','products','clients','treatments'] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at();', t);
  end loop;
end $$;
