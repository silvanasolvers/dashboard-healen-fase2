// Capa de acceso a datos Healen OS — lee de las vistas v_dashboard_* y
// muta vía RPCs dash_*. Devuelve las formas que la UI ya consume.
import { supabase } from './supabase';
import type { FinanceMovement, InventoryItem, Patient } from './data';

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

export function upsertProduct(f: FormData) {
  return rpc('dash_upsert_product', {
    p_name: String(f.get('product') || ''),
    p_type: String(f.get('type') || 'peptido'),
    p_stock: Number(f.get('stock')) || 0,
    p_minimum: Number(f.get('minimum')) || 0,
    p_unit: String(f.get('unit') || 'unidades'),
    p_lot: String(f.get('lot') || ''),
    p_expiration: String(f.get('expiration') || '') || null,
    p_supplier: String(f.get('supplier') || ''),
    p_unit_cost: Number(f.get('unitCost')) || 0,
  });
}

export function inventoryMovement(f: FormData) {
  return rpc('dash_inventory_movement', {
    p_product: String(f.get('itemId') || ''),
    p_kind: String(f.get('kind') || 'Salida'),
    p_quantity: Number(f.get('quantity')) || 0,
    p_reason: String(f.get('reason') || ''),
    p_date: String(f.get('date') || '') || new Date().toISOString().slice(0, 10),
  });
}

export function financeEntry(f: FormData) {
  return rpc('dash_finance_entry', {
    p_kind: String(f.get('kind') || 'Ingreso'),
    p_scope: String(f.get('scope') || 'Empresa'),
    p_category: String(f.get('category') || ''),
    p_concept: String(f.get('concept') || 'Movimiento'),
    p_amount: Number(f.get('value')) || 0,
    p_date: String(f.get('date') || '') || new Date().toISOString().slice(0, 10),
    p_cost_center: String(f.get('costCenter') || 'Operacion'),
    p_payment_method: String(f.get('paymentMethod') || 'transferencia'),
    p_person: String(f.get('person') || ''),
    p_attachment_url: String(f.get('attachmentUrl') || '') || null,
    p_note: String(f.get('note') || '') || null,
  });
}
