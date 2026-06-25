-- ============================================================
-- HEALEN OS · 01 · Cimientos: enums, helpers, auditoría
-- Centro de medicina regenerativa. Esquema integrado:
-- clientes ↔ tratamientos ↔ inventario (por lotes, FEFO) ↔ dinero (margen auto).
-- ============================================================

-- Extensiones (idempotente)
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------- Enums de dominio ----------
do $$ begin
  create type app_role as enum ('admin', 'medico', 'recepcion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_category as enum ('peptido', 'suero', 'insumo', 'suplemento', 'otro');
exception when duplicate_object then null; end $$;

-- Tipo de movimiento de inventario. Positivos suman stock, negativos restan.
do $$ begin
  create type movement_kind as enum ('entrada', 'venta', 'dispensacion', 'salida', 'ajuste', 'merma');
exception when duplicate_object then null; end $$;

do $$ begin
  create type treatment_status as enum ('activo', 'por_finalizar', 'finalizado', 'cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_status as enum ('activo', 'por_finalizar', 'finalizado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_status as enum ('pendiente', 'parcial', 'pagada', 'vencida', 'anulada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type finance_kind as enum ('ingreso', 'gasto');
exception when duplicate_object then null; end $$;

-- Empresa = caja del negocio; retiro_socio/personal = no afecta utilidad operativa.
do $$ begin
  create type finance_scope as enum ('empresa', 'personal', 'retiro_socio', 'reembolso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('efectivo', 'transferencia', 'tarjeta_credito', 'tarjeta_debito', 'pse', 'nequi', 'daviplata', 'pendiente', 'otro');
exception when duplicate_object then null; end $$;

-- ---------- Helpers ----------
-- updated_at automático
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Semáforo por días restantes (verde/ámbar/rojo). Lenguaje central del sistema.
create or replace function signal_by_days(days integer)
returns text language sql immutable as $$
  select case
    when days is null then 'ok'
    when days <= 5 then 'danger'
    when days <= 12 then 'warn'
    else 'ok'
  end;
$$;

-- ¿El usuario actual es staff? Base para RLS de escritura.
-- plpgsql para diferir la resolución de public.profiles al runtime.
create or replace function is_staff()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role in ('admin','medico','recepcion')
  );
end $$;

-- Guarda de autorización para RPCs SECURITY DEFINER (que saltan RLS).
-- Bloquea a usuarios autenticados que NO son staff. No bloquea a la service role
-- ni al SQL directo (seed): en esos contextos auth.uid() es null.
create or replace function require_staff()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Bloquea anon (auth.role()='anon') y autenticados sin perfil de staff.
  -- No bloquea service role ni SQL directo (auth.role() null / auth.uid() null).
  if auth.role() = 'anon' or (auth.uid() is not null and not is_staff()) then
    raise exception 'No autorizado: se requiere un perfil de staff activo' using errcode = '42501';
  end if;
end $$;

comment on function signal_by_days is 'Semáforo Healen: <=5 danger, <=12 warn, resto ok. Usado en tratamientos e inventario.';
comment on function is_staff is 'True si auth.uid() es un perfil activo con rol de staff. Base de las políticas RLS de escritura.';
comment on function require_staff is 'Guarda interna para RPCs de escritura: lanza 42501 si el JWT es de un usuario autenticado sin perfil de staff. No afecta service role ni SQL directo.';
