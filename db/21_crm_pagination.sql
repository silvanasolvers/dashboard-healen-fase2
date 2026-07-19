-- ============================================================
-- HEALEN OS · 21 · Lectura paginada y ligera del CRM
-- ============================================================
-- La lista deja de materializar identidades y miles de filas en el browser.
-- Esta RPC pagina, busca, filtra y calcula métricas en PostgreSQL. El detalle
-- individual sigue disponible en v_crm_contacts cuando realmente se abre.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

alter table crm_contacts
  add column if not exists search_text text
  generated always as (
    lower(
      coalesce(display_name, '') || ' ' ||
      coalesce(primary_phone, '') || ' ' ||
      coalesce(primary_email, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(last_summary, '')
    )
  ) stored;

create index if not exists idx_crm_contacts_active_sort
  on crm_contacts(last_contact_at desc nulls last, lower(display_name), id) where active;

create index if not exists idx_crm_contacts_active_name
  on crm_contacts(lower(display_name), id) where active;

-- pg_trgm suele vivir en `extensions` en Supabase, pero instalaciones antiguas
-- pueden tenerlo en `public`. Resolver el opclass real evita que la migración
-- falle o mueva una extensión compartida por otros módulos.
do $$
declare v_trgm_schema text;
begin
  select n.nspname into v_trgm_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_trgm_schema is null then
    raise exception 'No se pudo resolver el esquema de pg_trgm';
  end if;

  execute format(
    'create index if not exists idx_crm_contacts_search on crm_contacts using gin (search_text %I.gin_trgm_ops) where active',
    v_trgm_schema
  );
end $$;

create index if not exists idx_crm_opportunities_contact_latest
  on crm_opportunities(contact_id, updated_at desc, created_at desc, id desc)
  where active;

create or replace function crm_list_contacts(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default null,
  p_contact_type text default 'all',
  p_stage text default 'all'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 250));
  v_offset bigint;
  v_search text := left(nullif(trim(coalesce(p_search, '')), ''), 200);
  v_search_pattern text;
  v_type text := lower(trim(coalesce(p_contact_type, 'all')));
  v_stage text := lower(trim(coalesce(p_stage, 'all')));
  v_result jsonb;
begin
  perform require_staff();
  v_offset := (v_page::bigint - 1) * v_page_size::bigint;
  v_search_pattern := case when v_search is null then null else
    '%' || replace(replace(replace(lower(v_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  with treatment_stats as materialized (
    select
      t.client_id,
      count(*)::integer as treatment_count,
      count(*) filter (where t.status in ('activo','por_finalizar'))::integer as active_treatment_count
    from treatments t
    group by t.client_id
  ), current_opportunity as materialized (
    select distinct on (o.contact_id)
      o.contact_id,
      o.stage,
      o.next_action_at
    from crm_opportunities o
    where o.active
    order by o.contact_id, o.updated_at desc, o.created_at desc, o.id desc
  ), base as materialized (
    select
      c.id,
      case
        when lower(trim(c.display_name)) in (
          'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
          'sin nombre', 'unknown'
        ) and nullif(trim(client.full_name), '') is not null
          then client.full_name
        else c.display_name
      end as display_name,
      c.primary_phone,
      c.primary_email,
      c.city,
      case
        when coalesce(ts.treatment_count, 0) > 0 then 'patient'::crm_contact_type
        when c.contact_type = 'patient' then 'lead'::crm_contact_type
        else c.contact_type
      end as contact_type,
      case
        when coalesce(ts.treatment_count, 0) = 0 and c.lifecycle_stage = 'patient' then 'lead'
        else c.lifecycle_stage
      end as lifecycle_stage,
      c.client_id,
      client.code as client_code,
      client.full_name as client_name,
      (coalesce(ts.treatment_count, 0) > 0) as has_treatment,
      coalesce(ts.treatment_count, 0)::integer as treatment_count,
      coalesce(ts.active_treatment_count, 0)::integer as active_treatment_count,
      case when coalesce(ts.treatment_count, 0) > 0 then 'matched' else c.match_status end as match_status,
      c.match_method,
      c.match_confidence,
      c.first_contact_at,
      c.last_contact_at,
      c.last_summary,
      c.tags,
      c.owner_id,
      owner.full_name as owner_name,
      c.active,
      c.lock_version,
      c.created_at,
      c.updated_at,
      coalesce(co.stage, 'unclassified'::crm_opportunity_stage) as current_opportunity_stage,
      co.next_action_at,
      c.search_text
    from crm_contacts c
    left join clients client on client.id = c.client_id
    left join profiles owner on owner.id = c.owner_id
    left join treatment_stats ts on ts.client_id = c.client_id
    left join current_opportunity co on co.contact_id = c.id
    where c.active
  ), useful as materialized (
    select * from base b
    where (
        nullif(trim(b.display_name), '') is not null
        and lower(trim(b.display_name)) not in (
          'contacto whatsapp', 'contacto sin nombre', 'whatsapp contact',
          'sin nombre', 'unknown'
        )
      )
      or nullif(trim(b.primary_phone), '') is not null
      or nullif(trim(b.primary_email), '') is not null
  ), filtered as materialized (
    select * from useful u
    where (
      v_search is null
      or u.search_text ilike v_search_pattern escape '\'
      or lower(array_to_string(coalesce(u.tags, '{}'::text[]), ' ')) ilike v_search_pattern escape '\'
      or lower(coalesce(u.client_name, '')) ilike v_search_pattern escape '\'
      or lower(coalesce(u.owner_name, '')) ilike v_search_pattern escape '\'
    )
    and (
      v_type = 'all'
      or (v_type = 'patients' and u.has_treatment)
      or (v_type <> 'patients' and not u.has_treatment and u.contact_type::text = v_type)
    )
    and (v_stage = 'all' or u.current_opportunity_stage::text = v_stage)
  ), paged_ids as materialized (
    select * from filtered
    order by last_contact_at desc nulls last, lower(display_name), id
    offset v_offset limit v_page_size
  ), opportunity_stats as materialized (
    select
      o.contact_id,
      count(*)::integer as opportunity_count,
      count(*) filter (where o.active and o.stage not in ('converted','lost'))::integer as open_opportunity_count
    from crm_opportunities o
    join paged_ids p on p.id = o.contact_id
    group by o.contact_id
  ), paged as materialized (
    select
      p.*,
      coalesce(os.opportunity_count, 0)::integer as opportunity_count,
      coalesce(os.open_opportunity_count, 0)::integer as open_opportunity_count
    from paged_ids p
    left join opportunity_stats os on os.contact_id = p.id
  ), totals as (
    select
      (select count(*)::integer from useful) as contacts,
      (select count(*)::integer from useful where not has_treatment and contact_type = 'lead') as leads,
      (select count(*)::integer from useful where has_treatment) as patients,
      (select count(*)::integer from useful
        where not has_treatment and contact_type = 'lead'
          and current_opportunity_stage not in ('lost','converted')) as active_pipeline,
      (select count(*)::integer from crm_import_candidates
        where status = 'pending' and candidate_type <> 'contact_upsert') as reviews,
      (select count(*)::integer from filtered) as filtered_total,
      (select count(*)::integer from paged) as returned
  )
  select jsonb_build_object(
    'ok', true,
    'page', v_page,
    'page_size', v_page_size,
    'filtered_total', totals.filtered_total,
    'has_more', (v_offset + totals.returned) < totals.filtered_total,
    'counts', jsonb_build_object(
      'contacts', totals.contacts,
      'leads', totals.leads,
      'patients', totals.patients,
      'active_pipeline', totals.active_pipeline,
      'reviews', totals.reviews
    ),
    'contacts', coalesce((
      select jsonb_agg((to_jsonb(p) - 'search_text') order by p.last_contact_at desc nulls last, lower(p.display_name), p.id)
      from paged p
    ), '[]'::jsonb)
  ) into v_result
  from totals;

  return v_result;
end $$;

comment on function crm_list_contacts(integer, integer, text, text, text) is
  'Lista CRM paginada (máximo 250), con filtros server-side y sin identidades pesadas.';

revoke all on function crm_list_contacts(integer, integer, text, text, text) from public, anon;
grant execute on function crm_list_contacts(integer, integer, text, text, text) to authenticated;
