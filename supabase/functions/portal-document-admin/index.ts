import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import {
  createDocumentUpload,
  DocumentError,
  DOCUMENT_BUCKET,
  QUARANTINE_BUCKET,
  scanAndPromoteDocument,
} from '../_shared/document-security.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigin = Deno.env.get('DASHBOARD_ORIGIN') ?? 'https://dashboard-healen-fase2.solversai.cloud';
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

class HttpError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-allow-methods': 'POST, OPTIONS',
      vary: 'origin',
    },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return response({ ok: true });
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) throw new HttpError('UNAUTHORIZED', 401);
    const staffClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await staffClient.auth.getUser();
    if (authError || !authData.user) throw new HttpError('UNAUTHORIZED', 401);
    const { data: staff, error: staffError } = await staffClient.rpc('is_staff');
    if (staffError || staff !== true) throw new HttpError('FORBIDDEN', 403);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'list') {
      const { data, error } = await staffClient.rpc('dash_portal_document_operations', {
        p_scope: typeof body.scope === 'string' ? body.scope : 'pending',
        p_limit: 100,
      });
      if (error) throw error;
      return response({ data });
    }
    if (action === 'patients') {
      const query = String(body.query ?? '').replace(/[,%()]/g, ' ').trim().slice(0, 80);
      let patients = admin.from('clients').select('id,full_name,code,phone').eq('active', true)
        .order('updated_at', { ascending: false }).limit(8);
      if (query) patients = patients.or(`full_name.ilike.%${query}%,code.ilike.%${query}%,phone.ilike.%${query}%`);
      const { data, error } = await patients;
      if (error) throw error;
      return response({ data: (data ?? []).map((patient) => ({
        id: patient.id,
        name: patient.full_name || 'Paciente sin nombre',
        code: patient.code ?? null,
        phone: patient.phone ?? null,
      })) });
    }
    if (action === 'prepare_upload') {
      if (!isUuid(body.clientId)) throw new HttpError('CLIENT_REQUIRED');
      const { data: client } = await admin.from('clients').select('id').eq('id', body.clientId).eq('active', true).maybeSingle();
      if (!client) throw new HttpError('CLIENT_NOT_FOUND', 404);
      const data = await createDocumentUpload(admin, {
        clientId: body.clientId,
        uploadedBy: authData.user.id,
        uploadedByPatient: false,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        title: body.title,
        category: body.category,
      });
      await admin.from('portal_access_audit').insert({
        auth_user_id: authData.user.id, client_id: body.clientId, action: 'staff_document_upload_prepare',
        resource_type: 'patient_document', resource_id: data.documentId,
      });
      return response({ data }, 201);
    }

    const documentId = body.documentId;
    if (!isUuid(documentId)) throw new HttpError('DOCUMENT_REQUIRED');
    const { data: document, error: documentError } = await admin.from('patient_documents')
      .select('*').eq('id', documentId).is('removed_at', null).maybeSingle();
    if (documentError) throw documentError;
    if (!document) throw new HttpError('DOCUMENT_NOT_FOUND', 404);

    if (action === 'complete_upload' || action === 'retry_scan') {
      let data: { documentId: string; status: 'clean' | 'pending_verification' };
      try {
        data = await scanAndPromoteDocument(admin, documentId);
      } catch (error) {
        if (!(error instanceof DocumentError) || error.message !== 'DOCUMENT_SCAN_UNAVAILABLE') throw error;
        data = { documentId, status: 'pending_verification' };
      }
      await admin.from('portal_access_audit').insert({
        auth_user_id: authData.user.id, client_id: document.client_id, action: 'staff_document_scan',
        resource_type: 'patient_document', resource_id: documentId,
      });
      return response({ data });
    }
    if (action === 'publish') {
      if (document.scan_status !== 'clean' || document.storage_bucket !== DOCUMENT_BUCKET || !document.storage_path) {
        throw new HttpError('DOCUMENT_NOT_CLEAN', 409);
      }
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 180) : document.title;
      const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 100) : document.category;
      const now = new Date().toISOString();
      const { error } = await admin.from('patient_documents').update({
        title, category, visibility: 'patient_published', review_status: 'approved',
        published_at: now, published_by: authData.user.id,
      }).eq('id', documentId);
      if (error) throw error;
      await Promise.all([
        admin.from('portal_notifications').insert({
          client_id: document.client_id, kind: 'document', title: 'Tienes un documento nuevo',
          body: `${title} ya está disponible en tu archivo clínico.`, tone: 'info', action_path: '/documentos',
        }),
        admin.from('portal_events').insert({ client_id: document.client_id, event_type: 'document_published', resource_type: 'patient_document', resource_id: documentId }),
        admin.from('portal_access_audit').insert({
          auth_user_id: authData.user.id, client_id: document.client_id, action: 'staff_document_publish',
          resource_type: 'patient_document', resource_id: documentId,
        }),
      ]);
      return response({ data: { documentId, status: 'published' } });
    }
    if (action === 'reject') {
      const { error } = await admin.from('patient_documents').update({
        visibility: 'internal', review_status: 'rejected', published_at: null, published_by: null,
        scan_details: { ...(document.scan_details ?? {}), rejectionReason: String(body.reason ?? 'Rechazado por el equipo').slice(0, 400) },
      }).eq('id', documentId);
      if (error) throw error;
      await admin.from('portal_access_audit').insert({
        auth_user_id: authData.user.id, client_id: document.client_id, action: 'staff_document_reject',
        resource_type: 'patient_document', resource_id: documentId,
      });
      return response({ data: { documentId, status: 'rejected' } });
    }
    if (action === 'revoke') {
      const { error } = await admin.from('patient_documents').update({
        visibility: 'internal', review_status: 'pending_review', published_at: null, published_by: null,
      }).eq('id', documentId);
      if (error) throw error;
      await admin.from('portal_access_audit').insert({
        auth_user_id: authData.user.id, client_id: document.client_id, action: 'staff_document_revoke',
        resource_type: 'patient_document', resource_id: documentId,
      });
      return response({ data: { documentId, status: 'revoked' } });
    }
    if (action === 'restore') {
      if (document.scan_status !== 'clean' || document.storage_bucket !== DOCUMENT_BUCKET || !document.storage_path) {
        throw new HttpError('DOCUMENT_NOT_RESTORABLE', 409);
      }
      const details = { ...(document.scan_details ?? {}) } as Record<string, unknown>;
      delete details.rejectionReason;
      const { error } = await admin.from('patient_documents').update({
        visibility: 'internal', review_status: 'pending_review', removed_at: null, scan_details: details,
      }).eq('id', documentId);
      if (error) throw error;
      await admin.from('portal_access_audit').insert({
        auth_user_id: authData.user.id, client_id: document.client_id, action: 'staff_document_restore',
        resource_type: 'patient_document', resource_id: documentId,
      });
      return response({ data: { documentId, status: 'pending_review' } });
    }
    if (action === 'signed_url') {
      if (document.scan_status !== 'clean' || document.storage_bucket !== DOCUMENT_BUCKET || !document.storage_path) {
        throw new HttpError('DOCUMENT_NOT_AVAILABLE', 404);
      }
      const { data: signed, error } = await admin.storage.from(DOCUMENT_BUCKET)
        .createSignedUrl(document.storage_path, 90, { download: true });
      if (error || !signed?.signedUrl) throw error ?? new Error('DOCUMENT_SIGN_FAILED');
      await admin.from('portal_access_audit').insert({
        auth_user_id: authData.user.id, client_id: document.client_id, action: 'staff_document_download',
        resource_type: 'patient_document', resource_id: documentId,
      });
      return response({ data: { url: signed.signedUrl, expiresIn: 90 } });
    }
    throw new HttpError('ACTION_NOT_AVAILABLE', 400);
  } catch (error) {
    if (error instanceof HttpError || error instanceof DocumentError) return response({ error: error.message }, error.status);
    return response({ error: 'DOCUMENT_OPERATION_FAILED' }, 500);
  }
});
