// Healen OS — modelo de dominio, datos demo y utilidades.
// Centro de medicina regenerativa: pacientes con planes de péptidos/sueros,
// inventario clínico, y caja separada empresa vs. socio.

export type View = 'inicio' | 'pacientes' | 'inventario' | 'contabilidad' | 'reportes';
export type PatientTier = 'Basico' | 'Medio' | 'Alto' | 'VIP';
export type PatientStatus = 'Activo' | 'Por finalizar' | 'Finalizado';
export type InventoryStatus = 'Disponible' | 'Bajo stock' | 'Agotado' | 'Proximo a vencer';
export type InventoryMovementKind = 'Entrada' | 'Salida' | 'Venta' | 'Ajuste';
export type MovementScope = 'Empresa' | 'Personal' | 'Retiro socio' | 'Reembolso';
export type MovementKind = 'Ingreso' | 'Gasto';
export type AccountingTab = 'ingresos' | 'egresos' | 'cobrar';
export type PatientSubView = 'pacientes' | 'alertas';
export type Tone = 'neutral' | 'success' | 'warning' | 'danger';
/** Semáforo: verde estable, ámbar atención, rojo urgente. */
export type Signal = 'ok' | 'warn' | 'danger';

export interface DateFilter {
  from: string;
  to: string;
  month: string;
  year: string;
}

export interface PeptideLine {
  name: string;
  dose: string;
  endsInDays: number;
  status: PatientStatus;
}

export interface Patient {
  id: string;
  name: string;
  plan: string;
  saleValue: number;
  tier: PatientTier;
  startDate: string;
  endDate: string;
  daysLeft: number;
  totalDays: number;
  weeklySerum: boolean;
  serumDay: string;
  status: PatientStatus;
  peptides: PeptideLine[];
}

export interface PatientHistoryItem {
  date: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning';
}

export interface PatientProductAlert {
  id: string;
  patientId: string;
  patientName: string;
  plan: string;
  product: string;
  dose: string;
  daysLeft: number;
  inventoryStock: number | null;
  inventoryUnit: string;
  inventoryMinimum: number | null;
  signal: Signal;
  statusText: string;
  nextAction: string;
  history: PatientHistoryItem[];
}

export interface InventoryItem {
  id: string;
  productId?: string;
  product: string;
  type: string;
  stock: number;
  minimum: number;
  unit: string;
  lot: string;
  expiration: string | null;
  supplier: string;
  unitCost: number;
  status: InventoryStatus;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  product: string;
  kind: InventoryMovementKind;
  date: string;
  quantity: number;
  previousStock: number;
  resultingStock: number;
  reason: string;
  responsible: string;
}

export interface FinanceMovement {
  id: string;
  kind: MovementKind;
  date: string;
  person: string;
  concept: string;
  category: string;
  value: number;
  invoiceValue?: number;
  paidValue?: number;
  dueDate?: string;
  paymentMethod: string;
  costCenter: string;
  scope: MovementScope;
  status: string;
  attachment?: string;
  attachmentUrl?: string;
  note?: string;
}

export const initialPatients: Patient[] = [
  {
    id: 'HLN-001',
    name: 'Valentina Restrepo',
    plan: 'Regeneracion celular',
    saleValue: 7200000,
    tier: 'VIP',
    startDate: '2026-06-10',
    endDate: '2026-07-22',
    daysLeft: 29,
    totalDays: 42,
    weeklySerum: true,
    serumDay: 'Miercoles',
    status: 'Activo',
    peptides: [
      { name: 'NAD+', dose: '250 mg semanal', endsInDays: 18, status: 'Activo' },
      { name: 'BPC-157', dose: '500 mcg diario', endsInDays: 4, status: 'Por finalizar' },
    ],
  },
  {
    id: 'HLN-002',
    name: 'Mariana Gil',
    plan: 'Anti-inflamatorio',
    saleValue: 3800000,
    tier: 'Alto',
    startDate: '2026-06-03',
    endDate: '2026-07-01',
    daysLeft: 6,
    totalDays: 28,
    weeklySerum: false,
    serumDay: '-',
    status: 'Por finalizar',
    peptides: [{ name: 'Thymosin Alpha', dose: '1 vial semanal', endsInDays: 6, status: 'Por finalizar' }],
  },
  {
    id: 'HLN-003',
    name: 'Camilo Arango',
    plan: 'Energia y metabolismo',
    saleValue: 1900000,
    tier: 'Medio',
    startDate: '2026-06-15',
    endDate: '2026-08-03',
    daysLeft: 41,
    totalDays: 49,
    weeklySerum: true,
    serumDay: 'Viernes',
    status: 'Activo',
    peptides: [{ name: 'Semaglutida', dose: '0.25 mg semanal', endsInDays: 41, status: 'Activo' }],
  },
  {
    id: 'HLN-004',
    name: 'Daniela Ocampo',
    plan: 'Longevidad premium',
    saleValue: 9400000,
    tier: 'VIP',
    startDate: '2026-06-18',
    endDate: '2026-08-12',
    daysLeft: 11,
    totalDays: 55,
    weeklySerum: true,
    serumDay: 'Lunes',
    status: 'Activo',
    peptides: [
      { name: 'Epitalon', dose: '10 mg ciclo', endsInDays: 11, status: 'Activo' },
      { name: 'Suero revitalizante', dose: '1 kit semanal', endsInDays: 9, status: 'Activo' },
    ],
  },
];

export const initialInventory: InventoryItem[] = [
  {
    id: 'INV-001',
    product: 'NAD+',
    type: 'Peptido',
    stock: 9,
    minimum: 12,
    unit: 'viales',
    lot: 'NAD-2606',
    expiration: '2026-08-18',
    supplier: 'Bioregen Labs',
    unitCost: 180000,
    status: 'Bajo stock',
  },
  {
    id: 'INV-002',
    product: 'Suero revitalizante',
    type: 'Suero',
    stock: 26,
    minimum: 10,
    unit: 'kits',
    lot: 'SRV-2306',
    expiration: '2026-11-02',
    supplier: 'Bioregen Labs',
    unitCost: 92000,
    status: 'Disponible',
  },
  {
    id: 'INV-003',
    product: 'BPC-157',
    type: 'Peptido',
    stock: 4,
    minimum: 8,
    unit: 'viales',
    lot: 'BPC-1906',
    expiration: '2026-07-14',
    supplier: 'Peptide Source',
    unitCost: 145000,
    status: 'Proximo a vencer',
  },
  {
    id: 'INV-004',
    product: 'Epitalon',
    type: 'Peptido',
    stock: 14,
    minimum: 6,
    unit: 'viales',
    lot: 'EPI-2206',
    expiration: '2026-10-09',
    supplier: 'Peptide Source',
    unitCost: 210000,
    status: 'Disponible',
  },
];

export const initialInventoryMovements: InventoryMovement[] = [
  {
    id: 'IMV-001',
    itemId: 'INV-001',
    product: 'NAD+',
    kind: 'Salida',
    date: '2026-06-22',
    quantity: 3,
    previousStock: 12,
    resultingStock: 9,
    reason: 'Uso en tratamiento regenerativo',
    responsible: 'Equipo Healen',
  },
  {
    id: 'IMV-002',
    itemId: 'INV-002',
    product: 'Suero revitalizante',
    kind: 'Venta',
    date: '2026-06-21',
    quantity: 2,
    previousStock: 28,
    resultingStock: 26,
    reason: 'Venta de kit semanal',
    responsible: 'Recepcion',
  },
];

export const initialFinance: FinanceMovement[] = [
  {
    id: 'MOV-001',
    kind: 'Ingreso',
    date: '2026-06-20',
    person: 'Valentina Restrepo',
    concept: 'Plan regenerativo',
    category: 'Tratamientos',
    value: 3600000,
    invoiceValue: 7200000,
    paidValue: 3600000,
    paymentMethod: 'Transferencia',
    costCenter: 'Operacion',
    scope: 'Empresa',
    status: 'Recibido',
  },
  {
    id: 'MOV-002',
    kind: 'Gasto',
    date: '2026-06-21',
    person: 'Bioregen Labs',
    concept: 'Compra de insumos',
    category: 'Inventario',
    value: 820000,
    paidValue: 820000,
    paymentMethod: 'Tarjeta',
    costCenter: 'Inventario',
    scope: 'Empresa',
    status: 'Pagado',
    attachment: 'soporte-gasto.jpg',
    attachmentUrl: 'https://drive.google.com/soporte-gasto-demo',
  },
  {
    id: 'MOV-003',
    kind: 'Gasto',
    date: '2026-06-22',
    person: 'Socio',
    concept: 'Retiro personal',
    category: 'Personal',
    value: 450000,
    paidValue: 450000,
    paymentMethod: 'Efectivo',
    costCenter: 'Personal',
    scope: 'Retiro socio',
    status: 'Pagado',
  },
  {
    id: 'MOV-004',
    kind: 'Ingreso',
    date: '2026-06-03',
    person: 'Mariana Gil',
    concept: 'Plan anti-inflamatorio',
    category: 'Cuentas por cobrar',
    value: 1100000,
    invoiceValue: 3800000,
    paidValue: 2700000,
    dueDate: '2026-06-16',
    paymentMethod: 'Pendiente',
    costCenter: 'Operacion',
    scope: 'Empresa',
    status: 'Vencido',
    note: 'Saldo de cierre de tratamiento pendiente por recaudo.',
  },
  {
    id: 'MOV-005',
    kind: 'Ingreso',
    date: '2026-06-15',
    person: 'Camilo Arango',
    concept: 'Plan energia y metabolismo',
    category: 'Cuentas por cobrar',
    value: 1000000,
    invoiceValue: 1900000,
    paidValue: 900000,
    dueDate: '2026-06-28',
    paymentMethod: 'Pendiente',
    costCenter: 'Operacion',
    scope: 'Empresa',
    status: 'Pendiente',
    note: 'Pendiente antes de la siguiente entrega de peptidos.',
  },
  {
    id: 'MOV-006',
    kind: 'Ingreso',
    date: '2026-06-19',
    person: 'Daniela Ocampo',
    concept: 'Plan longevidad premium',
    category: 'Tratamientos',
    value: 4700000,
    invoiceValue: 9400000,
    paidValue: 4700000,
    paymentMethod: 'Transferencia',
    costCenter: 'Operacion',
    scope: 'Empresa',
    status: 'Recibido',
  },
];

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number) {
  return currency.format(value);
}

/** Versión compacta para cifras grandes glanceables: $7,2 M */
export function formatCompact(value: number) {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toLocaleString('es-CO', { maximumFractionDigits: 0 })} K`;
  }
  return formatCurrency(value);
}

export function formatDate(value: string) {
  if (!value || value === '-') return value;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

export function daysFromDueDate(dueDate?: string) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const diff = today.getTime() - due.getTime();
  return Math.ceil(diff / 86400000);
}

export function dueLabel(movement: FinanceMovement) {
  const days = daysFromDueDate(movement.dueDate);
  if (days === null) return movement.status === 'Vencido' ? 'Sin fecha limite' : 'Sin fecha';
  if (days > 0) return `${days} dias en mora`;
  if (days === 0) return 'Vence hoy';
  return `Vence en ${Math.abs(days)} dias`;
}

export function inventoryStatus(stock: number, minimum: number, expiration: string): InventoryStatus {
  if (stock <= 0) return 'Agotado';
  if (stock <= minimum) return 'Bajo stock';
  const expirationDate = new Date(`${expiration}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToExpire = Math.ceil((expirationDate.getTime() - today.getTime()) / 86400000);
  if (daysToExpire <= 30) return 'Proximo a vencer';
  return 'Disponible';
}

export function classifySale(value: number): PatientTier {
  if (value >= 6000000) return 'VIP';
  if (value >= 3500000) return 'Alto';
  if (value >= 1500000) return 'Medio';
  return 'Basico';
}

/** Semáforo central: días restantes → señal de tratamiento. */
export function treatmentSignal(daysLeft: number): Signal {
  if (daysLeft <= 5) return 'danger';
  if (daysLeft <= 12) return 'warn';
  return 'ok';
}

/** Semáforo de inventario: stock vs mínimo y estado. */
export function stockSignal(item: InventoryItem): Signal {
  if (item.stock <= 0 || item.status === 'Agotado') return 'danger';
  if (item.stock <= item.minimum || item.status === 'Bajo stock' || item.status === 'Proximo a vencer') return 'warn';
  return 'ok';
}

export const emptyDateFilter: DateFilter = { from: '', to: '', month: '', year: '' };

export function hasDateFilter(filter: DateFilter) {
  return Boolean(filter.from || filter.to || filter.month || filter.year);
}

export function matchesDateFilter(date: string, filter: DateFilter) {
  if (!hasDateFilter(filter)) return true;
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  if (filter.month && !date.startsWith(filter.month)) return false;
  if (filter.year && !date.startsWith(filter.year)) return false;
  return true;
}

export function matchesTreatmentFilter(patient: Patient, filter: DateFilter) {
  if (!hasDateFilter(filter)) return true;
  return matchesDateFilter(patient.startDate, filter) || matchesDateFilter(patient.endDate, filter);
}

export function isReceivable(movement: FinanceMovement) {
  return (
    movement.kind === 'Ingreso' &&
    (movement.status === 'Pendiente' ||
      movement.status === 'Vencido' ||
      movement.paymentMethod === 'Pendiente' ||
      movement.category.toLowerCase().includes('cobrar'))
  );
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function signalLabel(signal: Signal) {
  if (signal === 'danger') return 'Urgente';
  if (signal === 'warn') return 'Atencion';
  return 'Estable';
}

export function statusTone(status: string): Tone {
  const normalized = status.toLowerCase();
  if (normalized.includes('vencer') || normalized.includes('finalizar') || normalized.includes('bajo')) return 'warning';
  if (normalized.includes('agotado') || normalized.includes('vencido')) return 'danger';
  if (normalized.includes('vip') || normalized.includes('recibido') || normalized.includes('pagado')) return 'success';
  return 'neutral';
}

export function buildPatientProductAlerts(patients: Patient[], inventory: InventoryItem[]): PatientProductAlert[] {
  const inventoryByProduct = inventory.reduce<Record<string, InventoryItem>>((acc, item) => {
    acc[normalizeKey(item.product)] = item;
    return acc;
  }, {});

  return patients.flatMap((patient) =>
    patient.peptides.map((peptide) => {
      const inventoryItem = inventoryByProduct[normalizeKey(peptide.name)];
      const stock = inventoryItem?.stock ?? null;
      const minimum = inventoryItem?.minimum ?? null;
      const hasCriticalStock = stock !== null && stock <= 0;
      const hasLowStock = stock !== null && minimum !== null && stock <= minimum;
      const signal: Signal =
        peptide.endsInDays <= 2 || hasCriticalStock
          ? 'danger'
          : peptide.endsInDays <= 5 || hasLowStock
            ? 'warn'
            : 'ok';
      const statusText =
        signal === 'danger'
          ? 'Reposicion inmediata'
          : peptide.endsInDays <= 5
            ? 'Alerta 5 dias'
            : hasLowStock
              ? 'Bajo stock'
              : signal === 'warn'
                ? 'Revision preventiva'
                : 'Tratamiento estable';
      const nextAction =
        signal === 'danger'
          ? 'Separar producto hoy, contactar al paciente y confirmar continuidad.'
          : peptide.endsInDays <= 5
            ? 'Revisar inventario, avisar al paciente y programar recompra antes del cierre.'
            : hasLowStock
              ? 'Reponer o separar stock antes de la siguiente entrega del paciente.'
              : 'Mantener seguimiento normal y volver a revisar en la proxima actualizacion.';
      const stockCopy =
        stock === null
          ? 'Producto sin inventario asociado.'
          : `Inventario actual: ${stock} ${inventoryItem?.unit ?? 'unidades'}; minimo sugerido: ${minimum}.`;

      return {
        id: `${patient.id}-${normalizeKey(peptide.name)}`,
        patientId: patient.id,
        patientName: patient.name,
        plan: patient.plan,
        product: peptide.name,
        dose: peptide.dose,
        daysLeft: peptide.endsInDays,
        inventoryStock: stock,
        inventoryUnit: inventoryItem?.unit ?? 'unidades',
        inventoryMinimum: minimum,
        signal,
        statusText,
        nextAction,
        history: [
          {
            date: patient.startDate,
            title: 'Producto asignado',
            detail: `${peptide.name} quedo asociado al tratamiento ${patient.plan}.`,
            tone: 'success',
          },
          {
            date: peptide.endsInDays <= 5 ? 'Hoy' : patient.endDate,
            title: peptide.endsInDays <= 5 ? 'Alerta previa al cierre' : 'Seguimiento programado',
            detail:
              peptide.endsInDays <= 5
                ? `Quedan ${peptide.endsInDays} dias de producto. Debe revisarse antes de que se acabe.`
                : `Quedan ${peptide.endsInDays} dias; todavia no requiere alerta critica.`,
            tone: peptide.endsInDays <= 5 ? 'warning' : 'neutral',
          },
          {
            date: 'Inventario',
            title: signalLabel(signal),
            detail: `${statusText}. ${stockCopy}`,
            tone: signal === 'ok' ? 'success' : 'warning',
          },
        ],
      };
    }),
  );
}

export function patientHistory(patient: Patient): PatientHistoryItem[] {
  return [
    {
      date: patient.startDate,
      title: 'Inicio del tratamiento',
      detail: `${patient.plan} registrado con valor de ${formatCurrency(patient.saleValue)}.`,
      tone: 'success',
    },
    ...patient.peptides.map(
      (peptide) =>
        ({
          date: patient.startDate,
          title: `Peptido: ${peptide.name}`,
          detail: `${peptide.dose}. Estado: ${peptide.status}. Restan ${peptide.endsInDays} dias.`,
          tone: peptide.status === 'Por finalizar' ? 'warning' : 'neutral',
        }) satisfies PatientHistoryItem,
    ),
    {
      date: patient.weeklySerum ? patient.serumDay : '-',
      title: patient.weeklySerum ? 'Suero semanal activo' : 'Sin suero semanal',
      detail: patient.weeklySerum
        ? `Paciente agendado para suero semanal los ${patient.serumDay}.`
        : 'No tiene suero semanal marcado para este tratamiento.',
      tone: patient.weeklySerum ? 'success' : 'neutral',
    },
    {
      date: patient.endDate,
      title: patient.daysLeft <= 10 ? 'Cierre proximo' : 'Finalizacion estimada',
      detail:
        patient.daysLeft <= 10
          ? `Quedan ${patient.daysLeft} dias. Revisar cierre, recompra o continuidad.`
          : `Finalizacion estimada en ${patient.daysLeft} dias.`,
      tone: patient.daysLeft <= 10 ? 'warning' : 'neutral',
    },
  ];
}

export function sumBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const group = key(item);
    acc[group] = (acc[group] ?? 0) + value(item);
    return acc;
  }, {});
}
