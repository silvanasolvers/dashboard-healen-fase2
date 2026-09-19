import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

export async function requirePortalUser(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization) throw new Error('UNAUTHORIZED');
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) throw new Error('UNAUTHORIZED');
  const { data: access } = await admin.from('portal_patient_access').select('client_id, portal_accounts!inner(status)').eq('auth_user_id', data.user.id).eq('relationship_role', 'self').eq('status', 'active').maybeSingle();
  if (!access || (access.portal_accounts as unknown as { status: string }).status !== 'active') throw new Error('FORBIDDEN');
  return { user: data.user, clientId: access.client_id as string };
}
