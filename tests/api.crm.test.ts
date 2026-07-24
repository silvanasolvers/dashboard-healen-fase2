import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../src/supabase', () => ({
  supabase: supabaseMocks,
}));

import {
  clearCrmCache,
  createPatient,
  fetchCrmContactsPage,
  moveCrmContact,
  setCrmCacheScope,
  type CrmPageResult,
  updateCrmContact,
} from '../src/api';

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

function rpcQuery(result: RpcResult) {
  const query = {
    abortSignal: vi.fn(),
    then: (
      resolve: (value: RpcResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  query.abortSignal.mockReturnValue(query);
  return query;
}

function crmPayload(overrides: Record<string, unknown> = {}) {
  return {
    page: 1,
    page_size: 50,
    filtered_total: 1,
    has_more: false,
    counts: {
      contacts: 12,
      leads: 7,
      patients: 3,
      active_pipeline: 4,
      reviews: 2,
    },
    contacts: [
      {
        id: 'contact-1',
        display_name: '  Ana Pérez  ',
        primary_phone: 573001112233,
        primary_email: ' ana@example.com ',
        city: ' Medellín ',
        contact_type: 'patient',
        client_id: 'client-1',
        current_opportunity_stage: 'qualified',
        has_treatment: false,
        treatment_count: '0',
        active_treatment_count: 0,
        patient_segments: [{
          code: 'sin_tratamiento',
          name: 'Paciente sin tratamiento',
          campaignType: 'bienvenida_calificacion',
          cadence: 'semanal',
          reason: 'Ficha de paciente sin tratamiento registrado',
          source: 'automatic',
        }],
        match_confidence: '0.91',
        opportunity_count: '3',
        open_opportunity_count: 1,
        active: true,
        lock_version: '8',
        tags: 'vip, whatsapp',
      },
    ],
    ...overrides,
  };
}

function mockSuccessfulRpc(payload = crmPayload()) {
  const query = rpcQuery({ data: payload, error: null });
  supabaseMocks.rpc.mockReturnValue(query);
  return query;
}

describe('fetchCrmContactsPage', () => {
  beforeEach(() => {
    clearCrmCache();
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockReset();
  });

  it.each([50, 75, 100])('sends the supported page size %i unchanged', async (pageSize) => {
    mockSuccessfulRpc(crmPayload({ page_size: pageSize }));

    await fetchCrmContactsPage({ page: 2, pageSize, search: '', contactType: 'all', stage: 'all' });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('crm_list_contacts', {
      p_page: 2,
      p_page_size: pageSize,
      p_search: null,
      p_contact_type: 'all',
      p_stage: 'all',
      p_segment: 'all',
    });
  });

  it('guards invalid page values and clamps progressive batches to 250', async () => {
    mockSuccessfulRpc(crmPayload({ page: 1, page_size: 250 }));

    await fetchCrmContactsPage({ page: 0, pageSize: 999 });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('crm_list_contacts', {
      p_page: 1,
      p_page_size: 250,
      p_search: null,
      p_contact_type: 'all',
      p_stage: 'all',
      p_segment: 'all',
    });
  });

  it('normalizes patient links independently of treatment history', async () => {
    mockSuccessfulRpc(crmPayload({
      contacts: [
        crmPayload().contacts[0],
        {
          id: 'contact-2',
          display_name: '',
          contact_type: 'unexpected-type',
          current_opportunity_stage: 'unexpected-stage',
          has_treatment: true,
          treatment_count: 1,
          active: '1',
          city: 'Bogotá',
          tags: ['one', 2, 'two'],
        },
      ],
      filtered_total: 2,
    }));

    const result = await fetchCrmContactsPage({ page: 1, pageSize: 50 });

    expect(result).toMatchObject<Partial<CrmPageResult>>({
      page: 1,
      pageSize: 50,
      filteredTotal: 2,
      hasMore: false,
      counts: {
        contacts: 12,
        leads: 7,
        patients: 3,
        activePipeline: 4,
        reviews: 2,
      },
    });
    expect(result.contacts[0]).toMatchObject({
      id: 'contact-1',
      displayName: 'Ana Pérez',
      phone: '573001112233',
      email: 'ana@example.com',
      city: 'Medellín',
      contactType: 'patient',
      stage: 'qualified',
      isPatient: true,
      treatmentCount: 0,
      patientSegments: [{
        code: 'sin_tratamiento',
        name: 'Paciente sin tratamiento',
        campaignType: 'bienvenida_calificacion',
        cadence: 'semanal',
      }],
      matchConfidence: 0.91,
      opportunityCount: 3,
      lockVersion: 8,
      tags: ['vip', 'whatsapp'],
    });
    expect(result.contacts[1]).toMatchObject({
      displayName: 'Contacto sin nombre',
      contactType: 'unknown',
      stage: 'unclassified',
      isPatient: false,
      active: true,
      tags: ['one', 'two'],
    });
  });

  it('reuses a normalized cache key and force refresh bypasses it', async () => {
    mockSuccessfulRpc();

    const first = await fetchCrmContactsPage({
      page: 1,
      pageSize: 50,
      search: '  ANA  ',
      contactType: 'lead',
      stage: 'new',
    });
    const cached = await fetchCrmContactsPage({
      page: 1,
      pageSize: 50,
      search: 'ana',
      contactType: 'lead',
      stage: 'new',
    });

    expect(cached).toBe(first);
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1);

    await fetchCrmContactsPage(
      { page: 1, pageSize: 50, search: 'ana', contactType: 'lead', stage: 'new' },
      { force: true },
    );
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('clearCrmCache invalidates a cached page', async () => {
    mockSuccessfulRpc();

    await fetchCrmContactsPage({ page: 1, pageSize: 50 });
    clearCrmCache();
    await fetchCrmContactsPage({ page: 1, pageSize: 50 });

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('never reuses a CRM page across authenticated user scopes', async () => {
    mockSuccessfulRpc();

    setCrmCacheScope('staff-a');
    await fetchCrmContactsPage({ page: 1, pageSize: 50 });
    await fetchCrmContactsPage({ page: 1, pageSize: 50 });
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1);

    setCrmCacheScope('staff-b');
    await fetchCrmContactsPage({ page: 1, pageSize: 50 });
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('passes the AbortSignal to Supabase', async () => {
    const query = mockSuccessfulRpc();
    const controller = new AbortController();

    await fetchCrmContactsPage(
      { page: 1, pageSize: 50 },
      { signal: controller.signal },
    );

    expect(query.abortSignal).toHaveBeenCalledOnce();
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it('does not cache failed requests', async () => {
    supabaseMocks.rpc
      .mockReturnValueOnce(rpcQuery({ data: null, error: { message: 'timeout' } }))
      .mockReturnValueOnce(rpcQuery({ data: crmPayload(), error: null }));

    await expect(fetchCrmContactsPage({ page: 1, pageSize: 50 })).rejects.toThrow('timeout');
    await expect(fetchCrmContactsPage({ page: 1, pageSize: 50 })).resolves.toMatchObject({
      filteredTotal: 1,
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('sends the contact lock version when moving the pipeline', async () => {
    mockSuccessfulRpc();
    const page = await fetchCrmContactsPage({ page: 1, pageSize: 50 });
    const contact = page.contacts[0];
    supabaseMocks.rpc.mockReset();
    supabaseMocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });

    await moveCrmContact(contact, 'contacted', '2026-07-20T14:00:00.000Z');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('crm_move_pipeline', {
      p_contact: 'contact-1',
      p_stage: 'contacted',
      p_expected_version: 8,
      p_next_action_at: '2026-07-20T14:00:00.000Z',
    });
  });

  it('allows promoting a CRM contact to Patient through the audited update RPC', async () => {
    mockSuccessfulRpc(crmPayload({
      contacts: [{
        ...crmPayload().contacts[0],
        contact_type: 'lead',
        client_id: null,
        patient_segments: [],
      }],
    }));
    const page = await fetchCrmContactsPage({ page: 1, pageSize: 50 });
    const contact = page.contacts[0];
    supabaseMocks.rpc.mockReset();
    supabaseMocks.rpc.mockResolvedValue({ data: { ok: true, client_created: true }, error: null });

    await updateCrmContact(contact, {
      displayName: 'Ana Pérez',
      phone: '+573001112233',
      email: 'ana@example.com',
      city: 'Medellín',
      contactType: 'patient',
      summary: 'Paciente promovida desde CRM',
      tags: ['vip'],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('crm_update_contact', {
      p_contact: 'contact-1',
      p_expected_version: 8,
      p_display_name: 'Ana Pérez',
      p_phone: '+573001112233',
      p_email: 'ana@example.com',
      p_city: 'Medellín',
      p_contact_type: 'patient',
      p_summary: 'Paciente promovida desde CRM',
      p_tags: ['vip'],
    });
  });
});

describe('createPatient', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
  });

  it('creates the patient with the same contact identity used by CRM', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { client_id: 'client-1', contact_id: 'contact-1' },
      error: null,
    });
    const form = new FormData();
    form.set('name', 'Paciente Uno');
    form.set('documentId', '123456');
    form.set('phone', '+57 300 111 2233');
    form.set('email', 'paciente@example.com');
    form.set('plan', 'Plan inicial');

    await createPatient(form);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('dash_create_patient', expect.objectContaining({
      p_name: 'Paciente Uno',
      p_document_id: '123456',
      p_phone: '+57 300 111 2233',
      p_email: 'paciente@example.com',
      p_plan: 'Plan inicial',
    }));
  });
});
