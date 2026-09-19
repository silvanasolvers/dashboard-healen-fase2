-- Extend the existing signed server-to-server contract; no public clinical endpoint.
begin;
create or replace function public.portal_core_get_progress(p_client_id uuid,p_portal_user_id uuid,p_request_id uuid,p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare days integer:=case p_params->>'range' when '30d' then 30 when '180d' then 180 else 90 end; result jsonb;
begin
 if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'progress') then raise exception 'Solicitud inválida' using errcode='42501';end if;
 select coalesce(jsonb_agg(x.value order by x.recorded_at),'[]') into result from (
  select m.recorded_at,jsonb_build_object('key',m.metric_key,'label',m.label,'value',m.value,'unit',m.unit,'recordedAt',m.recorded_at,'sourceKind','published_metric','sourceId',m.id) value
  from public.portal_progress_metrics m where m.client_id=p_client_id and m.validated and m.recorded_at>=now()-make_interval(days=>days)
  union all
  select o.recorded_at,jsonb_build_object('key','symptom:'||o.symptom_code||':'||o.dimension,'label',o.label||' · '||case o.dimension when 'severity_7d' then 'Intensidad' when 'frequency_7d' then 'Días con molestias' else 'Interferencia' end,'value',o.value,'unit',o.unit,'recordedAt',o.recorded_at,'region',o.body_region,'laterality',o.laterality,'sourceKind',o.source_kind,'sourceId',o.id,'dimension',o.dimension,'instrument',o.instrument,'instrumentVersion',o.instrument_version,'recallDays',o.recall_days,'respondentRole',o.respondent_role)
  from healen_clinical.observations o join healen_clinical.submissions s on s.id=o.submission_id where s.client_id=p_client_id and s.state='published' and o.value is not null and o.recorded_at>=now()-make_interval(days=>days)
 ) x;
 insert into public.portal_core_access_audit(request_id,portal_user_id,client_id,action) values(p_request_id,p_portal_user_id,p_client_id,'progress');
 return result;
end$$;
revoke all on function public.portal_core_get_progress(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.portal_core_get_progress(uuid,uuid,uuid,jsonb) to service_role;
commit;
