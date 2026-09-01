-- ============================================================
-- HEALEN OS · 34 · Custodia documental del portal
--
-- Los archivos entran a cuarentena, solo pasan al bucket clínico después
-- de escaneo, y únicamente el material aprobado y publicado se descarga.
-- El navegador del paciente nunca recibe client_id ni rutas elegidas por él.
-- ============================================================

begin;

alter table public.patient_documents
  add column if not exists original_name text,
  add column if not exists uploaded_by_patient boolean not null default false,
  add column if not exists uploaded_by uuid references auth.users(id),
  add column if not exists source_portal_user_id uuid,
  add column if not exists scan_status text not null default 'pending',
  add column if not exists scan_engine text,
  add column if not exists scan_details jsonb not null default '{}'::jsonb,
  add column if not exists scan_completed_at timestamptz,
  add column if not exists content_sha256 text,
  add column if not exists removed_at timestamptz;

alter table public.patient_documents
  drop constraint if exists patient_documents_scan_status_check;
alter table public.patient_documents
  add constraint patient_documents_scan_status_check
  check (scan_status in ('uploading', 'pending', 'scanning', 'clean', 'infected', 'error'));

update public.patient_documents
set original_name = coalesce(original_name, title),
    scan_status = case
      when storage_path is null then 'pending'
      when visibility = 'patient_published' and review_status = 'approved' then 'pending'
      else scan_status
    end
where original_name is null
   or scan_status is null;

create index if not exists idx_patient_documents_review_queue
  on public.patient_documents(scan_status, review_status, created_at desc)
  where removed_at is null;
create index if not exists idx_patient_documents_client_created
  on public.patient_documents(client_id, created_at desc)
  where removed_at is null;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('patient-documents-quarantine', 'patient-documents-quarantine', false, 26214400,
    array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('patient-documents', 'patient-documents', false, 26214400,
    array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- El dashboard y el portal usan Edge Functions con service_role. Ningún
-- navegador recibe una política directa sobre los objetos clínicos.
drop policy if exists patient_documents_browser_read on storage.objects;
drop policy if exists patient_documents_browser_write on storage.objects;
drop policy if exists patient_documents_quarantine_browser_read on storage.objects;
drop policy if exists patient_documents_quarantine_browser_write on storage.objects;

create or replace function public.dash_portal_document_operations(
  p_scope text default 'pending',
  p_limit integer default 100
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_items jsonb;
begin
  perform public.require_staff();
  if p_scope not in ('pending', 'published', 'rejected', 'all') then
    raise exception 'Filtro inválido' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(item order by
    (item->>'createdAt')::timestamptz desc
  ), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', d.id,
      'clientId', d.client_id,
      'patientCode', c.code,
      'patientName', c.full_name,
      'patientPhone', c.phone,
      'title', d.title,
      'originalName', d.original_name,
      'category', d.category,
      'mimeType', d.mime_type,
      'sizeBytes', d.size_bytes,
      'reviewStatus', d.review_status,
      'scanStatus', d.scan_status,
      'visibility', d.visibility,
      'uploadedByPatient', d.uploaded_by_patient,
      'createdAt', d.created_at,
      'publishedAt', d.published_at,
      'scanCompletedAt', d.scan_completed_at,
      'scanDetails', d.scan_details
    ) item
    from public.patient_documents d
    join public.clients c on c.id = d.client_id
    where d.removed_at is null
      and case p_scope
        when 'pending' then d.review_status = 'pending_review'
        when 'published' then d.visibility = 'patient_published' and d.review_status = 'approved'
        when 'rejected' then d.review_status = 'rejected' or d.scan_status = 'infected'
        else true
      end
    order by d.created_at desc
    limit v_limit
  ) q;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'pending', (select count(*) from public.patient_documents where removed_at is null and review_status = 'pending_review'),
      'scanning', (select count(*) from public.patient_documents where removed_at is null and scan_status in ('uploading','pending','scanning','error')),
      'published', (select count(*) from public.patient_documents where removed_at is null and visibility = 'patient_published' and review_status = 'approved'),
      'rejected', (select count(*) from public.patient_documents where removed_at is null and (review_status = 'rejected' or scan_status = 'infected'))
    ),
    'items', v_items
  );
end;
$$;

create or replace function public.portal_core_get_documents(
  p_client_id uuid,
  p_portal_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.portal_core_request_valid(p_request_id, p_portal_user_id, p_client_id, 'documents') then
    raise exception 'Solicitud inválida' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'category', d.category,
    'publishedAt', d.published_at,
    'createdAt', d.created_at,
    'reviewStatus', case
      when d.visibility = 'patient_published' and d.review_status = 'approved' and d.scan_status = 'clean' then 'published'
      when d.review_status = 'rejected' or d.scan_status = 'infected' then 'rejected'
      else 'pending_review'
    end,
    'scanStatus', d.scan_status,
    'mimeType', d.mime_type,
    'sizeBytes', d.size_bytes,
    'uploadedByPatient', d.uploaded_by_patient,
    'downloadable', d.visibility = 'patient_published' and d.review_status = 'approved'
      and d.scan_status = 'clean' and d.storage_bucket = 'patient-documents'
  ) order by coalesce(d.published_at, d.created_at) desc), '[]'::jsonb)
  into v_result
  from public.patient_documents d
  where d.client_id = p_client_id
    and d.removed_at is null
    and (
      (d.visibility = 'patient_published' and d.review_status = 'approved' and d.scan_status = 'clean')
      or (d.uploaded_by_patient and d.source_portal_user_id = p_portal_user_id)
    );
  insert into public.portal_core_access_audit(request_id, portal_user_id, client_id, action)
  values (p_request_id, p_portal_user_id, p_client_id, 'documents');
  return v_result;
end;
$$;

create or replace function public.portal_core_register_request(
  p_request_id uuid,
  p_portal_user_id uuid,
  p_client_id uuid,
  p_action text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in (
    'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
    'billing', 'create_checkout', 'payment_status', 'rewards', 'submit_checkin',
    'request_appointment', 'confirm_appointment', 'request_profile_change',
    'request_records', 'redeem_reward', 'document_url',
    'document_upload_prepare', 'document_upload_complete'
  ) or p_expires_at <= now() or p_expires_at > now() + interval '2 minutes'
     or not exists (select 1 from public.clients c where c.id = p_client_id and c.active) then
    return false;
  end if;
  delete from public.portal_core_request_receipts where expires_at < now() - interval '10 minutes';
  insert into public.portal_core_request_receipts(request_id, portal_user_id, client_id, action, expires_at)
  values (p_request_id, p_portal_user_id, p_client_id, p_action, p_expires_at);
  return true;
exception when unique_violation then return false;
end;
$$;

revoke all on function public.dash_portal_document_operations(text, integer) from public, anon;
grant execute on function public.dash_portal_document_operations(text, integer) to authenticated;
grant execute on function public.portal_core_get_documents(uuid, uuid, uuid) to service_role;
grant execute on function public.portal_core_register_request(uuid, uuid, uuid, text, timestamptz) to service_role;

commit;
