-- ============================================================
-- HEALEN OS · 05 · Seguridad: RLS por rol + grants RPC
-- El dashboard usa la ANON KEY + login de staff (signInWithPassword) y RLS
-- via is_staff(). La service role es SOLO backend/scripts y NUNCA va al browser.
-- IMPORTANTE: toda RPC de escritura es SECURITY DEFINER (salta RLS), por eso
-- valida require_staff() internamente (ver 01/03/07). El hardening de grants
-- está en 08_hardening.sql.
-- ============================================================

-- ---------- RLS en todas las tablas base ----------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','suppliers','products','inventory_lots','inventory_movements',
    'clients','treatments','treatment_items','treatment_dispensations',
    'sales','sale_items','payments','finance_entries'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists staff_all on %I;', t);
    execute format('create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff());', t);
  end loop;
end $$;

-- Un usuario siempre puede leer su propio perfil (para resolver su rol).
drop policy if exists self_read on profiles;
create policy self_read on profiles for select to authenticated using (id = auth.uid());

-- ---------- Vistas respetan RLS del que consulta ----------
do $$
declare v text;
begin
  foreach v in array array[
    'v_product_stock','v_low_stock','v_expiring_lots','v_inventory_ledger',
    'v_client_360','v_treatment_board','v_treatment_item_status',
    'v_accounts_receivable','v_finance_ledger','v_cashflow_summary'
  ] loop
    execute format('alter view %I set (security_invoker = on);', v);
  end loop;
end $$;

-- ---------- Grants (RPC + lectura para el rol authenticated) ----------
grant usage on schema public to authenticated, anon;
grant select on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Nota: 08_hardening.sql revoca después el EXECUTE de anon/PUBLIC para que
-- ningún usuario sin sesión pueda invocar las RPCs (que saltan RLS por ser DEFINER).
