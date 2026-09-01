// Capa de acceso a datos Healen OS — lee de las vistas v_dashboard_* y
// muta vía RPCs dash_*. Devuelve las formas que la UI ya consume.
import { supabase } from './supabase';
import type {
  Analytics,
  ClinicalNote,
  CrmContact,
  CrmContactType,
  CrmReviewCandidate,
  CrmReviewDecision,
  CrmStage,
  DailyClosure,
  DateRange,
  FinanceMovement,
  FinanceSummary,
  InventoryItem,
  MovementPayload,
  NoteKind,
  Patient,
  PatientDossier,
  PatientMilestone,
  PatientMilestoneCategory,
  PatientRelated,
  PatientSummary,
  Payee,
  Plan,
  ProductPayload,
  CrmPatientSegment,
  RevenuePoint,
  StockMovePayload,
  TimelineEvent,
} from './data';

type DbRow = Record<string, unknown>;

function rowValue(row: DbRow, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function rowString(row: DbRow, ...keys: string[]): string | null {
  const value = rowValue(row, ...keys);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function rowNumber(row: DbRow, ...keys: string[]): number {
  const value = rowValue(row, ...keys);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowBoolean(row: DbRow, ...keys: string[]): boolean {
  const value = rowValue(row, ...keys);
  return value === true || value === 1 || value === '1' || value === 'true';
}

function rowTags(row: DbRow): string[] {
  const value = rowValue(row, 'tags', 'labels');
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function rowObject(row: DbRow, key: string): Record<string, unknown> {
  const value = rowValue(row, key);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rowPatientSegments(row: DbRow): CrmPatientSegment[] {
  const value = rowValue(row, 'patient_segments');
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const segment = item as DbRow;
    const code = rowString(segment, 'code');
    const name = rowString(segment, 'name');
    if (!code || !name) return [];
    return [{
      code,
      name,
      campaignType: rowString(segment, 'campaignType', 'campaign_type') ?? 'seguimiento',
      cadence: rowString(segment, 'cadence') ?? 'manual',
      reason: rowString(segment, 'reason') ?? 'Segmento de campaña',
      source: rowString(segment, 'source', 'membership_source') ?? 'automatic',
    }];
  });
}

function crmType(value: string | null): CrmContactType {
  return value === 'lead' || value === 'patient' || value === 'supplier' || value === 'staff' || value === 'partner' || value === 'personal' || value === 'group_only' || value === 'other'
    ? value
    : 'unknown';
}

const CRM_STAGE_IDS = new Set<CrmStage>([
  'new',
  'contacted',
  'interested',
  'qualified',
  'appointment_pending',
  'appointment_scheduled',
  'converted',
  'follow_up',
  'recovery',
  'lost',
  'unclassified',
]);

function crmStage(value: string | null): CrmStage {
  return value && CRM_STAGE_IDS.has(value as CrmStage) ? (value as CrmStage) : 'unclassified';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('La solicitud fue cancelada.', 'AbortError');
}

/** Lee una vista completa en páginas; se usa solo para la bandeja lazy de revisión. */
async function fetchAllRows(view: string, orderColumn: string, signal?: AbortSignal): Promise<DbRow[]> {
  const pageSize = 1000;
  const rows: DbRow[] = [];
  for (let from = 0; ; from += pageSize) {
    throwIfAborted(signal);
    let query = supabase
      .from(view)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) {
      throwIfAborted(signal);
      throw new Error(error.message);
    }
    throwIfAborted(signal);
    const page = (data ?? []) as DbRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export interface MovementRow {
  id: string;
  product: string;
  kind: string;
  date: string;
  quantity: number;
  previousStock: number;
  resultingStock: number;
  reason: string;
}

export interface AppointmentRow {
  id: string;
  date: string;
  time: string;
  title: string;
  detail: string;
  kind: 'suero' | 'control' | 'cierre' | 'peptido' | 'consulta';
  patientId?: string | null;
  clientUuid?: string | null;
  patientName?: string | null;
  documentId?: string | null;
  eventType?: string | null;
  status?: string | null;
  tone: 'ok' | 'warn' | 'danger' | 'brand';
  sourceOriginalDate?: string | null;
  sourceCorrectedDate?: string | null;
}

export interface HealenData {
  patients: Patient[];
  inventory: InventoryItem[];
  finance: FinanceMovement[];
  movements: MovementRow[];
  appointments: AppointmentRow[];
  closures: DailyClosure[];
}

function normalizeClosure(row: DbRow): DailyClosure {
  const raw = rowObject(row, 'raw_payload');
  const optionalNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const bankBalance = raw.bancolombia_final_informado === false
    ? null
    : optionalNumber(rowValue(row, 'bank_balance'));
  const boldBalance = raw.bold_final_informado === false
    ? null
    : optionalNumber(raw.saldo_bold_final ?? raw.bold);
  const cashBalance = optionalNumber(rowValue(row, 'cash_balance'));
  const explicitClosingBalance = optionalNumber(raw.saldo_final_total ?? raw.liquidez_total_final);
  return {
    id: rowString(row, 'id') ?? '',
    date: rowString(row, 'closure_date') ?? '',
    weekday: rowString(row, 'weekday') ?? '',
    salesTotal: rowNumber(row, 'sales_total'),
    bankInflow: rowNumber(row, 'payments_total'),
    businessExpenses: rowNumber(row, 'business_expenses_total'),
    personalExpenses: optionalNumber(raw.gastos_personales) ?? 0,
    totalExpenses: optionalNumber(raw.gasto_total) ?? rowNumber(row, 'business_expenses_total'),
    cashBalance: cashBalance ?? 0,
    openingBalance: optionalNumber(raw.saldo_inicial_total),
    openingBank: optionalNumber(raw.banco_inicial),
    openingBold: optionalNumber(raw.bold_inicial),
    openingCash: optionalNumber(raw.efectivo_inicial),
    bankBalance,
    closingBank: explicitClosingBalance ?? (
      bankBalance !== null && boldBalance !== null && cashBalance !== null
        ? bankBalance + boldBalance + cashBalance
        : null
    ),
    boldBalance,
    notes: rowString(row, 'notes'),
  };
}

/** Producto del catálogo de recetas (con defaults inteligentes + stock). */
export interface CatalogItem {
  productId: string;
  name: string;
  category: string;
  unit: string;
  salePrice: number;
  defaultDose: string | null;
  defaultRoute: string | null;
  defaultFrequency: string | null;
  defaultDurationDays: number | null;
  defaultQuantity: number;
  stock: number;
  signal: 'ok' | 'warn' | 'danger';
  status: string;
  unitCost: number;
}

/** Una línea de la receta = checkout. */
export interface RxLine {
  product_id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: number | null;
  quantity: number;
  unit_price: number;
  instructions?: string;
}

export interface PrescribePayload {
  clientUuid: string;
  treatmentId?: string | null;
  planName?: string;
  charge: boolean;
  payment: number;
  method: string;
  notes?: string;
  items: RxLine[];
}

export interface PrescribeResult {
  treatment_id: string;
  sale_id: string | null;
  code: string | null;
  lines: number;
  subtotal: number;
  cogs: number;
  margin: number;
  paid: number;
  balance: number;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

/** Carga todo el estado del dashboard en paralelo. */
export async function fetchAll(): Promise<HealenData> {
  const [patients, inventory, finance, movements, appointments, closures] = await Promise.all([
    supabase.from('v_dashboard_patients').select('*'),
    supabase.from('v_dashboard_inventory').select('*'),
    supabase.from('v_dashboard_finance').select('*').order('date', { ascending: false }),
    supabase.from('v_dashboard_inventory_movements').select('*').limit(20),
    supabase.from('v_dashboard_appointments').select('*').order('date', { ascending: true }).order('time', { ascending: true }),
    supabase.from('daily_operational_closures').select('*').order('closure_date', { ascending: false }),
  ]);
  return {
    patients: unwrap<Patient[]>(patients),
    inventory: unwrap<InventoryItem[]>(inventory),
    finance: unwrap<FinanceMovement[]>(finance),
    movements: unwrap<MovementRow[]>(movements),
    appointments: unwrap<AppointmentRow[]>(appointments),
    closures: unwrap<DbRow[]>(closures).map(normalizeClosure),
  };
}

// ---------- CRM (carga perezosa al entrar a la vista) ----------
function normalizeCrmContact(row: DbRow): CrmContact {
  const id = rowString(row, 'id') ?? '';
  const treatmentCount = rowNumber(row, 'treatment_count');
  const contactType = crmType(rowString(row, 'contact_type'));
  const clientId = rowString(row, 'client_id');
  const activeTreatmentCount = rowNumber(row, 'active_treatment_count');
  // El vínculo con la ficha clínica define la categoría Paciente. La vigencia
  // del tratamiento define su etapa (activo o recuperación), no borra la relación.
  const isPatient = contactType === 'patient' || Boolean(clientId);
  const stage = isPatient && treatmentCount > 0 && activeTreatmentCount === 0
    ? 'recovery'
    : crmStage(rowString(row, 'current_opportunity_stage'));
  const confidenceRaw = rowValue(row, 'match_confidence');
  const matchConfidence = confidenceRaw === null ? null : rowNumber(row, 'match_confidence');
  return {
    id,
    displayName: rowString(row, 'display_name') ?? 'Contacto sin nombre',
    phone: rowString(row, 'primary_phone'),
    email: rowString(row, 'primary_email'),
    city: rowString(row, 'city'),
    contactType,
    stage,
    lifecycleStage: rowString(row, 'lifecycle_stage'),
    responsible: rowString(row, 'owner_name'),
    summary: rowString(row, 'last_summary'),
    nextActionAt: rowString(row, 'next_action_at'),
    tags: rowTags(row),
    firstInteractionAt: rowString(row, 'first_contact_at'),
    lastInteractionAt: rowString(row, 'last_contact_at'),
    isPatient,
    clientId,
    clientCode: rowString(row, 'client_code'),
    clientName: rowString(row, 'client_name'),
    treatmentCount,
    activeTreatmentCount,
    patientSegments: rowPatientSegments(row),
    matchStatus: rowString(row, 'match_status'),
    matchMethod: rowString(row, 'match_method'),
    matchConfidence,
    opportunityCount: rowNumber(row, 'opportunity_count'),
    openOpportunityCount: rowNumber(row, 'open_opportunity_count'),
    active: rowBoolean(row, 'active'),
    lockVersion: rowNumber(row, 'lock_version'),
    identities: rowValue(row, 'identities'),
  };
}

function normalizeReviewCandidate(row: DbRow): CrmReviewCandidate {
  return {
    id: rowString(row, 'candidate_id') ?? '',
    importRunId: rowString(row, 'import_run_id') ?? '',
    contactId: rowString(row, 'contact_id') ?? '',
    contactName: rowString(row, 'contact_name') ?? 'Contacto sin nombre',
    candidateKind: rowString(row, 'candidate_type') ?? 'field_update',
    sourceRecordKey: rowString(row, 'source_record_key') ?? '',
    status: rowString(row, 'status') ?? 'pending',
    currentData: rowObject(row, 'current_data'),
    proposedData: rowObject(row, 'proposed_data'),
    confidence: rowNumber(row, 'confidence'),
    reason: rowString(row, 'reason'),
    evidenceCount: rowNumber(row, 'evidence_count'),
    createdAt: rowString(row, 'created_at'),
    reviewedAt: rowString(row, 'reviewed_at'),
    reviewerName: rowString(row, 'reviewer_name'),
    reviewNote: rowString(row, 'review_note'),
    lockVersion: rowNumber(row, 'lock_version'),
  };
}

export interface CrmCounts {
  contacts: number;
  leads: number;
  patients: number;
  activePipeline: number;
  reviews: number;
}

export interface CrmPageParams {
  page: number;
  pageSize: number;
  search?: string;
  contactType?: string;
  stage?: string;
  segment?: string;
}

export interface CrmPageResult {
  contacts: CrmContact[];
  counts: CrmCounts;
  page: number;
  pageSize: number;
  filteredTotal: number;
  hasMore: boolean;
}

const CRM_PAGE_CACHE_TTL = 60_000;
const crmPageCache = new Map<string, { storedAt: number; value: CrmPageResult }>();
let crmCacheScope = 'signed-out';

function normalizedCrmPage(params: CrmPageParams): { page: number; pageSize: number } {
  const page = Number.isFinite(params.page) ? Math.trunc(params.page) : 1;
  const pageSize = Number.isFinite(params.pageSize) ? Math.trunc(params.pageSize) : 50;
  return {
    page: Math.max(1, page),
    pageSize: Math.max(1, Math.min(pageSize, 250)),
  };
}

function crmPageCacheKey(params: CrmPageParams): string {
  const normalized = normalizedCrmPage(params);
  return JSON.stringify({
    scope: crmCacheScope,
    page: normalized.page,
    pageSize: normalized.pageSize,
    search: params.search?.trim().toLocaleLowerCase('es') || '',
    contactType: params.contactType || 'all',
    stage: params.stage || 'all',
    segment: params.segment || 'all',
  });
}

function normalizeCrmCounts(value: unknown): CrmCounts {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as DbRow : {};
  return {
    contacts: rowNumber(row, 'contacts'),
    leads: rowNumber(row, 'leads'),
    patients: rowNumber(row, 'patients'),
    activePipeline: rowNumber(row, 'active_pipeline'),
    reviews: rowNumber(row, 'reviews'),
  };
}

export function clearCrmCache() {
  crmPageCache.clear();
}

/**
 * Aísla las páginas con datos personales por usuario. La capa de sesión llama
 * esto antes de renderizar un usuario nuevo, de modo que nunca se reutilice
 * una respuesta CRM obtenida por otra sesión en la misma SPA.
 */
export function setCrmCacheScope(userId: string | null) {
  const nextScope = userId || 'signed-out';
  if (nextScope === crmCacheScope) return;
  crmPageCache.clear();
  crmCacheScope = nextScope;
}

export async function fetchCrmContactsPage(
  params: CrmPageParams,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<CrmPageResult> {
  throwIfAborted(options.signal);
  const normalized = normalizedCrmPage(params);
  const key = crmPageCacheKey(params);
  const cached = crmPageCache.get(key);
  if (!options.force && cached && Date.now() - cached.storedAt < CRM_PAGE_CACHE_TTL) return cached.value;

  let query = supabase.rpc('crm_list_contacts', {
    p_page: normalized.page,
    p_page_size: normalized.pageSize,
    p_search: params.search?.trim() || null,
    p_contact_type: params.contactType || 'all',
    p_stage: params.stage || 'all',
    p_segment: params.segment || 'all',
  });
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) {
    throwIfAborted(options.signal);
    throw new Error(error.message);
  }
  throwIfAborted(options.signal);
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as DbRow : {};
  const rows = Array.isArray(payload.contacts) ? payload.contacts as DbRow[] : [];
  const value: CrmPageResult = {
    // La definición de contacto útil vive en PostgreSQL. Filtrar aquí rompería
    // el tamaño de página y haría que filteredTotal/hasMore dejaran de coincidir.
    contacts: rows.map(normalizeCrmContact).filter((contact) => contact.id),
    counts: normalizeCrmCounts(payload.counts),
    page: rowNumber(payload, 'page') || normalized.page,
    pageSize: rowNumber(payload, 'page_size') || normalized.pageSize,
    filteredTotal: rowNumber(payload, 'filtered_total'),
    hasMore: rowBoolean(payload, 'has_more'),
  };
  crmPageCache.set(key, { storedAt: Date.now(), value });
  if (crmPageCache.size > 40) crmPageCache.delete(crmPageCache.keys().next().value as string);
  return value;
}

export async function fetchCrmContact(contactId: string, signal?: AbortSignal): Promise<CrmContact> {
  throwIfAborted(signal);
  let query = supabase.from('v_crm_contacts').select('*').eq('id', contactId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.single();
  if (error) {
    throwIfAborted(signal);
    throw new Error(error.message);
  }
  throwIfAborted(signal);
  return normalizeCrmContact(data as DbRow);
}

export async function fetchCrmReviewQueue(signal?: AbortSignal): Promise<CrmReviewCandidate[]> {
  const rows = await fetchAllRows('v_crm_review_queue', 'candidate_id', signal);
  return rows
    .map(normalizeReviewCandidate)
    .filter((candidate) => candidate.id)
    .sort((a, b) => b.confidence - a.confidence);
}

export async function reviewCrmCandidate(
  candidateId: string,
  decision: CrmReviewDecision,
  expectedVersion: number,
  reviewNote: string | null = null,
) {
  const result = await rpc('crm_review_candidate', {
    p_candidate: candidateId,
    p_decision: decision,
    p_expected_version: expectedVersion,
    p_review_note: reviewNote,
  });
  clearCrmCache();
  return result;
}

export interface CrmContactUpdate {
  displayName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  contactType: CrmContactType;
  summary: string | null;
  tags: string[];
}

export async function updateCrmContact(contact: CrmContact, fields: CrmContactUpdate) {
  const result = await rpc('crm_update_contact', {
    p_contact: contact.id,
    p_expected_version: contact.lockVersion,
    p_display_name: fields.displayName,
    p_phone: fields.phone,
    p_email: fields.email,
    p_city: fields.city,
    p_contact_type: fields.contactType,
    p_summary: fields.summary,
    p_tags: fields.tags,
  });
  clearCrmCache();
  return result;
}

export async function moveCrmContact(contact: CrmContact, stage: CrmStage, nextActionAt: string | null = null) {
  const result = await rpc('crm_move_pipeline', {
    p_contact: contact.id,
    p_stage: stage,
    p_expected_version: contact.lockVersion,
    p_next_action_at: nextActionAt,
  });
  clearCrmCache();
  return result;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function edge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message);
  return data as T;
}

/** Catálogo de productos para recetar (con defaults + stock). */
export async function fetchCatalog(): Promise<CatalogItem[]> {
  const { data, error } = await supabase.from('v_prescribe_catalog').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogItem[];
}

/** Recetar + cobrar en un acto. */
export async function prescribeCheckout(p: PrescribePayload): Promise<PrescribeResult> {
  return rpc('prescribe_checkout', {
    p_client: p.clientUuid,
    p_items: p.items,
    p_treatment: p.treatmentId ?? null,
    p_plan_name: p.planName ?? null,
    p_charge: p.charge,
    p_payment: p.payment,
    p_method: p.method,
    p_notes: p.notes ?? null,
  }) as Promise<PrescribeResult>;
}

// ---------- Historia clínica del paciente (carga perezosa al abrir la ficha) ----------
export async function fetchDossier(clientUuid: string): Promise<PatientDossier> {
  const [summary, notes, milestones, timeline, revenue, related] = await Promise.all([
    supabase.from('v_patient_summary').select('*').eq('client_id', clientUuid).maybeSingle(),
    supabase.from('v_patient_notes').select('*').eq('client_id', clientUuid),
    supabase.from('v_patient_milestones').select('*').eq('clientId', clientUuid),
    supabase
      .from('v_patient_timeline')
      .select('*')
      .eq('client_id', clientUuid)
      .order('ts', { ascending: false })
      .limit(80),
    supabase.from('v_patient_revenue').select('*').eq('client_id', clientUuid).order('month', { ascending: true }),
    supabase.from('v_patient_related').select('*').eq('client_id', clientUuid).maybeSingle(),
  ]);
  if (summary.error) throw new Error(summary.error.message);

  // La identidad del paciente es la sección mínima obligatoria. Las secciones
  // clínicas son independientes: un error puntual en notas, hitos o dinero no
  // debe ocultar teléfono/correo ni bloquear la edición de la ficha.
  const noteRows = (notes.error ? [] : (notes.data ?? [])) as ClinicalNote[];
  noteRows.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (a.created_at < b.created_at ? 1 : -1),
  );

  return {
    summary: (summary.data ?? null) as PatientSummary | null,
    notes: noteRows,
    milestones: (milestones.error ? [] : (milestones.data ?? [])) as PatientMilestone[],
    timeline: (timeline.error ? [] : (timeline.data ?? [])) as TimelineEvent[],
    revenue: (revenue.error ? [] : (revenue.data ?? [])) as RevenuePoint[],
    related: (related.error ? null : (related.data ?? null)) as PatientRelated | null,
  };
}

export function addNote(clientUuid: string, body: string, kind: NoteKind, treatmentId?: string | null) {
  return rpc('dash_add_note', {
    p_client: clientUuid,
    p_body: body,
    p_kind: kind,
    p_treatment: treatmentId ?? null,
    p_pinned: null,
  });
}

export function deleteNote(noteId: string) {
  return rpc('dash_delete_note', { p_note: noteId });
}

export interface MilestonePayload {
  clientId: string;
  treatmentId?: string | null;
  title: string;
  description?: string | null;
  category?: PatientMilestoneCategory | string;
  modality?: string | null;
  targetDate?: string | null;
  relativeDay?: number | null;
  phase?: string | null;
  pinned?: boolean;
}

export function addMilestone(p: MilestonePayload) {
  return rpc('dash_add_milestone', {
    p_client: p.clientId,
    p_treatment: p.treatmentId ?? null,
    p_title: p.title,
    p_description: p.description ?? null,
    p_category: p.category ?? 'seguimiento',
    p_modality: p.modality ?? null,
    p_target_date: p.targetDate || null,
    p_relative_day: p.relativeDay ?? null,
    p_phase: p.phase || 'Fase 1',
    p_pinned: p.pinned ?? false,
  });
}

export function toggleMilestone(milestoneId: string, done: boolean, note?: string | null) {
  return rpc('dash_toggle_milestone', {
    p_milestone: milestoneId,
    p_done: done,
    p_note: note ?? null,
  });
}

export function deleteMilestone(milestoneId: string) {
  return rpc('dash_delete_milestone', { p_milestone: milestoneId });
}

export interface ClientFields {
  full_name?: string | null;
  document_id?: string | null;
  phone?: string | null;
  email?: string | null;
  birthdate?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** Actualiza la ficha de datos del paciente (contacto + demografía). */
export function updateClient(clientUuid: string, f: ClientFields) {
  return rpc('dash_update_client', {
    p_client: clientUuid,
    p_full_name: f.full_name || null,
    p_document_id: f.document_id || null,
    p_phone: f.phone || null,
    p_email: f.email || null,
    p_birthdate: f.birthdate || null,
    p_address: f.address || null,
    p_notes: f.notes || null,
  });
}

// ---------- Reportes / caja por rango de fechas (agregado en SQL) ----------
export async function fetchFinanceSummary(range: DateRange): Promise<FinanceSummary> {
  return rpc('dash_finance_summary', { p_from: range.from || null, p_to: range.to || null }) as Promise<FinanceSummary>;
}

export async function fetchAnalytics(range: DateRange): Promise<Analytics> {
  return rpc('dash_analytics', { p_from: range.from || null, p_to: range.to || null }) as Promise<Analytics>;
}

/** Filas de caja del periodo (filtrado server-side por fecha; la UI solo lista). */
export async function fetchFinanceRows(range: DateRange): Promise<FinanceMovement[]> {
  let q = supabase.from('v_dashboard_finance').select('*').order('date', { ascending: false });
  if (range.from) q = q.gte('date', range.from);
  if (range.to) q = q.lte('date', range.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as FinanceMovement[];
}

// ---------- Mutaciones (1:1 con los formularios) ----------
export function createPatient(f: FormData) {
  return rpc('dash_create_patient', {
    p_name: String(f.get('name') || ''),
    p_document_id: String(f.get('documentId') || '') || null,
    p_phone: String(f.get('phone') || '') || null,
    p_email: String(f.get('email') || '') || null,
    p_plan: String(f.get('plan') || ''),
    p_sale_value: Number(f.get('saleValue')) || 0,
    p_peptide: String(f.get('peptide') || ''),
    p_dose: String(f.get('dose') || ''),
    p_days_left: Number(f.get('daysLeft')) || 30,
    p_start: String(f.get('startDate') || '') || new Date().toISOString().slice(0, 10),
    p_end: String(f.get('endDate') || '') || null,
    p_serum_day: String(f.get('serumDay') || ''),
    p_weekly_serum: f.get('weeklySerum') === 'on',
  });
}

export function upsertProduct(p: ProductPayload) {
  return rpc('dash_upsert_product', {
    p_name: p.product,
    p_type: p.type || 'peptido',
    p_stock: p.stock || 0,
    p_minimum: p.minimum || 0,
    p_unit: p.unit || 'unidades',
    p_lot: p.lot || '',
    p_expiration: p.expiration || null,
    p_supplier: p.supplier || '',
    p_unit_cost: p.unitCost || 0,
    p_sale_price: p.salePrice || 0,
  });
}

export function inventoryMovement(p: StockMovePayload) {
  return rpc('dash_inventory_movement', {
    p_product: p.productId,
    p_kind: p.kind || 'Salida',
    p_quantity: p.quantity || 0,
    p_reason: p.reason || '',
    p_date: p.date || new Date().toISOString().slice(0, 10),
  });
}

// ---------- Soportes (archivos en Supabase Storage, bucket 'soportes') ----------
function safeName(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80) || 'archivo'
  );
}

/** Sube un archivo de soporte y devuelve su path (organizado por año-mes). */
export async function uploadSupport(file: File): Promise<string> {
  const now = new Date();
  const folder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const path = `${folder}/${now.getTime()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from('soportes').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Resuelve un soporte a URL descargable (signed URL del bucket, o el link si es externo). */
export async function supportUrl(pathOrUrl: string): Promise<string> {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const { data, error } = await supabase.storage.from('soportes').createSignedUrl(pathOrUrl, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Clientes + proveedores para el autocompletar del campo cliente/proveedor. */
export async function fetchPayees(): Promise<Payee[]> {
  const { data, error } = await supabase.from('v_payees').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Payee[];
}

// ---------- Planes (plantillas reutilizables de receta) ----------
/** Una línea al guardar un plan. unit_price null = precio del día. */
export interface PlanLineInput {
  product_id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: number | null;
  quantity: number;
  unit_price: number | null;
  instructions?: string;
}

export interface PlanPayload {
  planId?: string | null; // null = crear, uuid = editar
  name: string;
  notes?: string;
  items: PlanLineInput[];
}

/** Lista de planes activos con sus items (carga perezosa, no va en fetchAll). */
export async function fetchPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.from('v_plans').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Plan[];
}

/** Crea o edita un plan (reemplazo total de items). */
export function savePlan(p: PlanPayload) {
  return rpc('dash_save_plan', {
    p_plan: p.planId ?? null,
    p_name: p.name,
    p_notes: p.notes ?? null,
    p_items: p.items, // jsonb: mismo shape que p_items de prescribe_checkout (+ instructions)
  }) as Promise<{ plan_id: string; items: number }>;
}

/** Archiva un plan (soft-delete). */
export function deletePlan(planId: string) {
  return rpc('dash_delete_plan', { p_plan: planId });
}

export function financeEntry(p: MovementPayload) {
  return rpc('dash_finance_entry', {
    p_kind: p.kind,
    p_scope: p.scope || 'Empresa',
    p_category: p.category || '',
    p_concept: p.concept || 'Movimiento',
    p_amount: p.value || 0,
    p_date: p.date || new Date().toISOString().slice(0, 10),
    p_cost_center: p.costCenter || 'Operacion',
    p_payment_method: p.paymentMethod || 'transferencia',
    p_person: p.person || '',
    p_attachment_url: p.attachmentUrl || null,
    p_note: p.note || null,
    p_client_id: p.clientId,
    p_supplier_id: p.supplierId,
  });
}

// ---------- Portal del paciente (controles staff) ----------
export interface PortalPatientStatus {
  invitation: null;
  account: { status: string; email: string; lastAccessAt: string | null; onboardingCompletedAt: string | null; mustChangePassword?: boolean } | null;
  entitlement: 'active_full' | 'purchased_pending_setup' | 'former_limited' | 'suspended' | null;
  pendingCheckins: number;
  pendingRequests: number;
  pendingDocuments: number;
  aiDrafts: number;
  rewardPoints: number;
  treatmentPublished: boolean;
}

export interface PortalCheckinOperation {
  id: string;
  clientId: string;
  patientCode: string | null;
  patientName: string;
  patientPhone: string | null;
  reviewStatus: 'pending' | 'escalated' | 'reviewed' | 'dismissed';
  priority: 'routine' | 'priority' | 'urgent';
  answers: Record<string, unknown>;
  alarmFlags: string[];
  assignedTo: string | null;
  assignedName: string | null;
  assignedAt: string | null;
  dueAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
  responseToPatient: string | null;
  isOverdue: boolean;
}

export interface PortalOperationsSnapshot {
  summary: { open: number; priority: number; overdue: number; reviewedToday: number };
  items: PortalCheckinOperation[];
}

export type PortalCheckinScope = 'open' | 'priority' | 'reviewed' | 'all';

export function fetchPortalCheckinOperations(scope: PortalCheckinScope = 'open') {
  return rpc('dash_portal_checkin_operations', { p_scope: scope, p_limit: 100 }) as Promise<PortalOperationsSnapshot>;
}

export function updatePortalCheckin(
  checkinId: string,
  action: 'assign_to_me' | 'review_complete' | 'dismiss',
  response?: string,
) {
  return rpc('dash_portal_checkin_action', {
    p_checkin: checkinId,
    p_action: action,
    p_response: response?.trim() || null,
  }) as Promise<{ id: string; action: string; ok: boolean }>;
}

export type PortalAppointmentRequestType = 'new' | 'reschedule' | 'cancel';
export type PortalAppointmentRequestStatus = 'pending' | 'accepted' | 'declined' | 'resolved';
export type PortalAppointmentScope = 'open' | 'new' | 'reschedule' | 'cancel' | 'resolved' | 'all';

export interface PortalAppointmentOperation {
  id: string;
  clientId: string;
  patientCode: string | null;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  requestType: PortalAppointmentRequestType;
  status: PortalAppointmentRequestStatus;
  preferredWindow: string | null;
  message: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  assignedAt: string | null;
  dueAt: string | null;
  createdAt: string;
  staffResponse: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  isOverdue: boolean;
  isUrgent: boolean;
  appointment: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    status: string;
  } | null;
}

export interface PortalAppointmentOperationsSnapshot {
  summary: { open: number; new: number; changes: number; overdue: number; resolvedToday: number };
  items: PortalAppointmentOperation[];
}

export interface PortalAppointmentResolution {
  startsAt?: string;
  endsAt?: string;
  service?: string;
  location?: string;
  response: string;
}

export function fetchPortalAppointmentOperations(scope: PortalAppointmentScope = 'open') {
  return rpc('dash_portal_appointment_operations', { p_scope: scope, p_limit: 100 }) as Promise<PortalAppointmentOperationsSnapshot>;
}

export function updatePortalAppointment(
  requestId: string,
  action: 'assign_to_me' | 'accept' | 'decline',
  payload: PortalAppointmentResolution,
) {
  return rpc('dash_portal_appointment_action', {
    p_request: requestId,
    p_action: action,
    p_payload: payload,
  }) as Promise<{ id: string; appointmentId: string | null; action: string; ok: boolean }>;
}

/** Lee solo el estado operativo del portal para una ficha; requiere staff. */
export function fetchPortalPatientStatus(clientId: string) {
  return Promise.all([
    edge<{ data: { status: string; email?: string; lastAccessAt?: string; mustChangePassword?: boolean; entitlement?: PortalPatientStatus['entitlement'] } }>('portal-admin-bridge', { action: 'status', basicsClientId: clientId }),
    rpc('dash_portal_patient_status', { p_client: clientId }) as Promise<Partial<PortalPatientStatus>>,
    supabase.from('treatments').select('portal_visibility').eq('client_id', clientId).in('status', ['activo', 'por_finalizar']).limit(1).maybeSingle(),
  ]).then(([portal, basics, treatment]) => {
    const linked = portal.data.status !== 'not_provisioned';
    return {
      invitation: null,
      account: linked ? {
        status: portal.data.status,
        email: portal.data.email ?? '',
        lastAccessAt: portal.data.lastAccessAt ?? null,
        onboardingCompletedAt: null,
        mustChangePassword: portal.data.mustChangePassword,
      } : null,
      entitlement: portal.data.entitlement ?? null,
      pendingCheckins: Number(basics.pendingCheckins ?? 0),
      pendingRequests: Number(basics.pendingRequests ?? 0),
      pendingDocuments: Number(basics.pendingDocuments ?? 0),
      aiDrafts: Number(basics.aiDrafts ?? 0),
      rewardPoints: Number(basics.rewardPoints ?? 0),
      treatmentPublished: treatment.data?.portal_visibility === 'patient_published',
    } satisfies PortalPatientStatus;
  });
}

/** Autoriza un correo de acceso de cualquier proveedor; no crea pacientes ni envía correo. */
export function invitePortalPatient(clientId: string, email: string, entitlement?: PortalPatientStatus['entitlement']) {
  return edge<{ data: { authUserId: string; email: string; status: string }; temporaryPassword: string }>('portal-admin-bridge', {
    action: 'provision', basicsClientId: clientId, email, entitlement: entitlement ?? 'former_limited',
  });
}

/** Encola un análisis seudonimizado hecho solo con métricas validadas. */
export function queuePortalAiAnalysis(clientId: string) {
  return rpc('dash_portal_queue_ai', { p_client: clientId, p_job_type: 'progress_summary' }) as Promise<{ id: string; status: string; validatedMetrics: number }>;
}

/** Publica o retira del portal el plan y sus instrucciones; requiere rol clínico. */
export function publishPortalTreatment(treatmentId: string, publish: boolean) {
  return rpc('dash_portal_publish_treatment', { p_treatment: treatmentId, p_publish: publish }) as Promise<{ id: string; published: boolean }>;
}
