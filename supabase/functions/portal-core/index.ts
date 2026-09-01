import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { assertFreshEnvelope, verifyHmacHex } from '../_shared/portal-integration.ts';
import {
  createDocumentUpload,
  DocumentError,
  scanAndPromoteDocument,
} from '../_shared/document-security.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sharedSecret = Deno.env.get('PORTAL_CORE_SHARED_SECRET')!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const boldBase = 'https://integrations.api.bold.co';
const portalOrigin = Deno.env.get('PORTAL_ORIGIN') ?? 'https://pacientes-healen.solversai.cloud';

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function uuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createCheckout(envelope: { basicsClientId: string; portalUserId: string; requestId: string; params: Record<string, unknown> }) {
  const packageId = envelope.params?.packageId;
  if (!uuid(packageId)) throw new HttpError('PACKAGE_REQUIRED', 400);
  const identityKey = Deno.env.get('BOLD_IDENTITY_KEY');
  if (!identityKey) throw new HttpError('PAYMENTS_NOT_CONFIGURED', 503);

  const { data: packageRow, error: packageError } = await admin.from('portal_packages')
    .select('id,name,description,price,terms_version,active,valid_from,valid_until')
    .eq('id', packageId).eq('active', true).maybeSingle();
  if (packageError) throw packageError;
  const now = new Date();
  if (!packageRow || new Date(packageRow.valid_from) > now ||
      (packageRow.valid_until && new Date(packageRow.valid_until) <= now)) {
    throw new HttpError('PACKAGE_NOT_AVAILABLE', 404);
  }

  const { data: existing } = await admin.from('portal_package_orders')
    .select('id,bold_payment_link,checkout_expires_at')
    .eq('client_id', envelope.basicsClientId).eq('package_id', packageRow.id)
    .eq('status', 'pending_payment').gt('checkout_expires_at', now.toISOString())
    .not('bold_payment_link', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing?.bold_payment_link) {
    return { orderId: existing.id, checkoutUrl: existing.bold_payment_link, expiresAt: existing.checkout_expires_at, reused: true };
  }

  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const { data: order, error: orderError } = await admin.from('portal_package_orders').insert({
    client_id: envelope.basicsClientId,
    package_id: packageRow.id,
    amount: packageRow.price,
    currency: 'COP',
    terms_version: packageRow.terms_version,
    checkout_expires_at: expiresAt.toISOString(),
  }).select('id').single();
  if (orderError) throw orderError;

  const reference = `HEALEN-${String(order.id).replaceAll('-', '')}`;
  const boldResponse = await fetch(`${boldBase}/online/link/v1`, {
    method: 'POST',
    headers: { Authorization: `x-api-key ${identityKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: Number(packageRow.price), tip_amount: 0 },
      reference,
      description: packageRow.name.slice(0, 100),
      expiration_date: expiresAt.getTime() * 1e6,
      callback_url: `${portalOrigin}/pagos?order=${order.id}`,
    }),
  });
  const boldBody = await boldResponse.json().catch(() => ({})) as { payload?: { url?: string; payment_link?: string }; errors?: unknown };
  if (!boldResponse.ok || !boldBody.payload?.url || !boldBody.payload.payment_link) {
    await admin.from('portal_package_orders').update({ status: 'cancelled' }).eq('id', order.id);
    throw new HttpError('BOLD_LINK_FAILED', 502);
  }
  const { error: updateError } = await admin.from('portal_package_orders').update({
    bold_payment_link: boldBody.payload.url,
    bold_order_id: boldBody.payload.payment_link,
    provider_reference: reference,
  }).eq('id', order.id);
  if (updateError) throw updateError;
  await admin.from('portal_core_access_audit').insert({
    request_id: envelope.requestId, portal_user_id: envelope.portalUserId,
    client_id: envelope.basicsClientId, action: 'create_checkout', metadata: { orderId: order.id },
  });
  return { orderId: order.id, checkoutUrl: boldBody.payload.url, expiresAt: expiresAt.toISOString() };
}

async function paymentStatus(envelope: { basicsClientId: string; portalUserId: string; requestId: string; params: Record<string, unknown> }) {
  const orderId = envelope.params?.orderId;
  if (!uuid(orderId)) throw new HttpError('ORDER_REQUIRED', 400);
  const { data: order, error } = await admin.from('portal_package_orders')
    .select('id,status,amount,currency,bold_order_id,provider_reference')
    .eq('id', orderId).eq('client_id', envelope.basicsClientId).maybeSingle();
  if (error) throw error;
  if (!order) throw new HttpError('ORDER_NOT_FOUND', 404);
  if (['preparing', 'active', 'cancelled', 'refunded'].includes(order.status) || !order.bold_order_id) {
    return { orderId, status: order.status };
  }
  const identityKey = Deno.env.get('BOLD_IDENTITY_KEY');
  if (!identityKey) throw new HttpError('PAYMENTS_NOT_CONFIGURED', 503);
  const boldResponse = await fetch(`${boldBase}/online/link/v1/${encodeURIComponent(order.bold_order_id)}`, {
    headers: { Authorization: `x-api-key ${identityKey}` },
  });
  if (!boldResponse.ok) return { orderId, status: order.status, providerStatus: 'UNAVAILABLE' };
  const current = await boldResponse.json() as { status?: string; total?: number; transaction_id?: string; payment_method?: string };
  const providerStatus = String(current.status ?? 'UNKNOWN').toUpperCase();
  if (providerStatus === 'PAID' || providerStatus === 'REJECTED') {
    const event = {
      id: `POLL-${order.bold_order_id}-${providerStatus}-${current.transaction_id ?? 'NO_TX'}`,
      type: providerStatus === 'PAID' ? 'SALE_APPROVED' : 'SALE_REJECTED',
      subject: order.bold_order_id,
      data: {
        payment_id: current.transaction_id ?? `${order.bold_order_id}-${providerStatus}`,
        reference: order.provider_reference,
        amount: { total: current.total ?? Number(order.amount), currency: order.currency ?? 'COP' },
        payment_method: current.payment_method,
        created_at: new Date().toISOString(),
      },
    };
    const raw = JSON.stringify(event);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)).then((value) =>
      Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const { error: processError } = await admin.rpc('portal_process_bold_event', { p_payload: event, p_payload_hash: hash });
    if (processError) throw processError;
  } else if (['CANCELLED', 'EXPIRED'].includes(providerStatus)) {
    await admin.from('portal_package_orders').update({ status: 'cancelled' }).eq('id', order.id).eq('status', 'pending_payment');
  }
  const { data: refreshed } = await admin.from('portal_package_orders').select('status').eq('id', order.id).single();
  await admin.from('portal_core_access_audit').insert({
    request_id: envelope.requestId, portal_user_id: envelope.portalUserId,
    client_id: envelope.basicsClientId, action: 'payment_status', metadata: { orderId: order.id, providerStatus },
  });
  return { orderId, status: refreshed?.status ?? order.status, providerStatus };
}

type PortalEnvelope = { basicsClientId: string; portalUserId: string; requestId: string; params: Record<string, unknown> };

async function prepareDocumentUpload(envelope: PortalEnvelope) {
  const upload = await createDocumentUpload(admin, {
    clientId: envelope.basicsClientId,
    portalUserId: envelope.portalUserId,
    uploadedByPatient: true,
    fileName: envelope.params.fileName,
    mimeType: envelope.params.mimeType,
    sizeBytes: envelope.params.sizeBytes,
    title: envelope.params.title,
    category: envelope.params.category,
  });
  await admin.from('portal_core_access_audit').insert({
    request_id: envelope.requestId,
    portal_user_id: envelope.portalUserId,
    client_id: envelope.basicsClientId,
    action: 'document_upload_prepare',
    metadata: { documentId: upload.documentId },
  });
  return upload;
}

async function completeDocumentUpload(envelope: PortalEnvelope) {
  const documentId = envelope.params.documentId;
  if (!uuid(documentId)) throw new HttpError('DOCUMENT_REQUIRED', 400);
  const result = await scanAndPromoteDocument(admin, String(documentId), {
    clientId: envelope.basicsClientId,
    portalUserId: envelope.portalUserId,
  });
  await admin.from('portal_core_access_audit').insert({
    request_id: envelope.requestId,
    portal_user_id: envelope.portalUserId,
    client_id: envelope.basicsClientId,
    action: 'document_upload_complete',
    metadata: { documentId },
  });
  return result;
}

async function documentUrl(envelope: PortalEnvelope) {
  const documentId = envelope.params.documentId;
  if (!uuid(documentId)) throw new HttpError('DOCUMENT_REQUIRED', 400);
  const { data: document, error } = await admin.from('patient_documents')
    .select('id,storage_bucket,storage_path')
    .eq('id', documentId).eq('client_id', envelope.basicsClientId)
    .eq('visibility', 'patient_published').eq('review_status', 'approved')
    .eq('scan_status', 'clean').eq('storage_bucket', 'patient-documents')
    .is('removed_at', null).maybeSingle();
  if (error) throw error;
  if (!document?.storage_path) throw new HttpError('DOCUMENT_NOT_AVAILABLE', 404);
  const { data: signed, error: signedError } = await admin.storage
    .from('patient-documents').createSignedUrl(document.storage_path, 90, { download: true });
  if (signedError || !signed?.signedUrl) throw signedError ?? new Error('DOCUMENT_SIGN_FAILED');
  await admin.from('portal_core_access_audit').insert({
    request_id: envelope.requestId,
    portal_user_id: envelope.portalUserId,
    client_id: envelope.basicsClientId,
    action: 'document_download',
    metadata: { documentId },
  });
  return { url: signed.signedUrl, expiresIn: 90 };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return respond({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const raw = await request.text();
    const signature = request.headers.get('x-healen-signature') ?? '';
    if (!sharedSecret || !(await verifyHmacHex(sharedSecret, raw, signature))) {
      return respond({ error: 'UNAUTHORIZED' }, 401);
    }
    const envelope: unknown = JSON.parse(raw);
    assertFreshEnvelope(envelope);

    const expiresAt = envelope.expiresAt;
    const { data: registered, error: registerError } = await admin.rpc('portal_core_register_request', {
      p_request_id: envelope.requestId,
      p_portal_user_id: envelope.portalUserId,
      p_client_id: envelope.basicsClientId,
      p_action: envelope.action,
      p_expires_at: expiresAt,
    });
    if (registerError || registered !== true) return respond({ error: 'REQUEST_REJECTED' }, 403);

    if (envelope.action === 'create_checkout') return respond({ data: await createCheckout(envelope) }, 201);
    if (envelope.action === 'payment_status') return respond({ data: await paymentStatus(envelope) });
    if (envelope.action === 'document_upload_prepare') return respond({ data: await prepareDocumentUpload(envelope) }, 201);
    if (envelope.action === 'document_upload_complete') return respond({ data: await completeDocumentUpload(envelope) });
    if (envelope.action === 'document_url') return respond({ data: await documentUrl(envelope) });

    const rpcName = {
      home: 'portal_core_get_home',
      treatment: 'portal_core_get_treatment',
      progress: 'portal_core_get_progress',
      appointments: 'portal_core_get_appointments',
      documents: 'portal_core_get_documents',
      packages: 'portal_core_get_packages',
      billing: 'portal_core_get_billing',
      rewards: 'portal_core_get_rewards',
      submit_checkin: 'portal_core_submit_checkin',
      request_appointment: 'portal_core_request_appointment',
      confirm_appointment: 'portal_core_confirm_appointment',
      request_profile_change: 'portal_core_request_profile_change',
      request_records: 'portal_core_request_records',
      redeem_reward: 'portal_core_redeem_reward',
    }[envelope.action];
    if (!rpcName) return respond({ error: 'ACTION_NOT_AVAILABLE' }, 400);
    const rpcParams: Record<string, unknown> = {
      p_client_id: envelope.basicsClientId,
      p_portal_user_id: envelope.portalUserId,
      p_request_id: envelope.requestId,
    };
    if (!['home', 'treatment', 'appointments', 'documents', 'packages', 'billing', 'rewards', 'request_records'].includes(envelope.action)) {
      rpcParams.p_params = envelope.params ?? {};
    }
    const { data, error } = await admin.rpc(rpcName, rpcParams);
    if (error) throw error;
    const safeData = envelope.action === 'packages' && Array.isArray(data)
      ? data.map((item) => ({ ...item, eligible: Boolean(item?.eligible) && Boolean(Deno.env.get('BOLD_IDENTITY_KEY')) }))
      : data;
    return respond({ data: safeData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    if (error instanceof HttpError) return respond({ error: error.message }, error.status);
    if (error instanceof DocumentError) return respond({ error: error.message }, error.status);
    return respond({ error: message === 'EXPIRED_ENVELOPE' ? message : 'INTEGRATION_ERROR' },
      message === 'EXPIRED_ENVELOPE' ? 401 : 500);
  }
});
