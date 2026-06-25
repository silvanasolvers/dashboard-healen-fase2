-- ============================================================
-- HEALEN OS · 08 · Hardening de seguridad (post-revisión)
-- Cierra el P0: en Postgres toda función nueva tiene EXECUTE para PUBLIC.
-- Como las RPCs son SECURITY DEFINER (saltan RLS), anon podía mutar la base.
-- Doble defensa: (1) revocar EXECUTE de anon/PUBLIC; (2) cada mutador llama
-- require_staff() internamente (ver 01/03/07) y bloquea a autenticados sin perfil.
-- DEBE correr DESPUÉS de 01–07.
-- ============================================================

-- 1) Quitar el EXECUTE por defecto (PUBLIC) y el de anon en TODO el esquema.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- 1b) Mínimo privilegio: anon no debe tener escritura sobre ninguna tabla/vista
--     (grants colgantes por defecto de Supabase; inertes hoy por RLS + vistas no
--      actualizables, pero se revocan explícitamente por higiene).
revoke insert, update, delete, truncate on all tables in schema public from anon;

-- 2) Re-otorgar SOLO los helpers puros que las vistas (security_invoker) y la RLS
--    necesitan evaluar como el rol que consulta.
grant execute on function signal_by_days(integer) to anon, authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function require_staff() to authenticated;

-- 3) Las RPCs de usuario siguen otorgadas a authenticated (grants de 05/07) y ahora
--    cada una valida require_staff(); un autenticado sin perfil de staff recibe 42501.
--    Las internas (_consume_fefo, recompute_sale_status) solo se invocan desde otras
--    funciones DEFINER (corren como owner), así que no necesitan grant externo.
