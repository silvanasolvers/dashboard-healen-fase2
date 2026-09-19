-- Additive clinical reception. Apply once after 001_booking.sql; protocol approval is explicit.
begin;
create schema if not exists healen_clinical;
revoke all on schema healen_clinical from public,anon,authenticated;
alter table healen_booking.settings add column if not exists sensitive_text text not null default '';
alter table healen_booking.settings add column if not exists teleconsultation_text text not null default '';
alter table healen_booking.settings add column if not exists team_emails jsonb not null default '[]';
alter table healen_booking.resources add column if not exists gmail_connected boolean not null default false;
alter table healen_booking.services add column if not exists visit_type text not null default 'initial' check(visit_type in ('initial','followup'));
alter table healen_booking.services add column if not exists protocol_version text not null default '1.0.0';
create table healen_clinical.protocols(visit_type text not null,version text not null,definition jsonb not null,content_hash text not null,approved_by uuid references public.profiles(id),approved_at timestamptz,primary key(visit_type,version));
create table healen_clinical.drafts(id uuid primary key default gen_random_uuid(),token_hash text unique not null,service_id uuid not null references healen_booking.services,visit_type text not null,modality text not null,protocol_version text not null,answers jsonb not null default '{}',consents jsonb not null,revision integer not null default 0,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours');
create table healen_clinical.submissions(id uuid primary key default gen_random_uuid(),draft_id uuid not null,revision integer not null,service_id uuid not null references healen_booking.services,visit_type text not null,modality text not null,protocol_version text not null,answers jsonb not null,consents jsonb not null,client_id uuid references public.clients(id),reservation_id uuid unique references healen_booking.reservations(id),state text not null default 'identity_pending' check(state in ('identity_pending','pending_review','reviewed','published')),reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,review_note text,created_at timestamptz not null default now(),unique(draft_id,revision));
create table healen_clinical.observations(id uuid primary key default gen_random_uuid(),submission_id uuid not null references healen_clinical.submissions,symptom_code text not null,label text not null,dimension text not null,value numeric,missing_reason text,unit text not null,instrument text not null,instrument_version text not null,recall_days integer not null,body_region text,laterality text,respondent_role text not null,source_kind text not null default 'patient_report',recorded_at timestamptz not null default now());
create table healen_clinical.attachments(id uuid primary key default gen_random_uuid(),draft_id uuid not null,submission_id uuid references healen_clinical.submissions,original_name text not null,mime_type text not null,size_bytes bigint not null check(size_bytes between 1 and 10485760),storage_bucket text not null default 'patient-documents-quarantine',storage_path text unique not null,scan_status text not null default 'uploading' check(scan_status in ('uploading','pending','scanning','clean','infected','error')),scan_engine text,content_sha256 text,scan_error text,attempts integer not null default 0,lease_id uuid,lease_until timestamptz,available_at timestamptz not null default now(),created_at timestamptz not null default now());
create table healen_clinical.reminders(id uuid primary key default gen_random_uuid(),reservation_id uuid not null references healen_booking.reservations,recipient text not null,scheduled_start timestamptz not null,due_at timestamptz not null,state text not null default 'queued' check(state in ('queued','sending','accepted','cancelled','review')),lease_id uuid,lease_until timestamptz,attempts integer not null default 0,last_error text,gmail_id text,unique(reservation_id,recipient,scheduled_start));
create table healen_clinical.audit(id bigint generated always as identity primary key,actor text not null,action text not null,resource_id uuid,created_at timestamptz not null default now());
create index on healen_clinical.submissions(client_id,created_at desc);
create index on healen_clinical.reminders(due_at) where state='queued';
create index on healen_clinical.attachments(available_at) where scan_status in ('pending','scanning');
do $$declare t record;begin for t in select tablename from pg_tables where schemaname='healen_clinical' loop execute format('alter table healen_clinical.%I enable row level security',t.tablename);end loop;end$$;
revoke all on all tables in schema healen_clinical from public,anon,authenticated;

create function healen_clinical.project_documents(sid uuid) returns void language sql security definer set search_path=healen_clinical,public,pg_temp as $$
 insert into public.patient_documents(id,client_id,title,category,storage_bucket,storage_path,mime_type,size_bytes,original_name,uploaded_by_patient,visibility,review_status,scan_status,scan_engine,content_sha256,scan_completed_at)
 select a.id,s.client_id,a.original_name,'Cuestionario Healen',a.storage_bucket,a.storage_path,a.mime_type,a.size_bytes,a.original_name,true,'internal','pending_review',a.scan_status,a.scan_engine,a.content_sha256,now() from attachments a join submissions s on s.id=a.submission_id where s.id=sid and s.client_id is not null and a.scan_status='clean' on conflict(id) do nothing;
$$;
revoke all on function healen_clinical.project_documents(uuid) from public,anon,authenticated,service_role;

create function public.healen_clinical_rpc(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=healen_clinical,healen_booking,public,pg_temp as $$
#variable_conflict use_column
declare d drafts%rowtype; s submissions%rowtype; a attachments%rowtype; m reminders%rowtype; cfg healen_booking.settings%rowtype; svc healen_booking.services%rowtype; p protocols%rowtype; v jsonb; item jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501';end if;
 if action='seed' then
  insert into protocols(visit_type,version,definition,content_hash) values(payload->>'visitType',payload->>'version',payload->'definition',payload->>'hash') on conflict(visit_type,version) do update set definition=excluded.definition,content_hash=excluded.content_hash where protocols.approved_at is null and not exists(select 1 from submissions entry where entry.visit_type=protocols.visit_type and entry.protocol_version=protocols.version) and not exists(select 1 from drafts draft where draft.visit_type=protocols.visit_type and draft.protocol_version=protocols.version);
  if not exists(select 1 from protocols where visit_type=payload->>'visitType' and version=payload->>'version' and content_hash=payload->>'hash') then raise exception 'protocol_version_conflict';end if;return '{"ok":true}';
 elsif action='protocol' then
  select * into svc from healen_booking.services where id=(payload->>'serviceId')::uuid and active;
  select * into p from protocols where visit_type=svc.visit_type and version=svc.protocol_version and approved_at is not null;
  select * into cfg from healen_booking.settings;
  if p.version is null or not cfg.enabled then raise exception 'booking_unavailable';end if;
  return jsonb_build_object('visitType',svc.visit_type,'modality',svc.modality,'version',p.version,'hash',p.content_hash,'privacyText',cfg.privacy_text,'sensitiveText',cfg.sensitive_text,'teleconsultationText',cfg.teleconsultation_text);
 elsif action='draft_create' then
  v:=public.healen_clinical_rpc('protocol',payload);select * into cfg from healen_booking.settings;
  if payload->'consents'->>'booking' is distinct from 'true' or payload->'consents'->>'sensitive' is distinct from 'true' or ((v->>'modality')='video' and payload->'consents'->>'teleconsultation' is distinct from 'true') then raise exception 'invalid_consent';end if;
  insert into drafts(token_hash,service_id,visit_type,modality,protocol_version,consents) values(payload->>'hash',(payload->>'serviceId')::uuid,v->>'visitType',v->>'modality',v->>'version',jsonb_build_object('booking',true,'sensitive',true,'teleconsultation',v->>'modality'='video','bookingText',cfg.privacy_text,'sensitiveText',cfg.sensitive_text,'teleconsultationText',cfg.teleconsultation_text,'acceptedAt',now())) returning * into d;
  return to_jsonb(d)-'token_hash';
 elsif action in ('draft_get','draft_save','complete','attachment_prepare','attachment_complete') then
  select * into d from drafts where token_hash=payload->>'hash' and expires_at>now() for update;if not found then raise exception 'draft_expired';end if;
  if action='draft_get' then return (to_jsonb(d)-'token_hash')||jsonb_build_object('attachments',(select coalesce(jsonb_agg(to_jsonb(x)-'draft_id'-'storage_path'-'lease_id'-'lease_until'),'[]') from attachments x where draft_id=d.id));end if;
  if action='draft_save' then
   if exists(select 1 from submissions where draft_id=d.id and reservation_id is not null) then raise exception 'already_booked';end if;
   if (payload->>'revision')::int is distinct from d.revision then raise exception 'draft_conflict';end if;
   update drafts set answers=payload->'answers',revision=revision+1 where id=d.id returning * into d;return jsonb_build_object('revision',d.revision);
  elsif action='complete' then
   if (payload->>'revision')::int is distinct from d.revision then raise exception 'draft_conflict';end if;
   if not exists(select 1 from protocols where visit_type=d.visit_type and version=d.protocol_version and approved_at is not null and content_hash=payload->>'protocolHash') then raise exception 'protocol_unavailable';end if;
   insert into submissions(draft_id,revision,service_id,visit_type,modality,protocol_version,answers,consents) values(d.id,d.revision,d.service_id,d.visit_type,d.modality,d.protocol_version,payload->'answers',d.consents) on conflict(draft_id,revision) do nothing returning * into s;
   if s.id is not null then
    for item in select value from jsonb_array_elements(payload->'observations') loop
     insert into observations(submission_id,symptom_code,label,dimension,value,missing_reason,unit,instrument,instrument_version,recall_days,body_region,laterality,respondent_role) values(s.id,item->>'symptom_code',item->>'label',item->>'dimension',(item->>'value')::numeric,item->>'missing_reason',item->>'unit',item->>'instrument',item->>'instrument_version',(item->>'recall_days')::integer,item->>'body_region',item->>'laterality',item->>'respondent_role');
    end loop;
    update attachments set submission_id=s.id where draft_id=d.id;
    insert into audit(actor,action,resource_id) values('public','questionnaire_received',s.id);
   else select * into s from submissions where draft_id=d.id and revision=d.revision;end if;
   return jsonb_build_object('submissionId',s.id,'revision',s.revision);
  elsif action='attachment_prepare' then
   if exists(select 1 from submissions where draft_id=d.id and reservation_id is not null) then raise exception 'already_booked';end if;
   if (select count(*) from attachments where draft_id=d.id)>=5 then raise exception 'upload_limit';end if;
   insert into attachments(draft_id,original_name,mime_type,size_bytes,storage_path) values(d.id,payload->>'name',payload->>'mime',(payload->>'size')::bigint,'booking/'||d.id||'/'||gen_random_uuid()||'.'||(payload->>'extension')) returning * into a;return to_jsonb(a);
  else
   update attachments set scan_status='pending' where id=(payload->>'id')::uuid and draft_id=d.id and scan_status='uploading' returning * into a;
   if a.id is null and not exists(select 1 from attachments where id=(payload->>'id')::uuid and draft_id=d.id) then raise exception 'not_found';end if;return '{"ok":true}';
  end if;
 elsif action='attachment_claim' then
  select * into a from attachments where (scan_status='pending' and available_at<=now()) or (scan_status='scanning' and lease_until<now()) order by created_at limit 1 for update skip locked;
  if not found then return null;end if;
  update attachments set scan_status='scanning',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=a.id returning * into a;return to_jsonb(a);
 elsif action='attachment_finish' then
  update attachments set scan_status=payload->>'status',storage_bucket=case when payload->>'status'='clean' then 'patient-documents' else storage_bucket end,scan_engine=payload->>'engine',content_sha256=payload->>'sha256',scan_error=payload->>'error',lease_until=null where id=(payload->>'id')::uuid and lease_id=(payload->>'leaseId')::uuid and scan_status='scanning' returning * into a;
  if a.submission_id is not null then perform project_documents(a.submission_id);end if;return '{"ok":true}';
 elsif action='reminder_claim' then
  update reminders set state='review',last_error='send_outcome_unknown' where state='sending' and lease_until<now();
  update reminders target set state='cancelled' from healen_booking.reservations booked where booked.id=target.reservation_id and target.state='queued' and (booked.state<>'confirmed' or booked.starts_at<>target.scheduled_start or booked.starts_at<=now());
  select * into m from reminders where state='queued' and due_at<=now() order by due_at limit 1 for update skip locked;if not found then return null;end if;
  update reminders set state='sending',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=m.id returning * into m;
  return jsonb_build_object('job',to_jsonb(m),'reservation',(select to_jsonb(r) from healen_booking.reservations r where r.id=m.reservation_id),'resource',(select to_jsonb(p) from healen_booking.resources p join healen_booking.reservations r on r.resource_id=p.id where r.id=m.reservation_id),'service',(select to_jsonb(x) from healen_booking.services x join healen_booking.reservations r on r.service_id=x.id where r.id=m.reservation_id));
 elsif action='reminder_finish' then
  update reminders set state=payload->>'state',gmail_id=payload->>'gmailId',last_error=payload->>'error',due_at=case when payload->>'state'='queued' then now()+interval '2 minutes' else due_at end,lease_until=null where id=(payload->>'id')::uuid and lease_id=(payload->>'leaseId')::uuid and state='sending';return '{"ok":true}';
 elsif action='operations' then
  return jsonb_build_object('protocols',(select coalesce(jsonb_agg(to_jsonb(p)-'definition'),'[]') from protocols p),'pendingIdentity',(select count(*) from submissions where state='identity_pending'),'pendingReview',(select count(*) from submissions where state='pending_review'),'documents',(select coalesce(jsonb_object_agg(scan_status,n),'{}') from (select scan_status,count(*) n from attachments group by scan_status) x),'reminders',(select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from reminders group by state) x));
 elsif action='expired_drafts' then
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'bucket',a.storage_bucket,'path',a.storage_path)),'[]') from attachments a join drafts d on d.id=a.draft_id where d.expires_at<now() and a.submission_id is null);
 elsif action='purge_drafts' then
  delete from attachments where id in(select (value#>>'{}')::uuid from jsonb_array_elements(payload->'attachmentIds')) and submission_id is null and draft_id in(select id from drafts where expires_at<now());
  delete from drafts where expires_at<now() and not exists(select 1 from attachments a where a.draft_id=drafts.id and a.submission_id is null);return '{"ok":true}';
 end if;
 raise exception 'invalid_action';
end $$;
revoke all on function public.healen_clinical_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.healen_clinical_rpc(text,jsonb) to service_role;

alter function public.healen_booking_rpc(text,jsonb) rename to healen_booking_engine_v1;
revoke all on function public.healen_booking_engine_v1(text,jsonb) from public,anon,authenticated,service_role;
create function public.healen_booking_rpc(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=healen_booking,healen_clinical,public,pg_temp as $$
#variable_conflict use_column
declare result jsonb; cfg settings%rowtype; r reservations%rowtype; s submissions%rowtype; v jsonb; d drafts%rowtype; rid uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cfg from settings;
 if action='configure' then
  if (payload->>'enabled')::boolean then
   if length(coalesce(payload->>'sensitive_text',''))<30 then raise exception 'invalid_configuration';end if;
   if not exists(select 1 from resources where id=(payload->'resource'->>'id')::uuid and gmail_connected) then raise exception 'gmail_not_connected';end if;
   for v in select value from jsonb_array_elements(payload->'services') where (value->>'active')::boolean loop
    if not exists(select 1 from protocols where visit_type=v->>'visit_type' and version=v->>'protocol_version' and approved_at is not null) then raise exception 'protocol_unavailable';end if;
    if v->>'modality'='video' and length(coalesce(payload->>'teleconsultation_text',''))<30 then raise exception 'invalid_configuration';end if;
   end loop;
  end if;
  for v in select value from jsonb_array_elements(payload->'services') loop
   if v->>'visit_type' is null or v->>'visit_type' not in ('initial','followup') or (v->>'duration_minutes')::int<>(case when v->>'visit_type'='followup' and v->>'modality'='video' then 30 else 45 end) then raise exception 'invalid_service';end if;
  end loop;
 elsif action in ('hold','submit') then
  perform pg_advisory_xact_lock(871230001);
  if action='hold' then
   select * into d from drafts where token_hash=payload->>'draftHash' and expires_at>now() for update;
   if not exists(select 1 from submissions where id=(payload->>'submissionId')::uuid and draft_id=d.id and revision=d.revision and service_id=(payload->>'serviceId')::uuid and reservation_id is null) then raise exception 'questionnaire_required';end if;
  else
  select * into r from reservations where token_hash=payload->>'hash' for update;if not found then raise exception 'not_found';end if;
  select * into d from drafts where token_hash=payload->>'draftHash' and expires_at>now() for update;
  select * into s from submissions where id=(payload->>'submissionId')::uuid and draft_id=d.id and revision=d.revision and service_id=r.service_id for update;
  if s.id is null or s.reservation_id is not null and s.reservation_id<>r.id then raise exception 'questionnaire_required';end if;
  if not exists(select 1 from protocols p join services x on x.id=r.service_id where p.visit_type=s.visit_type and p.version=s.protocol_version and p.approved_at is not null and x.visit_type=s.visit_type and x.protocol_version=s.protocol_version and x.modality=s.modality) then raise exception 'protocol_unavailable';end if;
  if cfg.privacy_text<>s.consents->>'bookingText' or cfg.sensitive_text<>s.consents->>'sensitiveText' or s.modality='video' and cfg.teleconsultation_text<>s.consents->>'teleconsultationText' then raise exception 'consent_changed';end if;
  payload:=payload||jsonb_build_object('guest',jsonb_build_object('name',s.answers->>'patient_name','email',lower(s.answers->>'email'),'phone',case when jsonb_typeof(s.answers->'phone')='string' then s.answers->>'phone' else '' end),'consent',true);
  end if;
 end if;
 result:=public.healen_booking_engine_v1(action,payload);
 if action='configure' then
  update settings set sensitive_text=payload->>'sensitive_text',teleconsultation_text=coalesce(payload->>'teleconsultation_text',''),team_emails=coalesce(payload->'team_emails','[]');
  for v in select value from jsonb_array_elements(payload->'services') loop update services set visit_type=v->>'visit_type',protocol_version=v->>'protocol_version' where id=(v->>'id')::uuid;end loop;
 elsif action='connect' then update resources set gmail_connected=coalesce((payload->>'gmailConnected')::boolean,false) where email=payload->>'email';
 elsif action='catalog' then
  result:=result||jsonb_build_object('sensitiveText',cfg.sensitive_text,'teleconsultationText',cfg.teleconsultation_text,'services',case when cfg.enabled then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select s.id,s.name,s.description,s.duration_minutes,s.modality,s.location,s.resource_id,s.visit_type,s.protocol_version from services s join protocols p on p.visit_type=s.visit_type and p.version=s.protocol_version where s.active and p.approved_at is not null) x) else '[]'::jsonb end);
 elsif action='claim' and result is not null then result:=result||jsonb_build_object('teamEmails',cfg.team_emails);
 elsif action='submit' and result->>'state' in ('pending','confirmed','review') then update submissions set reservation_id=r.id where id=s.id;
 elsif action='finish' then
  select reservation_id into rid from jobs where id=(payload->>'jobId')::uuid;
  select * into r from reservations where id=rid;
  if r.state='confirmed' then
   insert into healen_clinical.reminders(reservation_id,recipient,scheduled_start,due_at) select r.id,lower(email),r.starts_at,r.starts_at-interval '30 minutes' from (select r.guest->>'email' email union select jsonb_array_elements_text(cfg.team_emails)) x where email is not null on conflict do nothing;
   perform set_config('healen.booking_engine','on',true);
   update public.appointments set client_id=s.client_id from healen_clinical.submissions s where appointments.id=r.id and s.reservation_id=r.id and s.client_id is not null;
  end if;
 end if;
 if action in ('cancel','finish','reconcile') then update healen_clinical.reminders m set state='cancelled' from reservations r where r.id=m.reservation_id and m.state='queued' and (r.state in ('cancel_pending','cancelled','review') or r.starts_at<>m.scheduled_start);end if;
 return result;
end$$;
revoke all on function public.healen_booking_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.healen_booking_rpc(text,jsonb) to service_role;

create function public.healen_intake_staff(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=healen_clinical,public,pg_temp as $$
#variable_conflict use_column
declare s submissions%rowtype; cid uuid; result jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','medico')) then raise exception 'Clinical authorization required' using errcode='42501';end if;
 if action='protocols' then return (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from protocols p);
 elsif action='approve_protocol' then
  if payload->>'reviewed' is distinct from 'true' then raise exception 'Review required';end if;
  update protocols set approved_at=now(),approved_by=auth.uid() where visit_type=payload->>'visitType' and version=payload->>'version' and content_hash=payload->>'hash';if not found then raise exception 'Protocol changed';end if;
 elsif action='list' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select id,visit_type,protocol_version,client_id,reservation_id,state,created_at,answers->>'patient_name' patient_name,answers->>'email' email,answers->>'request_contact' request_contact from submissions where case when payload->>'clientId' is not null then client_id=(payload->>'clientId')::uuid else state in ('identity_pending','pending_review') end order by created_at desc limit 100) x;return result;
 elsif action='progress' then
  return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('state',entry.state) order by o.recorded_at),'[]') from observations o join submissions entry on entry.id=o.submission_id where entry.client_id=(payload->>'clientId')::uuid);
 elsif action='retry_document' then
  update attachments set scan_status='pending',available_at=now(),scan_error=null where id=(payload->>'id')::uuid and scan_status='error';
 elsif action='detail' then
  select * into s from submissions where id=(payload->>'id')::uuid;if not found then raise exception 'Not found';end if;
  insert into audit(actor,action,resource_id) values(auth.uid()::text,'intake_read',s.id);
  return to_jsonb(s)||jsonb_build_object('observations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from observations o where submission_id=s.id),'attachments',(select coalesce(jsonb_agg(to_jsonb(a)-'lease_id'-'lease_until'),'[]') from attachments a where submission_id=s.id));
 elsif action in ('link','review','publish') then
  select * into s from submissions where id=(payload->>'id')::uuid for update;if not found then raise exception 'Not found';end if;
  if action='link' then
   if s.client_id is not null then raise exception 'Identity already linked';end if;
   cid:=(payload->>'clientId')::uuid;
   if payload->>'createPatient'='true' then insert into public.clients(full_name,email,phone,source_system,source_key) values(s.answers->>'patient_name',s.answers->>'email',case when jsonb_typeof(s.answers->'phone')='string' then s.answers->>'phone' end,'healen-booking',s.id::text) returning id into cid;end if;
   if not exists(select 1 from public.clients where id=cid and active) or payload->>'identityVerified' is distinct from 'true' then raise exception 'Identity verification required';end if;
   update submissions set client_id=cid,state='pending_review' where id=s.id;
   perform set_config('healen.booking_engine','on',true);update public.appointments set client_id=cid where id=s.reservation_id;
   perform project_documents(s.id);
  elsif action='review' then
   if s.client_id is null then raise exception 'Identity required';end if;
   update submissions set state='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(payload->>'note',4000) where id=s.id and state='pending_review';
  else
   if s.state not in ('reviewed','published') or s.client_id is null then raise exception 'Clinical review required';end if;
   update submissions set state='published' where id=s.id;
  end if;
 else raise exception 'Invalid action';end if;
 insert into audit(actor,action,resource_id) values(auth.uid()::text,action,s.id);return '{"ok":true}';
end$$;
revoke all on function public.healen_intake_staff(text,jsonb) from public,anon;
grant execute on function public.healen_intake_staff(text,jsonb) to authenticated;
-- Newly installed clinical gate starts closed until operational and clinical review.
update healen_booking.settings set enabled=false,team_emails='["daniela.cibosano2@gmail.com","sebastiansgv30@gmail.com","healencenterai@gmail.com"]';
insert into healen_booking.services(resource_id,name,description,duration_minutes,modality,visit_type,active) select r.id,x.name,x.description,x.duration,x.modality,x.visit,false from healen_booking.resources r cross join (values ('Consulta inicial presencial','Primera consulta en Healen',45,'in_person','initial'),('Seguimiento presencial','Continuidad de tu atención',45,'in_person','followup'),('Consulta inicial virtual','Primera consulta por Google Meet',45,'video','initial'),('Seguimiento virtual','Seguimiento por Google Meet',30,'video','followup')) as x(name,description,duration,modality,visit) where r.email='doctor@healenmed.com' and not exists(select 1 from healen_booking.services z where z.resource_id=r.id and z.visit_type=x.visit and z.modality=x.modality);
notify pgrst,'reload schema';
commit;
