import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3';

export const DOCUMENT_BUCKET = 'patient-documents';
export const QUARANTINE_BUCKET = 'patient-documents-quarantine';
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export class DocumentError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function validateDocumentInput(input: {
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  title?: unknown;
}) {
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.toLowerCase().trim() : '';
  const sizeBytes = Number(input.sizeBytes);
  const originalName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  const requestedTitle = typeof input.title === 'string' ? input.title.trim() : '';
  if (!MIME_EXTENSIONS[mimeType]) throw new DocumentError('DOCUMENT_TYPE_NOT_ALLOWED', 415);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_DOCUMENT_BYTES) {
    throw new DocumentError('DOCUMENT_SIZE_NOT_ALLOWED', 413);
  }
  if (!originalName || originalName.length > 220) throw new DocumentError('DOCUMENT_NAME_INVALID');
  const baseName = originalName.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const title = (requestedTitle || baseName || 'Documento clínico').slice(0, 180);
  const safeName = `${crypto.randomUUID()}.${MIME_EXTENSIONS[mimeType]}`;
  return { mimeType, sizeBytes, originalName: originalName.slice(0, 220), title, safeName };
}

export async function createDocumentUpload(
  admin: SupabaseClient,
  fields: {
    clientId: string;
    portalUserId?: string;
    uploadedBy?: string;
    uploadedByPatient: boolean;
    fileName?: unknown;
    mimeType?: unknown;
    sizeBytes?: unknown;
    title?: unknown;
    category?: unknown;
  },
) {
  const input = validateDocumentInput(fields);
  const documentId = crypto.randomUUID();
  const path = `${fields.clientId}/${documentId}/${input.safeName}`;
  const category = typeof fields.category === 'string' && fields.category.trim()
    ? fields.category.trim().slice(0, 100)
    : 'Documento clínico';
  const { error: insertError } = await admin.from('patient_documents').insert({
    id: documentId,
    client_id: fields.clientId,
    title: input.title,
    original_name: input.originalName,
    category,
    storage_bucket: QUARANTINE_BUCKET,
    storage_path: path,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    visibility: 'internal',
    review_status: 'pending_review',
    scan_status: 'uploading',
    uploaded_by_patient: fields.uploadedByPatient,
    source_portal_user_id: fields.portalUserId ?? null,
    uploaded_by: fields.uploadedBy ?? null,
  });
  if (insertError) throw insertError;
  const { data: signed, error: signError } = await admin.storage
    .from(QUARANTINE_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (signError || !signed?.signedUrl) {
    await admin.from('patient_documents').delete().eq('id', documentId);
    throw signError ?? new Error('SIGNED_UPLOAD_FAILED');
  }
  return { documentId, signedUrl: signed.signedUrl, expiresIn: 7200, mimeType: input.mimeType };
}

async function sha256Hex(blob: Blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function scanAndPromoteDocument(
  admin: SupabaseClient,
  documentId: string,
  ownership: { clientId?: string; portalUserId?: string } = {},
) {
  let query = admin.from('patient_documents').select('*').eq('id', documentId).is('removed_at', null);
  if (ownership.clientId) query = query.eq('client_id', ownership.clientId);
  if (ownership.portalUserId) query = query.eq('source_portal_user_id', ownership.portalUserId);
  const { data: document, error } = await query.maybeSingle();
  if (error) throw error;
  if (!document) throw new DocumentError('DOCUMENT_NOT_FOUND', 404);
  if (document.scan_status === 'clean' && document.storage_bucket === DOCUMENT_BUCKET) {
    return { documentId, status: 'clean' as const };
  }
  if (document.scan_status === 'infected') throw new DocumentError('DOCUMENT_REJECTED', 409);
  if (document.storage_bucket !== QUARANTINE_BUCKET || !document.storage_path) {
    throw new DocumentError('DOCUMENT_UPLOAD_INCOMPLETE', 409);
  }
  const { data: object, error: downloadError } = await admin.storage
    .from(QUARANTINE_BUCKET).download(document.storage_path);
  if (downloadError || !object) throw new DocumentError('DOCUMENT_UPLOAD_INCOMPLETE', 409);
  if (object.size !== Number(document.size_bytes) || object.size > MAX_DOCUMENT_BYTES) {
    await admin.from('patient_documents').update({ scan_status: 'error', scan_details: { reason: 'size_mismatch' } }).eq('id', documentId);
    throw new DocumentError('DOCUMENT_SIZE_MISMATCH', 409);
  }

  await admin.from('patient_documents').update({ scan_status: 'scanning', scan_details: {} }).eq('id', documentId);
  const scannerUrl = Deno.env.get('DOCUMENT_SCANNER_URL');
  const scannerSecret = Deno.env.get('DOCUMENT_SCANNER_SECRET');
  if (!scannerUrl || !scannerSecret) {
    await admin.from('patient_documents').update({ scan_status: 'error', scan_details: { reason: 'scanner_unavailable' } }).eq('id', documentId);
    throw new DocumentError('DOCUMENT_SCAN_UNAVAILABLE', 503);
  }

  let scannerResponse: Response;
  try {
    scannerResponse = await fetch(scannerUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${scannerSecret}`,
        'content-type': document.mime_type ?? 'application/octet-stream',
        'x-file-name': encodeURIComponent(document.original_name ?? document.title),
      },
      body: object,
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    await admin.from('patient_documents').update({ scan_status: 'error', scan_details: { reason: 'scanner_timeout' } }).eq('id', documentId);
    throw new DocumentError('DOCUMENT_SCAN_UNAVAILABLE', 503);
  }
  const scan = await scannerResponse.json().catch(() => ({})) as { status?: string; engine?: string; signature?: string };
  if (!scannerResponse.ok || !['clean', 'infected'].includes(scan.status ?? '')) {
    await admin.from('patient_documents').update({ scan_status: 'error', scan_details: { reason: 'scanner_error' } }).eq('id', documentId);
    throw new DocumentError('DOCUMENT_SCAN_UNAVAILABLE', 503);
  }
  const digest = await sha256Hex(object);
  if (scan.status === 'infected') {
    await admin.storage.from(QUARANTINE_BUCKET).remove([document.storage_path]);
    await admin.from('patient_documents').update({
      scan_status: 'infected', review_status: 'rejected', scan_engine: scan.engine ?? 'clamav',
      scan_details: { signature: scan.signature ?? 'unknown' }, scan_completed_at: new Date().toISOString(),
      content_sha256: digest,
    }).eq('id', documentId);
    throw new DocumentError('DOCUMENT_INFECTED', 422);
  }

  const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(document.storage_path, object, {
    contentType: document.mime_type ?? undefined,
    cacheControl: '0',
    upsert: false,
  });
  if (uploadError) throw uploadError;
  await admin.storage.from(QUARANTINE_BUCKET).remove([document.storage_path]);
  const { error: updateError } = await admin.from('patient_documents').update({
    storage_bucket: DOCUMENT_BUCKET,
    scan_status: 'clean',
    scan_engine: scan.engine ?? 'clamav',
    scan_details: {},
    scan_completed_at: new Date().toISOString(),
    content_sha256: digest,
  }).eq('id', documentId);
  if (updateError) throw updateError;
  return { documentId, status: 'clean' as const };
}
