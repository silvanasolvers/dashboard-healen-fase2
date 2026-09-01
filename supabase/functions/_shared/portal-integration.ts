export type CoreAction =
  | 'home'
  | 'treatment'
  | 'progress'
  | 'appointments'
  | 'documents'
  | 'packages'
  | 'billing'
  | 'create_checkout'
  | 'payment_status'
  | 'rewards'
  | 'submit_checkin'
  | 'request_appointment'
  | 'confirm_appointment'
  | 'request_profile_change'
  | 'request_records'
  | 'redeem_reward'
  | 'document_upload_prepare'
  | 'document_upload_complete'
  | 'document_url';

const coreActions: CoreAction[] = [
  'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
  'billing', 'create_checkout', 'payment_status', 'rewards', 'submit_checkin', 'request_appointment',
  'confirm_appointment', 'request_profile_change', 'request_records',
  'redeem_reward', 'document_upload_prepare', 'document_upload_complete', 'document_url',
];

export type IntegrationEnvelope = {
  version: 1;
  requestId: string;
  portalUserId: string;
  basicsClientId: string;
  action: CoreAction;
  params: Record<string, unknown>;
  issuedAt: string;
  expiresAt: string;
};

export type AdminAction = 'provision' | 'status' | 'suspend' | 'revoke';

export type AdminEnvelope = {
  version: 1;
  requestId: string;
  action: AdminAction;
  basicsClientId: string;
  email?: string;
  temporaryPassword?: string;
  entitlement?: string;
  issuedAt: string;
  expiresAt: string;
};

const encoder = new TextEncoder();

export async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyHmacHex(secret: string, body: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = await hmacHex(secret, body);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.toLowerCase().charCodeAt(index);
  }
  return difference === 0;
}

export function assertFreshEnvelope(value: unknown, now = Date.now()): asserts value is IntegrationEnvelope {
  const envelope = value as Partial<IntegrationEnvelope> | null;
  if (!envelope || envelope.version !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.requestId ?? '') ||
      !/^[0-9a-f-]{36}$/i.test(envelope.portalUserId ?? '') ||
      !/^[0-9a-f-]{36}$/i.test(envelope.basicsClientId ?? '') ||
      !coreActions.includes(envelope.action as CoreAction)) {
    throw new Error('INVALID_ENVELOPE');
  }
  const issued = Date.parse(envelope.issuedAt ?? '');
  const expires = Date.parse(envelope.expiresAt ?? '');
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 5_000 ||
      expires <= now || expires - issued > 60_000) {
    throw new Error('EXPIRED_ENVELOPE');
  }
}

export function createAdminEnvelope(
  action: AdminAction,
  basicsClientId: string,
  fields: Pick<AdminEnvelope, 'email' | 'temporaryPassword' | 'entitlement'> = {},
  now = new Date(),
) {
  return {
    version: 1 as const,
    requestId: crypto.randomUUID(),
    action,
    basicsClientId,
    ...fields,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  } satisfies AdminEnvelope;
}
