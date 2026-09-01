import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rpcSql = readFileSync(resolve(root, 'db/26_portal_rpc.sql'), 'utf8');
const foundationSql = readFileSync(resolve(root, 'db/25_portal_foundation.sql'), 'utf8');
const portalSource = readFileSync(resolve(root, 'portal/src/App.tsx'), 'utf8');
const pwaConfig = readFileSync(resolve(root, 'portal/vite.config.ts'), 'utf8');
const coreBridgeSql = readFileSync(resolve(root, 'db/29_portal_core_bridge.sql'), 'utf8');
const coreFunction = readFileSync(resolve(root, 'supabase/functions/portal-core/index.ts'), 'utf8');
const adminBridge = readFileSync(resolve(root, 'supabase/functions/portal-admin-bridge/index.ts'), 'utf8');
const appointmentOperationsSql = readFileSync(resolve(root, 'db/33_portal_appointment_operations.sql'), 'utf8');
const documentCustodySql = readFileSync(resolve(root, 'db/34_portal_document_custody.sql'), 'utf8');
const documentSecurity = readFileSync(resolve(root, 'supabase/functions/_shared/document-security.ts'), 'utf8');
const documentAdmin = readFileSync(resolve(root, 'supabase/functions/portal-document-admin/index.ts'), 'utf8');

function signature(name: string) {
  return rpcSql.match(new RegExp(`create or replace function ${name}\\(([^)]*)\\)`, 'i'))?.[1] ?? '';
}

describe('portal API isolation guardrails', () => {
  it('never accepts a browser supplied client id on patient RPCs', () => {
    for (const name of ['portal_get_home','portal_get_treatment','portal_get_progress','portal_get_appointments','portal_get_documents','portal_get_billing','portal_submit_checkin','portal_request_appointment','portal_request_profile_change','portal_redeem_reward']) {
      expect(signature(name).toLowerCase()).not.toContain('client');
    }
    expect(rpcSql).toContain('portal_current_client()');
    expect(rpcSql).toContain('a.auth_user_id=auth.uid()');
  });

  it('keeps all existing portal rows staff-only except the safe event invalidator', () => {
    expect(foundationSql).toContain("create policy staff_all");
    expect(foundationSql).toContain('create policy portal_event_read');
    expect(foundationSql).not.toMatch(/create policy portal_.* on (clients|treatments|clinical_notes|sales|payments)/i);
  });

  it('requires explicit publication for pre-existing clinical and financial content', () => {
    expect(foundationSql).toContain("portal_visibility text not null default 'internal'");
    expect(foundationSql).toContain('visible_to_patient boolean not null default false');
    expect(rpcSql).toContain("t.portal_visibility='patient_published'");
    expect(rpcSql).toContain("i.portal_visibility='patient_published'");
    expect(rpcSql).toContain('s.visible_to_patient');
  });

  it('does not leak demo patient data to an unauthorized production account', () => {
    expect(portalSource).toContain('query.isError || !query.data?.authorized');
    expect(portalSource).toContain('<AccessUnavailable />');
    expect(portalSource).not.toContain("const home = usePortalQuery(['portal', 'home'], portalApi.home, demoHome).data ?? demoHome");
  });

  it('keeps the heavy 3D module out of the PWA precache', () => {
    expect(pwaConfig).toContain("'**/BodyMap-*.js'");
    expect(pwaConfig).toContain("'**/LivingProtocolScene-*.js'");
    expect(pwaConfig).toContain('runtimeCaching: []');
  });

  it('exposes the clinical bridge only to server_role and requires signed, expiring requests', () => {
    expect(coreBridgeSql).toContain('to service_role');
    expect(coreBridgeSql).toContain('from public, anon, authenticated');
    expect(coreFunction).toContain("request.headers.get('x-healen-signature')");
    expect(coreFunction).toContain('assertFreshEnvelope');
    expect(coreFunction).toContain('portal_core_register_request');
  });

  it('keeps the second-project admin credential behind a staff-authenticated bridge', () => {
    expect(adminBridge).toContain('staffClient.auth.getUser()');
    expect(adminBridge).toContain("['admin', 'medico'].includes(profile.role)");
    expect(adminBridge).not.toContain('PORTAL_SERVICE_ROLE_KEY');
    expect(adminBridge).toContain('PORTAL_PROVISIONING_ENABLED');
    expect(adminBridge).toContain('PORTAL_CANARY_CLIENT_IDS');
  });

  it('resolves portal appointment requests only through staff RPCs', () => {
    expect(appointmentOperationsSql).toContain('perform public.require_staff()');
    expect(appointmentOperationsSql).toContain('dash_portal_appointment_action');
    expect(appointmentOperationsSql).toContain("grant execute on function public.dash_portal_appointment_action(uuid, text, jsonb) to authenticated");
    expect(appointmentOperationsSql).toContain("grant execute on function public.portal_core_request_appointment(uuid, uuid, uuid, jsonb) to service_role");
    expect(appointmentOperationsSql).toContain("from public, anon, authenticated");
  });

  it('keeps the requested preference separate from the canonical schedule', () => {
    expect(appointmentOperationsSql).toContain("p_params->>'preferredWindow'");
    expect(appointmentOperationsSql).toContain("p_payload->>'startsAt'");
    expect(appointmentOperationsSql).toContain('where a.id = v_appointment and a.client_id = p_client_id');
    expect(appointmentOperationsSql).toContain("set starts_at = v_starts_at");
    expect(appointmentOperationsSql).toContain("insert into public.portal_notifications");
  });

  it('keeps clinical files private, quarantined, scanned and patient-scoped', () => {
    expect(documentCustodySql).toContain("'patient-documents-quarantine', 'patient-documents-quarantine', false");
    expect(documentCustodySql).toContain("'patient-documents', 'patient-documents', false");
    expect(documentCustodySql).toContain('drop policy if exists patient_documents_browser_read');
    expect(documentSecurity).toContain('`${fields.clientId}/${documentId}/${input.safeName}`');
    expect(documentSecurity).toContain("scan.status === 'infected'");
    expect(documentSecurity).toContain("storage_bucket: DOCUMENT_BUCKET");
    expect(coreFunction).toContain(".eq('client_id', envelope.basicsClientId)");
    expect(coreFunction).toContain(".eq('scan_status', 'clean')");
    expect(coreFunction).toContain("createSignedUrl(document.storage_path, 90");
  });

  it('requires staff authentication before document review or publication', () => {
    expect(documentAdmin).toContain('staffClient.auth.getUser()');
    expect(documentAdmin).toContain("staffClient.rpc('is_staff')");
    expect(documentAdmin).toContain("document.scan_status !== 'clean'");
    expect(documentAdmin).toContain("action: 'staff_document_download'");
  });
});

describe('secret hygiene', () => {
  it('contains no server secret variable in browser source', () => {
    const browserFiles = [
      readFileSync(resolve(root, 'portal/src/lib/api.ts'), 'utf8'),
      readFileSync(resolve(root, 'portal/src/lib/supabase.ts'), 'utf8'),
    ].join('\n');
    expect(browserFiles).not.toMatch(/SERVICE_ROLE|BOLD_SECRET|OLLAMA_API_KEY/);
  });
});
