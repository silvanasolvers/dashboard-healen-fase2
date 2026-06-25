# db/ — Backend Healen (Supabase)

SQL versionado del esquema integrado de Healen OS. Ver **[SCHEMA.md](SCHEMA.md)**
para la arquitectura completa (tablas, funciones, vistas, seguridad, ejemplos).

## Archivos (correr en orden)

| Archivo | Contenido |
|---|---|
| `01_foundation.sql` | Extensiones, enums, helpers (`signal_by_days`, `is_staff`, `set_updated_at`) |
| `02_tables.sql` | 13 tablas del dominio con relaciones, índices y comentarios |
| `03_functions.sql` | Motor FEFO + operaciones (`register_sale`, `dispense_treatment`, `receive_stock`, `record_payment`, `adjust_stock`) |
| `04_views.sql` | 10 vistas de lectura (stock, cliente 360, cartera, caja…) |
| `05_security.sql` | RLS por rol + grants RPC + `security_invoker` en vistas |
| `06_seed.sql` | Datos demo que ejercitan el motor (idempotente) |
| `07_dashboard.sql` | Capa dashboard: vistas `v_dashboard_*` (forma del front) + RPCs `dash_*` |
| `08_hardening.sql` | Cierra el P0: revoca EXECUTE de anon/PUBLIC; cada mutador valida `require_staff()` |

## Ejecutar

```bash
# Aplica todo desde cero
for f in db/0*.sql; do python3 db/run.py "$f"; done
```

`run.py` ejecuta SQL contra la base vía la Supabase Management API. Las credenciales
(Management token + ref) están en el propio script. Todos los `.sql` son
idempotentes salvo `06_seed.sql`, que hace `truncate` y vuelve a sembrar.

## Reglas

- El stock **no** se edita a mano: usar `receive_stock` / `register_sale` /
  `dispense_treatment` / `adjust_stock` para que el libro mayor cuadre.
- El dinero sale de `payments` (ventas) y `finance_entries` (gastos/retiros).
- Toda lectura del dashboard debería ir contra las **vistas `v_*`**, no las tablas crudas.
