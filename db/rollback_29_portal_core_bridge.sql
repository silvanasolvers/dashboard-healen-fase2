-- Kill switch conservador para el bridge Portal → Basics.
-- No borra auditoría, recibos ni columnas de publicación.
begin;

revoke all on function public.portal_core_register_request(uuid, uuid, uuid, text, timestamptz) from service_role;
revoke all on function public.portal_core_get_home(uuid, uuid, uuid) from service_role;
revoke all on function public.portal_core_get_treatment(uuid, uuid, uuid) from service_role;
revoke all on function public.portal_core_get_appointments(uuid, uuid, uuid) from service_role;
revoke all on function public.dash_portal_publish_treatment(uuid, boolean) from authenticated;

update public.treatments set portal_visibility = 'internal', portal_published_at = null, portal_published_by = null
where portal_visibility = 'patient_published';
update public.treatment_items set portal_visibility = 'internal', portal_published_at = null, portal_published_by = null
where portal_visibility = 'patient_published';
update public.appointments set visible_to_patient = false where visible_to_patient;
update public.patient_milestones set visible_to_patient = false where visible_to_patient;

insert into public.portal_core_access_audit(action, success, metadata)
values ('bridge_disabled', true, '{"reason":"manual_rollback"}'::jsonb);

notify pgrst, 'reload schema';
commit;
