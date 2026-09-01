# Portal Healen · registro vivo de preparación móvil

Este documento se actualiza con evidencia observada. No contiene datos de pacientes.

| Hallazgo o mejora | Evidencia / métrica | Prioridad | Versión objetivo | Web | iOS | Android | Decisión y resultado |
|---|---|---:|---|---|---|---|---|
| Separar contratos clínicos del navegador | Portal usa RPCs allowlist y `auth.uid()`; no importa el monolito staff | P0 | v1 | Listo | Reutilizable | Reutilizable | Los tipos viven en `portal/src/types.ts` |
| No cachear PHI | Workbox no tiene runtime cache; el 3D no entra al precache | P0 | v1 | Listo | N/A | N/A | Solo shell y assets públicos |
| Rutas recuperables | React Router cubre 10 módulos | P0 | v1 | Listo | Deep links futuros | App links futuros | Vercel reescribe a `index.html` |
| Aislamiento por paciente | `portal_current_client()` deriva identidad desde JWT | P0 | v1 | Pendiente de prueba integrada | Igual contrato | Igual contrato | Lanzamiento bloqueado hasta matriz A/B |
| Peso del módulo 3D | Chunk 3D lazy; fuera del JS inicial | P1 | v1.1 | Listo, medir por dispositivo | Usar escena nativa o WebView evaluada | Igual | Fallback 2D/lista obligatorio |
| Reducción de movimiento | CSS y alternativa de listado | P1 | v1 | Listo | Respetar Reduce Motion | Respetar Remove animations | No se simulan mediciones |
| Push | Eventos seguros ya existen | P2 | v2 | Preparado | APNs pendiente | FCM pendiente | No registrar PHI en payload push |
| Biometría | Auth Google PKCE actual | P2 | App nativa | N/A | Keychain/Face ID | Keystore/Biometrics | Biometría desbloquea sesión local; no sustituye JWT |
| Cámara | Upload firmado admite imágenes | P2 | v1.2 | Selector de archivo | Cámara nativa futura | Cámara nativa futura | Consentimiento contextual; sin acceso persistente |
| HealthKit / Health Connect | Métricas normalizadas por clave/unidad/fecha | P3 | v3 | N/A | HealthKit pendiente | Health Connect pendiente | Importación siempre explícita y revisable |
| Bandeja clínica responsive | Capturas QA a 1440 px y 390 px; `scrollWidth=innerWidth=390` | P0 | v1 | Listo | Patrón master-detail apilable | Patrón master-detail apilable | En móvil lista y revisión se apilan; objetivos principales ocupan todo el ancho |

## Plantilla para nuevos hallazgos

- Hallazgo o mejora:
- Evidencia y métrica:
- Prioridad y versión objetivo:
- Impacto en web, iOS y Android:
- Decisión tomada:
- Resultado posterior:
