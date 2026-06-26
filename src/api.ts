// Capa de acceso a datos Healen OS — lee de las vistas v_dashboard_* y
// muta vía RPCs dash_*. Devuelve las formas que la UI ya consume.
import { supabase } from './supabase';
import type {
  Analytics,
  ClinicalNote,
  DateRange,
  FinanceMovement,
  FinanceSummary,
  InventoryItem,
  MovementPayload,
  NoteKind,
  Patient,
  PatientDossier,
  PatientSummary,
  Payee,
  ProductPayload,
  RevenuePoint,
  StockMovePayload,
  TimelineEvent,
} from './data';

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

export interface HealenData {
  patients: Patient[];
  inventory: InventoryItem[];
  finance: FinanceMovement[];
  movements: MovementRow[];
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
  const [patients, inventory, finance, movements] = await Promise.all([
    supabase.from('v_dashboard_patients').select('*'),
    supabase.from('v_dashboard_inventory').select('*'),
    supabase.from('v_dashboard_finance').select('*').order('date', { ascending: false }),
    supabase.from('v_dashboard_inventory_movements').select('*').limit(20),
  ]);
  return {
    patients: unwrap<Patient[]>(patients),
    inventory: unwrap<InventoryItem[]>(inventory),
    finance: unwrap<FinanceMovement[]>(finance),
    movements: unwrap<MovementRow[]>(movements),
  };
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
  const [summary, notes, timeline, revenue] = await Promise.all([
    supabase.from('v_patient_summary').select('*').eq('client_id', clientUuid).maybeSingle(),
    supabase.from('v_patient_notes').select('*').eq('client_id', clientUuid),
    supabase
      .from('v_patient_timeline')
      .select('*')
      .eq('client_id', clientUuid)
      .order('ts', { ascending: false })
      .limit(80),
    supabase.from('v_patient_revenue').select('*').eq('client_id', clientUuid).order('month', { ascending: true }),
  ]);
  if (summary.error) throw new Error(summary.error.message);
  if (notes.error) throw new Error(notes.error.message);
  if (timeline.error) throw new Error(timeline.error.message);
  if (revenue.error) throw new Error(revenue.error.message);

  const noteRows = (notes.data ?? []) as ClinicalNote[];
  noteRows.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (a.created_at < b.created_at ? 1 : -1),
  );

  return {
    summary: (summary.data ?? null) as PatientSummary | null,
    notes: noteRows,
    timeline: (timeline.data ?? []) as TimelineEvent[],
    revenue: (revenue.data ?? []) as RevenuePoint[],
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
