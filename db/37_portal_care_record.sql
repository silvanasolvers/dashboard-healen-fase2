begin;
create table if not exists public.portal_patient_summaries (
 client_id uuid primary key references public.clients(id),
 recorded_on date not null,
 source_label text not null,
 source_hash text not null,
 sections jsonb not null default '[]' check(jsonb_typeof(sections)='array'),
 measurements jsonb not null default '[]' check(jsonb_typeof(measurements)='array'),
 review_notes jsonb not null default '[]' check(jsonb_typeof(review_notes)='array'),
 published_at timestamptz not null default now()
);
create table if not exists public.portal_item_publications (
 item_id uuid primary key references public.treatment_items(id),
 source_hash text not null,
 title text not null,
 recorded_amount text,
 recorded_schedule text,
 recorded_route text,
 review_note text not null,
 published_at timestamptz not null default now()
);
alter table public.portal_patient_summaries enable row level security;
alter table public.portal_item_publications enable row level security;
revoke all on public.portal_patient_summaries,public.portal_item_publications from anon,authenticated;
grant all on public.portal_patient_summaries,public.portal_item_publications to service_role;

create or replace function public.portal_core_care_record(p_client_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'summary',(select jsonb_build_object('recordedOn',s.recorded_on,'sourceLabel',s.source_label,
   'sourceChanged',s.source_hash<>md5(coalesce(c.notes,'')),
   'sections',s.sections,'measurements',s.measurements,'reviewNotes',s.review_notes,
   'publishedAt',s.published_at) from public.portal_patient_summaries s join public.clients c on c.id=s.client_id where s.client_id=p_client_id),
 'plans',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',tp.title,
   'startsOn',t.start_date,'endsOn',t.end_date,
   'status',case when t.status::text='finalizado' then 'completed' when t.end_date<current_date then 'period_ended'
     when t.status::text in ('activo','por_finalizar') then 'open_record' else 'recorded' end,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',ip.title,
     'amount',ip.recorded_amount,'schedule',ip.recorded_schedule,'route',ip.recorded_route,
     'reviewNote',ip.review_note,'sourceChanged',ip.source_hash<>md5(concat_ws('|',i.name,i.dose,i.schedule,i.route,i.instructions))) order by i.created_at,i.id)
    from public.treatment_items i join public.portal_item_publications ip on ip.item_id=i.id where i.treatment_id=t.id),'[]'::jsonb))
    order by case when t.status::text in ('activo','por_finalizar') and (t.end_date is null or t.end_date>=current_date) then 0 else 1 end,t.start_date desc nulls last,t.id)
   from public.treatments t join public.portal_treatment_publications tp on tp.treatment_id=t.id
   where t.client_id=p_client_id and exists(select 1 from public.treatment_items i join public.portal_item_publications ip on ip.item_id=i.id where i.treatment_id=t.id)),'[]'::jsonb)
 );
$$;
revoke all on function public.portal_core_care_record(uuid) from public,anon,authenticated;
grant execute on function public.portal_core_care_record(uuid) to service_role;

create or replace function public.portal_core_get_home(p_client_id uuid,p_portal_user_id uuid,p_request_id uuid)
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
 into history from public.treatments t join public.portal_treatment_publications p on p.treatment_id=t.id where t.client_id=p_client_id;
 return result || jsonb_build_object('identity',(result->'identity')||identity_extra,'treatmentHistory',history,
  'careRecord',public.portal_core_care_record(p_client_id));
end;
$$;
notify pgrst,'reload schema';
commit;
