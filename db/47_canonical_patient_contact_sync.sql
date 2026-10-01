begin;
-- Canonical patient contact: CRM edits write through to public.clients.
create or replace function public.crm_sync_linked_patient_identity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if pg_trigger_depth()>1 or new.client_id is null or not new.active then return new;end if;
 if tg_op='UPDATE' and new.display_name is not distinct from old.display_name and new.primary_phone is not distinct from old.primary_phone and new.primary_email is not distinct from old.primary_email and new.client_id is not distinct from old.client_id then return new;end if;
 update public.clients c set full_name=coalesce(nullif(trim(new.display_name),''),c.full_name),phone=nullif(trim(new.primary_phone),''),email=nullif(lower(trim(new.primary_email)),''),updated_at=now()
 where c.id=new.client_id and c.active and (c.full_name is distinct from coalesce(nullif(trim(new.display_name),''),c.full_name) or c.phone is distinct from nullif(trim(new.primary_phone),'') or c.email is distinct from nullif(lower(trim(new.primary_email)),''));
 return new;
end $$;
revoke all on function public.crm_sync_linked_patient_identity() from public,anon,authenticated;
drop trigger if exists trg_crm_linked_patient_identity on public.crm_contacts;
create trigger trg_crm_linked_patient_identity after update of display_name,primary_phone,primary_email,client_id on public.crm_contacts for each row execute function public.crm_sync_linked_patient_identity();
-- Only use contacts already explicitly linked to the same patient, filling empty canonical fields.
update public.clients c set email=lower(trim(cc.primary_email)),updated_at=now() from public.crm_contacts cc
where cc.client_id=c.id and cc.active and c.active and nullif(trim(c.email),'') is null and trim(cc.primary_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
commit;
