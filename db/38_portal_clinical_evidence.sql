begin;

-- Patient-safe excerpts, not raw documents, prescriptions or staff notes.
-- Values quoted in a guide are documentary evidence, never validated lab results.
create table if not exists public.portal_clinical_reports (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 source_key text not null,
 title text not null,
 source_label text not null,
 document_date date,
 date_label text,
 summary text not null,
 observations jsonb not null default '[]' check(jsonb_typeof(observations)='array'),
 findings jsonb not null default '[]' check(jsonb_typeof(findings)='array'),
 goals jsonb not null default '[]' check(jsonb_typeof(goals)='array'),
 limitations jsonb not null default '[]' check(jsonb_typeof(limitations)='array'),
 published_at timestamptz not null default now(),
 unique(client_id,source_key),
 check(octet_length(observations::text)+octet_length(findings::text)+octet_length(goals::text)+octet_length(limitations::text)<65536)
);
alter table public.portal_clinical_reports enable row level security;
revoke all on public.portal_clinical_reports from public,anon,authenticated;
grant all on public.portal_clinical_reports to service_role;

do $$ begin
 if to_regprocedure('public.portal_core_care_record_before_evidence(uuid)') is null then
  alter function public.portal_core_care_record(uuid) rename to portal_core_care_record_before_evidence;
 end if;
end $$;

create or replace function public.portal_core_care_record(p_client_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.portal_core_care_record_before_evidence(p_client_id) || jsonb_build_object(
  'reports',coalesce((select jsonb_agg(jsonb_build_object(
   'id',r.id,'title',r.title,'sourceLabel',r.source_label,
   'documentDate',r.document_date,'dateLabel',r.date_label,'summary',r.summary,
   'observations',r.observations,'findings',r.findings,'goals',r.goals,
   'limitations',r.limitations,'publishedAt',r.published_at
  ) order by r.document_date desc nulls last,r.id)
  from public.portal_clinical_reports r where r.client_id=p_client_id),'[]'::jsonb));
$$;
revoke all on function public.portal_core_care_record_before_evidence(uuid) from public,anon,authenticated;
revoke all on function public.portal_core_care_record(uuid) from public,anon,authenticated;
grant execute on function public.portal_core_care_record(uuid) to service_role;
notify pgrst,'reload schema';
commit;
