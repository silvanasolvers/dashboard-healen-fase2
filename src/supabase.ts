import { createClient } from '@supabase/supabase-js';

// La anon key es pública (RLS protege). Fallback embebido para correr sin .env.
const url =
  import.meta.env.VITE_SUPABASE_URL || 'https://densirbwpzsmugoeramc.supabase.co';
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbnNpcmJ3cHpzbXVnb2VyYW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDMzNTYsImV4cCI6MjA5NzkxOTM1Nn0.qBCN-MXGX8rdm2dieVovvuQpaATchdRfZx6pZ0Jus4I';

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
