export const corsHeaders = {
  'access-control-allow-origin': Deno.env.get('PORTAL_ORIGIN') ?? 'https://portal.healen.co',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-bold-signature',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
