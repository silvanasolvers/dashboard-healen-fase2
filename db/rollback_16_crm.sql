-- ============================================================
-- HEALEN OS · Rollback manual exclusivo de 16_crm.sql
--
-- DESTRUCTIVO: elimina únicamente objetos y datos del CRM WhatsApp.
-- No modifica clients, treatments, clinical_notes, sales ni inventario.
-- Usar solo si la migración 16 debe revertirse por completo.
-- ============================================================

begin;

-- Los únicos objetos de 16 instalados sobre una tabla preexistente.
drop trigger if exists trg_crm_treatment_delete_sync on treatments;
drop trigger if exists trg_crm_treatment_move_sync on treatments;

drop view if exists v_crm_review_queue;
drop view if exists v_crm_contacts;

-- API pública e internas con dependencias sobre las tablas CRM.
drop function if exists crm_merge_client_fields(uuid, text[], boolean, bigint, timestamptz);
drop function if exists crm_stage_import_matches(uuid, integer, boolean);
drop function if exists crm_candidate_exact_clients(jsonb);
drop function if exists crm_match_existing_contacts(integer, boolean);
drop function if exists crm_apply_import(uuid, integer, numeric, boolean);
drop function if exists crm_review_candidate(uuid, text, bigint, text);
drop function if exists crm_apply_candidate_internal(uuid, uuid);
drop function if exists crm_contact_snapshot(uuid);
drop function if exists crm_ingest_candidates(jsonb);
drop function if exists crm_sanitize_proposed_data(jsonb);

-- Orden inverso de dependencias de datos.
drop table if exists crm_contact_evidence;
drop table if exists crm_import_candidates;
drop table if exists crm_import_runs;
drop table if exists crm_opportunities;
drop table if exists crm_contact_identities;
drop table if exists crm_change_audit;
drop table if exists crm_contacts;

-- Helpers de triggers: las tablas CRM y triggers sobre treatments ya no existen.
drop function if exists crm_downgrade_contact_without_treatment();
drop function if exists crm_assert_patient_has_treatment();
drop function if exists crm_bump_lock_version();

drop function if exists crm_map_contact_type(text);
drop function if exists crm_json_text_array(jsonb);
drop function if exists crm_identity_hash(text, text);
drop function if exists crm_normalize_identity(text, text);
drop function if exists crm_normalize_email(text);
drop function if exists crm_normalize_phone(text);

drop type if exists crm_opportunity_stage;
drop type if exists crm_contact_type;

do $$
begin
  if to_regclass('public.crm_contacts') is not null
     or to_regclass('public.crm_import_candidates') is not null then
    raise exception 'Rollback CRM incompleto: aún existen tablas CRM';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname in ('trg_crm_treatment_delete_sync', 'trg_crm_treatment_move_sync')
      and not tgisinternal
  ) then
    raise exception 'Rollback CRM incompleto: aún existen triggers sobre treatments';
  end if;
end $$;

commit;
