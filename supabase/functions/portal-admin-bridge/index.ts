import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createAdminEnvelope, hmacHex, type AdminAction } from '../_shared/portal-integration.ts';

const basicsUrl = Deno.env.get('SUPABASE_URL')!;
const basicsAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const basicsServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const portalAdminUrl = Deno.env.get('PORTAL_ADMIN_URL')!;
const sharedSecret = Deno.env.get('PORTAL_ADMIN_SHARED_SECRET')!;
const dashboardOrigins = new Set(
  (Deno.env.get('DASHBOARD_ORIGINS') ?? Deno.env.get('DASHBOARD_ORIGIN') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const provisioningEnabled = Deno.env.get('PORTAL_PROVISIONING_ENABLED') === 'true';
const canaryClientIds = new Set((Deno.env.get('PORTAL_CANARY_CLIENT_IDS') ?? '').split(',').map((value) => value.trim()).filter(Boolean));
const admin = createClient(basicsUrl, basicsServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function response(body: unknown, status = 200, requestOrigin?: string) {
  const allowedOrigin = requestOrigin && dashboardOrigins.has(requestOrigin)
    ? requestOrigin
    : [...dashboardOrigins][0] ?? 'https://dashboard-healen-fase2.solversai.cloud';
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS', 'vary': 'origin',
  } });
}

function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-_';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return `Hn!${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}7a`;
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get('origin') ?? undefined;
  if (requestOrigin && !dashboardOrigins.has(requestOrigin)) {
    return response({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  }
  const respond = (body: unknown, status = 200) => response(body, status, requestOrigin);
  if (request.method === 'OPTIONS') return respond({ ok: true });
  if (request.method !== 'POST') return respond({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) return respond({ error: 'UNAUTHORIZED' }, 401);
    const staffClient = createClient(basicsUrl, basicsAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await staffClient.auth.getUser();
    if (authError || !authData.user) return respond({ error: 'UNAUTHORIZED' }, 401);
    const { data: profile } = await admin.from('profiles').select('role,active').eq('id', authData.user.id).maybeSingle();
    if (!profile?.active || !['admin', 'medico'].includes(profile.role)) return respond({ error: 'FORBIDDEN' }, 403);

    const body = await request.json() as {
      action?: AdminAction;
      basicsClientId?: string;
      email?: string;
      entitlement?: string;
    };
    if (!body.action || !['provision', 'status', 'suspend', 'revoke'].includes(body.action) ||
        !/^[0-9a-f-]{36}$/i.test(body.basicsClientId ?? '')) {
      return respond({ error: 'INVALID_REQUEST' }, 400);
    }
    const { data: patient } = await admin.from('clients').select('id,active').eq('id', body.basicsClientId!).maybeSingle();
    if (!patient || (body.action === 'provision' && !patient.active)) {
      return respond({ error: 'PATIENT_NOT_AVAILABLE' }, 404);
    }
    if (body.action === 'provision' && !['active_full', 'purchased_pending_setup', 'former_limited', 'suspended'].includes(body.entitlement ?? '')) {
      return respond({ error: 'INVALID_ENTITLEMENT' }, 400);
    }
    if (body.action === 'provision' && !provisioningEnabled && !canaryClientIds.has(body.basicsClientId!)) {
      return respond({ error: 'PROVISIONING_LOCKED' }, 503);
    }
    const password = body.action === 'provision' ? temporaryPassword() : undefined;
    const envelope = createAdminEnvelope(body.action, body.basicsClientId!, {
      email: body.email,
      temporaryPassword: password,
      entitlement: body.entitlement,
    });
    const raw = JSON.stringify(envelope);
    const signature = await hmacHex(sharedSecret, raw);
    const portalResponse = await fetch(portalAdminUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-healen-signature': signature },
      body: raw,
    });
    const portalPayload = await portalResponse.json().catch(() => ({ error: 'INVALID_PORTAL_RESPONSE' }));
    if (!portalResponse.ok) return respond(portalPayload, portalResponse.status);
    return respond({ ...portalPayload, ...(password ? { temporaryPassword: password } : {}) }, portalResponse.status);
  } catch {
    return respond({ error: 'PORTAL_ADMIN_BRIDGE_ERROR' }, 500);
  }
});
