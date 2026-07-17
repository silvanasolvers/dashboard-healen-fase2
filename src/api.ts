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
  'lost',
  'unclassified',
]);

function crmStage(value: string | null): CrmStage {
  return value && CRM_STAGE_IDS.has(value as CrmStage) ? (value as CrmStage) : 'unclassified';
}

/** Lee una vista completa en páginas para no perder contactos por el límite de PostgREST. */
async function fetchAllRows(view: string, orderColumn: string): Promise<DbRow[]> {
  const pageSize = 1000;
  const rows: DbRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(view)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
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
  const [patients, inventory, finance, movements, appointments] = await Promise.all([
    supabase.from('v_dashboard_patients').select('*'),
    supabase.from('v_dashboard_inventory').select('*'),
    supabase.from('v_dashboard_finance').select('*').order('date', { ascending: false }),
    supabase.from('v_dashboard_inventory_movements').select('*').limit(20),
    supabase.from('v_dashboard_appointments').select('*').order('date', { ascending: true }).order('time', { ascending: true }),
  ]);
  return {
    patients: unwrap<Patient[]>(patients),
    inventory: unwrap<InventoryItem[]>(inventory),
    finance: unwrap<FinanceMovement[]>(finance),
    movements: unwrap<MovementRow[]>(movements),
    appointments: unwrap<AppointmentRow[]>(appointments),
  };
}

// ---------- CRM (carga perezosa al entrar a la vista) ----------
function normalizeCrmContact(row: DbRow): CrmContact {
  const id = rowString(row, 'id') ?? '';
  const treatmentCount = rowNumber(row, 'treatment_count');
  // La vista es la fuente de verdad. Como defensa adicional, un vínculo a
  // cliente sin tratamiento no se muestra como paciente.
  const isPatient = rowBoolean(row, 'has_treatment') && treatmentCount > 0;
  const confidenceRaw = rowValue(row, 'match_confidence');
  const matchConfidence = confidenceRaw === null ? null : rowNumber(row, 'match_confidence');
  return {
    id,
    displayName: rowString(row, 'display_name') ?? 'Contacto sin nombre',
    phone: rowString(row, 'primary_phone'),
    email: rowString(row, 'primary_email'),
    city: rowString(row, 'city'),
    contactType: crmType(rowString(row, 'contact_type')),
    stage: crmStage(rowString(row, 'current_opportunity_stage')),
    lifecycleStage: rowString(row, 'lifecycle_stage'),
    responsible: rowString(row, 'owner_name'),
    summary: rowString(row, 'last_summary'),
    nextActionAt: rowString(row, 'next_action_at'),
    tags: rowTags(row),
    firstInteractionAt: rowString(row, 'first_contact_at'),
    lastInteractionAt: rowString(row, 'last_contact_at'),
    isPatient,
    clientId: rowString(row, 'client_id'),
    clientCode: rowString(row, 'client_code'),
    clientName: rowString(row, 'client_name'),
    treatmentCount,
    activeTreatmentCount: rowNumber(row, 'active_treatment_count'),
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

const EMPTY_CRM_NAMES = new Set([
  'contacto whatsapp',
  'contacto sin nombre',
  'whatsapp contact',
  'sin nombre',
  'unknown',
]);

/**
 * Oculta artefactos técnicos de WhatsApp que no aportan ningún dato al CRM.
 * Una etapa u oportunidad creada por el importador no cuenta como información
 * si el contacto sigue sin un dato visible que permita identificarlo o actuar.
 */
function hasUsefulCrmInfo(contact: CrmContact): boolean {
  const hasRealName = !EMPTY_CRM_NAMES.has(contact.displayName.trim().toLocaleLowerCase('es'));
  return Boolean(
    hasRealName ||
    contact.phone ||
    contact.email ||
    contact.city ||
    contact.responsible ||
    contact.summary ||
    contact.isPatient
  );
}

export async function fetchCrmContacts(): Promise<CrmContact[]> {
  const rows = await fetchAllRows('v_crm_contacts', 'id');
  return rows
    .map(normalizeCrmContact)
    .filter((contact) => contact.id && hasUsefulCrmInfo(contact));
}

export async function fetchCrmReviewQueue(): Promise<CrmReviewCandidate[]> {
  const rows = await fetchAllRows('v_crm_review_queue', 'candidate_id');
  return rows
    .map(normalizeReviewCandidate)
    .filter((candidate) => candidate.id)
    .sort((a, b) => b.confidence - a.confidence);
}

export function reviewCrmCandidate(
  candidateId: string,
  decision: CrmReviewDecision,
  expectedVersion: number,
  reviewNote: string | null = null,
) {
  return rpc('crm_review_candidate', {
    p_candidate: candidateId,
    p_decision: decision,
    p_expected_version: expectedVersion,
    p_review_note: reviewNote,
  });
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
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
  if (notes.error) throw new Error(notes.error.message);
  if (milestones.error) throw new Error(milestones.error.message);
  if (timeline.error) throw new Error(timeline.error.message);
  if (revenue.error) throw new Error(revenue.error.message);
  if (related.error) throw new Error(related.error.message);

  const noteRows = (notes.data ?? []) as ClinicalNote[];
  noteRows.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (a.created_at < b.created_at ? 1 : -1),
  );

  return {
    summary: (summary.data ?? null) as PatientSummary | null,
    notes: noteRows,
    milestones: (milestones.data ?? []) as PatientMilestone[],
    timeline: (timeline.data ?? []) as TimelineEvent[],
    revenue: (revenue.data ?? []) as RevenuePoint[],
    related: (related.data ?? null) as PatientRelated | null,
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
