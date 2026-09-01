# Portal Healen · operación y salida a producción

## Componentes

- `portal/`: PWA independiente. Google OAuth con PKCE, TanStack Query y rutas recuperables.
- `db/16_phase2_missing_ddl.sql` y `db/25_*` a `db/27_*`: baseline faltante, dominio portal, RPCs allowlist, Bold y storage.
- `supabase/functions/`: creación/consulta Bold, webhook, documentos firmados y worker IA interno.
- Dashboard interno: pestaña **Portal** en cada ficha para invitar y ver pendientes, más una bandeja global **Portal pacientes**.

## Circuito de check-ins

- `db/32_portal_checkin_operations.sql` añade prioridad, responsable, vencimiento y resolución sin duplicar el dato clínico.
- Un check-in con alarma entra como `escalated`, prioridad urgente y SLA de 4 horas; el resto vence en 24 horas.
- Recepción puede consultar y asignarse trabajo. Solo `admin` o `medico` pueden validar, descartar y cerrar una revisión.
- Al validar se marcan como validadas las métricas originadas en ese check-in, se registra auditoría y se publica una notificación para el paciente.
- La respuesta visible queda en `response_to_patient`; nunca modifica dosis, diagnóstico ni tratamiento automáticamente.
- La bandeja permite pendientes, prioridad, revisados y todos. El detalle enlaza de regreso a la ficha clínica canónica.

## Secretos de servidor

Nunca definirlos con prefijo `VITE_`:

- `BOLD_IDENTITY_KEY`
- `BOLD_SECRET_KEY`
- `OLLAMA_API_KEY` (rotar antes de staging y otra vez antes de producción)
- `AI_WORKER_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORTAL_ORIGIN=https://portal.healen.co`

Variables públicas de Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. En producción no definir `VITE_PORTAL_DEMO`.

## Orden de despliegue

1. Ejecutar las migraciones 24–32 en orden en una instalación nueva; en producción actual la 32 ya está aplicada.
2. Configurar Google Provider en Supabase; redirects exactos de staging y `https://portal.healen.co/auth/callback`.
3. Desplegar Edge Functions con secretos de staging.
4. Ejecutar la matriz de aislamiento con dos usuarios sintéticos y un usuario no invitado.
5. Validar Bold sandbox: aprobado, rechazado, duplicado, tardío y reversado.
6. Configurar antivirus/asynchronous scanner para objetos `pending_review`; ningún archivo se publica hasta `approved`.
7. Crear proyecto Vercel independiente y secretos `PORTAL_VERCEL_*`; asociar `portal.healen.co`.
8. Piloto por feature flag con 5–10 pacientes curados.

## Bloqueos duros de lanzamiento

- No se aplican migraciones directamente por primera vez en producción.
- No se publica ningún documento anterior de forma automática: `visibility` empieza `internal`.
- No se muestra ningún borrador IA sin `review_status=published`.
- No se aceptan archivos sin escaneo antimalware. El código deja toda carga en `pending_review`.
- La revisión jurídica y clínica de consentimientos/versiones es obligatoria.

## Pruebas de aislamiento

- Usuario A: todas las RPCs devuelven solo `client_id=A`.
- Usuario A enviando UUID de B: ninguna RPC portal acepta `client_id`; descargas verifican documento+cliente en servidor.
- Usuario sin invitación: Google Auth puede existir, pero `portal_accounts/access` no se crean y devuelve cero información.
- Invitación vencida/revocada/correo distinto: trigger no crea vínculo.
- Cuenta suspendida: solo soporte; home no incluye tratamiento, citas, progreso ni documentos.
- Verificar que las respuestas nunca contienen `notes`, `cogs`, `margin`, inventario, CRM o WhatsApp.

## Bold

La integración usa API Link (`POST /online/link/v1`), consulta de estado y HMAC-SHA256 sobre el cuerpo en Base64. `portal_webhook_events` y `portal_payment_transactions` dan idempotencia; el webhook responde inmediatamente y procesa en segundo plano. Referencia: [documentación oficial de API Link](https://developers.bold.co/pagos-en-linea/api-link-de-pagos) y [webhooks Bold](https://developers.bold.co/webhook).

## IA

El worker usa `https://ollama.com/api/chat`, no bloquea navegación y elimina claves identificadoras antes de transmitir. El modelo predeterminado es `deepseek-v4-pro:0813-cloud`. Toda salida se valida como JSON y queda `needs_review`. Referencia: [API de chat](https://docs.ollama.com/api/chat) y [autenticación](https://docs.ollama.com/api/authentication).
