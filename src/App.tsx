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
  LayoutDashboard,
  Menu,
  PackageCheck,
  Plus,
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
}: {
  label: string;
  value: string;
  helper: string;
  icon: ElementType;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{helper}</span>
      </div>
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
    return text.includes(patientSearch.toLowerCase());
  });

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
    const status = kind === 'Ingreso' ? 'Recibido' : 'Pagado';
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
      paymentMethod: String(form.get('paymentMethod') || 'Transferencia'),
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
            <button className="icon-button" type="button" aria-label="Buscar">
              <Search size={18} />
            </button>
            <button className="primary-action" type="button">
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
            addPatient={addPatient}
          />
        )}
        {view === 'inventario' && <InventoryView inventory={inventory} addInventory={addInventory} />}
        {view === 'contabilidad' && (
          <AccountingView
            finance={finance}
            addMovement={addMovement}
            companyIncome={companyIncome}
            companyExpenses={companyExpenses}
            netProfit={netProfit}
            pendingIncome={pendingIncome}
            personalOut={personalOut}
          />
        )}
        {view === 'reportes' && (
          <ReportsView
            patients={patients}
            inventory={inventory}
            finance={finance}
            companyIncome={companyIncome}
            companyExpenses={companyExpenses}
            netProfit={netProfit}
            personalOut={personalOut}
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
          <span className="demo-pill">Datos demo</span>
          <h2>Control de pacientes, inventario y caja en un solo pulso.</h2>
          <p>
            Hoy hay {patients.length} pacientes activos, {finishingTreatments} tratamientos por finalizar y {lowStock}{' '}
            alertas de inventario.
          </p>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Ingresos empresa" value={formatCurrency(companyIncome)} helper="Recibidos este mes" icon={TrendingUp} tone="success" />
        <StatCard label="Gastos empresa" value={formatCurrency(companyExpenses)} helper="Operativos registrados" icon={CreditCard} tone="warning" />
        <StatCard label="Utilidad real" value={formatCurrency(netProfit)} helper="Sin gastos personales" icon={CircleDollarSign} tone="success" />
        <StatCard label="Por cobrar" value={formatCurrency(pendingIncome)} helper="Pendiente de recaudo" icon={CalendarClock} tone="warning" />
      </section>

      <section className="dashboard-grid">
        <article className="panel span-2">
          <SectionHeader eyebrow="Alertas" title="Prioridades de hoy" />
          <div className="alert-list">
            <AlertItem icon={Dna} title={`${finishingTreatments} tratamientos por finalizar`} text="Revisar dosis, cierre y siguiente compra." tone="warning" />
            <AlertItem icon={Syringe} title={`${serumCount} sueros semanales activos`} text="Validar agenda y disponibilidad de insumos." tone="success" />
            <AlertItem icon={PackageCheck} title={`${lowStock} productos requieren revision`} text="Bajo stock o vencimiento cercano." tone="danger" />
            <AlertItem icon={WalletCards} title={formatCurrency(personalOut)} text="Movimientos personales separados de empresa." tone="neutral" />
          </div>
        </article>

        <article className="panel">
          <SectionHeader eyebrow="Accesos" title="Registro rapido" />
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
}: {
  icon: ElementType;
  title: string;
  text: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={`alert-item ${tone}`}>
      <Icon size={18} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

function PatientsView({
  patients,
  patientSearch,
  setPatientSearch,
  addPatient,
}: {
  patients: Patient[];
  patientSearch: string;
  setPatientSearch: (value: string) => void;
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
          <SectionHeader eyebrow="Activos" title="Pacientes demo" />
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
  addInventory,
}: {
  inventory: InventoryItem[];
  addInventory: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="content-stack">
      <SectionHeader eyebrow="Inventario" title="Peptidos, sueros e insumos" />
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
          <SectionHeader eyebrow="Stock" title="Control de productos" />
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
  addMovement,
  companyIncome,
  companyExpenses,
  netProfit,
  pendingIncome,
  personalOut,
}: {
  finance: FinanceMovement[];
  addMovement: (event: FormEvent<HTMLFormElement>) => void;
  companyIncome: number;
  companyExpenses: number;
  netProfit: number;
  pendingIncome: number;
  personalOut: number;
}) {
  const [selectedSupport, setSelectedSupport] = useState<FinanceMovement | null>(null);

  return (
    <div className="content-stack">
      <section className="stats-grid">
        <StatCard label="Empresa" value={formatCurrency(companyIncome)} helper="Ingresos recibidos" icon={TrendingUp} tone="success" />
        <StatCard label="Gastos operativos" value={formatCurrency(companyExpenses)} helper="Sin personales" icon={CreditCard} tone="warning" />
        <StatCard label="Utilidad" value={formatCurrency(netProfit)} helper="Caja empresa" icon={CircleDollarSign} tone="success" />
        <StatCard label="Personal/retiros" value={formatCurrency(personalOut)} helper="Vista separada" icon={WalletCards} tone="neutral" />
      </section>

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
                <option>Tarjeta</option>
                <option>Pendiente</option>
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
            eyebrow="Caja"
            title="Ingresos, gastos y retiros"
            action={<Badge label={`Por cobrar ${formatCurrency(pendingIncome)}`} tone="warning" />}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Movimiento</th>
                  <th>Categoria</th>
                  <th>Valor</th>
                  <th>Centro</th>
                  <th>Tipo</th>
                  <th>Soporte</th>
                </tr>
              </thead>
              <tbody>
                {finance.map((movement) => (
                  <tr key={movement.id}>
                    <td>
                      <strong>{movement.concept}</strong>
                      <span>
                        {movement.date} · {movement.person}
                      </span>
                    </td>
                    <td>{movement.category}</td>
                    <td>{formatCurrency(movement.value)}</td>
                    <td>{movement.costCenter}</td>
                    <td>
                      <Badge label={movement.scope} tone={movement.scope === 'Empresa' ? 'success' : 'neutral'} />
                    </td>
                    <td>
                      {movement.attachment ? (
                        <button className="support-button" onClick={() => setSelectedSupport(movement)} type="button">
                          <Eye size={16} />
                          Ver soporte
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {selectedSupport && (
        <SupportModal movement={selectedSupport} onClose={() => setSelectedSupport(null)} />
      )}
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
  companyIncome,
  companyExpenses,
  netProfit,
  personalOut,
}: {
  patients: Patient[];
  inventory: InventoryItem[];
  finance: FinanceMovement[];
  companyIncome: number;
  companyExpenses: number;
  netProfit: number;
  personalOut: number;
}) {
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
        title="Resumen mensual demo"
        action={
          <button className="secondary-action" type="button">
            <Download size={16} />
            Exportar
          </button>
        }
      />
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
