-- ============================================================
-- HEALEN OS · 24 · Visibilidad de atenciones finalizadas recientes
--
-- Mantiene los planes activos/por finalizar y agrega la última atención
-- finalizada de los últimos 7 días cuando el paciente no tiene un plan activo.
-- Oportunidades cerradas/no interesadas permanecen fuera del tablero clínico.
-- ============================================================

begin;

create or replace view public.v_dashboard_patients as
select
  c.code                                              as id,
  c.full_name                                         as name,
  c.document_id                                       as "documentId",
  t.name                                              as plan,
  coalesce(t.sale_price, 0)                           as "saleValue",
  case
    when coalesce(fin.total_sales, 0) >= 8000000 then 'VIP'
    when coalesce(fin.total_sales, 0) >= 4000000 then 'Alto'
    when coalesce(fin.total_sales, 0) >= 1500000 then 'Medio'
    else 'Basico'
  end                                                 as tier,
  t.start_date                                        as "startDate",
  coalesce(t.end_date, current_date)                  as "endDate",
  case when t.end_date is null then 0 else greatest((t.end_date - current_date), 0) end as "daysLeft",
  greatest(coalesce(t.end_date, current_date) - t.start_date, 1) as "totalDays",
  coalesce(t.weekly_serum, false)                     as "weeklySerum",
  coalesce(t.serum_day, '-')                          as "serumDay",
  case
    when t.status = 'por_finalizar' then 'Por finalizar'
    when t.status = 'finalizado' then 'Finalizado'
    else 'Activo'
  end                                                 as status,
  c.id                                                as "clientUuid",
  t.id                                                as "treatmentId",
  coalesce(pep.items, '[]'::jsonb)                    as peptides,
  c.phone                                             as phone,
  c.email                                             as email,
  latest.service_date                                 as "lastAttentionDate",
  latest.service_name                                 as "lastAttentionService"
from clients c
join lateral (
  select tr.*
  from treatments tr
  where tr.client_id = c.id
    and (
      tr.status in ('activo', 'por_finalizar')
      or (
        tr.status = 'finalizado'
        and tr.start_date between current_date - 6 and current_date
        and tr.name not ilike '%oportunidad cerrada%'
        and tr.name not ilike '%no interesado%'
      )
    )
  order by
    case tr.status
      when 'activo' then 1
      when 'por_finalizar' then 2
      else 3
    end,
    tr.end_date desc nulls last,
    tr.created_at desc
  limit 1
) t on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'name', ti.name,
    'dose', coalesce(ti.dose, ''),
    'route', ti.route,
    'endsInDays', greatest(coalesce(ti.ends_on, current_date) - current_date, 0),
    'status', case ti.status
      when 'por_finalizar' then 'Por finalizar'
      when 'finalizado' then 'Finalizado'
      else 'Activo'
    end
  ) order by ti.ends_on, ti.name) as items
  from treatment_items ti
  join treatments tr_items on tr_items.id = ti.treatment_id
  where tr_items.client_id = c.id
    and tr_items.status in ('activo', 'por_finalizar')
    and ti.product_id is not null
    and ti.status in ('activo', 'por_finalizar')
) pep on true
left join lateral (
  select coalesce(sum(s.total), 0) as total_sales
  from sales s
  where s.client_id = c.id and s.status <> 'anulada'
) fin on true
left join lateral (
  select tr_last.start_date as service_date, tr_last.name as service_name
  from treatments tr_last
  where tr_last.client_id = c.id
    and tr_last.start_date <= current_date
    and tr_last.name not ilike 'Seguimiento%'
  order by tr_last.start_date desc, tr_last.created_at desc
  limit 1
) latest on true
where c.active
order by c.code;

comment on view public.v_dashboard_patients is
  'Pacientes con tratamiento activo/por finalizar y atenciones finalizadas de los últimos 7 días. Los servicios recientes conservan estado Finalizado y no generan alerta de recompra.';

alter view public.v_dashboard_patients set (security_invoker = on);

commit;
