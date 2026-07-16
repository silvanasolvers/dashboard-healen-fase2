# Extractor WhatsApp → CRM

Herramienta local y determinística para convertir el archivo de solo lectura de
WhatsApp en **candidatos de importación**. No llama modelos, APIs ni Supabase; no
responde mensajes y no escribe en la base de datos.

## Qué hace

- Lee `history_messages.jsonl` y `history_catalog.json` en dos pasadas.
- Une alias del mismo contacto (`PN`, `LID`, JID con dispositivo y teléfono
  `E.164`) usando el catálogo y los alias observados.
- Incluye contactos de chat directo, participantes que solo aparecen en grupos
  y placeholders encontrados únicamente en el catálogo o referencias.
- Propone de forma determinística nombre, email, intereses, etapa comercial,
  fechas y contadores.
- Clasifica contactos directos como `lead`; `staff` y `vendor` solo mediante
  reglas exactas. Nunca deduce que alguien es paciente por el texto: eso queda
  como `requires_database_treatment_match` para la fase de matching con DB.
- Guarda evidencia limitada a `messageId`, hash, timestamp y dirección; nunca
  copia extractos de conversación al payload de evidencia.
- Produce `candidates.json` privado y `summary.json` agregado sin PII.
- Puede preparar, sin enviarlo, un payload para `crm_ingest_candidates`.

Debe ejecutarse sobre un snapshot ya congelado del historial. La herramienta
verifica los hashes antes y después del análisis y aborta sin emitir candidatos
si alguno de los dos archivos cambia durante la ejecución.

## Seguridad

Los archivos con candidatos contienen PII. El extractor crea el directorio de
salida con modo `0700` y los archivos con `0600`. Si el directorio ya existe y
es accesible por grupo/otros, aborta sin cambiar sus permisos. No se deben
guardar estas salidas en Git; este directorio incluye reglas `.gitignore` para
los nombres predeterminados.

La consola solo recibe conteos agregados. Incluso los errores de JSONL indican
el número de línea, no el contenido inválido.

## Dry-run

Analiza todo y no escribe ningún archivo:

```bash
python3 tools/whatsapp_crm/extractor.py \
  --messages /ruta/privada/history_messages.jsonl \
  --catalog /ruta/privada/history_catalog.json \
  --dry-run
```

## Generar candidatos

El directorio indicado no debería existir; así se crea automáticamente como
privado:

```bash
python3 tools/whatsapp_crm/extractor.py \
  --messages /ruta/privada/history_messages.jsonl \
  --catalog /ruta/privada/history_catalog.json \
  --rules /ruta/privada/rules.json \
  --output-dir /ruta/privada/crm-import-001 \
  --rpc-payload /ruta/privada/crm-import-001/rpc-payload.json
```

El payload opcional tiene esta envoltura y **no se ejecuta**:

```json
{
  "rpc": "crm_ingest_candidates",
  "params": {
    "p_payload": {
      "schemaVersion": 1,
      "run": {
        "id": "...",
        "source": "whatsapp_history_read_only",
        "idempotencyKey": "...",
        "sourceChecksum": "...",
        "config": {}
      },
      "candidates": [
        {
          "sourceRecordKey": "...",
          "candidateType": "contact_upsert",
          "confidence": 0.98,
          "reason": "has_direct_conversation",
          "proposedData": {},
          "evidence": []
        }
      ]
    }
  }
}
```

Esta forma coincide con `crm_ingest_candidates(p_payload jsonb)`. En el payload
RPC, `vendor` se normaliza a `supplier`; `group_only` se conserva. El valor
original siempre queda también en `proposedData.sourceContactType`.

## Reglas exactas

Copiar `rules.example.json` fuera del repositorio como `rules.json` y añadir
teléfonos E.164 o JIDs completos:

```json
{
  "staffIdentities": ["+57XXXXXXXXXX"],
  "vendorIdentities": ["XXXXXXXXXXXX@s.whatsapp.net"],
  "ignoredIdentities": []
}
```

No hay clasificación heurística de staff/proveedores por nombres o mensajes;
los no listados conservan `lead`, `group_only` o `unknown`.

## Idempotencia y matching

`candidateId`, `importKey` y `runId` se derivan de identidades y hashes de
entrada, reglas, versión y opciones de extracción. Con la misma configuración,
`candidates.json` es idéntico byte a byte; cambiar inclusión de catálogo o
cantidad de evidencias genera otra llave idempotente. El payload usa únicamente
el teléfono derivado de la identidad WhatsApp para matching automático. Los
correos hallados en mensajes quedan como datos propuestos para revisión humana,
porque podrían pertenecer a un tercero; ni correo ni nombre habilitan un match
automático en schema v1.

Antes de escribir, la herramienta valida los mismos límites del RPC (5.000
candidatos y 30 MB). Si se exceden, aborta sin emitir archivos parciales y exige
particionar explícitamente una copia inmutable.

El RPC o la capa de revisión debe hacer upsert por `importKey` y solo convertir
un contacto en paciente cuando exista un tratamiento real en la base actual.

## Pruebas

```bash
cd tools/whatsapp_crm
python3 -m unittest -v
```

Las pruebas cubren alias PN/LID, deduplicación, clasificación, ausencia de PII
en consola/resumen, permisos privados, idempotencia, dry-run y modo estricto.
