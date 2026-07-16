-- ============================================================
-- HEALEN OS · 18 · Hardening de vistas CRM
--
-- Supabase puede aplicar default privileges a vistas nuevas. Cerramos de
-- forma explícita cualquier SELECT heredado para anon/PUBLIC y conservamos
-- acceso únicamente para staff autenticado, bajo security_invoker + RLS.
-- ============================================================

begin;

revoke all on v_crm_contacts, v_crm_review_queue from public, anon;
grant select on v_crm_contacts, v_crm_review_queue to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.v_crm_contacts', 'SELECT')
     or has_table_privilege('anon', 'public.v_crm_review_queue', 'SELECT') then
    raise exception 'Hardening CRM incompleto: anon conserva SELECT sobre vistas CRM';
  end if;
  if not has_table_privilege('authenticated', 'public.v_crm_contacts', 'SELECT')
     or not has_table_privilege('authenticated', 'public.v_crm_review_queue', 'SELECT') then
    raise exception 'Hardening CRM incompleto: authenticated perdió acceso a vistas CRM';
  end if;
end $$;

commit;
