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
| `09_prescribe.sql` | Recetar=checkout: columnas de receta + `v_prescribe_catalog` + RPC `prescribe_checkout` |
| `10_clinical.sql`–`15_plans.sql` | Historia clínica, reportes, pagos, storage, precios y plantillas de receta |
| `16_crm.sql` | CRM WhatsApp: contactos, pipeline, staging, matching exacto, revisión y auditoría |
| `16_patient_milestones.sql` | Hitos clínicos/operativos estructurados y auditables por paciente |
| `16_phase2_missing_ddl.sql` | Baseline versionado de agenda, relaciones e importaciones; permite crear staging desde cero |
| `17_phase2_dashboard.sql` | Agenda, dossier relacionado y vistas de dashboard para Fase 2 |
| `18_crm_view_hardening.sql` | Revoca explícitamente acceso anon/PUBLIC a las vistas CRM |
| `19_crm_cleanup.sql` | Archiva contactos WhatsApp sin información útil y excluye archivados del directorio |
| `20_crm_operations.sql` | Edición auditada de contactos y movimientos del pipeline |
| `21_crm_pagination.sql` | Listado CRM paginado, filtros server-side, métricas e índices de rendimiento |
| `19_active_patient_lifecycle.sql` | Separa leads, pacientes con tratamiento activo y pacientes históricos en recuperación, conservando la relación CRM–ficha clínica |
| `20_crm_active_match_semantics.sql` | Propaga la regla de tratamiento activo al matching, revisión y aplicación de candidatos CRM |
| `22_crm_patient_category_segments.sql` | Identidad paciente como categoría CRM y segmentaciones de campaña |
| `23_patient_crm_identity_sync.sql` | Sincronización 1:1 de identidad `clients` ↔ CRM |
| `29_portal_core_bridge.sql` | Superficie clínica mínima de Basics para el Portal separado; solo service role y publicación explícita |
| `30_portal_daily_experience.sql` | Bootstrap diario, actividad, notificaciones y operaciones base del portal |
| `31_portal_bold_checkout.sql` | Órdenes, conciliación y checkout Bold detrás del bridge seguro |
| `32_portal_checkin_operations.sql` | Cola clínica de check-ins, alertas, responsables y revisión auditable |
| `33_portal_appointment_operations.sql` | Solicitudes de citas conectadas a agenda, respuesta al paciente y auditoría |
| `rollback_16_crm.sql` | Rollback manual y destructivo del CRM; queda fuera de la secuencia automática |

## Ejecutar

```bash
# Solo en una base vacía de desarrollo (06_seed destruye datos existentes)
for f in db/[0-9][0-9]_*.sql; do python3 db/run.py "$f"; done

# Producción existente con CRM 16–18 instalado: aplicar/reaplicar en este orden
HEALEN_SBP=... python3 db/run.py db/19_crm_cleanup.sql
HEALEN_SBP=... python3 db/run.py db/20_crm_operations.sql
HEALEN_SBP=... python3 db/run.py db/21_crm_pagination.sql
HEALEN_SBP=... python3 db/run.py db/19_active_patient_lifecycle.sql
HEALEN_SBP=... python3 db/run.py db/20_crm_active_match_semantics.sql

# Portal separado: Basics recibe solo el bridge clínico, después de backup y preflight.
HEALEN_SBP=... python3 db/run.py db/29_portal_core_bridge.sql

# Solo ante rollback total del CRM (elimina sus datos)
HEALEN_SBP=... python3 db/run.py db/rollback_16_crm.sql
```

`run.py` ejecuta SQL contra la base vía la Supabase Management API. El token se
lee de `HEALEN_SBP` y nunca se guarda en el repositorio. Todos los `.sql` son
idempotentes salvo `06_seed.sql`, que hace `truncate` y vuelve a sembrar.
**Nunca ejecutar `06_seed.sql` en producción.**

## Reglas

- El stock **no** se edita a mano: usar `receive_stock` / `register_sale` /
  `dispense_treatment` / `adjust_stock` para que el libro mayor cuadre.
- El dinero sale de `payments` (ventas) y `finance_entries` (gastos/retiros).
- Toda lectura del dashboard debería ir contra las **vistas `v_*`**, no las tablas crudas.
