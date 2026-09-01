import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function hexHmac(message: string, secret: string) {
  const raw = new TextEncoder().encode(message);
  let binary = ''; for (const byte of raw) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base64));
  return Array.from(new Uint8Array(signed)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const raw = await request.text();
  const signature = request.headers.get('x-bold-signature') ?? '';
  const secret = Deno.env.get('BOLD_SECRET_KEY');
  if (secret === undefined) return json({ error: 'WEBHOOK_NOT_CONFIGURED' }, 503);
  const expected = await hexHmac(raw, secret);
  if (!timingSafeEqual(signature.toLowerCase(), expected)) return json({ error: 'INVALID_SIGNATURE' }, 401);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'INVALID_JSON' }, 400); }
  const work = admin.rpc('portal_process_bold_event', { p_payload: payload, p_payload_hash: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)).then((hash) => Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')) });
  // Bold exige respuesta en menos de dos segundos. El runtime mantiene esta promesa viva.
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions.
  if (globalThis.EdgeRuntime?.waitUntil) globalThis.EdgeRuntime.waitUntil(work); else await work;
  return json({ received: true });
});
