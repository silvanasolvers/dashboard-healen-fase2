-- HEALEN OS · 31 · Bold checkout through the signed two-project bridge

begin;

alter table public.portal_core_request_receipts
  drop constraint if exists portal_core_request_receipts_action_check;
alter table public.portal_core_request_receipts
  add constraint portal_core_request_receipts_action_check check (action in (
    'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
    'billing', 'create_checkout', 'payment_status', 'rewards', 'submit_checkin',
    'request_appointment', 'confirm_appointment', 'request_profile_change',
    'request_records', 'redeem_reward', 'document_url'
  ));

alter table public.portal_packages
  add column if not exists terms_version text not null default 'portal-terms-v1';

alter table public.portal_package_orders
  add column if not exists currency text not null default 'COP',
  add column if not exists terms_version text not null default 'portal-terms-v1',
  add column if not exists bold_payment_link text,
  add column if not exists bold_order_id text,
  add column if not exists provider_reference text,
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists sale_id uuid references public.sales(id) on delete set null;
create unique index if not exists uq_portal_orders_bold_order
  on public.portal_package_orders(bold_order_id) where bold_order_id is not null;
create unique index if not exists uq_portal_orders_provider_reference
  on public.portal_package_orders(provider_reference) where provider_reference is not null;

create table if not exists public.portal_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.portal_package_orders(id) on delete restrict,
  provider text not null default 'bold',
  provider_transaction_id text not null,
  status text not null check (status in ('created','pending','approved','rejected','reversed','refunded')),
  amount numeric(14,2) not null,
  currency text not null default 'COP',
  raw_event_hash text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider, provider_transaction_id, status)
);
create unique index if not exists uq_portal_payment_transaction_state
  on public.portal_payment_transactions(provider, provider_transaction_id, status);

create table if not exists public.portal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  signature_valid boolean not null,
  payload_hash text not null,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,event_id)
);

create table if not exists public.portal_events (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  created_at timestamptz not null default now()
);

alter table public.portal_payment_transactions enable row level security;
alter table public.portal_webhook_events enable row level security;
revoke all on table public.portal_payment_transactions, public.portal_webhook_events from public, anon, authenticated;
grant all on table public.portal_payment_transactions, public.portal_webhook_events to service_role;

create or replace function public.portal_core_register_request(
  p_request_id uuid, p_portal_user_id uuid, p_client_id uuid,
  p_action text, p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in (
    'home', 'treatment', 'progress', 'appointments', 'documents', 'packages',
    'billing', 'create_checkout', 'payment_status', 'rewards', 'submit_checkin',
    'request_appointment', 'confirm_appointment', 'request_profile_change',
    'request_records', 'redeem_reward', 'document_url'
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

create or replace function public.portal_process_bold_event(p_payload jsonb, p_payload_hash text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_event_id text := p_payload->>'id';
  v_type text := p_payload->>'type';
  v_data jsonb := coalesce(p_payload->'data','{}'::jsonb);
  v_payment_id text := coalesce(v_data->>'payment_id',p_payload->>'subject');
  v_reference text := coalesce(v_data->'metadata'->>'reference',v_data->>'reference');
  v_order public.portal_package_orders%rowtype;
  v_transaction uuid; v_sale uuid; v_package_name text;
  v_amount numeric := coalesce((v_data->'amount'->>'total')::numeric,0);
  v_occurred timestamptz := coalesce((v_data->>'created_at')::timestamptz,now());
  v_status text;
  v_method public.payment_method;
begin
  if v_event_id is null or v_type not in ('SALE_APPROVED','SALE_REJECTED','VOID_APPROVED','VOID_REJECTED') or v_payment_id is null then
    raise exception 'Evento Bold incompleto' using errcode='22023';
  end if;
  insert into public.portal_webhook_events(provider,event_id,signature_valid,payload_hash,processing_status)
  values('bold',v_event_id,true,p_payload_hash,'received') on conflict(provider,event_id) do nothing;
  if not found then return '{"duplicate":true}'::jsonb; end if;

  select * into v_order from public.portal_package_orders o
  where o.provider_reference=v_reference or o.bold_order_id=v_reference
    or o.bold_order_id=(p_payload->>'subject')
  order by o.created_at desc limit 1 for update;
  if v_order.id is null then
    update public.portal_webhook_events set processing_status='ignored',processed_at=now(),error='order_not_found'
    where provider='bold' and event_id=v_event_id;
    return '{"ignored":true,"reason":"order_not_found"}'::jsonb;
  end if;
  if v_amount>0 and v_amount<>v_order.amount then raise exception 'Monto Bold no coincide con la orden'; end if;

  v_status := case v_type when 'SALE_APPROVED' then 'approved' when 'SALE_REJECTED' then 'rejected'
    when 'VOID_APPROVED' then 'reversed' else 'rejected' end;
  insert into public.portal_payment_transactions(order_id,provider_transaction_id,status,amount,currency,raw_event_hash,occurred_at)
  values(v_order.id,v_payment_id,v_status,coalesce(nullif(v_amount,0),v_order.amount),coalesce(v_data->'amount'->>'currency','COP'),p_payload_hash,v_occurred)
  on conflict(provider,provider_transaction_id,status) do nothing returning id into v_transaction;
  if v_transaction is null then
    update public.portal_webhook_events set processing_status='ignored',processed_at=now(),error='transaction_already_processed'
    where provider='bold' and event_id=v_event_id;
    return '{"duplicate":true}'::jsonb;
  end if;

  if v_type='SALE_APPROVED' then
    v_sale := v_order.sale_id;
    if v_sale is null then
      select p.name into v_package_name from public.portal_packages p where p.id=v_order.package_id;
      insert into public.sales(code,client_id,sale_date,subtotal,total,status,notes)
      values('VTA-PORTAL-'||upper(left(replace(v_order.id::text,'-',''),10)),v_order.client_id,current_date,v_order.amount,v_order.amount,'pendiente','Orden portal: '||v_package_name)
      returning id into v_sale;
      update public.portal_package_orders set sale_id=v_sale where id=v_order.id;
    end if;
    v_method := case upper(coalesce(v_data->>'payment_method',''))
      when 'PSE' then 'pse'::public.payment_method when 'NEQUI' then 'nequi'::public.payment_method
      when 'CREDIT_CARD' then 'tarjeta_credito'::public.payment_method
      when 'DEBIT_CARD' then 'tarjeta_debito'::public.payment_method
      else 'otro'::public.payment_method end;
    if not exists(select 1 from public.payments p where p.sale_id=v_sale and p.note='Bold '||v_payment_id) then
      insert into public.payments(client_id,sale_id,amount,method,paid_at,note)
      values(v_order.client_id,v_sale,v_order.amount,v_method,v_occurred,'Bold '||v_payment_id);
    end if;
    update public.portal_package_orders set status='preparing',paid_at=v_occurred where id=v_order.id;
    insert into public.portal_events(client_id,event_type,resource_type,resource_id)
    values(v_order.client_id,'payment_approved','package_order',v_order.id::text);
    insert into public.portal_notifications(client_id,kind,title,body,action_path)
    values(v_order.client_id,'payment','Pago aprobado','Tu compra fue aprobada. El equipo está preparando tu plan.','/mi-plan');
  elsif v_type='SALE_REJECTED' then
    insert into public.portal_events(client_id,event_type,resource_type,resource_id)
    values(v_order.client_id,'payment_rejected','package_order',v_order.id::text);
  elsif v_type='VOID_APPROVED' then
    if v_order.sale_id is not null and not exists(select 1 from public.payments p where p.sale_id=v_order.sale_id and p.note='Reverso Bold '||v_payment_id) then
      insert into public.payments(client_id,sale_id,amount,method,paid_at,note)
      values(v_order.client_id,v_order.sale_id,-v_order.amount,'otro',v_occurred,'Reverso Bold '||v_payment_id);
    end if;
    update public.portal_package_orders set status='refunded' where id=v_order.id;
    insert into public.portal_events(client_id,event_type,resource_type,resource_id)
    values(v_order.client_id,'payment_reversed','package_order',v_order.id::text);
  end if;
  update public.portal_webhook_events set processing_status='processed',processed_at=now()
  where provider='bold' and event_id=v_event_id;
  return jsonb_build_object('processed',true,'orderId',v_order.id,'status',v_status);
exception when others then
  update public.portal_webhook_events set processing_status='failed',processed_at=now(),error=left(sqlerrm,500)
  where provider='bold' and event_id=v_event_id;
  raise;
end;
$$;

revoke all on function public.portal_process_bold_event(jsonb,text) from public,anon,authenticated;
grant execute on function public.portal_process_bold_event(jsonb,text) to service_role;
revoke all on function public.portal_core_register_request(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.portal_core_register_request(uuid,uuid,uuid,text,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;
