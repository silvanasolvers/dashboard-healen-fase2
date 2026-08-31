-- ============================================================
-- HEALEN OS · 30 · Portal daily experience (Basics)
--
-- Basics owns every clinical or operational record. The patient browser only
-- reaches these functions through the signed portal-core Edge Function.
-- ============================================================

begin;

alter table public.portal_core_request_receipts
  drop constraint if exists portal_core_request_receipts_action_check;
alter table public.portal_core_request_receipts
  add constraint portal_core_request_receipts_action_check check (action in (
    'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
    'billing', 'rewards', 'submit_checkin', 'request_appointment',
    'confirm_appointment', 'request_profile_change', 'request_records',
    'redeem_reward', 'document_url'
  ));

create table if not exists public.portal_checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_request_id uuid not null unique,
  template_key text not null default 'wellbeing_v1',
  answers jsonb not null,
  alarm_flags jsonb not null default '[]'::jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'escalated', 'reviewed', 'dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  response_to_patient text,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_checkins_client_time
  on public.portal_checkins(client_id, created_at desc);

create table if not exists public.portal_progress_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  metric_key text not null,
  label text not null,
  value numeric not null,
  unit text,
  source_type text not null check (source_type in ('checkin', 'measurement', 'laboratory', 'milestone')),
  source_id text,
  validated boolean not null default false,
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_progress_client_metric
  on public.portal_progress_metrics(client_id, metric_key, recorded_at desc);

create table if not exists public.portal_appointment_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  source_request_id uuid not null unique,
  request_type text not null check (request_type in ('new', 'reschedule', 'cancel')),
  preferred_window text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'resolved')),
  staff_response text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_appointment_requests_pending
  on public.portal_appointment_requests(status, created_at) where status = 'pending';

create table if not exists public.portal_profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_request_id uuid not null unique,
  field_name text not null check (field_name in ('full_name', 'document_id', 'phone', 'email', 'address')),
  requested_value text not null,
  requires_reverification boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  staff_response text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  category text not null default 'Documento clínico',
  storage_bucket text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  visibility text not null default 'internal' check (visibility in ('internal', 'patient_published')),
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'approved', 'rejected')),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_patient_documents_portal
  on public.patient_documents(client_id, published_at desc)
  where visibility = 'patient_published' and review_status = 'approved';

create table if not exists public.portal_record_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_request_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'fulfilled', 'cancelled')),
  staff_response text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.portal_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  tone text not null default 'info' check (tone in ('info', 'success', 'warning', 'critical')),
  action_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_notifications_client_unread
  on public.portal_notifications(client_id, created_at desc) where read_at is null;

create table if not exists public.portal_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  price numeric(14,2) not null check (price >= 0),
  benefits jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.portal_package_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  package_id uuid not null references public.portal_packages(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'preparing', 'active', 'cancelled', 'refunded')),
  provider_reference text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.portal_reward_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  event_key text not null,
  points integer not null,
  source_type text not null,
  source_id text,
  created_at timestamptz not null default now(),
  unique(client_id, event_key, source_type, source_id)
);
create table if not exists public.portal_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  reward_id uuid not null references public.portal_reward_catalog(id),
  source_request_id uuid not null unique,
  points_spent integer not null check (points_spent > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'fulfilled', 'rejected')),
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array[
    'portal_checkins', 'portal_progress_metrics', 'portal_appointment_requests',
    'portal_profile_change_requests', 'patient_documents', 'portal_record_requests',
    'portal_notifications', 'portal_packages', 'portal_package_orders',
    'portal_reward_catalog', 'portal_reward_events', 'portal_reward_redemptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('drop policy if exists portal_staff_all on public.%I', t);
    execute format('create policy portal_staff_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.portal_core_request_valid(
  p_request_id uuid,
  p_portal_user_id uuid,
  p_client_id uuid,
  p_action text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.portal_core_request_receipts r
    where r.request_id = p_request_id
      and r.portal_user_id = p_portal_user_id
      and r.client_id = p_client_id
      and r.action = p_action
      and r.expires_at > now()
  );
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
    'billing', 'rewards', 'submit_checkin', 'request_appointment',
    'confirm_appointment', 'request_profile_change', 'request_records',
    'redeem_reward', 'document_url'
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

create or replace function public.portal_core_get_progress(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_days integer := case p_params->>'range' when '30d' then 30 when '180d' then 180 else 90 end; v_result jsonb;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'progress') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',m.metric_key,'label',m.label,'value',m.value,'unit',m.unit,'recordedAt',m.recorded_at) order by m.recorded_at),'[]'::jsonb)
  into v_result from public.portal_progress_metrics m where m.client_id=p_client_id and m.validated and m.recorded_at>=now()-make_interval(days=>v_days);
  insert into public.portal_core_access_audit(request_id,portal_user_id,client_id,action) values(p_request_id,p_portal_user_id,p_client_id,'progress');
  return v_result;
end $$;

create or replace function public.portal_core_get_documents(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'documents') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  -- Signed downloads stay disabled until the storage antivirus + URL signer is
  -- deployed. A storage_path alone must never make a private file clickable.
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'category',d.category,'publishedAt',d.published_at,'reviewStatus','published','downloadable',false) order by d.published_at desc),'[]'::jsonb)
  into v_result from public.patient_documents d where d.client_id=p_client_id and d.visibility='patient_published' and d.review_status='approved';
  insert into public.portal_core_access_audit(request_id,portal_user_id,client_id,action) values(p_request_id,p_portal_user_id,p_client_id,'documents');
  return v_result;
end $$;

create or replace function public.portal_core_get_packages(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'packages') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'price',p.price,'benefits',p.benefits,'eligible',true) order by p.price),'[]'::jsonb)
  into v_result from public.portal_packages p where p.active and p.valid_from<=now() and (p.valid_until is null or p.valid_until>now());
  return v_result;
end $$;

create or replace function public.portal_core_get_billing(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_orders jsonb;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'billing') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'title',p.name,'amount',o.amount,'status',o.status,'occurredAt',coalesce(o.paid_at,o.created_at)) order by o.created_at desc),'[]'::jsonb)
  into v_orders from public.portal_package_orders o join public.portal_packages p on p.id=o.package_id where o.client_id=p_client_id;
  return jsonb_build_object('orders',v_orders,'balance',0);
end $$;

create or replace function public.portal_core_get_rewards(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_points integer; v_catalog jsonb;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'rewards') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select coalesce(sum(points),0)::integer into v_points from public.portal_reward_events where client_id=p_client_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'points',r.points_cost,'available',v_points>=r.points_cost) order by r.points_cost),'[]'::jsonb)
  into v_catalog from public.portal_reward_catalog r where r.active;
  return jsonb_build_object('points',v_points,'catalog',v_catalog);
end $$;

create or replace function public.portal_core_submit_checkin(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pain numeric; v_energy numeric; v_sleep numeric; v_alarm boolean;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'submit_checkin') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  if octet_length(p_params::text)>8192 then raise exception 'Contenido demasiado extenso' using errcode='22023'; end if;
  v_energy:=coalesce((p_params->>'energy')::numeric,-1); v_sleep:=coalesce((p_params->>'sleep')::numeric,-1); v_pain:=coalesce((p_params->>'pain')::numeric,-1);
  if v_energy<0 or v_energy>10 or v_sleep<0 or v_sleep>10 or v_pain<0 or v_pain>10 then raise exception 'Escalas inválidas' using errcode='22023'; end if;
  v_alarm:=coalesce((p_params->>'alarm')::boolean,false) or v_pain>=8;
  insert into public.portal_checkins(client_id,source_request_id,answers,alarm_flags,review_status)
  values(p_client_id,p_request_id,p_params,case when v_alarm then '["patient_requested_contact_or_high_pain"]'::jsonb else '[]'::jsonb end,case when v_alarm then 'escalated' else 'pending' end)
  returning id into v_id;
  insert into public.portal_progress_metrics(client_id,metric_key,label,value,unit,source_type,source_id,validated,recorded_at) values
    (p_client_id,'energy','Energía',v_energy,'/10','checkin',v_id::text,false,now()),
    (p_client_id,'sleep','Sueño',v_sleep,'/10','checkin',v_id::text,false,now()),
    (p_client_id,'pain','Molestia',v_pain,'/10','checkin',v_id::text,false,now());
  if v_alarm then insert into public.portal_notifications(client_id,kind,title,body,tone,action_path) values(p_client_id,'clinical_alarm','Seguimiento prioritario','El equipo recibió tu solicitud de contacto.','warning','/inicio'); end if;
  insert into public.portal_core_access_audit(request_id,portal_user_id,client_id,action,metadata) values(p_request_id,p_portal_user_id,p_client_id,'submit_checkin',jsonb_build_object('alertCreated',v_alarm));
  return jsonb_build_object('id',v_id,'alertCreated',v_alarm);
end $$;

create or replace function public.portal_core_request_appointment(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_type text:=coalesce(p_params->>'kind','new'); v_appointment uuid;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'request_appointment') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  if v_type not in ('new','reschedule','cancel') then raise exception 'Solicitud inválida' using errcode='22023'; end if;
  if nullif(p_params->>'appointmentId','') is not null then v_appointment:=(p_params->>'appointmentId')::uuid; end if;
  if v_appointment is not null and not exists(select 1 from public.appointments where id=v_appointment and client_id=p_client_id) then raise exception 'Cita inválida' using errcode='42501'; end if;
  insert into public.portal_appointment_requests(client_id,appointment_id,source_request_id,request_type,preferred_window,message)
  values(p_client_id,v_appointment,p_request_id,v_type,left(p_params->>'preferredWindow',200),left(p_params->>'message',1000)) returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.portal_core_confirm_appointment(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid:=(p_params->>'appointmentId')::uuid;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'confirm_appointment') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  update public.appointments set status='confirmada' where id=v_id and client_id=p_client_id and status='programada';
  if not found then raise exception 'La cita no se puede confirmar' using errcode='22023'; end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.portal_core_request_profile_change(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_field text:=p_params->>'field'; v_value text:=trim(p_params->>'value');
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'request_profile_change') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  if v_field not in ('full_name','document_id','phone','email','address') or v_value is null or length(v_value)<2 or length(v_value)>500 then raise exception 'Cambio inválido' using errcode='22023'; end if;
  insert into public.portal_profile_change_requests(client_id,source_request_id,field_name,requested_value,requires_reverification)
  values(p_client_id,p_request_id,v_field,v_value,v_field<>'address') returning id into v_id;
  return jsonb_build_object('id',v_id,'updated',false);
end $$;

create or replace function public.portal_core_request_records(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'request_records') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select id into v_id from public.portal_record_requests where client_id=p_client_id and status in ('pending','processing') order by created_at desc limit 1;
  if v_id is null then insert into public.portal_record_requests(client_id,source_request_id) values(p_client_id,p_request_id) returning id into v_id; end if;
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.portal_core_redeem_reward(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reward public.portal_reward_catalog%rowtype; v_points integer; v_id uuid;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'redeem_reward') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select * into v_reward from public.portal_reward_catalog where id=(p_params->>'rewardId')::uuid and active for update;
  select coalesce(sum(points),0)::integer into v_points from public.portal_reward_events where client_id=p_client_id;
  if v_reward.id is null or v_points<v_reward.points_cost then raise exception 'Puntos insuficientes' using errcode='22023'; end if;
  insert into public.portal_reward_redemptions(client_id,reward_id,source_request_id,points_spent) values(p_client_id,v_reward.id,p_request_id,v_reward.points_cost) returning id into v_id;
  insert into public.portal_reward_events(client_id,event_key,points,source_type,source_id) values(p_client_id,'reward_redemption',-v_reward.points_cost,'redemption',v_id::text);
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.portal_core_get_document_url(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'document_url') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  if not exists(select 1 from public.patient_documents where id=(p_params->>'documentId')::uuid and client_id=p_client_id and visibility='patient_published' and review_status='approved') then raise exception 'Documento no disponible' using errcode='42501'; end if;
  return jsonb_build_object('url',null,'expiresIn',0);
end $$;

create or replace function public.portal_core_get_home(
  p_client_id uuid, p_portal_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_client public.clients%rowtype; v_treatment jsonb; v_appointment jsonb; v_pending jsonb; v_alerts jsonb; v_points integer; v_next_reward text; v_activity jsonb;
begin
  if not public.portal_core_request_valid(p_request_id,p_portal_user_id,p_client_id,'home') then raise exception 'Solicitud inválida' using errcode='42501'; end if;
  select * into v_client from public.clients where id=p_client_id and active;
  if v_client.id is null then raise exception 'Paciente no disponible' using errcode='42501'; end if;
  v_treatment:=public.portal_core_treatment_snapshot(p_client_id);
  select jsonb_build_object('id',a.id,'title',coalesce(a.service,'Cita Healen'),'startsAt',a.starts_at,'location',null,'status',a.status) into v_appointment
  from public.appointments a where a.client_id=p_client_id and a.visible_to_patient and a.starts_at>=now() and a.status not in ('cancelada','vencida') order by a.starts_at limit 1;
  if v_treatment is not null and v_treatment <> 'null'::jsonb
     and not exists(select 1 from public.portal_checkins c where c.client_id=p_client_id and c.created_at>=now()-interval '7 days') then
    v_pending:=jsonb_build_object('id','wellbeing-weekly','title','Check-in de bienestar','questions',4);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'tone',n.tone) order by n.created_at desc),'[]'::jsonb) into v_alerts
  from (select * from public.portal_notifications where client_id=p_client_id and read_at is null order by created_at desc limit 5) n;
  select coalesce(sum(points),0)::integer into v_points from public.portal_reward_events where client_id=p_client_id;
  select r.name||' a '||greatest(r.points_cost-v_points,0)||' puntos' into v_next_reward from public.portal_reward_catalog r where r.active order by r.points_cost limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'detail',n.body,'occurredAt',n.created_at,'actionPath',n.action_path,'tone',n.tone) order by n.created_at desc),'[]'::jsonb) into v_activity
  from (select * from public.portal_notifications where client_id=p_client_id order by created_at desc limit 6) n;
  insert into public.portal_core_access_audit(request_id,portal_user_id,client_id,action) values(p_request_id,p_portal_user_id,p_client_id,'home');
  return jsonb_build_object(
    'identity',jsonb_strip_nulls(jsonb_build_object('displayName',v_client.full_name,'initials',upper(left(v_client.full_name,1)),'email',v_client.email,'phone',v_client.phone,'address',v_client.address)),
    'treatment',v_treatment,'nextAppointment',v_appointment,'pendingCheckin',v_pending,'alerts',v_alerts,'points',v_points,'nextReward',v_next_reward,'recentActivity',v_activity,'generatedAt',now()
  );
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'portal_core_%'
  loop execute format('revoke all on function %s from public, anon, authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop;
end $$;

notify pgrst, 'reload schema';
commit;
