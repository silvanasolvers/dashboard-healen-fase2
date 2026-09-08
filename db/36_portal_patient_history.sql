begin;
-- Explicit editorial publication; never expose raw treatment names or clinical notes.
create table if not exists public.portal_treatment_publications (
 treatment_id uuid primary key references public.treatments(id),
 title text not null check(length(title) between 1 and 200),
 published_at timestamptz not null default now(),
 publication_note text not null default 'Historial autorizado por administración; no constituye una indicación vigente'
);
alter table public.portal_treatment_publications enable row level security;
revoke all on public.portal_treatment_publications from anon,authenticated;
grant all on public.portal_treatment_publications to service_role;

-- Preserve the existing audited home contract and enrich its allowlisted output.
alter function public.portal_core_get_home(uuid,uuid,uuid) rename to portal_core_get_home_before_history;
create function public.portal_core_get_home(p_client_id uuid,p_portal_user_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; identity_extra jsonb; history jsonb;
begin
 result:=public.portal_core_get_home_before_history(p_client_id,p_portal_user_id,p_request_id);
 select jsonb_strip_nulls(jsonb_build_object('code',c.code,'documentId',c.document_id,'birthdate',c.birthdate))
 into identity_extra from public.clients c where c.id=p_client_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',p.title,'startsOn',t.start_date,
  'endsOn',t.end_date,'status',case when t.status::text='finalizado' then 'completed'
   when t.end_date<current_date then 'period_ended' else 'registered' end,
  'publishedAt',p.published_at) order by t.start_date desc nulls last),'[]'::jsonb)
 into history from public.treatments t join public.portal_treatment_publications p on p.treatment_id=t.id
 where t.client_id=p_client_id;
 return result || jsonb_build_object('identity',(result->'identity')||identity_extra,'treatmentHistory',history);
end;
$$;
revoke all on function public.portal_core_get_home(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.portal_core_get_home(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
