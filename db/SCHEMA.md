# Healen OS — Arquitectura de la base de datos

Backend del centro de medicina regenerativa **Healen** (Supabase / Postgres).
Sistema integrado: **clientes ↔ tratamientos ↔ inventario (por lotes, FEFO) ↔ dinero (margen automático)**.

> Filosofía: el inventario está **vivo**. Cada venta o dosis descuenta stock real
> por lotes, captura el costo y deja un movimiento auditable. El dinero, el stock
> y los tratamientos siempre cuadran porque salen de los mismos hechos registrados.

- **Project ref:** `densirbwpzsmugoeramc`
- **REST:** `https://densirbwpzsmugoeramc.supabase.co/rest/v1/`
- **SQL versionado:** `db/01_foundation.sql` … `db/08_hardening.sql` (correr en orden con `python3 db/run.py <archivo>`).
- **Front conectado:** el dashboard React consume las vistas `v_dashboard_*` y las RPCs
  `dash_*` (capa en `07_dashboard.sql`) vía `@supabase/supabase-js` con anon key + login.

---

## Mapa de relaciones

```
auth.users ──1:1── profiles (rol: admin/medico/recepcion)

suppliers ──< products ──< inventory_lots ──< inventory_movements
                  │              (stock real,      (libro mayor del
                  │               FEFO, costo)       stock, con signo)
                  │
clients ──< treatments ──< treatment_items ──< treatment_dispensations
   │                            (péptidos,         (cada dosis descuenta
   │                             días restantes)    inventario por FEFO)
   │
   ├──< sales ──< sale_items  (venta retail → descuenta inventario + margen)
   │       │
   │       └──< payments  (abonos → recalculan estado: parcial/pagada/vencida)
   │
   └──< finance_entries  (gastos, compras, retiros de socio — caja empresa vs personal)
```

Regla de oro del dinero:
- **Ingresos** = `payments` (abonos de ventas, todos scope empresa).
- **Cuentas por cobrar** = ventas con `total − abonado > 0`.
- **Gastos / retiros** = `finance_entries` (`scope` separa empresa de personal/socio).
- **Utilidad real** = ingreso empresa − gasto empresa (los retiros de socio NO restan utilidad).
- **Margen por venta** = `sales.total − sales.cogs_total` (COGS capturado del costo del lote vía FEFO).

---

## Tablas

| Tabla | Para qué | Claves / notas |
|---|---|---|
| `profiles` | Staff (1:1 con `auth.users`) | `role` controla RLS |
| `suppliers` | Proveedores | — |
| `products` | Catálogo. **El stock NO vive aquí** | `min_stock`, `sale_price`, `unit` |
| `inventory_lots` | **Stock real** por lote | `quantity_remaining`, `expiration_date`, `unit_cost`; consumo FEFO |
| `inventory_movements` | Libro mayor del stock (inmutable) | `quantity` con signo (+entra/−sale), `kind` |
| `clients` | Pacientes | `code` (HLN-###); tier y valor de vida se derivan |
| `treatments` | Plan vendido a un cliente | `sale_price`, `end_date` → días restantes |
| `treatment_items` | Péptidos/sueros del plan | `ends_on` → semáforo; `dispensed_quantity` |
| `treatment_dispensations` | Cada dosis entregada | descuenta inventario FEFO |
| `sales` | Cabecera de venta | `margin` = `total − cogs_total` (generada) |
| `sale_items` | Líneas de venta | `line_total`, `line_cogs` (generadas) |
| `payments` | Abonos/pagos | recalculan `sales.status` vía trigger |
| `finance_entries` | Gastos, compras, retiros | `scope`: empresa/personal/retiro_socio/reembolso |

### Enums
- `app_role`: admin · medico · recepcion
- `product_category`: peptido · suero · insumo · suplemento · otro
- `movement_kind`: entrada · venta · dispensacion · salida · ajuste · merma
- `treatment_status`: activo · por_finalizar · finalizado · cancelado
- `item_status`: activo · por_finalizar · finalizado
- `sale_status`: pendiente · parcial · pagada · vencida · anulada
- `finance_kind`: ingreso · gasto
- `finance_scope`: empresa · personal · retiro_socio · reembolso
- `payment_method`: efectivo · transferencia · tarjeta_credito · tarjeta_debito · pse · nequi · daviplata · pendiente · otro

---

## Funciones (RPC — llamar con `POST /rest/v1/rpc/<fn>`)

Todas son `SECURITY DEFINER`: encapsulan la lógica y mantienen el inventario y el
dinero consistentes en una sola transacción.

| Función | Qué hace | Devuelve |
|---|---|---|
| `receive_stock(product, lot_code, qty, unit_cost, expiration, supplier, received_at)` | Entrada de stock (crea o suma al lote) + movimiento `entrada` | `uuid` del lote |
| `register_sale(client, items jsonb, sale_date, due_date, payment, method, treatment, notes)` | Venta completa: descuenta inventario **FEFO**, captura costo, calcula margen, abona | `jsonb {sale_id, code, subtotal, cogs, margin, paid, balance}` |
| `dispense_treatment(item, qty, notes)` | Entrega una dosis: descuenta inventario FEFO y sube `dispensed_quantity` | `jsonb {dispensation_id, product_id, quantity, cost}` |
| `record_payment(sale, amount, method, note)` | Abona a una venta; recalcula estado | `jsonb {total, paid, balance}` |
| `adjust_stock(lot, new_remaining, reason)` | Fija el stock de un lote + movimiento `ajuste` | `jsonb {previous, new, delta}` |
| `next_client_code()` | Genera el próximo código HLN-### | `text` |
| `_consume_fefo(...)` | Núcleo interno: consume stock FEFO (lo usan venta y dispensación) | `jsonb {total_cost, avg_cost, first_lot}` |

`items` para `register_sale`:
```json
[{ "product_id": "uuid", "quantity": 2, "unit_price": 150000 }]
```
`unit_price` es opcional; si falta, usa `products.sale_price`.

---

## Vistas (lectura — `GET /rest/v1/<vista>`)

| Vista | Qué entrega |
|---|---|
| `v_product_stock` | Stock por producto: cantidad, valor, próximo vencimiento, **semáforo** y estado |
| `v_low_stock` | Productos bajo mínimo / agotados / próximos a vencer (lista de reposición) |
| `v_expiring_lots` | Lotes con stock que vencen en ≤60 días |
| `v_inventory_ledger` | Historial de movimientos con nombres |
| `v_client_360` | Por cliente: valor de vida, saldo, tratamientos activos, **tier** automático |
| `v_treatment_board` | Tratamientos con días restantes y semáforo (pared de urgencia) |
| `v_treatment_item_status` | Cada péptido con días restantes + stock del producto (alertas) |
| `v_accounts_receivable` | Ventas con saldo: facturado, abonado, saldo, vencimiento, mora |
| `v_finance_ledger` | Flujo de dinero unificado (ventas + caja) |
| `v_cashflow_summary` | Totales: ingreso/gasto empresa, utilidad real, retiros, cartera |

**Semáforo** (`signal`): `ok` verde · `warn` ámbar · `danger` rojo.
Días: `≤5 danger`, `≤12 warn`, resto `ok` (función `signal_by_days`).

### Capa dashboard (lo que consume el front)

Vistas con la forma exacta de los tipos del front (camelCase): `v_dashboard_patients`,
`v_dashboard_inventory`, `v_dashboard_finance`, `v_dashboard_inventory_movements`.
RPCs 1:1 con cada formulario: `dash_create_patient`, `dash_upsert_product`,
`dash_inventory_movement`, `dash_finance_entry`.

**Base de caja:** en `v_dashboard_finance` el `value` de una venta es la caja
efectivamente recibida (suma de abonos). Una venta parcial aparece como ingreso (su abono)
y como cartera (su saldo) — no es doble conteo. Así `companyIncome` del front cuadra con
`v_cashflow_summary.company_income`.

### Recetar = checkout (`09_prescribe.sql`)

En un paciente, el médico receta productos (dosis, **vía de ingesta** `route`, frecuencia,
duración) y cobra en un acto. Soporte:
- `treatment_items.route`/`duration_days`/`unit_price`/`instructions` + `products.default_*`
  (dosis/vía/frecuencia/duración/cantidad sugeridas para auto-rellenar).
- `v_prescribe_catalog` — catálogo para el prescriptor: producto, precio, stock con semáforo,
  costo del lote líder (margen estimado) y defaults.
- **`prescribe_checkout(p_client, p_items, p_treatment, p_plan_name, p_charge, p_payment, p_method, p_notes)`**
  — en una transacción: anexa al tratamiento vigente (o crea uno), inserta los `treatment_items`
  (receta clínica) y, si hay líneas cobrables, crea la venta con descuento FEFO + margen + abono.
  Valida cantidades/precios ≥ 0, no genera venta si no hay producto cobrable, y pone `due_date`
  a la cartera con saldo. Devuelve `{treatment_id, sale_id, code, lines, subtotal, cogs, margin, paid, balance}`.
  Bloqueada para anon (require_staff + revoke).

### Historia clínica viva (`10_clinical.sql`)

La ficha del paciente "a la mano": notas persistentes + historia real unificada + revenue en el tiempo.
- **`clinical_notes`** — notas por paciente con `kind` (`nota`/`alergia`/`recomendacion`/`hito`/`seguimiento`) y `pinned` (las alergias se fijan). RLS `staff_all`.
- **`dash_add_note(p_client, p_body, p_kind, p_treatment, p_pinned)`** / **`dash_delete_note(p_note)`** — mutadores con `require_staff`.
- **`v_patient_notes`** — notas con autor.
- **`v_patient_timeline`** — línea de tiempo UNIFICADA sobre hechos reales: tratamientos + ventas + abonos + dosis + notas (el front filtra por `client_id`, ordena por `ts`).
- **`v_patient_revenue`** — abonos por mes y paciente (revenue en el tiempo).
- **`v_patient_summary`** — resumen vivo: valor de vida, abonado, saldo, sesiones, última venta, tier.
- **Próximos pasos NO se guardan**: el front (`buildNextSteps`) los deriva en vivo del paciente + dossier, así se auto-gestionan al pasar los días o entrar una venta.

---

## Seguridad

Modelo real: el dashboard usa la **anon key + login de staff** (Supabase Auth) y RLS
via `is_staff()`. La **service role NUNCA va al browser** (solo backend/scripts).

- **RLS activado** en todas las tablas. Política `staff_all`: el rol `authenticated`
  con perfil de staff (`is_staff()`) puede leer/escribir. Las vistas usan
  `security_invoker` (respetan la RLS de quien consulta). Lectura anon-sin-sesión → 0 filas.
- **Doble defensa en las RPCs de escritura** (que son SECURITY DEFINER y por tanto
  saltan RLS):
  1. `08_hardening.sql` revoca `EXECUTE` de `anon` y `PUBLIC` en todas las funciones
     (Postgres las otorga a PUBLIC por defecto — ese era el agujero P0). anon sin sesión
     recibe `42501 permission denied`.
  2. Cada mutador llama `require_staff()` al inicio: bloquea a usuarios autenticados sin
     perfil de staff (p. ej. auto-registros). No afecta a la service role ni al SQL directo
     (en esos contextos `auth.uid()` es null).
- **Usuarios demo de staff** (creados vía Auth admin API):
  `admin@healen.co` (rol admin) y `recepcion@healen.co` (rol recepcion), contraseña `Healen2026!`.
- Para agregar staff: crear el usuario en Auth y su fila en `profiles` con el rol.

---

## Cómo se llama (ejemplos)

```bash
BASE=https://densirbwpzsmugoeramc.supabase.co/rest/v1
KEY=<service_role o anon>

# Leer stock vivo
curl "$BASE/v_product_stock?select=name,stock,status,signal" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"

# Registrar una venta (descuenta inventario + margen)
curl -X POST "$BASE/rpc/register_sale" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"p_client":"<uuid>","p_items":[{"product_id":"<uuid>","quantity":2}],"p_payment":300000,"p_method":"efectivo"}'

# Dispensar una dosis de tratamiento
curl -X POST "$BASE/rpc/dispense_treatment" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"p_item":"<uuid>","p_qty":1}'
```

---

## Cómo extender (pensado para crecer)

- **Nuevos productos/insumos**: solo `products` + `receive_stock`. El stock, alertas
  y valor aparecen solos en las vistas.
- **Nuevos tipos de movimiento o categoría**: `ALTER TYPE ... ADD VALUE`.
- **Citas / agenda**: tabla nueva `appointments` referenciando `clients` y `profiles`.
- **Comisiones de staff**: derivar de `sales`/`payments` por `created_by`.
- **Impuestos (IVA)**: agregar `tax_rate`/`tax_amount` a `sales`/`sale_items` y ajustar `total`.
- **Multi-sede**: agregar `location_id` a `inventory_lots`, `sales`, `profiles`.

Convenciones: snake_case, `uuid` PK con `gen_random_uuid()`, `created_at`/`updated_at`,
`created_by → auth.users`, dinero `numeric(14,2)`, cantidades `numeric(12,2)`, todo
comentado con `COMMENT ON` (visible vía introspección para agentes y PostgREST).
