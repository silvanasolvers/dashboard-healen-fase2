import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { assertFreshEnvelope, verifyHmacHex } from '../_shared/portal-integration.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sharedSecret = Deno.env.get('PORTAL_CORE_SHARED_SECRET')!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
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

    const rpcName = {
      home: 'portal_core_get_home',
      treatment: 'portal_core_get_treatment',
      appointments: 'portal_core_get_appointments',
    }[envelope.action];
    const { data, error } = await admin.rpc(rpcName, {
      p_client_id: envelope.basicsClientId,
      p_portal_user_id: envelope.portalUserId,
      p_request_id: envelope.requestId,
    });
    if (error) throw error;
    return respond({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    return respond({ error: message === 'EXPIRED_ENVELOPE' ? message : 'INTEGRATION_ERROR' },
      message === 'EXPIRED_ENVELOPE' ? 401 : 500);
  }
});
