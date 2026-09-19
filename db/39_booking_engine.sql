-- Additive Healen booking engine. Runtime access only through service-role RPC.
set search_path=public,healen_booking,extensions;
create schema if not exists healen_booking;
revoke all on schema healen_booking from public, anon, authenticated;
create extension if not exists btree_gist with schema extensions;
create table if not exists healen_booking.settings(id boolean primary key default true check(id), enabled boolean not null default false, privacy_text text not null default '', updated_at timestamptz not null default now());
insert into healen_booking.settings(id) values(true) on conflict do nothing;
create table if not exists healen_booking.resources(id uuid primary key default gen_random_uuid(), email text unique not null, name text not null, timezone text not null default 'America/Bogota' check(timezone='America/Bogota'), calendar_id text not null default 'primary', busy_calendars jsonb not null default '["primary"]', weekly jsonb not null default '[]', notice_minutes integer not null default 1440 check(notice_minutes>=0), horizon_days integer not null default 30 check(horizon_days between 1 and 90), buffer_minutes integer not null default 0 check(buffer_minutes between 0 and 120), reviewed_existing boolean not null default false, tokens jsonb, connected_at timestamptz);
insert into healen_booking.resources(email,name) values('doctor@healenmed.com','Doctor Healen') on conflict do nothing;
create table if not exists healen_booking.services(id uuid primary key default gen_random_uuid(), resource_id uuid not null references healen_booking.resources, name text not null, description text not null default '', duration_minutes integer not null check(duration_minutes between 10 and 240), modality text not null check(modality in ('in_person','video')), location text not null default '', active boolean not null default false);
create table if not exists healen_booking.sessions(token_hash text primary key, kind text not null check(kind in ('oauth','admin')), data jsonb not null, expires_at timestamptz not null);
create table if not exists healen_booking.reservations(id uuid primary key default gen_random_uuid(), resource_id uuid not null references healen_booking.resources, service_id uuid not null references healen_booking.services, starts_at timestamptz not null, ends_at timestamptz not null, occupied_until timestamptz not null, state text not null check(state in ('held','pending','confirmed','cancel_pending','cancelled','expired','review')), token_hash text unique not null, idempotency_key text unique not null, expires_at timestamptz not null, guest jsonb, event_id text, meet_url text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at>starts_at), exclude using gist(resource_id with =, tstzrange(starts_at,occupied_until,'[)') with &&) where(state in ('held','pending','confirmed','cancel_pending','review')));
create table if not exists healen_booking.jobs(id uuid primary key default gen_random_uuid(), reservation_id uuid not null references healen_booking.reservations, kind text not null check(kind in ('create','cancel')), state text not null default 'queued', attempts integer not null default 0, available_at timestamptz not null default now(), lease_until timestamptz, lease_id uuid, last_error text, unique(reservation_id,kind));
create table if not exists healen_booking.audit(id bigint generated always as identity primary key, actor text not null, action text not null, resource_id uuid, created_at timestamptz not null default now());
-- Matches the columns used by the existing staff RPC; no broad access policy.
create table if not exists public.portal_access_audit(id uuid primary key default gen_random_uuid(), auth_user_id uuid, client_id uuid, action text not null, resource_type text not null, resource_id text, metadata jsonb not null default '{}', created_at timestamptz not null default now());
alter table public.portal_access_audit enable row level security;
revoke all on public.portal_access_audit from anon, authenticated;
alter table public.appointments add column if not exists booking_resource_id uuid references healen_booking.resources;
alter table public.appointments add column if not exists booking_service_id uuid references healen_booking.services;
alter table public.appointments add column if not exists booking_sync_status text;
-- Defense in depth even if schema exposure is accidentally changed later.
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='healen_booking' loop execute format('alter table healen_booking.%I enable row level security',t.tablename); end loop; end $$;
revoke all on all tables in schema healen_booking from public, anon, authenticated;

create or replace function healen_booking.guard_appointment() returns trigger language plpgsql security definer set search_path=public,healen_booking,extensions,pg_temp as $$
begin
 if coalesce(current_setting('healen.booking_engine',true),'')='on' then return new; end if;
 perform pg_advisory_xact_lock(871230001);
 if tg_op='INSERT' and new.booking_resource_id is not null then raise exception 'Usa el motor de reservas para crear esta cita.';end if;
 if tg_op='UPDATE' and old.booking_resource_id is null and new.booking_resource_id is not null then raise exception 'Usa el motor para asignar el recurso.';end if;
 if tg_op='UPDATE' and old.booking_resource_id is not null and (old.starts_at,old.ends_at,old.status,old.booking_resource_id,old.booking_service_id) is distinct from (new.starts_at,new.ends_at,new.status,new.booking_resource_id,new.booking_service_id) then
  if old.starts_at=new.starts_at and old.ends_at=new.ends_at and old.booking_resource_id=new.booking_resource_id and old.booking_service_id=new.booking_service_id and new.status in ('confirmada','atendida','completada','no_asistio') then return new; end if;
  raise exception 'Gestiona esta cita desde Agendamiento Healen para sincronizar Google.' using errcode='P0001';
 end if;
 if new.starts_at>now() and new.status not in ('cancelada','cancelled','canceled','vencida') then
  if exists(select 1 from reservations r where r.id<>new.id and r.state in ('pending','confirmed','cancel_pending','review','held') and (r.state<>'held' or r.expires_at>now()) and (new.booking_resource_id is null or r.resource_id=new.booking_resource_id) and tstzrange(r.starts_at,r.occupied_until,'[)') && tstzrange(new.starts_at,coalesce(new.ends_at,'infinity'::timestamptz),'[)')) then raise exception 'El horario está ocupado en Agendamiento Healen.' using errcode='23P01'; end if;
 end if;
 return new;
end $$;
drop trigger if exists healen_booking_guard on public.appointments;
create trigger healen_booking_guard before insert or update of starts_at,ends_at,status,booking_resource_id,booking_service_id on public.appointments for each row execute function healen_booking.guard_appointment();

create or replace function public.healen_booking_rpc(action text, payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=healen_booking,public,extensions,pg_temp as $$
#variable_conflict use_column
declare r reservations%rowtype; s services%rowtype; p resources%rowtype; j jobs%rowtype; v jsonb; st timestamptz; en timestamptz; occ timestamptz; cfg settings%rowtype; n integer; daynum integer; minute integer;
begin
 if coalesce(auth.role(),'') <> 'service_role' and session_user not in ('postgres','supabase_admin') then raise exception 'Forbidden' using errcode='42501'; end if;
 if action='health' then return jsonb_build_object('ok',true); end if;
 if action='session_put' then
  delete from sessions where expires_at<now();
  insert into sessions(token_hash,kind,data,expires_at) values(payload->>'hash',payload->>'kind',payload->'data',now()+case when payload->>'kind'='oauth' then interval '10 minutes' else interval '8 hours' end);
  return '{"ok":true}';
 elsif action='session_get' then select data into v from sessions where token_hash=payload->>'hash' and kind=payload->>'kind' and expires_at>now();return v;
 elsif action='session_take' then delete from sessions where token_hash=payload->>'hash' and kind=payload->>'kind' and expires_at>now() returning data into v;return v;
 elsif action='session_delete' then delete from sessions where token_hash=payload->>'hash';return '{"ok":true}';
 elsif action='connect' then
  update resources set tokens=payload->'tokens',connected_at=now() where email=payload->>'email';get diagnostics n=row_count;if n<>1 then raise exception 'Unknown organizer';end if;
  insert into audit(actor,action) values(payload->>'email','google_connected');return '{"ok":true}';
 elsif action='resource' then select to_jsonb(x) into v from resources x where id=(payload->>'id')::uuid;return v;
 elsif action='admin' then
  return jsonb_build_object('settings',(select to_jsonb(x) from settings x),'resources',(select coalesce(jsonb_agg(to_jsonb(x)-'tokens'||jsonb_build_object('connected',x.tokens is not null)),'[]') from resources x),'services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from services x),'reservations',(select coalesce(jsonb_agg(to_jsonb(x)-'token_hash'-'idempotency_key'),'[]') from (select * from reservations where state not in ('held','expired') order by starts_at desc limit 100) x),'unassigned_future',(select count(*) from appointments where booking_resource_id is null and starts_at>now() and status not in ('cancelada','cancelled','canceled','vencida')));
 elsif action='configure' then
  perform pg_advisory_xact_lock(871230001);
  if exists(select 1 from reservations where state in ('held','pending','cancel_pending','review') and (state<>'held' or expires_at>now())) then raise exception 'Espera a que terminen las reservas en proceso antes de cambiar las reglas.';end if;
  select * into p from resources where id=(payload->'resource'->>'id')::uuid for update;
  if p.id is null then raise exception 'Unknown resource';end if;
  if exists(select 1 from reservations where resource_id=p.id and state='confirmed' and starts_at>now()) and p.calendar_id<>payload->'resource'->>'calendar_id' then raise exception 'No cambies el calendario con citas futuras; requiere migración.';end if;
  update resources set name=payload->'resource'->>'name',calendar_id=payload->'resource'->>'calendar_id',busy_calendars=payload->'resource'->'busy_calendars',weekly=payload->'resource'->'weekly',notice_minutes=(payload->'resource'->>'notice_minutes')::int,horizon_days=(payload->'resource'->>'horizon_days')::int,buffer_minutes=(payload->'resource'->>'buffer_minutes')::int,reviewed_existing=(payload->'resource'->>'reviewed_existing')::boolean where id=p.id;
  update services set active=false where resource_id=p.id;
  for v in select value from jsonb_array_elements(payload->'services') loop
   insert into services(id,resource_id,name,description,duration_minutes,modality,location,active) values((v->>'id')::uuid,p.id,v->>'name',coalesce(v->>'description',''),(v->>'duration_minutes')::int,v->>'modality',coalesce(v->>'location',''),(v->>'active')::boolean) on conflict(id) do update set name=excluded.name,description=excluded.description,duration_minutes=excluded.duration_minutes,modality=excluded.modality,location=excluded.location,active=excluded.active where services.resource_id=p.id;
  end loop;
  if (payload->>'enabled')::boolean then
   if p.tokens is null or not (payload->'resource'->>'reviewed_existing')::boolean or jsonb_array_length(payload->'resource'->'weekly')=0 or not exists(select 1 from services where active and resource_id=p.id) or length(payload->>'privacy_text')<30 then raise exception 'Completa Google, horarios, servicios, revisión de agenda y privacidad antes de activar.';end if;
   if exists(select 1 from appointments where starts_at>now() and ends_at is null and status not in ('cancelada','cancelled','canceled','vencida')) then raise exception 'Hay citas futuras sin hora de finalización.';end if;
  end if;
  update settings set enabled=(payload->>'enabled')::boolean,privacy_text=payload->>'privacy_text',updated_at=now();insert into audit(actor,action) values(payload->>'actor','configuration_updated');return '{"ok":true}';
 elsif action='catalog' then
  select * into cfg from settings;
  return jsonb_build_object('enabled',cfg.enabled,'privacyText',cfg.privacy_text,'services',case when cfg.enabled then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select s.id,s.name,s.description,s.duration_minutes,s.modality,s.location,s.resource_id from services s join resources p on p.id=s.resource_id where s.active and p.tokens is not null) x) else '[]'::jsonb end);
 elsif action='availability' then
  update reservations set state='expired' where state='held' and expires_at<now();
  select * into s from services where id=(payload->>'serviceId')::uuid and active;select * into cfg from settings;
  if s.id is null or not cfg.enabled then return null;end if;
  select * into p from resources where id=s.resource_id;
  return jsonb_build_object('service',to_jsonb(s),'resource',to_jsonb(p),'busy',(select coalesce(jsonb_agg(x),'[]') from (
   select starts_at,occupied_until as ends_at from reservations where resource_id=p.id and state in ('held','pending','confirmed','cancel_pending','review') and occupied_until>(payload->>'from')::timestamptz and starts_at<(payload->>'to')::timestamptz
   union all select a.starts_at,coalesce(a.ends_at,'infinity'::timestamptz)+make_interval(mins=>p.buffer_minutes) from appointments a where (a.booking_resource_id is null or a.booking_resource_id=p.id) and not exists(select 1 from reservations r where r.id=a.id) and a.status not in ('cancelada','cancelled','canceled','vencida') and a.starts_at<(payload->>'to')::timestamptz and coalesce(a.ends_at,'infinity'::timestamptz)>(payload->>'from')::timestamptz
  ) x));
 elsif action='hold' then
  perform pg_advisory_xact_lock(871230001);
  select * into r from reservations where idempotency_key=payload->>'key';if found then if r.token_hash<>payload->>'hash' then raise exception 'Idempotency conflict';end if;return to_jsonb(r)-'guest';end if;
  update reservations set state='expired' where state='held' and expires_at<now();
  select * into cfg from settings;if not cfg.enabled then raise exception 'Booking disabled';end if;
  select * into s from services where id=(payload->>'serviceId')::uuid and active;if not found then raise exception 'Unknown service';end if;
  select * into p from resources where id=s.resource_id;if p.tokens is null or not p.reviewed_existing then raise exception 'Resource unavailable';end if;
  st:=(payload->>'startsAt')::timestamptz;en:=st+make_interval(mins=>s.duration_minutes);occ:=en+make_interval(mins=>p.buffer_minutes);
  if st<now()+make_interval(mins=>p.notice_minutes) or st>now()+make_interval(days=>p.horizon_days) then raise exception 'Outside booking horizon';end if;
  daynum:=extract(dow from st at time zone p.timezone);minute:=extract(hour from st at time zone p.timezone)*60+extract(minute from st at time zone p.timezone);
  if extract(second from st)<>0 or not exists(select 1 from jsonb_array_elements(p.weekly) w where (w->>'day')::int=daynum and minute>=(w->>'start')::int and minute+s.duration_minutes+p.buffer_minutes<=(w->>'end')::int and mod(minute-(w->>'start')::int,15)=0) then raise exception 'Outside working hours';end if;
  if exists(select 1 from appointments where (booking_resource_id is null or booking_resource_id=p.id) and status not in ('cancelada','cancelled','canceled','vencida') and tstzrange(st,occ,'[)')&&tstzrange(starts_at,coalesce(ends_at,'infinity'::timestamptz)+make_interval(mins=>p.buffer_minutes),'[)')) then raise exception 'Conflict' using errcode='23P01';end if;
  insert into reservations(resource_id,service_id,starts_at,ends_at,occupied_until,state,token_hash,idempotency_key,expires_at) values(p.id,s.id,st,en,occ,'held',payload->>'hash',payload->>'key',now()+interval '5 minutes') returning * into r;return to_jsonb(r)-'guest';
 elsif action='release' then update reservations set state='expired' where token_hash=payload->>'hash' and state='held';return '{"ok":true}';
 elsif action='submit' then
  perform pg_advisory_xact_lock(871230001);select * into r from reservations where token_hash=payload->>'hash' for update;if not found then raise exception 'Unknown reservation';end if;
  if r.state<>'held' then return jsonb_build_object('id',r.id,'state',r.state);end if;
  if r.expires_at<now() then update reservations set state='expired' where id=r.id;return jsonb_build_object('state','expired');end if;
  if not (select enabled from settings) then raise exception 'Booking disabled';end if;
  if length(payload->'guest'->>'name') not between 2 and 120 or length(payload->'guest'->>'email') not between 3 and 254 or coalesce((payload->>'consent')::boolean,false)=false then raise exception 'Invalid guest';end if;
  update reservations set state='pending',guest=(payload->'guest')||jsonb_build_object('consent',true,'consented_at',now(),'privacy_text',(select privacy_text from settings)),updated_at=now() where id=r.id;
  insert into jobs(reservation_id,kind) values(r.id,'create') on conflict do nothing;
  return jsonb_build_object('id',r.id,'state','pending');
 elsif action='status' then select jsonb_build_object('id',id,'state',state,'serviceId',service_id,'service',(select jsonb_build_object('name',s.name,'duration_minutes',s.duration_minutes,'modality',s.modality,'location',s.location) from services s where s.id=service_id),'startsAt',starts_at,'endsAt',ends_at,'expiresAt',expires_at,'meetUrl',meet_url) into v from reservations where token_hash=payload->>'hash';return v;
 elsif action='claim' then
  select * into j from jobs where (state='queued' and available_at<=now()) or (state='working' and lease_until<now()) order by available_at limit 1 for update skip locked;if not found then return null;end if;
  update jobs set state='working',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=j.id returning * into j;
  select * into r from reservations where id=j.reservation_id;select * into s from services where id=r.service_id;select * into p from resources where id=r.resource_id;
  return jsonb_build_object('job',to_jsonb(j),'reservation',to_jsonb(r),'service',to_jsonb(s),'resource',to_jsonb(p));
 elsif action='finish' then
  perform pg_advisory_xact_lock(871230001);select * into j from jobs where id=(payload->>'jobId')::uuid and lease_id=(payload->>'leaseId')::uuid and state='working' for update;if not found then return '{"stale":true}';end if;
  select * into r from reservations where id=j.reservation_id for update;select * into s from services where id=r.service_id;
  perform set_config('healen.booking_engine','on',true);
  if j.kind='create' then
   insert into appointments(id,starts_at,ends_at,event_type,service,status,location,visible_to_patient,source_system,source_key,booking_resource_id,booking_service_id,booking_sync_status) values(r.id,r.starts_at,r.ends_at,'clinico',s.name,'programada',case when s.modality='video' then payload->>'meetUrl' else s.location end,false,'healen-booking',r.id::text,r.resource_id,r.service_id,'synced') on conflict(id) do nothing;
   update reservations set state='confirmed',event_id=payload->>'eventId',meet_url=payload->>'meetUrl',last_error=null,updated_at=now() where id=r.id;
  else update reservations set state='cancelled',updated_at=now() where id=r.id;update appointments set status='cancelada',booking_sync_status='synced' where id=r.id;end if;
  update jobs set state='done',lease_until=null where id=j.id;insert into audit(actor,action,resource_id) values('worker',j.kind||'_completed',r.id);return '{"ok":true}';
 elsif action='job_error' then
  select * into j from jobs where id=(payload->>'jobId')::uuid and lease_id=(payload->>'leaseId')::uuid and state='working' for update;if not found then return '{"stale":true}';end if;
  update jobs set state=case when j.attempts>=10 or coalesce((payload->>'permanent')::boolean,false) then 'review' else 'queued' end,available_at=now()+make_interval(secs=>least(900,15*power(2,least(j.attempts,6))::int)),last_error=left(payload->>'code',100),lease_until=null where id=j.id;
  update reservations set last_error=left(payload->>'code',100),state=case when j.attempts>=10 or coalesce((payload->>'permanent')::boolean,false) then 'review' else state end where id=j.reservation_id;return '{"ok":true}';
 elsif action='cancel' then
  select * into r from reservations where id=(payload->>'id')::uuid for update;if r.state='cancelled' then return '{"ok":true}';end if;if r.state not in ('confirmed','review') then raise exception 'No se puede cancelar mientras la reserva está en proceso.';end if;
  if exists(select 1 from jobs where reservation_id=r.id and state='working' and lease_until>now()) then raise exception 'Espera a que termine la sincronización.';end if;
  update jobs set state='done' where reservation_id=r.id and kind='create' and state='review';
  update reservations set state='cancel_pending' where id=r.id;
  insert into jobs(reservation_id,kind) values(r.id,'cancel') on conflict(reservation_id,kind) do update set state='queued',attempts=0,available_at=now();insert into audit(actor,action,resource_id) values(payload->>'actor','cancel_requested',r.id);return '{"ok":true}';
 elsif action='retry' then
  select * into r from reservations where id=(payload->>'id')::uuid and state='review' for update;
  select * into j from jobs where reservation_id=r.id and state='review' for update;
  if j.id is null then raise exception 'No hay una sincronización fallida para reintentar. Revisa el evento en Google.';end if;
  update jobs set state='queued',attempts=0,available_at=now() where id=j.id;
  update reservations set state=case when j.kind='create' then 'pending' else 'cancel_pending' end,last_error=null where id=r.id;
  insert into audit(actor,action,resource_id) values(payload->>'actor','retry_requested',r.id);return '{"ok":true}';
 elsif action='reconcile_list' then return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,event_id,resource_id,starts_at,ends_at,meet_url from reservations where (state='confirmed' or (state='review' and last_error='google_time_changed' and event_id is not null)) and starts_at>now()-interval '1 day' order by updated_at limit 100) x);
 elsif action='reconcile' then
  perform pg_advisory_xact_lock(871230001);select * into r from reservations where id=(payload->>'id')::uuid and (state='confirmed' or (state='review' and last_error='google_time_changed')) for update;if not found then return '{}';end if;
  perform set_config('healen.booking_engine','on',true);
  if payload->>'status'='cancelled' then update reservations set state='cancelled',updated_at=now() where id=r.id;update appointments set status='cancelada',booking_sync_status='synced' where id=r.id;
  elsif (payload->>'startsAt')::timestamptz<>r.starts_at or (payload->>'endsAt')::timestamptz<>r.ends_at then
   update reservations set state='review',last_error='google_time_changed',updated_at=now() where id=r.id;update appointments set booking_sync_status='review' where id=r.id;
  else update reservations set state='confirmed',last_error=null,meet_url=payload->>'meetUrl',updated_at=now() where id=r.id;update appointments set booking_sync_status='synced',location=coalesce(payload->>'meetUrl',location) where id=r.id;end if;return '{"ok":true}';
 end if;
 raise exception 'Unknown action';
end $$;
revoke all on function public.healen_booking_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.healen_booking_rpc(text,jsonb) to service_role;
revoke all on all functions in schema healen_booking from public,anon,authenticated;
notify pgrst,'reload schema';

reset search_path;
