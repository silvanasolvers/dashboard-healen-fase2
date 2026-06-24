import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Camera,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Dna,
  Download,
  Eye,
  FileText,
  Filter,
  LayoutDashboard,
  Layers3,
  Menu,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Syringe,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { ElementType, FormEvent, useEffect, useState } from 'react';

type View = 'inicio' | 'pacientes' | 'inventario' | 'contabilidad' | 'reportes';
type PatientTier = 'Basico' | 'Medio' | 'Alto' | 'VIP';
type PatientStatus = 'Activo' | 'Por finalizar' | 'Finalizado';
type InventoryStatus = 'Disponible' | 'Bajo stock' | 'Agotado' | 'Proximo a vencer';
type MovementScope = 'Empresa' | 'Personal' | 'Retiro socio' | 'Reembolso';
type MovementKind = 'Ingreso' | 'Gasto';
type AccountingTab = 'ingresos' | 'egresos' | 'cobrar';

interface DateFilter {
  from: string;
  to: string;
  month: string;
  year: string;
}

interface PeptideLine {
  name: string;
  dose: string;
  endsInDays: number;
  status: PatientStatus;
}

interface Patient {
  id: string;
  name: string;
  plan: string;
  saleValue: number;
  tier: PatientTier;
  startDate: string;
  endDate: string;
  daysLeft: number;
  weeklySerum: boolean;
  serumDay: string;
  status: PatientStatus;
  peptides: PeptideLine[];
}

interface InventoryItem {
  id: string;
  product: string;
  type: string;
  stock: number;
  minimum: number;
  unit: string;
  lot: string;
  expiration: string;
  supplier: string;
  unitCost: number;
  status: InventoryStatus;
}

interface FinanceMovement {
  id: string;
  kind: MovementKind;
  date: string;
  person: string;
  concept: string;
  category: string;
  value: number;
  paymentMethod: string;
  costCenter: string;
  scope: MovementScope;
  status: 'Recibido' | 'Pendiente' | 'Pagado' | 'Vencido';
  attachment?: string;
  attachmentPreview?: string;
}

const navItems: Array<{ id: View; label: string; icon: ElementType }> = [
  { id: 'inicio', label: 'Inicio', icon: LayoutDashboard },
  { id: 'pacientes', label: 'Pacientes', icon: UserRound },
  { id: 'inventario', label: 'Inventario', icon: PackageCheck },
  { id: 'contabilidad', label: 'Contabilidad', icon: WalletCards },
  { id: 'reportes', label: 'Reportes', icon: BarChart3 },
];

const initialPatients: Patient[] = [
  {
    id: 'HLN-001',
    name: 'Paciente demo 1',
    plan: 'Regeneracion celular',
    saleValue: 7200000,
    tier: 'VIP',
    startDate: '2026-06-10',
    endDate: '2026-07-22',
    daysLeft: 29,
    weeklySerum: true,
    serumDay: 'Miercoles',
    status: 'Activo',
    peptides: [
      { name: 'NAD+', dose: '250 mg semanal', endsInDays: 18, status: 'Activo' },
      { name: 'BPC-157', dose: '500 mcg diario', endsInDays: 6, status: 'Por finalizar' },
    ],
  },
  {
    id: 'HLN-002',
    name: 'Paciente demo 2',
    plan: 'Anti-inflamatorio',
    saleValue: 3800000,
    tier: 'Alto',
    startDate: '2026-06-03',
    endDate: '2026-07-01',
    daysLeft: 8,
    weeklySerum: false,
    serumDay: '-',
    status: 'Por finalizar',
    peptides: [{ name: 'Thymosin Alpha', dose: '1 vial semanal', endsInDays: 8, status: 'Por finalizar' }],
  },
  {
    id: 'HLN-003',
    name: 'Paciente demo 3',
    plan: 'Energia y metabolismo',
    saleValue: 1900000,
    tier: 'Medio',
    startDate: '2026-06-15',
    endDate: '2026-08-03',
    daysLeft: 41,
    weeklySerum: true,
    serumDay: 'Viernes',
    status: 'Activo',
    peptides: [{ name: 'Semaglutida', dose: '0.25 mg semanal', endsInDays: 41, status: 'Activo' }],
  },
];

const initialInventory: InventoryItem[] = [
  {
    id: 'INV-001',
    product: 'NAD+',
    type: 'Peptido',
    stock: 9,
    minimum: 12,
    unit: 'viales',
    lot: 'NAD-2606',
    expiration: '2026-08-18',
    supplier: 'Proveedor demo',
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
    supplier: 'Proveedor demo',
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
    supplier: 'Proveedor demo',
    unitCost: 145000,
    status: 'Proximo a vencer',
  },
];

const initialFinance: FinanceMovement[] = [
  {
    id: 'MOV-001',
    kind: 'Ingreso',
    date: '2026-06-20',
    person: 'Paciente demo 1',
    concept: 'Plan regenerativo',
    category: 'Tratamientos',
    value: 3600000,
    paymentMethod: 'Transferencia',
    costCenter: 'Operacion',
    scope: 'Empresa',
    status: 'Recibido',
  },
  {
    id: 'MOV-002',
    kind: 'Gasto',
    date: '2026-06-21',
    person: 'Proveedor demo',
    concept: 'Compra de insumos',
    category: 'Inventario',
    value: 820000,
    paymentMethod: 'Tarjeta',
    costCenter: 'Inventario',
    scope: 'Empresa',
    status: 'Pagado',
    attachment: 'soporte-gasto.jpg',
  },
  {
    id: 'MOV-003',
    kind: 'Gasto',
    date: '2026-06-22',
    person: 'Socio',
    concept: 'Retiro personal',
    category: 'Personal',
    value: 450000,
    paymentMethod: 'Efectivo',
    costCenter: 'Personal',
    scope: 'Retiro socio',
    status: 'Pagado',
  },
  {
    id: 'MOV-004',
    kind: 'Ingreso',
    date: '2026-06-23',
    person: 'Paciente demo 2',
    concept: 'Saldo pendiente',
    category: 'Cuentas por cobrar',
    value: 1100000,
    paymentMethod: 'Pendiente',
    costCenter: 'Operacion',
    scope: 'Empresa',
    status: 'Pendiente',
  },
];

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currency.format(value);
}

function classifySale(value: number): PatientTier {
  if (value >= 6000000) return 'VIP';
  if (value >= 3500000) return 'Alto';
  if (value >= 1500000) return 'Medio';
  return 'Basico';
}

const emptyDateFilter: DateFilter = {
  from: '',
  to: '',
  month: '',
  year: '',
};

function hasDateFilter(filter: DateFilter) {
  return Boolean(filter.from || filter.to || filter.month || filter.year);
}

function matchesDateFilter(date: string, filter: DateFilter) {
  if (!hasDateFilter(filter)) return true;
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  if (filter.month && !date.startsWith(filter.month)) return false;
  if (filter.year && !date.startsWith(filter.year)) return false;
  return true;
}

function matchesTreatmentFilter(patient: Patient, filter: DateFilter) {
  if (!hasDateFilter(filter)) return true;
  return matchesDateFilter(patient.startDate, filter) || matchesDateFilter(patient.endDate, filter);
}

function isReceivable(movement: FinanceMovement) {
  return (
    movement.kind === 'Ingreso' &&
    (movement.status === 'Pendiente' ||
      movement.status === 'Vencido' ||
      movement.paymentMethod === 'Pendiente' ||
      movement.category.toLowerCase().includes('cobrar'))
  );
}

function sumBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const group = key(item);
    acc[group] = (acc[group] ?? 0) + value(item);
    return acc;
  }, {});
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('vencer') || normalized.includes('finalizar') || normalized.includes('bajo')) return 'warning';
  if (normalized.includes('agotado') || normalized.includes('vencido')) return 'danger';
  if (normalized.includes('vip') || normalized.includes('recibido') || normalized.includes('pagado')) return 'success';
  return 'neutral';
}

function Loader() {
  return (
    <div className="loader-screen" aria-label="Cargando dashboard Healen">
      <div className="cell-loader">
        <span className="cell cell-a" />
        <span className="cell cell-b" />
        <span className="cell cell-c" />
        <span className="cell cell-d" />
        <span className="cell cell-core" />
      </div>
      <div className="loader-copy">
        <strong>HEALEN</strong>
        <span>Bienvenido. Sincronizando pacientes, inventario y flujo financiero.</span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'neutral',
  action,
  onClick,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ElementType;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  action?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{helper}</span>
        {action && <em>{action}</em>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button className={`stat-card ${tone} interactive-card`} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return (
    <article className={`stat-card ${tone}`}>
      {content}
    </article>
  );
}

function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('inicio');
  const [menuOpen, setMenuOpen] = useState(false);
  const [patients, setPatients] = useState(initialPatients);
  const [inventory, setInventory] = useState(initialInventory);
  const [finance, setFinance] = useState(initialFinance);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientFilter, setPatientFilter] = useState<DateFilter>(emptyDateFilter);
  const [inventoryFilter, setInventoryFilter] = useState<DateFilter>(emptyDateFilter);
  const [financeFilter, setFinanceFilter] = useState<DateFilter>(emptyDateFilter);
  const [reportFilter, setReportFilter] = useState<DateFilter>(emptyDateFilter);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 2100);
    return () => window.clearTimeout(timer);
  }, []);

  const companyMovements = finance.filter((movement) => movement.scope === 'Empresa');
  const companyIncome = companyMovements
    .filter((movement) => movement.kind === 'Ingreso' && movement.status !== 'Pendiente')
    .reduce((total, movement) => total + movement.value, 0);
  const pendingIncome = companyMovements
    .filter((movement) => movement.kind === 'Ingreso' && movement.status === 'Pendiente')
    .reduce((total, movement) => total + movement.value, 0);
  const companyExpenses = companyMovements
    .filter((movement) => movement.kind === 'Gasto')
    .reduce((total, movement) => total + movement.value, 0);
  const personalOut = finance
    .filter((movement) => movement.scope !== 'Empresa')
    .reduce((total, movement) => total + movement.value, 0);
  const netProfit = companyIncome - companyExpenses;
  const lowStock = inventory.filter((item) => item.stock <= item.minimum || item.status !== 'Disponible').length;
  const serumCount = patients.filter((patient) => patient.weeklySerum && patient.status !== 'Finalizado').length;
  const finishingTreatments = patients.filter((patient) => patient.daysLeft <= 10 && patient.status !== 'Finalizado').length;

  const filteredPatients = patients.filter((patient) => {
    const text = `${patient.id} ${patient.name} ${patient.plan} ${patient.tier}`.toLowerCase();
    return text.includes(patientSearch.toLowerCase()) && matchesTreatmentFilter(patient, patientFilter);
  });
  const filteredInventory = inventory.filter((item) => matchesDateFilter(item.expiration, inventoryFilter));
  const filteredFinance = finance.filter((movement) => matchesDateFilter(movement.date, financeFilter));
  const reportPatients = patients.filter((patient) => matchesTreatmentFilter(patient, reportFilter));
  const reportInventory = inventory.filter((item) => matchesDateFilter(item.expiration, reportFilter));
  const reportFinance = finance.filter((movement) => matchesDateFilter(movement.date, reportFilter));

  function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saleValue = Number(form.get('saleValue')) || 0;
    const newPatient: Patient = {
      id: `HLN-${String(patients.length + 1).padStart(3, '0')}`,
      name: String(form.get('name') || 'Paciente nuevo'),
      plan: String(form.get('plan') || 'Plan personalizado'),
      saleValue,
      tier: classifySale(saleValue),
      startDate: String(form.get('startDate') || '2026-06-23'),
      endDate: String(form.get('endDate') || '2026-07-23'),
      daysLeft: Number(form.get('daysLeft')) || 30,
      weeklySerum: form.get('weeklySerum') === 'on',
      serumDay: String(form.get('serumDay') || '-'),
      status: 'Activo',
      peptides: [
        {
          name: String(form.get('peptide') || 'Peptido personalizado'),
          dose: String(form.get('dose') || 'Dosis por definir'),
          endsInDays: Number(form.get('daysLeft')) || 30,
          status: 'Activo',
        },
      ],
    };
    setPatients((current) => [newPatient, ...current]);
    event.currentTarget.reset();
  }

  function addInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stock = Number(form.get('stock')) || 0;
    const minimum = Number(form.get('minimum')) || 0;
    const status: InventoryStatus = stock === 0 ? 'Agotado' : stock <= minimum ? 'Bajo stock' : 'Disponible';
    const newItem: InventoryItem = {
      id: `INV-${String(inventory.length + 1).padStart(3, '0')}`,
      product: String(form.get('product') || 'Producto nuevo'),
      type: String(form.get('type') || 'Insumo'),
      stock,
      minimum,
      unit: String(form.get('unit') || 'unidades'),
      lot: String(form.get('lot') || 'Sin lote'),
      expiration: String(form.get('expiration') || '2026-12-31'),
      supplier: String(form.get('supplier') || 'Proveedor'),
      unitCost: Number(form.get('unitCost')) || 0,
      status,
    };
    setInventory((current) => [newItem, ...current]);
    event.currentTarget.reset();
  }

  function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = String(form.get('kind') || 'Ingreso') as MovementKind;
    const paymentMethod = String(form.get('paymentMethod') || 'Transferencia');
    let status = String(form.get('status') || (kind === 'Ingreso' ? 'Recibido' : 'Pagado')) as FinanceMovement['status'];
    if (kind === 'Ingreso' && paymentMethod === 'Pendiente') status = 'Pendiente';
    const attachmentFile = form.get('attachment');
    const hasAttachment = attachmentFile instanceof File && attachmentFile.size > 0;
    const newMovement: FinanceMovement = {
      id: `MOV-${String(finance.length + 1).padStart(3, '0')}`,
      kind,
      date: String(form.get('date') || '2026-06-23'),
      person: String(form.get('person') || 'Sin nombre'),
      concept: String(form.get('concept') || 'Movimiento'),
      category: String(form.get('category') || 'General'),
      value: Number(form.get('value')) || 0,
      paymentMethod,
      costCenter: String(form.get('costCenter') || 'Operacion'),
      scope: String(form.get('scope') || 'Empresa') as MovementScope,
      status,
      attachment: hasAttachment ? attachmentFile.name : undefined,
      attachmentPreview: hasAttachment ? URL.createObjectURL(attachmentFile) : undefined,
    };
    setFinance((current) => [newMovement, ...current]);
    event.currentTarget.reset();
  }

  const activeLabel = navItems.find((item) => item.id === view)?.label ?? 'Inicio';

  return (
    <div className="app-shell">
      {loading && <Loader />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Dna size={20} />
          </div>
          <div>
            <strong>Healen</strong>
            <span>Control Center</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => {
                  setView(item.id);
                  setMenuOpen(false);
                }}
                type="button"
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <ShieldCheck size={18} />
          <span>Prototipo demo</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} type="button">
            <Menu size={20} />
          </button>
          <div>
            <span>{activeLabel}</span>
            <h1>Hola, equipo Healen.</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setView('pacientes')} type="button" aria-label="Buscar pacientes">
              <Search size={18} />
            </button>
            <button
              className="primary-action"
              onClick={() => setView(view === 'pacientes' || view === 'inventario' ? view : 'contabilidad')}
              type="button"
            >
              <Plus size={18} />
              Nuevo registro
            </button>
          </div>
        </header>

        {menuOpen && (
          <button className="scrim" onClick={() => setMenuOpen(false)} type="button" aria-label="Cerrar menu">
            <X size={22} />
          </button>
        )}

        {view === 'inicio' && (
          <DashboardView
            companyIncome={companyIncome}
            companyExpenses={companyExpenses}
            netProfit={netProfit}
            pendingIncome={pendingIncome}
            personalOut={personalOut}
            patients={patients}
            inventory={inventory}
            lowStock={lowStock}
            serumCount={serumCount}
            finishingTreatments={finishingTreatments}
            setView={setView}
          />
        )}
        {view === 'pacientes' && (
          <PatientsView
            patients={filteredPatients}
            patientSearch={patientSearch}
            setPatientSearch={setPatientSearch}
            patientFilter={patientFilter}
            setPatientFilter={setPatientFilter}
            addPatient={addPatient}
          />
        )}
        {view === 'inventario' && (
          <InventoryView
            inventory={filteredInventory}
            inventoryFilter={inventoryFilter}
            setInventoryFilter={setInventoryFilter}
            addInventory={addInventory}
          />
        )}
        {view === 'contabilidad' && (
          <AccountingView
            finance={filteredFinance}
            financeFilter={financeFilter}
            setFinanceFilter={setFinanceFilter}
            addMovement={addMovement}
          />
        )}
        {view === 'reportes' && (
          <ReportsView
            patients={reportPatients}
            inventory={reportInventory}
            finance={reportFinance}
            reportFilter={reportFilter}
            setReportFilter={setReportFilter}
          />
        )}
      </main>
    </div>
  );
}

function DashboardView({
  companyIncome,
  companyExpenses,
  netProfit,
  pendingIncome,
  personalOut,
  patients,
  inventory,
  lowStock,
  serumCount,
  finishingTreatments,
  setView,
}: {
  companyIncome: number;
  companyExpenses: number;
  netProfit: number;
  pendingIncome: number;
  personalOut: number;
  patients: Patient[];
  inventory: InventoryItem[];
  lowStock: number;
  serumCount: number;
  finishingTreatments: number;
  setView: (view: View) => void;
}) {
  return (
    <div className="content-stack">
      <section className="welcome-band">
        <div>
          <span className="demo-pill">Healen OS · Datos demo</span>
          <h2>Un centro de mando para pacientes, inventario y rentabilidad real.</h2>
          <p>
            Hoy hay {patients.length} pacientes activos, {finishingTreatments} tratamientos por finalizar y {lowStock}{' '}
            alertas de inventario. Cada tarjeta abre su modulo para revisar el detalle.
          </p>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Ingresos empresa" value={formatCurrency(companyIncome)} helper="Recibidos este mes" icon={TrendingUp} tone="success" action="Abrir caja" onClick={() => setView('contabilidad')} />
        <StatCard label="Gastos empresa" value={formatCurrency(companyExpenses)} helper="Operativos registrados" icon={CreditCard} tone="warning" action="Ver desglose" onClick={() => setView('contabilidad')} />
        <StatCard label="Utilidad real" value={formatCurrency(netProfit)} helper="Sin gastos personales" icon={CircleDollarSign} tone="success" action="Ver reportes" onClick={() => setView('reportes')} />
        <StatCard label="Por cobrar" value={formatCurrency(pendingIncome)} helper="Pendiente de recaudo" icon={CalendarClock} tone="warning" action="Revisar cartera" onClick={() => setView('contabilidad')} />
      </section>

      <section className="dashboard-grid">
        <article className="panel span-2">
          <SectionHeader eyebrow="Alertas" title="Prioridades de hoy" />
          <div className="alert-list">
            <AlertItem icon={Dna} title={`${finishingTreatments} tratamientos por finalizar`} text="Abrir pacientes y revisar dosis, cierre y siguiente compra." tone="warning" onClick={() => setView('pacientes')} />
            <AlertItem icon={Syringe} title={`${serumCount} sueros semanales activos`} text="Abrir seguimiento de pacientes con agenda semanal." tone="success" onClick={() => setView('pacientes')} />
            <AlertItem icon={PackageCheck} title={`${lowStock} productos requieren revision`} text="Abrir inventario para bajo stock o vencimiento cercano." tone="danger" onClick={() => setView('inventario')} />
            <AlertItem icon={WalletCards} title={formatCurrency(personalOut)} text="Abrir caja personal separada de empresa." tone="neutral" onClick={() => setView('contabilidad')} />
          </div>
        </article>

        <article className="panel">
          <SectionHeader eyebrow="Accesos" title="Registro inteligente" />
          <div className="quick-actions">
            <button onClick={() => setView('pacientes')} type="button">
              <UserRound size={18} />
              Paciente
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setView('inventario')} type="button">
              <PackageCheck size={18} />
              Inventario
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setView('contabilidad')} type="button">
              <WalletCards size={18} />
              Movimiento
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setView('reportes')} type="button">
              <BarChart3 size={18} />
              Reportes
              <ChevronRight size={16} />
            </button>
          </div>
        </article>

        <article className="panel span-2">
          <SectionHeader eyebrow="Tratamientos" title="Pacientes en seguimiento" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Plan</th>
                  <th>Categoria</th>
                  <th>Dias</th>
                  <th>Suero</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <strong>{patient.name}</strong>
                      <span>{patient.id}</span>
                    </td>
                    <td>{patient.plan}</td>
                    <td>
                      <Badge label={patient.tier} tone={patient.tier === 'VIP' ? 'success' : 'neutral'} />
                    </td>
                    <td>{patient.daysLeft}</td>
                    <td>{patient.weeklySerum ? patient.serumDay : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <SectionHeader eyebrow="Inventario" title="Estado por tipo" />
          <div className="mini-chart">
            {inventory.map((item) => (
              <div key={item.id}>
                <span>{item.product}</span>
                <div>
                  <i style={{ width: `${Math.min(100, (item.stock / Math.max(item.minimum * 2, 1)) * 100)}%` }} />
                </div>
                <em>
                  {item.stock} {item.unit}
                </em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function AlertItem({
  icon: Icon,
  title,
  text,
  tone,
  onClick,
}: {
  icon: ElementType;
  title: string;
  text: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon size={18} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button className={`alert-item ${tone} interactive-alert`} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return (
    <div className={`alert-item ${tone}`}>
      {content}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

function PeriodFilter({
  filter,
  onChange,
  label = 'Periodo',
}: {
  filter: DateFilter;
  onChange: (filter: DateFilter) => void;
  label?: string;
}) {
  return (
    <div className="period-filter">
      <div className="filter-title">
        <Filter size={16} />
        <span>{label}</span>
      </div>
      <label>
        Desde
        <input
          type="date"
          value={filter.from}
          onChange={(event) => onChange({ ...filter, from: event.target.value })}
        />
      </label>
      <label>
        Hasta
        <input
          type="date"
          value={filter.to}
          onChange={(event) => onChange({ ...filter, to: event.target.value })}
        />
      </label>
      <label>
        Mes
        <input
          type="month"
          value={filter.month}
          onChange={(event) => onChange({ ...filter, month: event.target.value })}
        />
      </label>
      <label>
        Año
        <input
          type="number"
          min="2024"
          max="2032"
          placeholder="2026"
          value={filter.year}
          onChange={(event) => onChange({ ...filter, year: event.target.value })}
        />
      </label>
      <button className="icon-button soft" onClick={() => onChange(emptyDateFilter)} type="button" aria-label="Limpiar filtros">
        <RefreshCw size={16} />
      </button>
    </div>
  );
}

function CollapsiblePeriodFilter({
  filter,
  onChange,
  label,
  open,
  onToggle,
}: {
  filter: DateFilter;
  onChange: (filter: DateFilter) => void;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  const active = hasDateFilter(filter);

  return (
    <div className="filter-shell">
      <button className={`secondary-action filter-toggle ${active ? 'active' : ''}`} onClick={onToggle} type="button">
        <Filter size={16} />
        Filtrar
        {active && <span>Activo</span>}
      </button>
      {open && <PeriodFilter filter={filter} onChange={onChange} label={label} />}
    </div>
  );
}

function PatientsView({
  patients,
  patientSearch,
  setPatientSearch,
  patientFilter,
  setPatientFilter,
  addPatient,
}: {
  patients: Patient[];
  patientSearch: string;
  setPatientSearch: (value: string) => void;
  patientFilter: DateFilter;
  setPatientFilter: (filter: DateFilter) => void;
  addPatient: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="content-stack">
      <SectionHeader
        eyebrow="Pacientes"
        title="Tratamientos, peptidos y sueros"
        action={
          <div className="search-box">
            <Search size={16} />
            <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} placeholder="Buscar paciente" />
          </div>
        }
      />
      <PeriodFilter filter={patientFilter} onChange={setPatientFilter} label="Filtrar por inicio o finalizacion" />

      <section className="split-layout">
        <article className="panel">
          <SectionHeader eyebrow="Nuevo" title="Paciente" />
          <form className="form-grid" onSubmit={addPatient}>
            <label>
              Nombre
              <input name="name" placeholder="Paciente" />
            </label>
            <label>
              Plan
              <input name="plan" placeholder="Plan de peptidos" />
            </label>
            <label>
              Valor venta
              <input name="saleValue" type="number" placeholder="0" />
            </label>
            <label>
              Peptido
              <input name="peptide" placeholder="NAD+, BPC..." />
            </label>
            <label>
              Dosis
              <input name="dose" placeholder="Dosis" />
            </label>
            <label>
              Dias restantes
              <input name="daysLeft" type="number" placeholder="30" />
            </label>
            <label>
              Fecha inicio
              <input name="startDate" type="date" />
            </label>
            <label>
              Fecha final
              <input name="endDate" type="date" />
            </label>
            <label>
              Dia suero
              <input name="serumDay" placeholder="Lunes" />
            </label>
            <label className="check-row">
              <input name="weeklySerum" type="checkbox" />
              Suero semanal
            </label>
            <button className="primary-action full" type="submit">
              <Plus size={18} />
              Agregar paciente
            </button>
          </form>
        </article>

        <article className="panel span-2">
          <SectionHeader eyebrow="Activos" title={`${patients.length} pacientes en vista`} />
          <div className="patient-list">
            {patients.map((patient) => (
              <div className="patient-row" key={patient.id}>
                <div className="patient-main">
                  <div className="avatar">{patient.name.slice(-1)}</div>
                  <div>
                    <strong>{patient.name}</strong>
                    <span>
                      {patient.id} · {patient.plan}
                    </span>
                  </div>
                </div>
                <div className="patient-meta">
                  <Badge label={patient.tier} tone={patient.tier === 'VIP' ? 'success' : 'neutral'} />
                  <Badge label={patient.status} tone={statusClass(patient.status) as 'neutral' | 'success' | 'warning' | 'danger'} />
                  <span>{formatCurrency(patient.saleValue)}</span>
                  <span>{patient.daysLeft} dias</span>
                  <span>{patient.weeklySerum ? `Suero ${patient.serumDay}` : 'Sin suero'}</span>
                </div>
                <div className="peptide-list">
                  {patient.peptides.map((peptide) => (
                    <span key={`${patient.id}-${peptide.name}`}>
                      {peptide.name} · {peptide.dose} · {peptide.endsInDays} dias
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function InventoryView({
  inventory,
  inventoryFilter,
  setInventoryFilter,
  addInventory,
}: {
  inventory: InventoryItem[];
  inventoryFilter: DateFilter;
  setInventoryFilter: (filter: DateFilter) => void;
  addInventory: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="content-stack">
      <SectionHeader eyebrow="Inventario" title="Peptidos, sueros e insumos" />
      <PeriodFilter filter={inventoryFilter} onChange={setInventoryFilter} label="Filtrar por vencimiento" />
      <section className="split-layout">
        <article className="panel">
          <SectionHeader eyebrow="Nuevo" title="Producto" />
          <form className="form-grid" onSubmit={addInventory}>
            <label>
              Producto
              <input name="product" placeholder="Nombre" />
            </label>
            <label>
              Tipo
              <select name="type">
                <option>Peptido</option>
                <option>Suero</option>
                <option>Insumo medico</option>
                <option>Suplemento</option>
              </select>
            </label>
            <label>
              Stock actual
              <input name="stock" type="number" placeholder="0" />
            </label>
            <label>
              Stock minimo
              <input name="minimum" type="number" placeholder="0" />
            </label>
            <label>
              Unidad
              <input name="unit" placeholder="viales, kits..." />
            </label>
            <label>
              Lote
              <input name="lot" placeholder="Lote" />
            </label>
            <label>
              Vencimiento
              <input name="expiration" type="date" />
            </label>
            <label>
              Proveedor
              <input name="supplier" placeholder="Proveedor" />
            </label>
            <label>
              Costo unitario
              <input name="unitCost" type="number" placeholder="0" />
            </label>
            <button className="primary-action full" type="submit">
              <Plus size={18} />
              Agregar producto
            </button>
          </form>
        </article>

        <article className="panel span-2">
          <SectionHeader eyebrow="Stock" title={`${inventory.length} productos en vista`} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Stock</th>
                  <th>Lote</th>
                  <th>Vence</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.product}</strong>
                      <span>{formatCurrency(item.unitCost)} unidad</span>
                    </td>
                    <td>{item.type}</td>
                    <td>
                      {item.stock} / min {item.minimum} {item.unit}
                    </td>
                    <td>{item.lot}</td>
                    <td>{item.expiration}</td>
                    <td>
                      <Badge label={item.status} tone={statusClass(item.status) as 'neutral' | 'success' | 'warning' | 'danger'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

function AccountingView({
  finance,
  financeFilter,
  setFinanceFilter,
  addMovement,
}: {
  finance: FinanceMovement[];
  financeFilter: DateFilter;
  setFinanceFilter: (filter: DateFilter) => void;
  addMovement: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [selectedSupport, setSelectedSupport] = useState<FinanceMovement | null>(null);
  const [activeTab, setActiveTab] = useState<AccountingTab>('ingresos');
  const [filterOpen, setFilterOpen] = useState(false);
  const incomeMovements = finance.filter(
    (movement) => movement.kind === 'Ingreso' && movement.scope === 'Empresa' && !isReceivable(movement),
  );
  const receivableMovements = finance.filter(isReceivable);
  const expenseMovements = finance.filter((movement) => movement.kind === 'Gasto');
  const companyIncome = incomeMovements.reduce((total, movement) => total + movement.value, 0);
  const pendingIncome = receivableMovements.reduce((total, movement) => total + movement.value, 0);
  const companyExpenses = expenseMovements
    .filter((movement) => movement.scope === 'Empresa')
    .reduce((total, movement) => total + movement.value, 0);
  const personalOut = expenseMovements
    .filter((movement) => movement.scope !== 'Empresa')
    .reduce((total, movement) => total + movement.value, 0);
  const netProfit = companyIncome - companyExpenses;
  const incomeByCategory = sumBy(
    incomeMovements,
    (movement) => movement.category,
    (movement) => movement.value,
  );
  const expensesByCenter = sumBy(
    expenseMovements,
    (movement) => movement.costCenter,
    (movement) => movement.value,
  );
  const personalByScope = sumBy(
    expenseMovements.filter((movement) => movement.scope !== 'Empresa'),
    (movement) => movement.scope,
    (movement) => movement.value,
  );
  const activeMovements =
    activeTab === 'ingresos' ? incomeMovements : activeTab === 'egresos' ? expenseMovements : receivableMovements;
  const activeTotal = activeMovements.reduce((total, movement) => total + movement.value, 0);
  const activeMeta = {
    ingresos: {
      eyebrow: 'Ingresos',
      title: 'Ingresos recibidos',
      badge: `${incomeMovements.length} registros`,
      empty: 'No hay ingresos recibidos en este periodo.',
    },
    egresos: {
      eyebrow: 'Egresos',
      title: 'Egresos y retiros',
      badge: `${expenseMovements.length} registros`,
      empty: 'No hay egresos en este periodo.',
    },
    cobrar: {
      eyebrow: 'Cuentas por cobrar',
      title: 'Cartera pendiente',
      badge: `${receivableMovements.length} pendientes`,
      empty: 'No hay cuentas por cobrar en este periodo.',
    },
  }[activeTab];
  const paymentByMethod = sumBy(
    activeMovements,
    (movement) => movement.paymentMethod,
    (movement) => movement.value,
  );

  return (
    <div className="content-stack">
      <CollapsiblePeriodFilter
        filter={financeFilter}
        onChange={setFinanceFilter}
        label="Calendario de busqueda"
        open={filterOpen}
        onToggle={() => setFilterOpen((current) => !current)}
      />
      <section className="stats-grid">
        <StatCard label="Empresa" value={formatCurrency(companyIncome)} helper="Ingresos recibidos" icon={TrendingUp} tone="success" />
        <StatCard label="Gastos operativos" value={formatCurrency(companyExpenses)} helper="Sin personales" icon={CreditCard} tone="warning" />
        <StatCard label="Utilidad" value={formatCurrency(netProfit)} helper="Caja empresa" icon={CircleDollarSign} tone="success" />
        <StatCard label="Personal/retiros" value={formatCurrency(personalOut)} helper="Vista separada" icon={WalletCards} tone="neutral" />
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <div className="detail-card-title">
            <TrendingUp size={18} />
            <strong>Ingresos empresa</strong>
          </div>
          <DetailLine label="Recibido" value={formatCurrency(companyIncome)} />
          <DetailLine label="Por cobrar" value={formatCurrency(pendingIncome)} />
          {Object.entries(incomeByCategory).map(([category, value]) => (
            <DetailLine key={category} label={category} value={formatCurrency(value)} />
          ))}
        </article>
        <article className="detail-card">
          <div className="detail-card-title">
            <Layers3 size={18} />
            <strong>Gastos por centro</strong>
          </div>
          <DetailLine label="Total operativo" value={formatCurrency(companyExpenses)} />
          {Object.entries(expensesByCenter).map(([center, value]) => (
            <DetailLine key={center} label={center} value={formatCurrency(value)} />
          ))}
        </article>
        <article className="detail-card">
          <div className="detail-card-title">
            <WalletCards size={18} />
            <strong>Personal separado</strong>
          </div>
          <DetailLine label="Total no empresa" value={formatCurrency(personalOut)} />
          {Object.entries(personalByScope).map(([scope, value]) => (
            <DetailLine key={scope} label={scope} value={formatCurrency(value)} />
          ))}
        </article>
        <article className="detail-card payment-methods-card">
          <div className="detail-card-title">
            <CreditCard size={18} />
            <strong>Metodos de pago</strong>
          </div>
          {Object.keys(paymentByMethod).length > 0 ? (
            Object.entries(paymentByMethod).map(([method, value]) => (
              <DetailLine key={method} label={method} value={formatCurrency(value)} />
            ))
          ) : (
            <DetailLine label="Sin movimientos" value={formatCurrency(0)} />
          )}
        </article>
      </section>

      <div className="accounting-tabs" role="tablist" aria-label="Secciones de contabilidad">
        <button
          className={activeTab === 'ingresos' ? 'active' : ''}
          onClick={() => setActiveTab('ingresos')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'ingresos'}
        >
          <TrendingUp size={16} />
          Ingresos
          <span>{formatCurrency(companyIncome)}</span>
        </button>
        <button
          className={activeTab === 'egresos' ? 'active' : ''}
          onClick={() => setActiveTab('egresos')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'egresos'}
        >
          <CreditCard size={16} />
          Egresos
          <span>{formatCurrency(companyExpenses + personalOut)}</span>
        </button>
        <button
          className={activeTab === 'cobrar' ? 'active' : ''}
          onClick={() => setActiveTab('cobrar')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'cobrar'}
        >
          <CalendarClock size={16} />
          Cuentas por cobrar
          <span>{formatCurrency(pendingIncome)}</span>
        </button>
      </div>

      <section className="split-layout">
        <article className="panel">
          <SectionHeader eyebrow="Nuevo" title="Movimiento" />
          <form className="form-grid" onSubmit={addMovement}>
            <label>
              Tipo
              <select name="kind">
                <option>Ingreso</option>
                <option>Gasto</option>
              </select>
            </label>
            <label>
              Fecha
              <input name="date" type="date" />
            </label>
            <label>
              Cliente/proveedor
              <input name="person" placeholder="Nombre" />
            </label>
            <label>
              Concepto
              <input name="concept" placeholder="Concepto" />
            </label>
            <label>
              Categoria
              <input name="category" placeholder="Tratamientos, inventario..." />
            </label>
            <label>
              Valor
              <input name="value" type="number" placeholder="0" />
            </label>
            <label>
              Medio de pago
              <select name="paymentMethod">
                <option>Transferencia</option>
                <option>Efectivo</option>
                <option>Tarjeta credito</option>
                <option>Tarjeta debito</option>
                <option>PSE</option>
                <option>Nequi</option>
                <option>Daviplata</option>
                <option>Pendiente</option>
              </select>
            </label>
            <label>
              Estado
              <select name="status">
                <option>Recibido</option>
                <option>Pendiente</option>
                <option>Pagado</option>
                <option>Vencido</option>
              </select>
            </label>
            <label>
              Centro de costo
              <select name="costCenter">
                <option>Operacion</option>
                <option>Inventario</option>
                <option>Marketing</option>
                <option>Nomina</option>
                <option>Administrativo</option>
                <option>Personal</option>
              </select>
            </label>
            <label>
              Clasificacion
              <select name="scope">
                <option>Empresa</option>
                <option>Personal</option>
                <option>Retiro socio</option>
                <option>Reembolso</option>
              </select>
            </label>
            <label className="file-button">
              <Camera size={16} />
              Soporte
              <input name="attachment" type="file" accept="image/*" />
            </label>
            <button className="primary-action full" type="submit">
              <Plus size={18} />
              Registrar
            </button>
          </form>
        </article>

        <article className="panel span-2">
          <SectionHeader
            eyebrow={activeMeta.eyebrow}
            title={activeMeta.title}
            action={<Badge label={`${activeMeta.badge} · ${formatCurrency(activeTotal)}`} tone={activeTab === 'egresos' ? 'warning' : activeTab === 'cobrar' ? 'danger' : 'success'} />}
          />
          <MovementTable movements={activeMovements} emptyText={activeMeta.empty} onSupport={setSelectedSupport} />
        </article>
      </section>

      {selectedSupport && (
        <SupportModal movement={selectedSupport} onClose={() => setSelectedSupport(null)} />
      )}
    </div>
  );
}

function MovementTable({
  movements,
  emptyText,
  onSupport,
}: {
  movements: FinanceMovement[];
  emptyText: string;
  onSupport: (movement: FinanceMovement) => void;
}) {
  return (
    <div className="table-wrap accounting-table-wrap">
      <table className="accounting-table">
        <thead>
          <tr>
            <th>Movimiento</th>
            <th>Fecha</th>
            <th>Cliente/proveedor</th>
            <th>Categoria</th>
            <th>Centro</th>
            <th>Metodo de pago</th>
            <th>Estado</th>
            <th>Valor</th>
            <th>Tipo</th>
            <th>Soporte</th>
          </tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr>
              <td className="empty-table" colSpan={10}>{emptyText}</td>
            </tr>
          ) : (
            movements.map((movement) => (
              <tr key={movement.id}>
                <td data-label="Movimiento">
                  <strong>{movement.concept}</strong>
                  <span>{movement.id} · {movement.kind}</span>
                </td>
                <td data-label="Fecha">{movement.date}</td>
                <td data-label="Cliente / prov.">{movement.person}</td>
                <td data-label="Categoria">
                  <strong>{movement.category}</strong>
                </td>
                <td data-label="Centro">{movement.costCenter}</td>
                <td data-label="Metodo de pago">
                  <strong className="payment-method">{movement.paymentMethod}</strong>
                </td>
                <td data-label="Estado">
                  <span className="status-text">{movement.status}</span>
                </td>
                <td data-label="Valor">{formatCurrency(movement.value)}</td>
                <td data-label="Tipo">
                  <Badge label={movement.scope} tone={movement.scope === 'Empresa' ? 'success' : 'neutral'} />
                </td>
                <td data-label="Soporte">
                  {movement.attachment ? (
                    <button className="support-button" onClick={() => onSupport(movement)} type="button">
                      <Eye size={16} />
                      Ver soporte
                    </button>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SupportModal({ movement, onClose }: { movement: FinanceMovement; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Soporte del movimiento">
      <article className="support-modal">
        <header className="support-modal-header">
          <div>
            <span>Soporte</span>
            <h3>{movement.concept}</h3>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Cerrar soporte">
            <X size={18} />
          </button>
        </header>

        {movement.attachmentPreview ? (
          <img className="support-image" src={movement.attachmentPreview} alt={`Soporte de ${movement.concept}`} />
        ) : (
          <div className="support-receipt">
            <div className="receipt-mark">
              <FileText size={24} />
            </div>
            <strong>Comprobante adjunto</strong>
            <span>{movement.attachment}</span>
            <dl>
              <div>
                <dt>Fecha</dt>
                <dd>{movement.date}</dd>
              </div>
              <div>
                <dt>Proveedor / cliente</dt>
                <dd>{movement.person}</dd>
              </div>
              <div>
                <dt>Valor</dt>
                <dd>{formatCurrency(movement.value)}</dd>
              </div>
              <div>
                <dt>Centro de costo</dt>
                <dd>{movement.costCenter}</dd>
              </div>
              <div>
                <dt>Medio de pago</dt>
                <dd>{movement.paymentMethod}</dd>
              </div>
            </dl>
          </div>
        )}
      </article>
    </div>
  );
}

function ReportsView({
  patients,
  inventory,
  finance,
  reportFilter,
  setReportFilter,
}: {
  patients: Patient[];
  inventory: InventoryItem[];
  finance: FinanceMovement[];
  reportFilter: DateFilter;
  setReportFilter: (filter: DateFilter) => void;
}) {
  const companyMovements = finance.filter((movement) => movement.scope === 'Empresa');
  const companyIncome = companyMovements
    .filter((movement) => movement.kind === 'Ingreso' && movement.status !== 'Pendiente')
    .reduce((total, movement) => total + movement.value, 0);
  const companyExpenses = companyMovements
    .filter((movement) => movement.kind === 'Gasto')
    .reduce((total, movement) => total + movement.value, 0);
  const personalOut = finance
    .filter((movement) => movement.scope !== 'Empresa')
    .reduce((total, movement) => total + movement.value, 0);
  const netProfit = companyIncome - companyExpenses;
  const vipPatients = patients.filter((patient) => patient.tier === 'VIP').length;
  const companyRatio = companyIncome > 0 ? Math.round((netProfit / companyIncome) * 100) : 0;
  const stockValue = inventory.reduce((total, item) => total + item.stock * item.unitCost, 0);
  const expensesByCategory = finance
    .filter((movement) => movement.kind === 'Gasto' && movement.scope === 'Empresa')
    .reduce<Record<string, number>>((acc, movement) => {
      acc[movement.category] = (acc[movement.category] ?? 0) + movement.value;
      return acc;
    }, {});

  return (
    <div className="content-stack">
      <SectionHeader
        eyebrow="Reportes"
        title="Resumen dinamico"
        action={
          <button className="secondary-action" onClick={() => window.print()} type="button">
            <Download size={16} />
            Exportar
          </button>
        }
      />
      <PeriodFilter filter={reportFilter} onChange={setReportFilter} label="Filtrar reportes por periodo" />
      <section className="stats-grid">
        <StatCard label="Margen empresa" value={`${companyRatio}%`} helper="Ingresos vs utilidad" icon={Activity} tone="success" />
        <StatCard label="Pacientes VIP" value={String(vipPatients)} helper="Por valor de venta" icon={Sparkles} tone="success" />
        <StatCard label="Valor inventario" value={formatCurrency(stockValue)} helper="Stock valorizado" icon={PackageCheck} tone="neutral" />
        <StatCard label="Separado personal" value={formatCurrency(personalOut)} helper="No afecta utilidad" icon={WalletCards} tone="neutral" />
      </section>

      <section className="dashboard-grid">
        <article className="panel span-2">
          <SectionHeader eyebrow="Flujo" title="Empresa vs operacion" />
          <div className="bars">
            <ReportBar label="Ingresos empresa" value={companyIncome} max={Math.max(companyIncome, companyExpenses, personalOut)} tone="success" />
            <ReportBar label="Gastos empresa" value={companyExpenses} max={Math.max(companyIncome, companyExpenses, personalOut)} tone="warning" />
            <ReportBar label="Utilidad" value={netProfit} max={Math.max(companyIncome, companyExpenses, personalOut)} tone="success" />
            <ReportBar label="Personal/retiros" value={personalOut} max={Math.max(companyIncome, companyExpenses, personalOut)} tone="neutral" />
          </div>
        </article>

        <article className="panel">
          <SectionHeader eyebrow="Categorias" title="Gastos empresa" />
          <div className="category-list">
            {Object.entries(expensesByCategory).map(([category, value]) => (
              <div key={category}>
                <span>{category}</span>
                <strong>{formatCurrency(value)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <SectionHeader eyebrow="Mes" title="Lectura rapida" />
          <ul className="insight-list">
            <li>
              <Check size={16} />
              Caja empresa separada de retiros personales.
            </li>
            <li>
              <AlertTriangle size={16} />
              Revisar productos bajo minimo.
            </li>
            <li>
              <ClipboardList size={16} />
              Mantener soportes de gastos adjuntos.
            </li>
          </ul>
        </article>
      </section>
    </div>
  );
}

function ReportBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'neutral' | 'success' | 'warning';
}) {
  return (
    <div className={`report-bar ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{formatCurrency(value)}</strong>
      </div>
      <i>
        <em style={{ width: `${Math.max(4, (value / Math.max(max, 1)) * 100)}%` }} />
      </i>
    </div>
  );
}
