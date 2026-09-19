-- Draft definitions can change only before approval and before any patient has used them.
begin;
create or replace function public.healen_clinical_rpc(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=healen_clinical,healen_booking,public,pg_temp as $$
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

commit;
