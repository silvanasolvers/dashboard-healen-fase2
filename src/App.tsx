import {
  ElementType,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import gsap from 'gsap';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  BarChart3,
  CalendarClock,
  Building2,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Dna,
  Download,
  Eye,
  FileDown,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Link as LinkIcon,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Syringe,
  Trash2,
  Upload,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { startAurora } from './aurora';
import {
  AccountingTab,
  ageFromBirthdate,
  Analytics,
  buildNextSteps,
  buildPatientProductAlerts,
  ClinicalNote,
  CrmContact,
  CrmContactType,
  CrmReviewCandidate,
  CrmStage,
  CRM_STAGES,
  crmContactTypeLabel,
  crmStageLabel,
  DateRange,
  daysSince,
  emptyRange,
  FinanceMovement,
  FinanceSummary,
  formatCompact,
  formatCurrency,
  formatDate,
  formatLongDate,
  formatMonth,
  InventoryItem,
  isReceivable,
  KV,
  MILESTONE_CATEGORIES,
  milestoneCategoryLabel,
  milestoneDueTone,
  milestoneStatusLabel,
  MonthPoint,
  mostUrgentPeptide,
  MovementPayload,
  NextStep,
  NOTE_KINDS,
  NoteKind,
  noteKindLabel,
  noteKindTone,
  overallSignal,
  Patient,
  patientHistory,
  PatientMilestone,
  PatientDossier,
  PatientProductAlert,
  patientSignalCounts,
  PatientSummary,
  Payee,
  Plan,
  PlanItem,
  ProductPayload,
  RANGE_PRESETS,
  rangeForPreset,
  rangeLabel,
  shortName,
  Signal,
  SignalCounts,
  signalLabel,
  statusTone,
  stockSignal,
  STOCK_REASONS,
  StockMovePayload,
  Tone,
  treatmentSignal,
  verdictPhrase,
  View,
} from './data';
import {
  addMilestone,
  addNote,
  AppointmentRow,
  CatalogItem,
  createPatient,
  clearCrmCache,
  type CrmCounts,
  deleteMilestone,
  deleteNote,
  fetchAll,
  fetchAnalytics,
  fetchCatalog,
  fetchCrmContact,
  fetchCrmContactsPage,
  fetchCrmReviewQueue,
  fetchDossier,
  fetchFinanceRows,
  fetchFinanceSummary,
  fetchPayees,
  fetchPlans,
  financeEntry,
  savePlan,
  deletePlan,
  PlanPayload,
  supportUrl,
  uploadSupport,
  inventoryMovement,
  MovementRow,
  moveCrmContact,
  prescribeCheckout,
  PrescribeResult,
  reviewCrmCandidate,
  toggleMilestone,
  updateClient,
  updateCrmContact,
  upsertProduct,
} from './api';
import { downloadCsv, downloadPdf } from './lib/export';
import { DatePicker } from './components/DatePicker';
import { Login, useSession } from './auth';

const ROUTES = ['subcutanea', 'intramuscular', 'intravenosa', 'oral', 'sublingual', 'topica', 'nasal'];
const FREQS = ['diario', '2x semana', 'semanal', 'quincenal', 'mensual', 'ciclo'];
const PAY_METHODS: Array<{ id: string; label: string }> = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'tarjeta_credito', label: 'Tarjeta' },
  { id: 'nequi', label: 'Nequi' },
  { id: 'daviplata', label: 'Daviplata' },
];

const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const HOME_PEPTIDE_PATIENT_IDS = new Set([
  'HLN-006', // Maria Luisa Bula
  'HLN-007', // Miguel Ángel González Delgado
  'HLN-008', // Olga Liliana Gaona Rangel
  'HLN-018', // Alejandra Saldarriaga / Tata
  'HLN-038', // Carolina Huertas
  'HLN-079', // Flavio Miranda
  'HLN-188', // Gabriel Piedrahita Borrero
]);

const NAV: Array<{ id: View; label: string; short: string; icon: ElementType }> = [
  { id: 'inicio', label: 'Inicio', short: 'Péptidos', icon: LayoutDashboard },
  { id: 'crm', label: 'CRM', short: 'CRM', icon: MessageCircle },
  { id: 'agenda', label: 'Agenda', short: 'Agenda', icon: CalendarClock },
  { id: 'pacientes', label: 'Pacientes', short: 'Pacientes', icon: Users },
  { id: 'inventario', label: 'Inventario', short: 'Stock', icon: Package },
  { id: 'contabilidad', label: 'Caja', short: 'Caja', icon: Wallet },
  { id: 'reportes', label: 'Reportes', short: 'Reportes', icon: BarChart3 },
];

const VIEW_LEAD: Record<View, { eyebrow: string; title: string }> = {
  inicio: { eyebrow: 'Healen OS', title: 'Pacientes péptidos TOP' },
  crm: { eyebrow: 'Relaciones', title: 'CRM' },
  agenda: { eyebrow: 'Operación clínica', title: 'Agenda' },
  pacientes: { eyebrow: 'Tratamientos', title: 'Pacientes' },
  inventario: { eyebrow: 'Insumos', title: 'Inventario' },
  contabilidad: { eyebrow: 'Finanzas', title: 'Caja' },
  reportes: { eyebrow: 'Analitica', title: 'Reportes' },
};

/* ============================================================
   Animación: revelado de vista + utilidades
   ============================================================ */
/** Reveal por scroll (estilo Apple): cada [data-reveal] aparece al entrar al
 *  viewport. Visible por defecto si no hay JS / reduced-motion. */
function useScrollReveal(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!items.length) return;
    if (REDUCED) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }
    document.documentElement.classList.add('js-scroll');
    // Basado en scroll + rAF (no IntersectionObserver, que no dispara para
    // elementos ya visibles en renderers headless y dejaría todo oculto).
    function check() {
      const vh = window.innerHeight;
      let pending = false;
      for (const el of items) {
        if (el.classList.contains('in')) continue;
        if (el.getBoundingClientRect().top < vh * 0.9) el.classList.add('in');
        else pending = true;
      }
      return pending;
    }
    // setTimeout (no rAF: se throttlea en headless) para el revelado inicial
    // con transición; el scroll revela lo de abajo del fold.
    const t = window.setTimeout(check, 60);
    function onScroll() {
      if (!check()) cleanup();
    }
    function cleanup() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      cleanup();
    };
  }, [dep]);

  // Seguro: en CADA render revela al instante cualquier [data-reveal] que haya
  // entrado y siga sobre el fold (cambios de sub-tab, master-detail, etc.). Sin
  // esto, contenido remontado dentro de la misma vista quedaría en opacity 0.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || REDUCED) return;
    const vh = window.innerHeight;
    root.querySelectorAll<HTMLElement>('[data-reveal]:not(.in)').forEach((el) => {
      if (el.getBoundingClientRect().top < vh * 0.95) el.classList.add('in');
    });
  });

  return ref;
}

/** true tras el primer frame — para animar anchos de barras/gauges desde 0. */
function useGrow() {
  const [grown, setGrown] = useState(REDUCED);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return grown;
}

function CountUp({ value, format = formatCompact }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Anima DESDE el valor anterior (no desde 0): al ajustar cantidades en el
  // checkout el total fluye suave en vez de saltar a $0 en cada cambio.
  const prev = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (REDUCED) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const from = prev.current;
    prev.current = value;
    const obj = { v: from };
    const tw = gsap.to(obj, {
      v: value,
      duration: from === 0 ? 1 : 0.45,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = format(Math.round(obj.v));
      },
    });
    return () => {
      tw.kill();
    };
  }, [value, format]);
  return (
    <span ref={ref} className="tnum">
      {format(value)}
    </span>
  );
}

/* ============================================================
   Anillo de tratamiento — el semáforo (elemento de firma)
   ============================================================ */
function TreatmentRing({
  daysLeft,
  totalDays = 30,
  size = 64,
  stroke = 6,
  showUnit = true,
}: {
  daysLeft: number;
  totalDays?: number;
  size?: number;
  stroke?: number;
  showUnit?: boolean;
}) {
  const signal = treatmentSignal(daysLeft);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0.02, Math.min(1, daysLeft / Math.max(totalDays, 1)));
  const offset = circ * (1 - frac);
  const barRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    if (REDUCED) {
      el.style.strokeDashoffset = String(offset);
      return;
    }
    const tw = gsap.fromTo(
      el,
      { strokeDashoffset: circ },
      { strokeDashoffset: offset, duration: 1.15, ease: 'power3.out' },
    );
    return () => {
      tw.kill();
    };
  }, [offset, circ]);

  const center = size / 2;
  return (
    <span className={`ring ring--${signal}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ring__track" cx={center} cy={center} r={r} strokeWidth={stroke} />
        <circle
          ref={barRef}
          className="ring__bar"
          cx={center}
          cy={center}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="ring__face">
        <span className="ring__num" style={{ fontSize: size * 0.34 }}>
          {daysLeft}
        </span>
        {showUnit && <span className="ring__unit">días</span>}
      </span>
    </span>
  );
}

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`badge badge--${tone}`}>{label}</span>;
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field${full ? ' field--full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/* ---- Botón de menú animado (framer-motion) ---- */
function MenuToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  const state = open ? 'open' : 'closed';
  const ease = [0.22, 1, 0.36, 1] as const;
  return (
    <motion.button className="menu-toggle" onClick={onClick} aria-label={label} whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.06 }}>
      <span className="menu-toggle__bars">
        <motion.span
          className="menu-toggle__bar"
          initial={false}
          animate={state}
          variants={{ closed: { y: -5, rotate: 0 }, open: { y: 0, rotate: 45 } }}
          transition={{ duration: 0.24, ease }}
        />
        <motion.span
          className="menu-toggle__bar"
          initial={false}
          animate={state}
          variants={{ closed: { opacity: 1, scaleX: 1 }, open: { opacity: 0, scaleX: 0.3 } }}
          transition={{ duration: 0.16 }}
        />
        <motion.span
          className="menu-toggle__bar"
          initial={false}
          animate={state}
          variants={{ closed: { y: 5, rotate: 0 }, open: { y: 0, rotate: -45 } }}
          transition={{ duration: 0.24, ease }}
        />
      </span>
    </motion.button>
  );
}

/* ---- Quick-create global (reemplaza el botón "Nuevo") ---- */
const QUICK_ACTIONS: Array<{ id: string; view: View; label: string; icon: ElementType }> = [
  { id: 'patient', view: 'pacientes', label: 'Nuevo paciente', icon: UserPlus },
  { id: 'cash', view: 'contabilidad', label: 'Movimiento de caja', icon: Wallet },
  { id: 'stock', view: 'inventario', label: 'Movimiento de stock', icon: RefreshCw },
  { id: 'product', view: 'inventario', label: 'Nuevo producto', icon: Package },
];

function QuickCreate({ onAction }: { onAction: (view: View, intent: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="quick" ref={ref}>
      <motion.button className="btn btn--primary quick__btn" onClick={() => setOpen((o) => !o)} whileTap={{ scale: 0.96 }} aria-expanded={open}>
        <motion.span animate={{ rotate: open ? 135 : 0 }} transition={{ duration: 0.2 }} style={{ display: 'inline-flex' }}>
          <Plus size={18} />
        </motion.span>
        Crear
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="quick__menu"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {QUICK_ACTIONS.map((a, i) => (
              <motion.button
                key={a.id}
                className="quick__item"
                onClick={() => {
                  setOpen(false);
                  onAction(a.view, a.id);
                }}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.18 }}
              >
                <span className="quick__ico">
                  <a.icon size={16} />
                </span>
                {a.label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
   App shell
   ============================================================ */
export function App() {
  const { session, loading: authLoading, signOut } = useSession();
  if (authLoading) return <Loader />;
  if (!session) return <Login />;
  const meta = (session.user.user_metadata ?? {}) as { full_name?: string };
  return <Dashboard userLabel={meta.full_name || session.user.email || 'Healen'} onSignOut={signOut} />;
}

function Dashboard({ userLabel, onSignOut }: { userLabel: string; onSignOut: () => void }) {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('inicio');
  const [drawer, setDrawer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [prescribe, setPrescribe] = useState<Patient | null>(null);
  // Detalle abierto (master-detail). Vive aquí para que el reveal del .view se
  // re-ejecute al entrar/salir (su key/dep cambia) y la lista no quede oculta.
  const [detailPatient, setDetailPatient] = useState<Patient | null>(null);
  const [detailAlert, setDetailAlert] = useState<PatientProductAlert | null>(null);
  const [rail, setRail] = useState<boolean>(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('healen_rail') === '1',
  );

  // El ☰ contrae/expande el rail en desktop; abre el drawer en móvil.
  function toggleMenu() {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches) {
      setDrawer(true);
    } else {
      setRail((c) => {
        const next = !c;
        if (typeof localStorage !== 'undefined') localStorage.setItem('healen_rail', next ? '1' : '0');
        return next;
      });
    }
  }

  const [patients, setPatients] = useState<Patient[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<MovementRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [finance, setFinance] = useState<FinanceMovement[]>([]);

  const [patientSearch, setPatientSearch] = useState('');
  // Sube en cada recarga de datos: Contabilidad/Reportes re-piden su agregado al cambiar.
  const [dataVersion, setDataVersion] = useState(0);

  const auroraRef = useRef<HTMLCanvasElement>(null);

  async function reload() {
    try {
      const data = await fetchAll();
      setPatients(data.patients);
      setInventory(data.inventory);
      setFinance(data.finance);
      setInventoryMovements(data.movements);
      setAppointments(data.appointments);
      setDataVersion((v) => v + 1);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setToast({ msg: 'No se pudieron cargar los datos.', error: true });
    } finally {
      setLoading(false);
    }
  }

  function retry() {
    setLoading(true);
    setLoadError(false);
    reload();
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!auroraRef.current) return;
    return startAurora(auroraRef.current);
  }, []);

  const notify = (msg: string, error?: boolean) => setToast({ msg, error });

  async function runMutation(action: () => Promise<unknown>, form: HTMLFormElement, okMsg: string) {
    setSaving(true);
    try {
      await action();
      await reload();
      form.reset();
      setToast({ msg: okMsg });
    } catch (e) {
      setToast({ msg: (e as Error).message || 'No se pudo guardar.', error: true });
    } finally {
      setSaving(false);
    }
  }

  // Derivados de empresa (base de caja: el ingreso es lo efectivamente cobrado).
  const companyMovements = finance.filter((m) => m.scope === 'Empresa');
  const companyIncome = companyMovements
    .filter((m) => m.kind === 'Ingreso')
    .reduce((t, m) => t + (m.paidValue ?? m.value), 0);
  const pendingIncome = finance
    .filter(isReceivable)
    .reduce((t, m) => t + ((m.invoiceValue ?? m.value) - (m.paidValue ?? 0)), 0);
  const companyExpenses = companyMovements
    .filter((m) => m.kind === 'Gasto')
    .reduce((t, m) => t + m.value, 0);
  const personalOut = finance.filter((m) => m.scope !== 'Empresa').reduce((t, m) => t + m.value, 0);
  const netProfit = companyIncome - companyExpenses;
  const lowStock = inventory.filter((i) => i.stock <= i.minimum || i.status !== 'Disponible').length;
  const homePeptidePatients = patients.filter((p) => HOME_PEPTIDE_PATIENT_IDS.has(p.id));
  const serumCount = homePeptidePatients.filter((p) => p.weeklySerum && p.status !== 'Finalizado').length;
  const finishingTreatments = homePeptidePatients.filter((p) => p.daysLeft <= 7 && p.status !== 'Finalizado').length;

  const filteredPatients = patients.filter((p) =>
    `${p.id} ${p.name} ${p.documentId ?? ''} ${p.phone ?? ''} ${p.email ?? ''} ${p.plan} ${p.tier}`
      .toLowerCase()
      .includes(patientSearch.toLowerCase()),
  );

  function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    runMutation(() => createPatient(new FormData(form)), form, 'Paciente registrado');
  }

  async function addInventory(p: ProductPayload): Promise<boolean> {
    setSaving(true);
    try {
      await upsertProduct(p);
      await reload();
      notify('Producto guardado');
      return true;
    } catch (e) {
      notify((e as Error).message || 'No se pudo guardar el producto.', true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function registerInventoryMovement(p: StockMovePayload): Promise<boolean> {
    setSaving(true);
    try {
      await inventoryMovement(p);
      await reload();
      notify('Movimiento registrado');
      return true;
    } catch (e) {
      notify((e as Error).message || 'No se pudo registrar el movimiento.', true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addMovement(payload: MovementPayload): Promise<boolean> {
    setSaving(true);
    try {
      await financeEntry(payload);
      await reload();
      notify('Movimiento registrado');
      return true;
    } catch (e) {
      notify((e as Error).message || 'No se pudo registrar el movimiento.', true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function go(next: View) {
    setView(next);
    setDrawer(false);
    setDetailPatient(null);
    setDetailAlert(null);
  }

  // Quick-create global (topbar): navega + deja un "intent" que la vista consume
  // para auto-abrir su formulario.
  const [intent, setIntent] = useState<string | null>(null);
  function quickCreate(v: View, key: string) {
    go(v);
    setIntent(key);
  }

  const lead = VIEW_LEAD[view];
  // El detalle abierto tiene prioridad en la "ruta" actual; al alternar
  // lista↔detalle cambia navKey → el .view se remonta y el reveal corre de nuevo.
  const navKey = detailPatient
    ? `patient-${detailPatient.id}`
    : detailAlert
      ? `alert-${detailAlert.id}`
      : view;
  const scrollRef = useScrollReveal(loading ? '__loading' : navKey);

  if (loading) return <Loader />;
  if (loadError) return <ErrorScreen onRetry={retry} onSignOut={onSignOut} />;

  return (
    <>
      <canvas ref={auroraRef} className="aurora" />
      <div className="aurora-veil" />
      <div className={`app${rail ? ' is-rail' : ''}`}>
        <AnimatePresence>
          {drawer && (
            <motion.div
              className="drawer-scrim"
              onClick={() => setDrawer(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
          )}
        </AnimatePresence>
        <Sidebar
          view={view}
          go={go}
          open={drawer}
          rail={rail}
          counts={{ pacientes: patients.length, alertas: lowStock }}
          userLabel={userLabel}
          onSignOut={onSignOut}
        />

        <main className="main">
          <header className="topbar">
            <MenuToggle open={drawer} onClick={toggleMenu} label={rail ? 'Abrir menú' : 'Menú'} />
            <div className="topbar__lead">
              <span className="eyebrow">{lead.eyebrow}</span>
              <h1 className="topbar__title">{lead.title}</h1>
            </div>
            <div className="topbar__actions">
              {saving && <span className="spinner" aria-label="Guardando" />}
              <QuickCreate onAction={quickCreate} />
            </div>
          </header>

          <div className="view" key={navKey} ref={scrollRef}>
            {detailPatient ? (
              <PatientDetail
                patient={detailPatient}
                onBack={() => setDetailPatient(null)}
                onPrescribe={setPrescribe}
                go={go}
              />
            ) : detailAlert ? (
              <AlertDetail alert={detailAlert} onBack={() => setDetailAlert(null)} />
            ) : (
              <>
            {view === 'inicio' && (
              <InicioView
                patients={homePeptidePatients}
                inventory={inventory}
                companyIncome={companyIncome}
                netProfit={netProfit}
                pendingIncome={pendingIncome}
                lowStock={lowStock}
                serumCount={serumCount}
                finishingTreatments={finishingTreatments}
                go={go}
                onOpenPatient={setDetailPatient}
              />
            )}
            {view === 'crm' && <CrmView notify={notify} />}
            {view === 'agenda' && <AgendaView patients={patients} appointments={appointments} onOpenPatient={setDetailPatient} />}
            {view === 'pacientes' && (
              <PacientesView
                patients={filteredPatients}
                allPatients={patients}
                inventory={inventory}
                search={patientSearch}
                setSearch={setPatientSearch}
                addPatient={addPatient}
                onOpenPatient={setDetailPatient}
                onOpenAlert={setDetailAlert}
                intent={intent}
                onIntentDone={() => setIntent(null)}
              />
            )}
            {view === 'inventario' && (
              <InventarioView
                inventory={inventory}
                allInventory={inventory}
                movements={inventoryMovements}
                addInventory={addInventory}
                registerMovement={registerInventoryMovement}
                notify={notify}
                intent={intent}
                onIntentDone={() => setIntent(null)}
              />
            )}
            {view === 'contabilidad' && (
              <ContabilidadView
                dataVersion={dataVersion}
                addMovement={addMovement}
                notify={notify}
                intent={intent}
                onIntentDone={() => setIntent(null)}
              />
            )}
            {view === 'reportes' && <ReportesView dataVersion={dataVersion} notify={notify} />}
              </>
            )}
          </div>
        </main>

        <nav className="tabbar" aria-label="Navegación principal">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`tabbar__item${view === item.id ? ' is-active' : ''}`}
              onClick={() => go(item.id)}
            >
              <item.icon size={20} />
              {item.short}
            </button>
          ))}
        </nav>
      </div>
      {prescribe && (
        <PrescribeSheet
          patient={prescribe}
          onClose={() => setPrescribe(null)}
          onError={(msg) => setToast({ msg, error: true })}
          onDone={async (msg) => {
            setPrescribe(null);
            setToast({ msg });
            await reload();
          }}
        />
      )}
      {toast && <div className={`toast${toast.error ? ' toast--error' : ''}`}>{toast.msg}</div>}
    </>
  );
}

function Sidebar({
  view,
  go,
  open,
  rail,
  counts,
  userLabel,
  onSignOut,
}: {
  view: View;
  go: (v: View) => void;
  open: boolean;
  rail: boolean;
  counts: { pacientes: number; alertas: number };
  userLabel: string;
  onSignOut: () => void;
}) {
  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="brand">
        <span className="brandmark">
          <img src="/healen-logo.png" alt="Healen" />
        </span>
        <span className="brand__name">
          <strong>HEALEN</strong>
          <span>Regenerativa</span>
        </span>
      </div>
      <nav className="nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav__item${view === item.id ? ' is-active' : ''}`}
            onClick={() => go(item.id)}
            title={rail ? item.label : undefined}
          >
            <item.icon size={19} />
            <span className="nav__label">{item.label}</span>
            {item.id === 'pacientes' && <span className="nav__count">{counts.pacientes}</span>}
            {item.id === 'inventario' && counts.alertas > 0 && (
              <span className="nav__count">{counts.alertas}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        <span className="demo-pill">Conectado · en vivo</span>
        <button className="session" onClick={onSignOut} title="Cerrar sesión">
          <span className="session__avatar">{userLabel.slice(0, 1).toUpperCase()}</span>
          <span className="session__body">
            <strong>{userLabel}</strong>
            <span>Cerrar sesión</span>
          </span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

function CellMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="10" cy="10" r="2.6" fill="currentColor" />
      <circle cx="14.5" cy="6.5" r="1.3" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

function ErrorScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <div className="login">
      <div className="login__panel">
        <span className="kpi__icon kpi__icon--danger" style={{ width: 48, height: 48, borderRadius: 14 }}>
          <AlertTriangle size={22} />
        </span>
        <div className="login__lead">
          <span className="eyebrow">Healen OS</span>
          <h1>No pudimos cargar tus datos</h1>
          <p>Revisa tu conexión e inténtalo de nuevo. Tu sesión sigue activa.</p>
        </div>
        <button className="btn btn--primary btn--block" onClick={onRetry}>
          <RefreshCw size={18} /> Reintentar
        </button>
        <button className="btn btn--ghost btn--block" onClick={onSignOut}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div className="loader">
      <div className="loader__mark">
        <span className="loader__ring" />
        <span className="loader__ring loader__ring--2" />
        <img className="loader__core" src="/healen-logo.png" alt="Healen" />
      </div>
      <div className="loader__copy">
        <strong>HEALEN</strong>
        <span>Sincronizando pacientes, inventario y caja…</span>
      </div>
    </div>
  );
}

/* ============================================================
   INICIO
   ============================================================ */
function InicioView({
  patients,
  inventory,
  companyIncome,
  netProfit,
  pendingIncome,
  lowStock,
  serumCount,
  finishingTreatments,
  go,
  onOpenPatient,
}: {
  patients: Patient[];
  inventory: InventoryItem[];
  companyIncome: number;
  netProfit: number;
  pendingIncome: number;
  lowStock: number;
  serumCount: number;
  finishingTreatments: number;
  go: (v: View) => void;
  onOpenPatient: (p: Patient) => void;
}) {
  const featuredPatients = [...patients]
    .sort((a, b) => {
      if (a.status === 'Finalizado' && b.status !== 'Finalizado') return 1;
      if (a.status !== 'Finalizado' && b.status === 'Finalizado') return -1;
      return a.daysLeft - b.daysLeft;
    })
    .slice(0, 8);
  const stockView = [...inventory]
    .sort((a, b) => a.stock / Math.max(a.minimum, 1) - b.stock / Math.max(b.minimum, 1))
    .slice(0, 4);
  const grown = useGrow();

  return (
    <>
      <section className="hero" data-reveal>
        <div className="hero__intro">
          <span className="eyebrow">Healen OS · Péptidos TOP</span>
          <h1>Solo pacientes con plan de péptidos, compras y seguimiento.</h1>
          <p>Inicio enfocado en los pacientes actualizados con protocolos de péptidos para revisar pagos, cierre de ciclo y recompra sin mezclar pacientes básicos.</p>
          <div className="hero__chips">
            <span className="hero__chip">
              <span className="dot dot--warn" />
              {patients.length} pacientes péptidos
            </span>
            <span className="hero__chip">
              <span className="dot dot--danger" />
              {lowStock} en inventario
            </span>
            <span className="hero__chip">
              <span className="dot dot--ok" />
              {serumCount} sueros activos
            </span>
          </div>
        </div>

        <article className="panel today">
          <div className="today__head">
            <h2>Pacientes péptidos actualizados</h2>
            <button className="alert-card__more" onClick={() => go('pacientes')}>
              Ver todos <ChevronRight size={15} />
            </button>
          </div>
          <div className="today__rings">
            {featuredPatients.map((p) => (
              <button key={p.id} className="urgent-ring" onClick={() => onOpenPatient(p)}>
                <TreatmentRing daysLeft={p.daysLeft} totalDays={p.totalDays} size={72} stroke={6} />
                <span className="urgent-ring__name">{p.name.split(' ')[0]}</span>
                <span className="urgent-ring__plan">{p.plan}</span>
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="panel money-strip" data-reveal style={{ padding: 0 }}>
        <div className="money">
          <div className="money__top">
            <TrendingUp size={17} />
            <span className="money__label">Ingresos empresa</span>
          </div>
          <span className="money__value">
            <CountUp value={companyIncome} />
          </span>
          <span className="money__hint">Recibidos este mes</span>
        </div>
        <div className="money money--accent">
          <div className="money__top">
            <Sparkles size={17} />
            <span className="money__label">Utilidad real</span>
          </div>
          <span className="money__value">
            <CountUp value={netProfit} />
          </span>
          <span className="money__hint">Sin retiros personales</span>
        </div>
        <div className="money">
          <div className="money__top">
            <CalendarClock size={17} />
            <span className="money__label">Por cobrar</span>
          </div>
          <span className="money__value">
            <CountUp value={pendingIncome} />
          </span>
          <span className="money__hint">Cartera pendiente</span>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">Inventario</span>
              <h2>De un vistazo</h2>
            </div>
            <button className="alert-card__more" onClick={() => go('inventario')}>
              Abrir <ChevronRight size={15} />
            </button>
          </div>
          <div className="stock-strip">
            {stockView.map((item) => {
              const signal = stockSignal(item);
              const pct = grown ? Math.min(100, (item.stock / Math.max(item.minimum * 1.6, 1)) * 100) : 0;
              return (
                <div key={item.id} className="stock-line">
                  <span className="stock-line__name">
                    <span className={`dot dot--${signal}`} />
                    <span>{item.product}</span>
                  </span>
                  <span className="gauge">
                    <span className={`gauge__fill gauge__fill--${signal}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="stock-line__val">
                    {item.stock}/{item.minimum} {item.unit}
                  </span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">Acciones</span>
              <h2>Prioridades</h2>
            </div>
          </div>
          <div className="priorities">
            <Priority
              icon={Dna}
              tone="warn"
              title={`${finishingTreatments} tratamientos por cerrar`}
              text="Revisa dosis, cierre y recompra."
              onClick={() => go('pacientes')}
            />
            <Priority
              icon={Package}
              tone="danger"
              title={`${lowStock} productos a reponer`}
              text="Bajo stock o vencimiento cercano."
              onClick={() => go('inventario')}
            />
            <Priority
              icon={CalendarClock}
              tone="brand"
              title={formatCompact(pendingIncome)}
              text="Cartera pendiente por recaudar."
              onClick={() => go('contabilidad')}
            />
          </div>
        </article>
      </section>
    </>
  );
}

function Priority({
  icon: Icon,
  tone,
  title,
  text,
  onClick,
}: {
  icon: ElementType;
  tone: 'ok' | 'warn' | 'danger' | 'brand';
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button className="priority" onClick={onClick}>
      <span className={`priority__icon priority__icon--${tone}`}>
        <Icon size={19} />
      </span>
      <span className="priority__body">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <ChevronRight className="chev" size={18} />
    </button>
  );
}

/* ============================================================
   CRM — contactos, pipeline y revisión humana
   ============================================================ */
type CrmTab = 'contacts' | 'pipeline' | 'review';
type CrmTypeFilter = 'all' | CrmContactType;
type CrmPageSizeChoice = 50 | 75 | 100 | 'all';

const CRM_BATCH_SIZE = 250;
const CRM_REQUEST_TIMEOUT = 15_000;
const CRM_CAMPAIGN_SEGMENTS = [
  { code: 'tratamiento_activo', label: 'Tratamiento activo' },
  { code: 'por_finalizar_30d', label: 'Por finalizar (30 días)' },
  { code: 'reactivacion', label: 'Reactivación' },
  { code: 'sin_tratamiento', label: 'Sin tratamiento' },
  { code: 'cumpleanos_mes', label: 'Cumpleaños del mes' },
  { code: 'vip', label: 'VIP' },
  { code: 'sin_contacto_45d', label: 'Sin contacto (45 días)' },
] as const;
const CRM_EMPTY_COUNTS: CrmCounts = {
  contacts: 0,
  leads: 0,
  patients: 0,
  activePipeline: 0,
  reviews: 0,
};

function initialCrmPageSize(): CrmPageSizeChoice {
  if (typeof window === 'undefined') return 50;
  try {
    const stored = window.localStorage.getItem('healen_crm_page_size');
    const numeric = Number(stored);
    return numeric === 50 || numeric === 75 || numeric === 100 ? numeric : 50;
  } catch {
    return 50;
  }
}

function crmErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function crmMatchesQuery(
  contact: CrmContact,
  search: string,
  type: CrmTypeFilter,
  stage: 'all' | CrmStage,
  segment: string,
): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase('es');
  const matchesSearch = !normalizedSearch || [
    contact.displayName,
    contact.phone,
    contact.email,
    contact.city,
    contact.summary,
    ...contact.tags,
  ].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(normalizedSearch);
  const matchesType = type === 'all' || contact.contactType === type;
  const matchesSegment = segment === 'all'
    || contact.patientSegments.some((item) => item.code === segment);
  return matchesSearch && matchesType && matchesSegment && (stage === 'all' || contact.stage === stage);
}

const CRM_FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  full_name: 'Nombre',
  phone: 'Teléfono',
  email: 'Correo',
  city: 'Ciudad',
  address: 'Dirección',
  birthdate: 'Fecha de nacimiento',
  document_id: 'Documento',
  interests: 'Intereses',
  suggestedStage: 'Etapa sugerida',
  suggested_stage: 'Etapa sugerida',
  client_match: 'Vinculación con registro actual',
  client_id: 'Registro vinculado',
  client_name: 'Nombre en la base actual',
  client_code: 'Código en la base actual',
  client_has_treatment: 'Tiene tratamiento',
  client_conflict_count: 'Coincidencias exactas',
  contact_type: 'Clasificación',
  lifecycle_stage: 'Estado del contacto',
  current_opportunity_stage: 'Etapa comercial',
};

function crmConfidencePct(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value <= 1 ? value * 100 : value)));
}

function crmConfidenceTone(value: number): Tone {
  const pct = crmConfidencePct(value) ?? 0;
  if (pct >= 90) return 'success';
  if (pct >= 70) return 'warning';
  return 'danger';
}

function crmDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Vacío';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(crmDisplayValue).join(', ') : 'Vacío';
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 320 ? `${serialized.slice(0, 317)}…` : serialized;
  } catch {
    return 'Dato estructurado';
  }
}

function crmCandidateChanges(candidate: CrmReviewCandidate) {
  const keys = Array.from(new Set([...Object.keys(candidate.currentData), ...Object.keys(candidate.proposedData)])).sort();
  return keys.map((key) => ({
    key,
    current: candidate.currentData[key],
    proposed: candidate.proposedData[key],
  }));
}

function crmMatchTarget(candidate: CrmReviewCandidate): string {
  const data = candidate.proposedData;
  const conflictCount = Number(data.client_conflict_count);
  if (Number.isFinite(conflictCount) && conflictCount > 1) {
    return `${conflictCount} registros exactos; requiere revisión`;
  }
  const target = data.client_name ?? data.full_name ?? data.display_name ?? data.client_code ?? data.client_id;
  return target === null || target === undefined ? 'Sin coincidencia nominada' : crmDisplayValue(target);
}

function crmMatchContext(candidate: CrmReviewCandidate): string {
  const data = candidate.proposedData;
  const conflictCount = Number(data.client_conflict_count);
  if (Number.isFinite(conflictCount) && conflictCount > 1) {
    return 'No se vinculará automáticamente con ninguno de esos registros.';
  }
  const treatment = data.client_has_treatment === true
    ? 'Tiene tratamiento registrado'
    : 'No tiene tratamiento registrado';
  const code = data.client_code ? `Código ${crmDisplayValue(data.client_code)}` : null;
  return [code, treatment].filter(Boolean).join(' · ');
}

function crmWhen(value: string | null): string {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function crmTypeTone(contact: CrmContact): Tone {
  if (contact.isPatient) return 'success';
  if (contact.contactType === 'lead') return 'warning';
  return 'neutral';
}

function crmTypeLabel(contact: CrmContact): string {
  return contact.isPatient ? 'Paciente' : crmContactTypeLabel(contact.contactType);
}

function crmCanMoveInPipeline(contact: CrmContact): boolean {
  return !contact.isPatient
    && !['staff', 'supplier', 'partner', 'personal'].includes(contact.contactType);
}

function CrmView({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const [tab, setTab] = useState<CrmTab>('contacts');
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [counts, setCounts] = useState<CrmCounts>(CRM_EMPTY_COUNTS);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [reviews, setReviews] = useState<CrmReviewCandidate[]>([]);
  const [pipelineContacts, setPipelineContacts] = useState<CrmContact[]>([]);
  const [pipelineTotal, setPipelineTotal] = useState(0);
  const [selected, setSelected] = useState<CrmContact | null>(null);
  const [editing, setEditing] = useState<CrmContact | null>(null);
  const [moving, setMoving] = useState<CrmContact | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stage, setStage] = useState<'all' | CrmStage>('all');
  const [type, setType] = useState<CrmTypeFilter>('all');
  const [segment, setSegment] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<CrmPageSizeChoice>(initialCrmPageSize);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allLoading, setAllLoading] = useState(false);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [savingContactIds, setSavingContactIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [pipelineError, setPipelineError] = useState('');
  const [reviewsError, setReviewsError] = useState('');
  const [contactsVersion, setContactsVersion] = useState(0);
  const [pipelineVersion, setPipelineVersion] = useState(0);
  const [reviewsVersion, setReviewsVersion] = useState(0);

  const contactsLoadedRef = useRef(false);
  const contactsSignatureRef = useRef('');
  const contactsRequestRef = useRef(0);
  const contactsAbortRef = useRef<AbortController | null>(null);
  const contactsResumeRef = useRef<{ signature: string; nextPage: number } | null>(null);
  const contactOverridesRef = useRef(new Map<string, CrmContact>());
  const pipelineLoadedRef = useRef(false);
  const pipelineRequestRef = useRef(0);
  const reviewsLoadedRef = useRef(false);
  const reviewsRequestRef = useRef(0);
  const querySignature = `${debouncedSearch}\u0000${type}\u0000${stage}\u0000${segment}\u0000${pageSize}\u0000${pageSize === 'all' ? 1 : page}`;
  const querySignatureRef = useRef(querySignature);
  querySignatureRef.current = querySignature;

  const numericPageSize = pageSize === 'all' ? CRM_BATCH_SIZE : pageSize;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / numericPageSize));
  const currentPage = pageSize === 'all' ? 1 : Math.min(page, pageCount);
  const reveal = useScrollReveal(`${tab}-${loading}-${selected?.id ?? ''}-${contacts.length}`);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      // El cambio de búsqueda y el regreso a página 1 ocurren en el mismo
      // render, evitando disparar una consulta intermedia a la página vieja.
      setPage(1);
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (pageSize !== 'all' && page > pageCount) setPage(pageCount);
  }, [page, pageCount, pageSize]);

  useEffect(() => {
    // "Todos" es deliberadamente temporal: volver al CRM no debe iniciar una
    // descarga completa solo porque se eligió una vez en una sesión anterior.
    if (typeof window === 'undefined' || pageSize === 'all') return;
    try {
      window.localStorage.setItem('healen_crm_page_size', String(pageSize));
    } catch {
      // Preferencia opcional: el CRM funciona igual si el navegador bloquea storage.
    }
  }, [pageSize]);

  // Contactos: una sola página en 50/75/100. "Todos" descarga bloques de 250
  // y los publica de forma progresiva, sin congelar la vista esperando el lote completo.
  useEffect(() => {
    // Al salir del directorio se cancela la descarga progresiva. Al volver,
    // las páginas terminadas salen del caché de la misma sesión y continúa sin
    // competir con el pipeline o la bandeja de revisión.
    if (tab !== 'contacts' && contactsLoadedRef.current) {
      contactsAbortRef.current?.abort();
      setAllLoading(false);
      setRefreshing(false);
      return;
    }
    const requestId = ++contactsRequestRef.current;
    const controller = new AbortController();
    contactsAbortRef.current = controller;
    let timedOut = false;
    let timeout = 0;
    function armTimeout() {
      window.clearTimeout(timeout);
      timedOut = false;
      timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CRM_REQUEST_TIMEOUT);
    }
    armTimeout();

    const hadData = contactsLoadedRef.current;
    setError('');
    setLoading(!hadData);
    setRefreshing(hadData);
    setAllLoading(pageSize === 'all');

    async function run() {
      const common = {
        search: debouncedSearch,
        contactType: type,
        stage,
        segment,
      };

      if (pageSize !== 'all') {
        contactsResumeRef.current = null;
        const result = await fetchCrmContactsPage({
          ...common,
          page,
          pageSize,
        }, { signal: controller.signal });
        if (requestId !== contactsRequestRef.current) return;
        setContacts(result.contacts.flatMap((incoming) => {
          const override = contactOverridesRef.current.get(incoming.id);
          const contact = override && override.lockVersion > incoming.lockVersion ? override : incoming;
          if (override && incoming.lockVersion >= override.lockVersion) {
            contactOverridesRef.current.delete(incoming.id);
          }
          return crmMatchesQuery(contact, debouncedSearch, type, stage, segment) ? [contact] : [];
        }));
        setCounts(result.counts);
        setFilteredTotal(result.filteredTotal);
        contactsLoadedRef.current = true;
        contactsSignatureRef.current = querySignature;
        return;
      }

      const resume = contactsResumeRef.current?.signature === querySignature
        ? contactsResumeRef.current
        : null;
      let batchPage = resume?.nextPage ?? 1;
      while (!controller.signal.aborted) {
        armTimeout();
        const result = await fetchCrmContactsPage({
          ...common,
          page: batchPage,
          pageSize: CRM_BATCH_SIZE,
        }, { signal: controller.signal });
        if (requestId !== contactsRequestRef.current) return;
        const receivedPage = batchPage;
        setCounts(result.counts);
        setFilteredTotal(result.filteredTotal);
        setContacts((current) => {
          const merged = new Map(
            (receivedPage === 1 ? [] : current).map((contact) => [contact.id, contact]),
          );
          result.contacts.forEach((incoming) => {
            const override = contactOverridesRef.current.get(incoming.id);
            const contact = override && override.lockVersion > incoming.lockVersion ? override : incoming;
            if (override && incoming.lockVersion >= override.lockVersion) {
              contactOverridesRef.current.delete(incoming.id);
            }
            if (crmMatchesQuery(contact, debouncedSearch, type, stage, segment)) merged.set(contact.id, contact);
            else merged.delete(contact.id);
          });
          return Array.from(merged.values());
        });
        contactsLoadedRef.current = true;
        contactsSignatureRef.current = querySignature;
        setLoading(false);
        setRefreshing(false);
        if (!result.hasMore || result.contacts.length === 0) {
          contactsResumeRef.current = null;
          break;
        }
        contactsResumeRef.current = { signature: querySignature, nextPage: batchPage + 1 };
        batchPage += 1;
      }
    }

    run().catch((err) => {
      if (requestId !== contactsRequestRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      const staleQuery = contactsLoadedRef.current && contactsSignatureRef.current !== querySignature;
      const message = timedOut
        ? 'La consulta tardó más de 15 segundos. Conservamos lo ya cargado para que puedas reintentar.'
        : crmErrorMessage(err, 'No se pudo cargar el CRM.');
      setError(staleQuery ? `${message} Se muestran los últimos resultados válidos, no los filtros nuevos.` : message);
    }).finally(() => {
      window.clearTimeout(timeout);
      if (requestId !== contactsRequestRef.current) return;
      setLoading(false);
      setRefreshing(false);
      setAllLoading(false);
      if (contactsAbortRef.current === controller) contactsAbortRef.current = null;
    });

    return () => {
      window.clearTimeout(timeout);
      if (contactsRequestRef.current === requestId) contactsRequestRef.current += 1;
      controller.abort();
    };
  }, [contactsVersion, debouncedSearch, page, pageSize, querySignature, segment, stage, tab, type]);

  // El pipeline no depende de la página visible del directorio: se carga al
  // abrir la pestaña y también avanza en bloques acotados.
  useEffect(() => {
    if (tab !== 'pipeline' || pipelineLoadedRef.current) return;
    const requestId = ++pipelineRequestRef.current;
    const controller = new AbortController();
    let timedOut = false;
    let timeout = 0;
    function armTimeout() {
      window.clearTimeout(timeout);
      timedOut = false;
      timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CRM_REQUEST_TIMEOUT);
    }
    armTimeout();
    setPipelineLoading(true);
    setPipelineError('');

    async function run() {
      let batchPage = 1;
      while (!controller.signal.aborted) {
        armTimeout();
        const result = await fetchCrmContactsPage({
          page: batchPage,
          pageSize: CRM_BATCH_SIZE,
          search: '',
          contactType: 'lead',
          stage: 'all',
          segment: 'all',
        }, { signal: controller.signal });
        if (requestId !== pipelineRequestRef.current) return;
        const receivedPage = batchPage;
        setPipelineContacts((current) => {
          const merged = new Map(
            (receivedPage === 1 ? [] : current).map((contact) => [contact.id, contact]),
          );
          result.contacts.forEach((incoming) => {
            const override = contactOverridesRef.current.get(incoming.id);
            const contact = override && override.lockVersion > incoming.lockVersion ? override : incoming;
            if (override && incoming.lockVersion >= override.lockVersion) {
              contactOverridesRef.current.delete(incoming.id);
            }
            if (!contact.isPatient && contact.contactType === 'lead') merged.set(contact.id, contact);
            else merged.delete(contact.id);
          });
          return Array.from(merged.values());
        });
        setPipelineTotal(result.filteredTotal);
        setCounts(result.counts);
        if (!result.hasMore || result.contacts.length === 0) break;
        batchPage += 1;
      }
      if (requestId === pipelineRequestRef.current && !controller.signal.aborted) {
        pipelineLoadedRef.current = true;
        setPipelineLoaded(true);
      }
    }

    run().catch((err) => {
      if (requestId !== pipelineRequestRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      setPipelineError(timedOut
        ? 'El pipeline tardó más de 15 segundos. Puedes reintentar sin afectar el directorio.'
        : crmErrorMessage(err, 'No se pudo cargar el pipeline.'));
    }).finally(() => {
      window.clearTimeout(timeout);
      if (requestId === pipelineRequestRef.current) setPipelineLoading(false);
    });

    return () => {
      window.clearTimeout(timeout);
      if (pipelineRequestRef.current === requestId) pipelineRequestRef.current += 1;
      controller.abort();
      setPipelineLoading(false);
    };
  }, [pipelineVersion, tab]);

  // La cola de revisión suele estar vacía y no bloquea el directorio. Solo se
  // consulta cuando alguien entra a su pestaña.
  useEffect(() => {
    if (tab !== 'review' || reviewsLoadedRef.current) return;
    const requestId = ++reviewsRequestRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CRM_REQUEST_TIMEOUT);
    setReviewsLoading(true);
    setReviewsError('');

    fetchCrmReviewQueue(controller.signal).then((rows) => {
      if (requestId !== reviewsRequestRef.current) return;
      setReviews(rows);
      reviewsLoadedRef.current = true;
      setReviewsLoaded(true);
    }).catch((err) => {
      if (requestId !== reviewsRequestRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      setReviewsError(timedOut
        ? 'La bandeja tardó más de 15 segundos. Intenta nuevamente.'
        : crmErrorMessage(err, 'No se pudo cargar la bandeja de revisión.'));
    }).finally(() => {
      window.clearTimeout(timeout);
      if (requestId === reviewsRequestRef.current) setReviewsLoading(false);
    });

    return () => {
      window.clearTimeout(timeout);
      if (reviewsRequestRef.current === requestId) reviewsRequestRef.current += 1;
      controller.abort();
      setReviewsLoading(false);
    };
  }, [reviewsVersion, tab]);

  function markContactSaving(contactId: string, saving: boolean) {
    setSavingContactIds((current) => {
      const next = new Set(current);
      if (saving) next.add(contactId);
      else next.delete(contactId);
      return next;
    });
  }

  function patchContact(nextContact: CrmContact) {
    contactOverridesRef.current.set(nextContact.id, nextContact);
    const matchesDirectory = crmMatchesQuery(nextContact, debouncedSearch, type, stage, segment);
    setContacts((current) => current
      .map((contact) => contact.id === nextContact.id ? nextContact : contact)
      .filter((contact) => contact.id !== nextContact.id || matchesDirectory));
    setPipelineContacts((current) => {
      const belongs = !nextContact.isPatient && nextContact.contactType === 'lead';
      const exists = current.some((contact) => contact.id === nextContact.id);
      if (!belongs) return current.filter((contact) => contact.id !== nextContact.id);
      if (exists) return current.map((contact) => contact.id === nextContact.id ? nextContact : contact);
      return pipelineLoadedRef.current ? [nextContact, ...current] : current;
    });
    setSelected((current) => current?.id === nextContact.id ? nextContact : current);
    setEditing((current) => current?.id === nextContact.id ? nextContact : current);
    setMoving((current) => current?.id === nextContact.id ? nextContact : current);
  }

  async function fetchFreshContact(contactId: string): Promise<CrmContact | null> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CRM_REQUEST_TIMEOUT);
    try {
      return await fetchCrmContact(contactId, controller.signal);
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function refreshMetricsAfterMutation() {
    if (pageSize !== 'all' && tab === 'contacts') {
      setContactsVersion((version) => version + 1);
      return;
    }
    const signature = querySignature;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CRM_REQUEST_TIMEOUT);
    try {
      const result = await fetchCrmContactsPage({
        page: 1,
        pageSize: 1,
        search: debouncedSearch,
        contactType: type,
        stage,
        segment,
      }, { signal: controller.signal, force: true });
      if (querySignatureRef.current !== signature) return;
      setCounts(result.counts);
      setFilteredTotal(result.filteredTotal);
    } catch {
      // La mutación ya quedó guardada; el botón Actualizar puede reconciliar
      // las métricas si esta consulta auxiliar falla.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function refreshCrm() {
    clearCrmCache();
    contactsResumeRef.current = null;
    setContactsVersion((version) => version + 1);
    if (tab === 'pipeline') {
      pipelineLoadedRef.current = false;
      setPipelineLoaded(false);
      setPipelineVersion((version) => version + 1);
    }
    if (tab === 'review') {
      reviewsLoadedRef.current = false;
      setReviewsLoaded(false);
      setReviewsVersion((version) => version + 1);
    }
  }

  function retryPipeline() {
    pipelineLoadedRef.current = false;
    setPipelineLoaded(false);
    setPipelineVersion((version) => version + 1);
  }

  function retryReviews() {
    reviewsLoadedRef.current = false;
    setReviewsLoaded(false);
    setReviewsVersion((version) => version + 1);
  }

  async function decide(candidate: CrmReviewCandidate, decision: 'approved' | 'rejected') {
    setReviewing(candidate.id);
    try {
      await reviewCrmCandidate(candidate.id, decision, candidate.lockVersion);
      setReviews((queue) => queue.filter((item) => item.id !== candidate.id));
      setCounts((current) => ({ ...current, reviews: Math.max(0, current.reviews - 1) }));
      pipelineLoadedRef.current = false;
      setPipelineLoaded(false);
      void refreshMetricsAfterMutation();
      notify(decision === 'approved' ? 'Candidato aprobado y auditado' : 'Candidato descartado');
    } catch (err) {
      notify(crmErrorMessage(err, 'No se pudo revisar el candidato.'), true);
    } finally {
      setReviewing(null);
    }
  }

  async function saveContact(fields: {
    displayName: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    contactType: CrmContactType;
    summary: string | null;
    tags: string[];
  }) {
    if (!editing) return;
    const contact = editing;
    markContactSaving(contact.id, true);
    try {
      await updateCrmContact(contact, fields);
      const optimistic: CrmContact = {
        ...contact,
        displayName: fields.displayName,
        phone: fields.phone,
        email: fields.email,
        city: fields.city,
        contactType: fields.contactType,
        isPatient: contact.isPatient || fields.contactType === 'patient',
        summary: fields.summary,
        tags: fields.tags,
        lockVersion: contact.lockVersion + 1,
      };
      patchContact(optimistic);
      const fresh = await fetchFreshContact(contact.id);
      if (fresh) patchContact(fresh);
      setEditing(null);
      void refreshMetricsAfterMutation();
      notify(fields.contactType === 'patient' && !contact.isPatient
        ? 'Paciente creado o vinculado; identidad y segmentos sincronizados'
        : 'Contacto actualizado y auditado');
    } catch (err) {
      notify(crmErrorMessage(err, 'No se pudo actualizar el contacto.'), true);
    } finally {
      markContactSaving(contact.id, false);
    }
  }

  async function moveContact(contact: CrmContact, nextStage: CrmStage, nextActionAt?: string | null) {
    if (contact.stage === nextStage && nextActionAt === undefined) return;
    if (!crmCanMoveInPipeline(contact)) {
      notify('Este contacto no pertenece al pipeline comercial. Clasifícalo como lead antes de moverlo.', true);
      return;
    }
    markContactSaving(contact.id, true);
    try {
      const resolvedNextAction = nextActionAt === undefined ? contact.nextActionAt : nextActionAt;
      await moveCrmContact(contact, nextStage, resolvedNextAction);
      const canBecomeLead = crmCanMoveInPipeline(contact);
      const optimistic: CrmContact = {
        ...contact,
        stage: nextStage,
        nextActionAt: resolvedNextAction,
        contactType: canBecomeLead ? 'lead' : contact.contactType,
        lifecycleStage: canBecomeLead ? 'lead' : contact.lifecycleStage,
        lockVersion: contact.lockVersion + 1,
      };
      patchContact(optimistic);
      const fresh = await fetchFreshContact(contact.id);
      if (fresh) patchContact(fresh);
      setMoving(null);
      void refreshMetricsAfterMutation();
      notify(`Contacto movido a ${crmStageLabel(nextStage)}`);
    } catch (err) {
      notify(crmErrorMessage(err, 'No se pudo mover el contacto.'), true);
    } finally {
      markContactSaving(contact.id, false);
    }
  }

  if (selected) {
    const selectedSaving = savingContactIds.has(selected.id);
    return (
      <>
        <CrmContactDetail
          contact={selected}
          onBack={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onMove={() => setMoving(selected)}
        />
        {editing && <CrmEditSheet contact={editing} saving={selectedSaving} onSave={saveContact} onClose={() => setEditing(null)} />}
        {moving && <CrmMoveSheet contact={moving} saving={selectedSaving} onMove={(stageValue, nextAction) => moveContact(moving, stageValue, nextAction)} onClose={() => setMoving(null)} />}
      </>
    );
  }

  if (loading && !contactsLoadedRef.current) {
    return (
      <div className="view-loading" ref={reveal}>
        <span className="spinner" /> Cargando la primera página del CRM…
      </div>
    );
  }

  if (error && !contactsLoadedRef.current) {
    return (
      <div className="crm-state panel" ref={reveal} data-reveal>
        <span className="kpi__icon kpi__icon--danger"><AlertTriangle size={20} /></span>
        <div>
          <h2>No pudimos cargar el CRM</h2>
          <p>{error}</p>
        </div>
        <button className="btn btn--primary" onClick={refreshCrm}>
          <RefreshCw size={17} /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="view-wrap" ref={reveal}>
      <div className="crm-tabs" data-reveal role="tablist" aria-label="Secciones CRM">
        <button className={`crm-tab${tab === 'contacts' ? ' is-active' : ''}`} onClick={() => setTab('contacts')} role="tab" aria-selected={tab === 'contacts'}>
          <Users size={17} /> Contactos <small>{counts.contacts}</small>
        </button>
        <button className={`crm-tab${tab === 'pipeline' ? ' is-active' : ''}`} onClick={() => setTab('pipeline')} role="tab" aria-selected={tab === 'pipeline'}>
          <TrendingUp size={17} /> Pipeline <small>{counts.activePipeline}</small>
        </button>
        <button className={`crm-tab${tab === 'review' ? ' is-active' : ''}`} onClick={() => setTab('review')} role="tab" aria-selected={tab === 'review'}>
          <ClipboardList size={17} /> Por revisar <small>{counts.reviews}</small>
        </button>
        <button className="btn btn--icon crm-refresh" onClick={refreshCrm} disabled={refreshing || pipelineLoading || reviewsLoading} aria-label="Actualizar CRM" title="Actualizar CRM">
          {refreshing || pipelineLoading || reviewsLoading ? <span className="spinner spinner--sm" /> : <RefreshCw size={17} />}
        </button>
      </div>

      <section className="kpi-grid" data-reveal>
        <SignalKpi icon={Users} tone="brand" label="Contactos" value={counts.contacts} hint="Identidades útiles en CRM" />
        <SignalKpi icon={UserPlus} tone="warn" label="Leads" value={counts.leads} hint="Contactos comerciales" />
        <SignalKpi icon={Activity} tone="ok" label="Pacientes" value={counts.patients} hint="Fichas clínicas vinculadas al CRM" />
        <SignalKpi icon={ClipboardList} tone={counts.reviews ? 'warn' : 'ok'} label="Por revisar" value={counts.reviews} hint="Cambios aún no aplicados" />
      </section>

      {tab === 'contacts' && (
        <>
          <CrmFilters
            search={search}
            setSearch={setSearch}
            stage={stage}
            setStage={(value) => { setStage(value); setPage(1); }}
            type={type}
            setType={(value) => { setType(value); setPage(1); }}
            segment={segment}
            setSegment={(value) => { setSegment(value); setPage(1); }}
            count={filteredTotal}
            pageSize={pageSize}
            setPageSize={(value) => { setPageSize(value); setPage(1); }}
          />
          {(refreshing || (search.trim() !== debouncedSearch)) && (
            <div className="crm-inline-status" role="status"><span className="spinner spinner--sm" /> Actualizando resultados…</div>
          )}
          {error && (
            <div className="crm-inline-alert" role="alert">
              <AlertTriangle size={17} /><span>{error}</span>
              <button className="btn btn--soft" onClick={refreshCrm}><RefreshCw size={15} /> Reintentar</button>
            </div>
          )}
          <CrmContactsTable
            contacts={contacts}
            filteredTotal={filteredTotal}
            total={counts.contacts}
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            allLoading={allLoading}
            onStopAll={() => {
              contactsAbortRef.current?.abort();
              setAllLoading(false);
            }}
            onResumeAll={() => setContactsVersion((version) => version + 1)}
            onPageChange={setPage}
            onOpen={setSelected}
            onEdit={setEditing}
            onMove={(contact, nextStage) => moveContact(contact, nextStage)}
            savingContactIds={savingContactIds}
          />
        </>
      )}

      {tab === 'pipeline' && (
        <>
          {pipelineLoading && (
            <div className="crm-inline-status" role="status"><span className="spinner spinner--sm" /> Cargando pipeline: {pipelineContacts.length} de {pipelineTotal || '…'}…</div>
          )}
          {pipelineError && (
            <div className="crm-inline-alert" role="alert">
              <AlertTriangle size={17} /><span>{pipelineError}</span>
              <button className="btn btn--soft" onClick={retryPipeline}><RefreshCw size={15} /> Reintentar</button>
            </div>
          )}
          {pipelineContacts.length === 0 && pipelineLoaded ? (
            <CrmEmpty icon={TrendingUp} title="El pipeline está vacío" text="Los contactos clasificados como leads aparecerán aquí; pacientes, equipo y proveedores permanecen fuera del embudo comercial." />
          ) : pipelineContacts.length > 0 ? (
            <CrmPipeline
              contacts={pipelineContacts}
              total={pipelineTotal}
              loading={pipelineLoading}
              onOpen={setSelected}
              onMove={(contact, nextStage) => moveContact(contact, nextStage)}
              savingContactIds={savingContactIds}
            />
          ) : null}
        </>
      )}

      {tab === 'review' && (
        <>
          {reviewsLoading && <div className="crm-inline-status" role="status"><span className="spinner spinner--sm" /> Cargando bandeja de revisión…</div>}
          {reviewsError && (
            <div className="crm-inline-alert" role="alert">
              <AlertTriangle size={17} /><span>{reviewsError}</span>
              <button className="btn btn--soft" onClick={retryReviews}><RefreshCw size={15} /> Reintentar</button>
            </div>
          )}
          {reviewsLoaded && <CrmReviewQueue candidates={reviews} reviewing={reviewing} onDecision={decide} />}
        </>
      )}

      {editing && <CrmEditSheet contact={editing} saving={savingContactIds.has(editing.id)} onSave={saveContact} onClose={() => setEditing(null)} />}
      {moving && <CrmMoveSheet contact={moving} saving={savingContactIds.has(moving.id)} onMove={(stageValue, nextAction) => moveContact(moving, stageValue, nextAction)} onClose={() => setMoving(null)} />}
    </div>
  );
}

function CrmFilters({
  search,
  setSearch,
  stage,
  setStage,
  type,
  setType,
  segment,
  setSegment,
  count,
  pageSize,
  setPageSize,
}: {
  search: string;
  setSearch: (value: string) => void;
  stage: 'all' | CrmStage;
  setStage: (value: 'all' | CrmStage) => void;
  type: CrmTypeFilter;
  setType: (value: CrmTypeFilter) => void;
  segment: string;
  setSegment: (value: string) => void;
  count: number;
  pageSize: CrmPageSizeChoice;
  setPageSize: (value: CrmPageSizeChoice) => void;
}) {
  return (
    <div className="crm-filters" data-reveal>
      <div className="search">
        <Search size={17} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, teléfono, correo o interés" />
        {search && (
          <button className="crm-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><X size={15} /></button>
        )}
      </div>
      <label className="crm-select">
        <span>Tipo</span>
        <select value={type} onChange={(event) => setType(event.target.value as CrmTypeFilter)}>
          <option value="all">Todos</option>
          <option value="lead">Leads</option>
          <option value="patient">Pacientes</option>
          <option value="supplier">Proveedores</option>
          <option value="staff">Equipo</option>
          <option value="partner">Aliados</option>
          <option value="personal">Personal / no comercial</option>
          <option value="group_only">Solo en grupos</option>
          <option value="other">Otros</option>
          <option value="unknown">Sin clasificar</option>
        </select>
      </label>
      <label className="crm-select">
        <span>Campaña</span>
        <select value={segment} onChange={(event) => setSegment(event.target.value)}>
          <option value="all">Todos los segmentos</option>
          {CRM_CAMPAIGN_SEGMENTS.map((item) => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </select>
      </label>
      <label className="crm-select">
        <span>Etapa</span>
        <select value={stage} onChange={(event) => setStage(event.target.value as 'all' | CrmStage)}>
          <option value="all">Todas</option>
          {CRM_STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="crm-select">
        <span>Ver</span>
        <select
          value={String(pageSize)}
          onChange={(event) => {
            const value = event.target.value;
            setPageSize(value === 'all' ? 'all' : Number(value) as 50 | 75 | 100);
          }}
          aria-label="Contactos por página"
        >
          <option value="50">50</option>
          <option value="75">75</option>
          <option value="100">100</option>
          <option value="all">Todos</option>
        </select>
      </label>
      <span className="crm-result-count">{count} resultado{count === 1 ? '' : 's'}</span>
    </div>
  );
}

function CrmContactsTable({
  contacts,
  filteredTotal,
  total,
  page,
  pageCount,
  pageSize,
  allLoading,
  onStopAll,
  onResumeAll,
  onPageChange,
  onOpen,
  onEdit,
  onMove,
  savingContactIds,
}: {
  contacts: CrmContact[];
  filteredTotal: number;
  total: number;
  page: number;
  pageCount: number;
  pageSize: CrmPageSizeChoice;
  allLoading: boolean;
  onStopAll: () => void;
  onResumeAll: () => void;
  onPageChange: (page: number) => void;
  onOpen: (contact: CrmContact) => void;
  onEdit: (contact: CrmContact) => void;
  onMove: (contact: CrmContact, stage: CrmStage) => void;
  savingContactIds: ReadonlySet<string>;
}) {
  if (total === 0) {
    return <CrmEmpty icon={Users} title="Aún no hay contactos" text="Cuando termine la importación de WhatsApp, todos aparecerán aquí sin convertirse automáticamente en pacientes." />;
  }
  if (contacts.length === 0) {
    return <CrmEmpty icon={Search} title="Sin coincidencias" text="Prueba otra búsqueda o limpia los filtros." />;
  }
  return (
    <section className={`panel crm-list-panel${pageSize === 'all' ? ' crm-list-panel--all' : ''}`} data-reveal>
      <div className="table-wrap">
        <table className="table crm-table">
          <thead>
            <tr>
              <th>Contacto</th>
              <th>Clasificación</th>
              <th>Etapa</th>
              <th>Actividad</th>
              <th>Próxima acción</th>
              <th aria-label="Abrir" />
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id} aria-busy={savingContactIds.has(contact.id)}>
                <td data-label="Contacto">
                  <button className="crm-person" onClick={() => onOpen(contact)}>
                    <span className="crm-avatar">{contact.displayName.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{contact.displayName}</strong>
                      <small>{[contact.phone, contact.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</small>
                      {(contact.city || contact.responsible) && <small>{[contact.city, contact.responsible && `Resp. ${contact.responsible}`].filter(Boolean).join(' · ')}</small>}
                    </span>
                  </button>
                </td>
                <td data-label="Clasificación">
                  <Badge label={crmTypeLabel(contact)} tone={crmTypeTone(contact)} />
                  {contact.patientSegments.length > 0 && (
                    <span className="crm-segment-summary">
                      {contact.patientSegments.slice(0, 2).map((item) => item.name).join(' · ')}
                      {contact.patientSegments.length > 2 ? ` +${contact.patientSegments.length - 2}` : ''}
                    </span>
                  )}
                </td>
                <td data-label="Etapa">
                  {crmCanMoveInPipeline(contact) ? (
                    <select
                      className={`crm-stage-select crm-stage--${contact.stage}`}
                      value={contact.stage}
                      onChange={(event) => onMove(contact, event.target.value as CrmStage)}
                      disabled={savingContactIds.has(contact.id)}
                      aria-label={`Mover ${contact.displayName} en el pipeline`}
                    >
                      {CRM_STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  ) : (
                    <span className="crm-stage crm-stage--unclassified">Fuera del pipeline</span>
                  )}
                </td>
                <td data-label="Actividad">
                  <strong className="crm-cell-value">{contact.openOpportunityCount} abierta{contact.openOpportunityCount === 1 ? '' : 's'}</strong>
                  <span>{contact.opportunityCount} oportunidades · {crmWhen(contact.lastInteractionAt)}</span>
                </td>
                <td data-label="Próxima acción">
                  <strong className="crm-cell-value">{contact.nextActionAt ? 'Seguimiento programado' : 'Sin definir'}</strong>
                  <span>{contact.nextActionAt ? crmWhen(contact.nextActionAt) : '—'}</span>
                </td>
                <td className="crm-open-cell">
                  <div className="crm-row-actions">
                    <button className="btn btn--icon" onClick={() => onEdit(contact)} disabled={savingContactIds.has(contact.id)} aria-label={`Editar ${contact.displayName}`} title="Editar contacto">
                      {savingContactIds.has(contact.id) ? <span className="spinner spinner--sm" /> : <Pencil size={15} />}
                    </button>
                    <button className="btn btn--icon" onClick={() => onOpen(contact)} aria-label={`Abrir ${contact.displayName}`} title="Ver ficha"><ChevronRight size={17} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize === 'all' ? (
        <nav className="crm-pagination" aria-label="Progreso de carga de contactos">
          <span>{contacts.length} de {filteredTotal} contactos cargados</span>
          <div>
            {allLoading && <><span className="spinner spinner--sm" /><strong>Cargando por bloques de {CRM_BATCH_SIZE}</strong></>}
            {allLoading && <button className="btn btn--soft" onClick={onStopAll}>Detener</button>}
            {!allLoading && contacts.length < filteredTotal && <button className="btn btn--soft" onClick={onResumeAll}><RefreshCw size={15} /> Continuar</button>}
          </div>
        </nav>
      ) : filteredTotal > 0 ? (
        <nav className="crm-pagination" aria-label="Paginación de contactos">
          <span>
            {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, filteredTotal)} de {filteredTotal}
          </span>
          <div>
            <button
              className="btn btn--icon"
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              aria-label="Página anterior"
            >
              <ChevronLeft size={17} />
            </button>
            <strong>Página {page} de {pageCount}</strong>
            <button
              className="btn btn--icon"
              onClick={() => onPageChange(page + 1)}
              disabled={page === pageCount}
              aria-label="Página siguiente"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}

function CrmPipeline({
  contacts,
  total,
  loading,
  onOpen,
  onMove,
  savingContactIds,
}: {
  contacts: CrmContact[];
  total: number;
  loading: boolean;
  onOpen: (contact: CrmContact) => void;
  onMove: (contact: CrmContact, stage: CrmStage) => void;
  savingContactIds: ReadonlySet<string>;
}) {
  const visibleStages = CRM_STAGES.filter((item) => item.id !== 'unclassified' || contacts.some((contact) => contact.stage === item.id));
  return (
    <>
      <div className="crm-pipeline-help" data-reveal>
        <div><TrendingUp size={18} /><span><strong>Pipeline operativo</strong> Mueve cada contacto desde el selector de su tarjeta.</span></div>
        <small>{contacts.length}{loading && total > contacts.length ? ` de ${total}` : ''} lead{total === 1 ? '' : 's'} en seguimiento</small>
      </div>
      <section className="crm-board" data-reveal aria-label="Pipeline comercial">
        {visibleStages.map((item) => {
          const stageContacts = contacts.filter((contact) => contact.stage === item.id);
          return (
            <div className="crm-column" key={item.id}>
              <header className="crm-column__head">
                <span className={`dot dot--${item.id === 'lost' ? 'danger' : item.id === 'converted' ? 'ok' : 'warn'}`} />
                <strong>{item.label}</strong>
                <small>{stageContacts.length}</small>
              </header>
              <div className="crm-column__body">
                {stageContacts.map((contact) => (
                  <article className="crm-deal" key={contact.id} aria-busy={savingContactIds.has(contact.id)}>
                    <button className="crm-deal__open" onClick={() => onOpen(contact)}>
                      <strong>{contact.displayName}</strong>
                      <span>{[contact.phone, contact.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span>
                    </button>
                    <p>{contact.summary || contact.tags.join(', ') || 'Sin resumen validado'}</p>
                    <div className="crm-deal__meta">
                      <small>{contact.nextActionAt ? `Próxima: ${crmWhen(contact.nextActionAt)}` : 'Sin próxima acción'}</small>
                      <ChevronRight size={14} />
                    </div>
                    <label className="crm-deal__move">
                      <span>Mover a</span>
                      <select value={contact.stage} onChange={(event) => onMove(contact, event.target.value as CrmStage)} disabled={savingContactIds.has(contact.id)}>
                        {CRM_STAGES.map((stageItem) => <option key={stageItem.id} value={stageItem.id}>{stageItem.label}</option>)}
                      </select>
                    </label>
                  </article>
                ))}
                {stageContacts.length === 0 && <span className="crm-column__empty">Sin contactos</span>}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

function CrmReviewQueue({
  candidates,
  reviewing,
  onDecision,
}: {
  candidates: CrmReviewCandidate[];
  reviewing: string | null;
  onDecision: (candidate: CrmReviewCandidate, decision: 'approved' | 'rejected') => void;
}) {
  if (candidates.length === 0) {
    return <CrmEmpty icon={Check} title="Bandeja al día" text="No hay matches ni cambios pendientes de revisión humana." />;
  }
  return (
    <section className="crm-review-list" data-reveal>
      {candidates.map((candidate) => {
        const pct = crmConfidencePct(candidate.confidence) ?? 0;
        const isMatch = candidate.candidateKind.includes('match');
        const isConflict = candidate.candidateKind === 'contact_match_conflict';
        const changes = crmCandidateChanges(candidate);
        const databaseChanges = changes.filter((change) => ['full_name', 'phone', 'email'].includes(change.key));
        return (
          <article className="panel crm-review" key={candidate.id}>
            <header className="crm-review__head">
              <span className="crm-avatar"><User size={17} /></span>
              <div>
                <span className="eyebrow">{isMatch ? 'Match propuesto' : 'Dato propuesto'}</span>
                <h3>{candidate.contactName}</h3>
              </div>
              <Badge label={`${pct}% confianza`} tone={crmConfidenceTone(candidate.confidence)} />
            </header>

            {isMatch ? (
              <div className="crm-compare crm-compare--match">
                <div><span>Contacto CRM</span><strong>{candidate.contactName}</strong></div>
                <span className="crm-compare__arrow"><LinkIcon size={18} /></span>
                <div>
                  <span>{isConflict ? 'Conflicto en la base actual' : 'Registro sugerido'}</span>
                  <strong>{crmMatchTarget(candidate)}</strong>
                  <small className="crm-match-note">{crmMatchContext(candidate)}</small>
                </div>
              </div>
            ) : (
              <div className="crm-change-list">
                {changes.map((change) => (
                  <div className="crm-compare" key={change.key}>
                    <div><span>Campo</span><strong>{CRM_FIELD_LABELS[change.key] || change.key.replace(/_/g, ' ')}</strong></div>
                    <div><span>Valor actual</span><strong>{crmDisplayValue(change.current)}</strong></div>
                    <span className="crm-compare__arrow"><ChevronRight size={18} /></span>
                    <div><span>Valor propuesto</span><strong>{crmDisplayValue(change.proposed)}</strong></div>
                  </div>
                ))}
                {changes.length === 0 && <p className="muted-line">El candidato no contiene campos comparables.</p>}
              </div>
            )}

            {isMatch && !isConflict && databaseChanges.length > 0 && (
              <div className="crm-change-list">
                {databaseChanges.map((change) => (
                  <div className="crm-compare" key={change.key}>
                    <div><span>Campo</span><strong>{CRM_FIELD_LABELS[change.key]}</strong></div>
                    <div><span>Base actual</span><strong>{crmDisplayValue(change.current)}</strong></div>
                    <span className="crm-compare__arrow"><ChevronRight size={18} /></span>
                    <div><span>WhatsApp</span><strong>{crmDisplayValue(change.proposed)}</strong></div>
                  </div>
                ))}
              </div>
            )}

            <div className="crm-review__meta">
              <span><strong>Motivo:</strong> {candidate.reason || 'Importación desde WhatsApp pendiente de validación.'}</span>
              <span><strong>Evidencias:</strong> {candidate.evidenceCount} referencia{candidate.evidenceCount === 1 ? '' : 's'} · creado {crmWhen(candidate.createdAt)}</span>
            </div>
            <footer className="crm-review__actions">
              <button className="btn btn--primary" onClick={() => onDecision(candidate, 'approved')} disabled={reviewing !== null}>
                {reviewing === candidate.id ? <span className="spinner spinner--sm" /> : <Check size={17} />}
                {isConflict ? 'Importar sin vincular' : isMatch ? 'Aprobar vínculo' : 'Aprobar'}
              </button>
              <button className="btn btn--ghost" onClick={() => onDecision(candidate, 'rejected')} disabled={reviewing !== null}>
                <X size={17} /> Descartar
              </button>
              <small>{isConflict
                ? 'Se crea el contacto CRM con conflicto pendiente; no se elige ningún registro.'
                : 'Aprobar no crea un paciente ni un tratamiento.'}</small>
            </footer>
          </article>
        );
      })}
    </section>
  );
}

function CrmContactDetail({
  contact,
  onBack,
  onEdit,
  onMove,
}: {
  contact: CrmContact;
  onBack: () => void;
  onEdit: () => void;
  onMove: () => void;
}) {
  const ref = useScrollReveal(contact.id);
  const confidence = crmConfidencePct(contact.matchConfidence);
  const canMove = crmCanMoveInPipeline(contact);
  return (
    <div className="detail crm-detail" ref={ref}>
      <div className="detail__bar" data-reveal>
        <button className="detail__back" onClick={onBack}><ArrowLeft size={17} /> CRM</button>
        <nav className="detail__crumbs" aria-label="Ruta">
          <button onClick={onBack}>Contactos</button><ChevronRight size={13} /><span>{contact.displayName}</span>
        </nav>
        <div className="crm-detail__actions">
          {canMove && <button className="btn btn--soft" onClick={onMove}><TrendingUp size={16} /> Mover etapa</button>}
          <button className="btn btn--primary" onClick={onEdit}><Pencil size={16} /> Editar contacto</button>
        </div>
      </div>

      <header className="crm-detail__hero" data-reveal>
        <span className="crm-detail__avatar">{contact.displayName.slice(0, 1).toUpperCase()}</span>
        <div className="crm-detail__identity">
          <span className="eyebrow">Contacto CRM</span>
          <h1>{contact.displayName}</h1>
          <div className="detail__tags">
            <Badge label={crmTypeLabel(contact)} tone={crmTypeTone(contact)} />
            <span className={`crm-stage crm-stage--${contact.stage}`}>{crmStageLabel(contact.stage)}</span>
            {!contact.active && <Badge label="Archivado" tone="neutral" />}
            {contact.lifecycleStage && <span className="detail__pid">Ciclo · {contact.lifecycleStage.replace(/_/g, ' ')}</span>}
          </div>
        </div>
        <div className="crm-detail__metric">
          <strong>{contact.openOpportunityCount}</strong>
          <span>oportunidades abiertas</span>
        </div>
      </header>

      <div className="detail__grid">
        <aside className="detail__aside">
          <section className="detail-block" data-reveal>
            <div className="label"><User size={17} /> Identidad <button className="detail-block__edit" onClick={onEdit}><Pencil size={13} /> Editar</button></div>
            <div className="crm-facts">
              <div><span>Teléfono</span><strong>{contact.phone || 'Sin registrar'}</strong></div>
              <div><span>Correo</span><strong>{contact.email || 'Sin registrar'}</strong></div>
              <div><span>Ciudad</span><strong>{contact.city || 'Sin registrar'}</strong></div>
              <div><span>Responsable</span><strong>{contact.responsible || 'Sin asignar'}</strong></div>
            </div>
          </section>

          <section className="detail-block crm-patient-rule" data-reveal>
            <div className="label"><Dna size={17} /> Relación clínica</div>
            {contact.isPatient ? (
              <>
                <Badge label="Paciente confirmado" tone="success" />
                <p>Ficha clínica vinculada. {contact.treatmentCount} tratamiento{contact.treatmentCount === 1 ? '' : 's'} registrado{contact.treatmentCount === 1 ? '' : 's'}; {contact.activeTreatmentCount} activo{contact.activeTreatmentCount === 1 ? '' : 's'}.</p>
                {(contact.clientName || contact.clientCode) && <span className="crm-match-note">{contact.clientName || 'Paciente'} · {contact.clientCode || 'sin código'}</span>}
              </>
            ) : (
              <>
                <Badge label="No es paciente" tone="neutral" />
                <p>Este contacto permanece en CRM. Puedes convertirlo en paciente desde Editar; se creará o vinculará su ficha clínica sin exigir un tratamiento.</p>
              </>
            )}
            {confidence !== null && <span className="crm-match-note">Match de identidad: {confidence}% · {contact.matchMethod || contact.matchStatus || 'pendiente'}</span>}
          </section>
        </aside>

        <main className="detail__main">
          <section className="detail-block" data-reveal>
            <div className="label"><Sparkles size={17} /> Lectura comercial</div>
            <div className="crm-summary crm-summary--single">
              <div><span>Último resumen validado</span><p>{contact.summary || 'La conversación todavía no tiene un resumen validado.'}</p></div>
            </div>
            {contact.tags.length > 0 && <div className="crm-tags">{contact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          </section>

          {contact.isPatient && (
            <section className="detail-block" data-reveal>
              <div className="label"><Megaphone size={17} /> Segmentos de campañas</div>
              {contact.patientSegments.length > 0 ? (
                <div className="crm-campaign-segments">
                  {contact.patientSegments.map((segmentItem) => (
                    <article key={segmentItem.code}>
                      <strong>{segmentItem.name}</strong>
                      <span>{segmentItem.campaignType.replace(/_/g, ' ')} · {segmentItem.cadence}</span>
                      <p>{segmentItem.reason}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="crm-segments-empty">Este paciente no coincide hoy con una regla automática de campaña.</p>
              )}
            </section>
          )}

          <section className="detail-block" data-reveal>
            <div className="label"><CalendarClock size={17} /> Seguimiento {canMove && <button className="detail-block__edit" onClick={onMove}><TrendingUp size={13} /> Mover</button>}</div>
            <div className="crm-followup">
              <div><span>Próxima acción</span><strong>{contact.nextActionAt ? crmWhen(contact.nextActionAt) : 'Sin definir'}</strong></div>
              <div><span>Oportunidades</span><strong>{contact.openOpportunityCount} abiertas · {contact.opportunityCount} total</strong></div>
              <div><span>Primer contacto</span><strong>{crmWhen(contact.firstInteractionAt)}</strong></div>
              <div><span>Último contacto</span><strong>{crmWhen(contact.lastInteractionAt)}</strong></div>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}

const CRM_EDITABLE_TYPES: Array<{ id: CrmContactType; label: string }> = [
  { id: 'lead', label: 'Lead' },
  { id: 'patient', label: 'Paciente' },
  { id: 'unknown', label: 'Sin clasificar' },
  { id: 'supplier', label: 'Proveedor' },
  { id: 'staff', label: 'Equipo' },
  { id: 'partner', label: 'Aliado' },
  { id: 'personal', label: 'Personal / no comercial' },
  { id: 'group_only', label: 'Solo en grupos' },
  { id: 'other', label: 'Otro' },
];

function CrmEditSheet({
  contact,
  saving,
  onSave,
  onClose,
}: {
  contact: CrmContact;
  saving: boolean;
  onSave: (fields: {
    displayName: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    contactType: CrmContactType;
    summary: string | null;
    tags: string[];
  }) => void;
  onClose: () => void;
}) {
  const initialType: CrmContactType = contact.contactType;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      displayName: String(form.get('displayName') || '').trim() || 'Contacto WhatsApp',
      phone: String(form.get('phone') || '').trim() || null,
      email: String(form.get('email') || '').trim().toLocaleLowerCase('es') || null,
      city: String(form.get('city') || '').trim() || null,
      contactType: String(form.get('contactType') || initialType) as CrmContactType,
      summary: String(form.get('summary') || '').trim() || null,
      tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    });
  }

  return (
    <Sheet title={`Editar ${contact.displayName}`} eyebrow="CRM" onClose={onClose}>
      <form className="form crm-edit-form" onSubmit={submit}>
        <label className="field field--full"><span>Nombre</span><input name="displayName" defaultValue={contact.displayName} autoFocus /></label>
        <label className="field"><span>Teléfono</span><input name="phone" type="tel" defaultValue={contact.phone || ''} placeholder="+57…" /></label>
        <label className="field"><span>Correo</span><input name="email" type="email" defaultValue={contact.email || ''} placeholder="correo@ejemplo.com" /></label>
        <label className="field"><span>Ciudad</span><input name="city" defaultValue={contact.city || ''} placeholder="Medellín" /></label>
        <label className="field"><span>Clasificación</span>
          <select name="contactType" defaultValue={initialType} disabled={contact.isPatient}>
            {contact.isPatient
              ? <option value="patient">Paciente</option>
              : CRM_EDITABLE_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {!contact.isPatient && (
          <p className="crm-patient-promotion-note field--full">
            Al elegir Paciente se creará o vinculará una ficha clínica y se sincronizarán nombre, teléfono y correo. El tratamiento se gestiona por separado.
          </p>
        )}
        <label className="field field--full"><span>Resumen comercial</span><textarea name="summary" defaultValue={contact.summary || ''} placeholder="Necesidad, interés y contexto relevante del contacto" rows={4} /></label>
        <label className="field field--full"><span>Etiquetas, separadas por coma</span><input name="tags" defaultValue={contact.tags.join(', ')} placeholder="NAD+, seguimiento, referido" /></label>
        <div className="crm-form-actions field--full">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? <span className="spinner spinner--sm" /> : <Check size={16} />} Guardar cambios</button>
        </div>
      </form>
    </Sheet>
  );
}

function crmDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function CrmMoveSheet({
  contact,
  saving,
  onMove,
  onClose,
}: {
  contact: CrmContact;
  saving: boolean;
  onMove: (stage: CrmStage, nextActionAt: string | null) => void;
  onClose: () => void;
}) {
  const [nextStage, setNextStage] = useState<CrmStage>(contact.stage);
  const [nextAction, setNextAction] = useState(crmDateTimeLocal(contact.nextActionAt));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextActionAt = nextAction ? new Date(nextAction).toISOString() : null;
    onMove(nextStage, nextActionAt);
  }

  return (
    <Sheet title={`Mover a ${contact.displayName}`} eyebrow="Pipeline" onClose={onClose}>
      <form className="crm-move-form" onSubmit={submit}>
        <div className="crm-move-current">
          <span>Etapa actual</span>
          <strong className={`crm-stage crm-stage--${contact.stage}`}>{crmStageLabel(contact.stage)}</strong>
        </div>
        <label className="field"><span>Nueva etapa</span>
          <select value={nextStage} onChange={(event) => setNextStage(event.target.value as CrmStage)} autoFocus>
            {CRM_STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Próxima acción</span><input type="datetime-local" value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
        <p className="crm-form-note">El movimiento quedará registrado en la bitácora. Convertido y Perdido cierran la oportunidad; volver a una etapa activa la reabre.</p>
        <div className="crm-form-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={saving || nextStage === contact.stage && crmDateTimeLocal(contact.nextActionAt) === nextAction}>
            {saving ? <span className="spinner spinner--sm" /> : <TrendingUp size={16} />} Actualizar pipeline
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ============================================================
   AGENDA
   ============================================================ */
type AgendaEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  detail: string;
  kind: 'suero' | 'control' | 'cierre' | 'peptido' | 'consulta';
  patient?: Patient;
  patientName: string;
  documentId?: string;
  fullName?: string;
  agendaLabel?: string;
  services?: string[];
  tone: 'ok' | 'warn' | 'danger' | 'brand';
};

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function isoLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysLocal(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function agendaDayLabel(value: string) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}

function agendaKindLabel(kind: AgendaEvent['kind']) {
  const labels: Record<AgendaEvent['kind'], string> = {
    suero: 'suero',
    control: 'control',
    cierre: 'cierre',
    peptido: 'péptido',
    consulta: 'consulta',
  };
  return labels[kind];
}

function buildAgendaEvents(patients: Patient[], horizon = 14): AgendaEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = isoLocal(today);
  const end = addDaysLocal(today, horizon);
  const events: AgendaEvent[] = [];

  patients
    .filter((p) => p.status !== 'Finalizado')
    .forEach((patient, idx) => {
      if (patient.weeklySerum) {
        const normalized = patient.serumDay.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const weekday = WEEKDAY_INDEX[normalized];
        if (weekday !== undefined) {
          for (let offset = 0; offset <= horizon; offset += 1) {
            const date = addDaysLocal(today, offset);
            if (date.getDay() !== weekday) continue;
            const iso = isoLocal(date);
            events.push({
              id: `suero-${patient.id}-${iso}`,
              date: iso,
              time: idx % 2 === 0 ? '09:00' : '11:30',
              title: 'Suero semanal',
              detail: `${patient.plan} · preparar insumos y consentimiento`,
              kind: 'suero',
              patient,
              patientName: patient.name,
              tone: 'brand',
            });
          }
        }
      }

      const closeDate = new Date(`${patient.endDate}T00:00:00`);
      if (!Number.isNaN(closeDate.getTime()) && closeDate >= today && closeDate <= end) {
        events.push({
          id: `cierre-${patient.id}`,
          date: patient.endDate,
          time: '16:00',
          title: 'Cierre de tratamiento',
          detail: 'Revisar evolución, recompra y próximos pasos',
          kind: 'cierre',
          patient,
          patientName: patient.name,
          tone: patient.daysLeft <= 5 ? 'danger' : 'warn',
        });
      }

      patient.peptides.forEach((line, lineIdx) => {
        if (line.endsInDays < 0 || line.endsInDays > horizon || line.status === 'Finalizado') return;
        const date = addDaysLocal(today, line.endsInDays);
        const iso = isoLocal(date);
        events.push({
          id: `peptido-${patient.id}-${lineIdx}-${iso}`,
          date: iso,
          time: '14:00',
          title: `${line.name} por terminar`,
          detail: `${line.dose}${line.route ? ` · ${line.route}` : ''}`,
          kind: 'peptido',
          patient,
          patientName: patient.name,
          tone: line.endsInDays <= 5 ? 'danger' : 'warn',
        });
      });

      if (patient.daysLeft <= 7 && patient.endDate >= todayIso) {
        const followDate = isoLocal(addDaysLocal(today, Math.max(0, Math.min(patient.daysLeft - 2, horizon))));
        events.push({
          id: `control-${patient.id}`,
          date: followDate,
          time: '10:30',
          title: 'Control y seguimiento',
          detail: 'Llamar antes del cierre para medir adherencia y síntomas',
          kind: 'control',
          patient,
          patientName: patient.name,
          tone: patient.daysLeft <= 3 ? 'danger' : 'warn',
        });
      }
    });

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

function appointmentToAgendaEvent(row: AppointmentRow, patients: Patient[]): AgendaEvent {
  const patient = patients.find((p) => p.clientUuid === row.clientUuid || p.id === row.patientId);
  return {
    id: row.id,
    date: row.date,
    time: row.time || '12:00',
    title: row.title,
    detail: row.detail || row.eventType || 'Evento de agenda',
    kind: row.kind,
    patient,
    patientName: row.patientName || patient?.name || 'Evento operativo',
    fullName: row.documentId ? row.patientName || patient?.name || undefined : undefined,
    documentId: row.documentId || patient?.documentId || undefined,
    services: row.title ? [row.title] : undefined,
    tone: row.tone,
  };
}

function AgendaView({ patients, appointments, onOpenPatient }: { patients: Patient[]; appointments: AppointmentRow[]; onOpenPatient: (p: Patient) => void }) {
  const today = isoLocal(new Date());
  const persistedEvents = appointments.map((row) => appointmentToAgendaEvent(row, patients));
  const generatedEvents = buildAgendaEvents(patients).filter(
    (event) => !persistedEvents.some((persisted) => persisted.date === event.date && persisted.patient?.id === event.patient?.id),
  );
  const events = [...persistedEvents, ...generatedEvents].sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
  );
  const upcomingEvents = events.filter((event) => event.date >= today);
  const defaultDate = upcomingEvents.find((event) => event.date === today)?.date ?? upcomingEvents[0]?.date ?? today;
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const todayEvents = upcomingEvents.filter((e) => e.date === today);
  const selectedEvents = events.filter((e) => e.date === selectedDate);
  const urgent = upcomingEvents.filter((e) => e.tone === 'danger').length;
  const days = Array.from(new Set([today, ...upcomingEvents.map((e) => e.date)])).sort();

  return (
    <div className="view-wrap agenda" data-reveal>
      <section className="agenda-hero" data-reveal>
        <div>
          <span className="eyebrow">Agenda inteligente</span>
          <h1>Calendario clínico sugerido por tratamientos activos.</h1>
          <p>
            Centraliza sueros, controles, cierres de tratamiento y péptidos por terminar para que el equipo sepa a quién atender,
            preparar o llamar.
          </p>
        </div>
        <div className="agenda-hero__stats">
          <article>
            <strong>{todayEvents.length}</strong>
            <span>eventos hoy</span>
          </article>
          <article>
            <strong>{upcomingEvents.length}</strong>
            <span>eventos vigentes</span>
          </article>
          <article>
            <strong>{urgent}</strong>
            <span>urgentes</span>
          </article>
        </div>
      </section>

      <section className="agenda-layout">
        <article className="panel agenda-calendar" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">Filtro</span>
              <h2>Día de trabajo</h2>
            </div>
            <DatePicker value={selectedDate} onChange={setSelectedDate} placeholder="Seleccionar día" />
          </div>
          <div className="agenda-days">
            {[selectedDate, ...days.filter((d) => d !== selectedDate)].slice(0, 10).map((date) => {
              const count = events.filter((e) => e.date === date).length;
              const manual = events.find((e) => e.date === date && e.agendaLabel);
              return (
                <button key={date} className={`agenda-day${selectedDate === date ? ' is-active' : ''}`} onClick={() => setSelectedDate(date)}>
                  <span>{date === today ? 'Hoy' : manual?.agendaLabel ?? agendaDayLabel(date)}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel agenda-list" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">{agendaDayLabel(selectedDate)}</span>
              <h2>Programación</h2>
            </div>
            <span className="count-chip">{selectedEvents.length}</span>
          </div>
          {selectedEvents.length ? (
            selectedEvents.map((event) => (
              <button
                key={event.id}
                className={`agenda-card agenda-card--${event.tone}${event.patient ? '' : ' agenda-card--manual'}`}
                onClick={() => {
                  if (event.patient) onOpenPatient(event.patient);
                }}
              >
                <span className="agenda-card__time">{event.time}</span>
                <span className="agenda-card__body">
                  <strong>{event.title}</strong>
                  <span>{event.patientName} · {event.detail}</span>
                  {event.fullName && <em>{event.fullName} · CC {event.documentId}</em>}
                  {event.services && (
                    <ul className="agenda-card__services">
                      {event.services.map((service) => (
                        <li key={service}>{service}</li>
                      ))}
                    </ul>
                  )}
                </span>
                <Badge label={agendaKindLabel(event.kind)} tone={event.tone === 'danger' ? 'danger' : event.tone === 'warn' ? 'warning' : 'success'} />
                {event.patient && <ChevronRight size={17} />}
              </button>
            ))
          ) : (
            <div className="agenda-empty">
              <CalendarClock size={24} />
              <strong>Sin eventos sugeridos</strong>
              <span>Ese día no tiene sueros, controles ni cierres derivados de los tratamientos activos.</span>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function CrmEmpty({ icon: Icon, title, text }: { icon: ElementType; title: string; text: string }) {
  return (
    <section className="panel crm-empty" data-reveal>
      <span className="crm-empty__icon"><Icon size={24} /></span>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

/* ============================================================
   PACIENTES
   ============================================================ */
function PacientesView({
  patients,
  allPatients,
  inventory,
  search,
  setSearch,
  addPatient,
  onOpenPatient,
  onOpenAlert,
  intent,
  onIntentDone,
}: {
  patients: Patient[];
  allPatients: Patient[];
  inventory: InventoryItem[];
  search: string;
  setSearch: (v: string) => void;
  addPatient: (e: FormEvent<HTMLFormElement>) => void;
  onOpenPatient: (p: Patient) => void;
  onOpenAlert: (a: PatientProductAlert) => void;
  intent: string | null;
  onIntentDone: () => void;
}) {
  const [sub, setSub] = useState<'pacientes' | 'alertas'>('pacientes');
  const [formOpen, setFormOpen] = useState(false);
  const reveal = useScrollReveal(`${sub}-${formOpen}`);

  useEffect(() => {
    if (intent === 'patient') {
      setSub('pacientes');
      setFormOpen(true);
      onIntentDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const alerts = buildPatientProductAlerts(allPatients, inventory).sort((a, b) => {
    const order = { danger: 0, warn: 1, ok: 2 } as const;
    return order[a.signal] - order[b.signal] || a.daysLeft - b.daysLeft;
  });
  const green = alerts.filter((a) => a.signal === 'ok').length;
  const orange = alerts.filter((a) => a.signal === 'warn').length;
  const red = alerts.filter((a) => a.signal === 'danger').length;

  return (
    <div className="view-wrap" ref={reveal}>
      <div className="toolbar" data-reveal>
        <div className="search">
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono, correo, cédula o plan" />
        </div>
        <div className="segmented">
          <button className={`segmented__btn${sub === 'pacientes' ? ' is-active' : ''}`} onClick={() => setSub('pacientes')}>
            <Users size={16} /> Pacientes <small>{allPatients.length}</small>
          </button>
          <button className={`segmented__btn${sub === 'alertas' ? ' is-active' : ''}`} onClick={() => setSub('alertas')}>
            <AlertTriangle size={16} /> Alertas <small>{red}·{orange}</small>
          </button>
        </div>
        {sub === 'pacientes' && (
          <button className="btn btn--soft" onClick={() => setFormOpen((o) => !o)}>
            <Plus size={17} /> {formOpen ? 'Cerrar' : 'Nuevo paciente'}
          </button>
        )}
      </div>

      {sub === 'pacientes' && (
        <>
          {formOpen && (
            <article className="panel" data-reveal>
              <div className="panel__head">
                <div>
                  <span className="eyebrow">Nuevo</span>
                  <h2>Registrar paciente</h2>
                </div>
              </div>
              <form className="form" onSubmit={addPatient}>
                <Field label="Nombre">
                  <input name="name" placeholder="Nombre y apellido" required />
                </Field>
                <Field label="Teléfono">
                  <input name="phone" type="tel" placeholder="+57 300 000 0000" />
                </Field>
                <Field label="Correo">
                  <input name="email" type="email" placeholder="nombre@correo.com" />
                </Field>
                <Field label="Documento">
                  <input name="documentId" placeholder="CC / pasaporte" />
                </Field>
                <Field label="Plan">
                  <input name="plan" placeholder="Plan de péptidos" />
                </Field>
                <Field label="Valor venta">
                  <input name="saleValue" type="number" min="0" placeholder="0" />
                </Field>
                <Field label="Péptido">
                  <input name="peptide" placeholder="NAD+, BPC-157…" />
                </Field>
                <Field label="Dosis">
                  <input name="dose" placeholder="250 mg semanal" />
                </Field>
                <Field label="Días restantes">
                  <input name="daysLeft" type="number" placeholder="30" />
                </Field>
                <Field label="Fecha inicio">
                  <input name="startDate" type="date" />
                </Field>
                <Field label="Fecha final">
                  <input name="endDate" type="date" />
                </Field>
                <Field label="Día de suero">
                  <input name="serumDay" placeholder="Lunes" />
                </Field>
                <label className="field field--check">
                  <input name="weeklySerum" type="checkbox" />
                  <span>Suero semanal</span>
                </label>
                <button className="btn btn--primary field--full" type="submit">
                  <Plus size={18} /> Agregar paciente
                </button>
              </form>
            </article>
          )}

          <section className="patient-grid">
            {patients.map((p) => (
              <button key={p.id} className="patient-card" data-reveal onClick={() => onOpenPatient(p)}>
                <TreatmentRing daysLeft={p.daysLeft} totalDays={p.totalDays} size={66} stroke={6} />
                <div className="patient-card__main">
                  <div className="patient-card__top">
                    <div>
                      <div className="patient-card__name">{p.name}</div>
                      <div className="patient-card__sub">
                        {p.id} · {p.documentId ? `CC ${p.documentId} · ` : 'Sin cédula · '}{p.plan}
                      </div>
                      <div className="patient-card__sub">
                        {[p.phone, p.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                      </div>
                    </div>
                    <span className={`tier${p.tier === 'VIP' ? ' tier--vip' : ''}`}>{p.tier}</span>
                  </div>
                  <div className="patient-card__meta">
                    <Badge label={p.status} tone={statusTone(p.status)} />
                    <span className="patient-card__value">{formatCurrency(p.saleValue)}</span>
                    <SignalSummary counts={patientSignalCounts(p)} />
                  </div>
                  <div className="peptide-chips">
                    {p.peptides.map((pep, i) => (
                      <span key={`${pep.name}-${i}`} className="peptide">
                        <span className={`dot dot--${treatmentSignal(pep.endsInDays)}`} />
                        {pep.name} · {pep.endsInDays}d
                      </span>
                    ))}
                  </div>
                  <div className="patient-card__foot">
                    <Eye size={15} /> Ver historial
                  </div>
                </div>
              </button>
            ))}
            {patients.length === 0 && (
              <article className="panel" data-reveal>
                <p style={{ color: 'var(--muted)' }}>Ningún paciente coincide con la búsqueda.</p>
              </article>
            )}
          </section>
        </>
      )}

      {sub === 'alertas' && (
        <>
          <section className="kpi-grid" data-reveal>
            <SignalKpi icon={Check} tone="ok" label="Estables" value={green} hint="Tratamiento normal" />
            <SignalKpi icon={CalendarClock} tone="warn" label="Atención" value={orange} hint="5 días o bajo stock" />
            <SignalKpi icon={AlertTriangle} tone="danger" label="Urgentes" value={red} hint="Reposición inmediata" />
            <SignalKpi icon={Package} tone="brand" label="Productos" value={alerts.length} hint="En seguimiento" />
          </section>
          <section className="alert-board">
            {alerts.map((a) => (
              <button key={a.id} className={`alert-card alert-card--${a.signal}`} data-reveal onClick={() => onOpenAlert(a)}>
                <div className="alert-card__head">
                  <div>
                    <strong>{a.patientName}</strong>
                    <span>
                      {a.patientId} · {a.plan}
                    </span>
                  </div>
                  <TreatmentRing daysLeft={a.daysLeft} totalDays={30} size={52} stroke={5} showUnit={false} />
                </div>
                <div className="alert-card__product">
                  <Dna size={18} style={{ color: 'var(--brand)' }} />
                  <div>
                    <strong>{a.product}</strong>
                    <span>{a.dose}</span>
                  </div>
                </div>
                <div className="alert-card__metrics">
                  <span>{a.daysLeft} días</span>
                  <span>{a.inventoryStock === null ? 'Sin stock vinculado' : `${a.inventoryStock} ${a.inventoryUnit}`}</span>
                  <span>{a.statusText}</span>
                </div>
                <p className="alert-card__action">{a.nextAction}</p>
                <span className="alert-card__more">
                  <ClipboardList size={15} /> Ver histórico
                </span>
              </button>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function SignalKpi({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: ElementType;
  tone: 'ok' | 'warn' | 'danger' | 'brand';
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi__top">
        <span className={`kpi__icon kpi__icon--${tone}`}>
          <Icon size={17} />
        </span>
        <span className="kpi__label">{label}</span>
      </div>
      <span className="kpi__value">{value}</span>
      <span className="kpi__hint">{hint}</span>
    </div>
  );
}

/* ============================================================
   INVENTARIO
   ============================================================ */
function InventarioView({
  inventory,
  allInventory,
  movements,
  addInventory,
  registerMovement,
  notify,
  intent,
  onIntentDone,
}: {
  inventory: InventoryItem[];
  allInventory: InventoryItem[];
  movements: MovementRow[];
  addInventory: (p: ProductPayload) => Promise<boolean>;
  registerMovement: (p: StockMovePayload) => Promise<boolean>;
  notify: (msg: string, error?: boolean) => void;
  intent: string | null;
  onIntentDone: () => void;
}) {
  const [productOpen, setProductOpen] = useState(false);
  const [move, setMove] = useState<{ item: InventoryItem | null; kind: 'Entrada' | 'Salida' } | null>(null);
  const [invTab, setInvTab] = useState<'stock' | 'planes'>('stock');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [builder, setBuilder] = useState<{ plan: Plan | null } | null>(null);
  const grown = useGrow();
  const reveal = useScrollReveal(`${productOpen}-${invTab}-${builder ? 'b' : ''}`);

  // carga perezosa de planes + catálogo la primera vez que se entra a la pestaña Planes
  const reloadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const [pl, cat] = await Promise.all([fetchPlans(), fetchCatalog()]);
      setPlans(pl);
      setCatalog(cat);
      setPlansLoaded(true);
    } catch {
      notify('No se pudieron cargar los planes.', true);
    } finally {
      setPlansLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (invTab === 'planes' && !plansLoaded && !plansLoading) reloadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invTab]);

  useEffect(() => {
    if (intent === 'product') {
      setInvTab('stock');
      setProductOpen(true);
    } else if (intent === 'stock') {
      setInvTab('stock');
      setMove({ item: null, kind: 'Salida' });
    } else if (intent === 'plan') {
      setInvTab('planes');
      setBuilder({ plan: null });
    }
    if (intent === 'product' || intent === 'stock' || intent === 'plan') onIntentDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  async function handleSavePlan(p: PlanPayload): Promise<boolean> {
    try {
      await savePlan(p);
      notify(p.planId ? 'Plan actualizado.' : 'Plan creado.');
      await reloadPlans();
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo guardar el plan.', true);
      return false;
    }
  }

  async function handleArchivePlan(id: string) {
    try {
      await deletePlan(id);
      notify('Plan archivado.');
      await reloadPlans();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo archivar el plan.', true);
    }
  }

  const units = inventory.reduce((t, i) => t + i.stock, 0);
  const low = inventory.filter((i) => i.stock <= i.minimum).length;
  const value = inventory.reduce((t, i) => t + i.stock * i.unitCost, 0);
  const outgoing = movements
    .filter((m) => m.kind === 'Salida' || m.kind === 'Venta')
    .reduce((t, m) => t + m.quantity, 0);
  const lastByProduct = movements.reduce<Record<string, MovementRow>>((acc, m) => {
    if (!acc[m.product]) acc[m.product] = m;
    return acc;
  }, {});

  return (
    <div className="view-wrap" ref={reveal}>
      <section className="kpi-grid" data-reveal>
        <SignalKpi icon={Package} tone="ok" label="Unidades" value={units} hint="Stock total" />
        <SignalKpi icon={AlertTriangle} tone="warn" label="Bajo mínimo" value={low} hint="A reponer" />
        <Kpi icon={Activity} tone="brand" label="Valor stock" value={formatCompact(value)} hint="Costo estimado" />
        <SignalKpi icon={RefreshCw} tone="danger" label="Salidas" value={outgoing} hint="Uso o ventas" />
      </section>

      <div className="acct-tabs inv-tabs" data-reveal role="tablist">
        <button
          type="button"
          className={`acct-tab${invTab === 'stock' ? ' is-active' : ''}`}
          onClick={() => setInvTab('stock')}
          role="tab"
          aria-selected={invTab === 'stock'}
        >
          <span className="acct-tab__top">
            <Package size={16} /> Stock
          </span>
          <strong>{inventory.length} productos</strong>
        </button>
        <button
          type="button"
          className={`acct-tab${invTab === 'planes' ? ' is-active' : ''}`}
          onClick={() => setInvTab('planes')}
          role="tab"
          aria-selected={invTab === 'planes'}
        >
          <span className="acct-tab__top">
            <ClipboardList size={16} /> Planes
          </span>
          <strong>{plansLoaded ? `${plans.length} ${plans.length === 1 ? 'plan' : 'planes'}` : 'Plantillas'}</strong>
        </button>
      </div>

      {invTab === 'stock' && (
        <>
      <div className="toolbar" data-reveal>
        <button className="btn btn--soft" onClick={() => setProductOpen((o) => !o)}>
          <Plus size={17} /> {productOpen ? 'Cerrar' : 'Nuevo producto'}
        </button>
        <button className="btn btn--soft" onClick={() => setMove({ item: null, kind: 'Salida' })}>
          <RefreshCw size={17} /> Registrar movimiento
        </button>
      </div>

      {productOpen && <ProductForm onSubmit={addInventory} onClose={() => setProductOpen(false)} />}

      <section className="grid-2">
        <article className="panel" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">Stock</span>
              <h2>{inventory.length} productos</h2>
            </div>
          </div>
          <div className="inv-list">
            {inventory.length === 0 && <p className="muted-line">Sin productos. Agrega el primero con “Nuevo producto”.</p>}
            {inventory.map((item) => {
              const signal = stockSignal(item);
              const pct = grown ? Math.min(100, (item.stock / Math.max(item.minimum * 1.6, 1)) * 100) : 0;
              const last = lastByProduct[item.product];
              return (
                <div key={item.productId ?? item.id} className="inv-row">
                  <div className="inv-row__id">
                    <span className={`dot dot--${signal}`} />
                    <div>
                      <strong>
                        {item.product}
                        {item.marginPct != null && (
                          <b className={`inv-mg inv-mg--${item.marginPct >= 40 ? 'good' : item.marginPct >= 15 ? 'mid' : 'low'}`}>
                            {item.marginPct}%
                          </b>
                        )}
                      </strong>
                      <span>
                        {item.type} · {formatCurrency(item.unitCost)}
                        {item.salePrice > 0 && <> → {formatCurrency(item.salePrice)}</>} ·{' '}
                        {item.expiration ? `vence ${formatDate(item.expiration)}` : 's/v'}
                      </span>
                    </div>
                  </div>
                  <div className="inv-row__gauge">
                    <span className="gauge">
                      <span className={`gauge__fill gauge__fill--${signal}`} style={{ width: `${pct}%` }} />
                    </span>
                    <small>
                      <strong>{item.stock}</strong> {item.unit} · mín {item.minimum}
                      {last ? ` · últ. ${last.kind} ${last.quantity}` : ''}
                    </small>
                  </div>
                  <div className="inv-row__actions">
                    <button
                      className="inv-qbtn inv-qbtn--in"
                      onClick={() => setMove({ item, kind: 'Entrada' })}
                      title="Entrada · llegó inventario"
                      aria-label="Registrar entrada"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="inv-qbtn inv-qbtn--out"
                      onClick={() => setMove({ item, kind: 'Salida' })}
                      title="Salida · uso, daño, regalo…"
                      aria-label="Registrar salida"
                    >
                      <Minus size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">Historial</span>
              <h2>Movimientos</h2>
            </div>
          </div>
          <div className="movements">
            {movements.length === 0 ? (
              <p className="muted-line">Todavía no hay movimientos.</p>
            ) : (
              movements.slice(0, 8).map((m) => {
                const tone = m.kind === 'Entrada' ? 'in' : 'out';
                return (
                  <div key={m.id} className="movement">
                    <span className={`movement__kind movement__kind--${tone}`}>
                      {m.kind === 'Entrada' ? <Plus size={15} /> : <Minus size={15} />}
                    </span>
                    <div className="movement__body">
                      <strong>{m.product}</strong>
                      <span>
                        {m.kind} · {m.reason || '—'} · {formatDate(m.date)}
                      </span>
                    </div>
                    <span className="movement__delta">
                      {m.previousStock} <ChevronRight size={14} /> <b>{m.resultingStock}</b>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>

      {move && (
        <StockMoveSheet products={allInventory} preset={move} onSubmit={registerMovement} onClose={() => setMove(null)} />
      )}
        </>
      )}

      {invTab === 'planes' && (
        <PlanesPanel
          plans={plans}
          catalog={catalog}
          loading={plansLoading}
          loaded={plansLoaded}
          builder={builder}
          onNew={() => setBuilder({ plan: null })}
          onEdit={(pl) => setBuilder({ plan: pl })}
          onCloseBuilder={() => setBuilder(null)}
          onSavePlan={handleSavePlan}
          onArchivePlan={handleArchivePlan}
        />
      )}
    </div>
  );
}

/* ============================================================
   PLANES — plantillas reutilizables (lista + constructor) en Inventario
   ============================================================ */
function PlanesPanel({
  plans,
  catalog,
  loading,
  loaded,
  builder,
  onNew,
  onEdit,
  onCloseBuilder,
  onSavePlan,
  onArchivePlan,
}: {
  plans: Plan[];
  catalog: CatalogItem[];
  loading: boolean;
  loaded: boolean;
  builder: { plan: Plan | null } | null;
  onNew: () => void;
  onEdit: (p: Plan) => void;
  onCloseBuilder: () => void;
  onSavePlan: (p: PlanPayload) => Promise<boolean>;
  onArchivePlan: (id: string) => void;
}) {
  return (
    <>
      <div className="toolbar" data-reveal>
        <button className="btn btn--soft" onClick={onNew}>
          <Plus size={17} /> Nuevo plan
        </button>
      </div>

      {builder && (
        <PlanBuilder
          key={builder.plan?.id ?? 'new'}
          plan={builder.plan}
          catalog={catalog}
          onSave={onSavePlan}
          onClose={onCloseBuilder}
        />
      )}

      <article className="panel" data-reveal>
        <div className="panel__head">
          <div>
            <span className="eyebrow">Planes</span>
            <h2>{loaded ? `${plans.length} ${plans.length === 1 ? 'plantilla' : 'plantillas'}` : 'Plantillas'}</h2>
          </div>
        </div>
        <div className="plan-list">
          {loading && !loaded ? (
            <div className="view-loading" style={{ padding: '24px 0' }}>
              <span className="spinner spinner--sm" />
            </div>
          ) : plans.length === 0 ? (
            <div className="rx-empty">
              <ClipboardList size={22} />
              <p>Crea tu primer plan: agrupa los productos de un tratamiento típico (con su dosis y precio) y aplícalo de un clic al recetar.</p>
            </div>
          ) : (
            plans.map((pl) => <PlanCard key={pl.id} plan={pl} onEdit={onEdit} onArchive={onArchivePlan} />)
          )}
        </div>
      </article>
    </>
  );
}

function PlanCard({ plan, onEdit, onArchive }: { plan: Plan; onEdit: (p: Plan) => void; onArchive: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="plan-card">
      <button type="button" className="plan-card__main" onClick={() => onEdit(plan)}>
        <strong>{plan.name}</strong>
        <span className="plan-card__meta">
          {plan.itemCount} {plan.itemCount === 1 ? 'producto' : 'productos'} ·{' '}
          {plan.hasDynamicPrice ? '~' : ''}
          {formatCurrency(plan.totalEstimated)}
          {plan.hasMissingProduct ? ' · 1+ sin catálogo' : ''}
        </span>
        <div className="plan-card__pills">
          {plan.items.slice(0, 4).map((it, i) => (
            <span key={i} className={`plan-pill plan-pill--${it.missing ? 'danger' : it.signal}`}>
              {it.name}
            </span>
          ))}
          {plan.itemCount > 4 && <span className="plan-pill plan-pill--more">+{plan.itemCount - 4}</span>}
        </div>
      </button>
      <div className="plan-card__actions">
        {confirm ? (
          <span className="plan-confirm">
            ¿Archivar?
            <button
              type="button"
              className="plan-confirm__yes"
              onClick={() => {
                setConfirm(false);
                onArchive(plan.id);
              }}
            >
              Sí
            </button>
            <button type="button" className="plan-confirm__no" onClick={() => setConfirm(false)}>
              No
            </button>
          </span>
        ) : (
          <>
            <button type="button" className="btn btn--icon" onClick={() => onEdit(plan)} aria-label="Editar plan">
              <Pencil size={15} />
            </button>
            <button type="button" className="btn btn--icon" onClick={() => setConfirm(true)} aria-label="Archivar plan">
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface PlanUiLine {
  uid: string;
  product_id: string; // '' = indicación sin producto (catálogo borrado)
  name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: number | null;
  quantity: number;
  unit_price: number | null; // null = precio del día
  instructions: string;
  stock: number;
  signal: 'ok' | 'warn' | 'danger';
}

function PlanBuilder({
  plan,
  catalog,
  onSave,
  onClose,
}: {
  plan: Plan | null;
  catalog: CatalogItem[];
  onSave: (p: PlanPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? '');
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [lines, setLines] = useState<PlanUiLine[]>(() =>
    plan
      ? plan.items.map((it, i) => ({
          uid: `${it.product_id ?? 'ind'}-${i}-seed`,
          product_id: it.product_id ?? '',
          name: it.name,
          dose: it.dose ?? '',
          route: it.route ?? 'subcutanea',
          frequency: it.frequency ?? 'semanal',
          duration_days: it.duration_days,
          quantity: it.quantity,
          unit_price: it.unit_price,
          instructions: it.instructions ?? '',
          stock: it.stock,
          signal: it.missing ? 'danger' : it.signal,
        }))
      : [],
  );
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const results = q ? catalog.filter((c) => `${c.name} ${c.category}`.toLowerCase().includes(q)).slice(0, 6) : [];
  useEffect(() => setHighlight(0), [query]);

  function catPrice(productId: string): number {
    return catalog.find((c) => c.productId === productId)?.salePrice ?? 0;
  }
  // precio efectivo de una línea: el fijado, o el del día (catálogo) si es dinámico
  function linePrice(l: PlanUiLine): number {
    return l.unit_price ?? catPrice(l.product_id);
  }
  const total = lines.reduce((t, l) => t + l.quantity * linePrice(l), 0);
  const hasDynamic = lines.some((l) => l.unit_price == null);
  const canSave = name.trim() !== '' && lines.length > 0 && !busy;

  function addProduct(c: CatalogItem) {
    // sin tope de stock ni guard de agotado: un plan es un molde atemporal
    setLines((prev) => [
      ...prev,
      {
        uid: `${c.productId}-${prev.length}-${Date.now() % 100000}`,
        product_id: c.productId,
        name: c.name,
        dose: c.defaultDose || '',
        route: c.defaultRoute || 'subcutanea',
        frequency: c.defaultFrequency || 'semanal',
        duration_days: c.defaultDurationDays ?? 30,
        quantity: Math.max(1, c.defaultQuantity || 1),
        unit_price: c.salePrice,
        instructions: '',
        stock: c.stock,
        signal: c.signal,
      },
    ]);
    setQuery('');
    inputRef.current?.focus();
  }

  function patch(uid: string, p: Partial<PlanUiLine>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...p } : l)));
  }
  function remove(uid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) addProduct(results[highlight]);
    } else if (e.key === 'Backspace' && query === '' && lines.length > 0) {
      setLines((prev) => prev.slice(0, -1));
    }
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    const ok = await onSave({
      planId: plan?.id ?? null,
      name: name.trim(),
      notes: notes.trim() || undefined,
      items: lines.map((l) => ({
        product_id: l.product_id,
        name: l.name,
        dose: l.dose,
        route: l.route,
        frequency: l.frequency,
        duration_days: l.duration_days,
        quantity: l.quantity,
        unit_price: l.unit_price,
        instructions: l.instructions || undefined,
      })),
    });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <article className="panel mv" data-reveal>
      <div className="panel__head">
        <div>
          <span className="eyebrow">{plan ? 'Editar' : 'Nuevo'}</span>
          <h2>Plan</h2>
        </div>
      </div>

      <div className="mv__form">
        <div className="mv__row">
          <div className="mv__field">
            <label className="mv__label">Nombre del plan</label>
            <input className="mv__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Regeneración celular base" autoFocus />
          </div>
          <div className="mv__field">
            <label className="mv__label">Notas (opcional)</label>
            <input className="mv__input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Protocolo de 8 semanas…" />
          </div>
        </div>
      </div>

      {/* Buscador de productos del catálogo */}
      <div className="rx-cmdbar">
        <Syringe size={18} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Agregar péptido, suero o insumo al plan…"
          aria-label="Buscar producto para el plan"
        />
        <kbd className="rx-kbd">↵</kbd>
      </div>

      {results.length > 0 && (
        <div className="rx-results">
          {results.map((c, i) => (
            <button
              key={c.productId}
              type="button"
              className={`rx-result${i === highlight ? ' is-active' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => addProduct(c)}
            >
              <span className={`dot dot--${c.signal}`} />
              <div className="rx-result__main">
                <strong>{c.name}</strong>
                <span className="rx-result__defaults">
                  {[c.defaultDose, c.defaultRoute, c.defaultFrequency, c.defaultDurationDays ? `${c.defaultDurationDays} días` : null]
                    .filter(Boolean)
                    .join(' · ') || c.category}
                </span>
              </div>
              <div className="rx-result__meta">
                <span className="tnum">{formatCurrency(c.salePrice)}</span>
                <span>{c.stock <= 0 ? 'sin stock' : `${c.stock} ${c.unit}`}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Líneas del plan */}
      <div className="rx-lines">
        {lines.length === 0 ? (
          <div className="rx-empty">
            <ClipboardList size={22} />
            <p>Busca arriba y agrega los productos del plan. Cada uno trae su dosis, vía, frecuencia y precio editables.</p>
          </div>
        ) : (
          lines.map((l) => {
            const dyn = l.unit_price == null;
            return (
              <article className="rx-card rx-card--plan" key={l.uid}>
                <div className="rx-card__top">
                  <span className={`dot dot--${l.signal}`} />
                  <strong>
                    {l.name}
                    {!l.product_id && <em className="rx-card__missing"> · sin catálogo</em>}
                  </strong>
                  <span className="rx-card__price tnum">{formatCurrency(l.quantity * linePrice(l))}</span>
                  <button type="button" className="btn btn--icon rx-card__x" onClick={() => remove(l.uid)} aria-label="Quitar">
                    <X size={15} />
                  </button>
                </div>
                <div className="rx-card__fields">
                  <label className="rx-field">
                    <span>Dosis</span>
                    <input value={l.dose} onChange={(e) => patch(l.uid, { dose: e.target.value })} placeholder="250 mg" />
                  </label>
                  <label className="rx-field">
                    <span>Vía</span>
                    <select value={l.route} onChange={(e) => patch(l.uid, { route: e.target.value })}>
                      {ROUTES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="rx-field">
                    <span>Frecuencia</span>
                    <select value={l.frequency} onChange={(e) => patch(l.uid, { frequency: e.target.value })}>
                      {FREQS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="rx-field rx-field--sm">
                    <span>Días</span>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={l.duration_days ?? ''}
                      onChange={(e) =>
                        patch(l.uid, {
                          duration_days: e.target.value ? Math.min(365, Math.max(0, Number(e.target.value))) : null,
                        })
                      }
                    />
                  </label>
                </div>
                <label className="rx-field rx-field--full">
                  <span>Indicaciones (opcional)</span>
                  <textarea
                    rows={2}
                    value={l.instructions}
                    onChange={(e) => patch(l.uid, { instructions: e.target.value })}
                    placeholder="Notas para el paciente…"
                  />
                </label>
                <div className="rx-card__foot">
                  <div className="rx-stepper">
                    <button type="button" onClick={() => patch(l.uid, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Menos">
                      <Minus size={15} />
                    </button>
                    <span className="tnum">{l.quantity}</span>
                    <button type="button" onClick={() => patch(l.uid, { quantity: l.quantity + 1 })} aria-label="Más">
                      <Plus size={15} />
                    </button>
                  </div>
                  <label className="rx-field rx-field--price">
                    <span>Precio c/u</span>
                    <input
                      type="number"
                      min="0"
                      value={l.unit_price ?? ''}
                      placeholder={String(catPrice(l.product_id) || 0)}
                      onChange={(e) =>
                        patch(l.uid, { unit_price: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })
                      }
                    />
                  </label>
                  {dyn ? (
                    <span className="rx-card__auto">auto · precio del día</span>
                  ) : (
                    <span className="rx-card__stock">{l.stock} en stock</span>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Pie: resumen + guardar */}
      <div className="plan-foot">
        <div className="plan-foot__sum">
          <span>
            {lines.length} {lines.length === 1 ? 'producto' : 'productos'}
          </span>
          <strong className="tnum">
            {hasDynamic ? '~' : ''}
            {formatCurrency(total)}
          </strong>
        </div>
        <div className="plan-foot__actions">
          <button type="button" className="btn btn--soft" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={!canSave}>
            {busy ? <span className="spinner spinner--sm" /> : <ClipboardList size={17} />} {plan ? 'Guardar cambios' : 'Guardar plan'}
          </button>
        </div>
      </div>
    </article>
  );
}

/* ---- Alta de producto (controlado, estilo luxury) ---- */
function ProductForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (p: ProductPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [product, setProduct] = useState('');
  const [type, setType] = useState('Peptido');
  const [stock, setStock] = useState('');
  const [minimum, setMinimum] = useState('');
  const [unit, setUnit] = useState('');
  const [lot, setLot] = useState('');
  const [expiration, setExpiration] = useState('');
  const [supplier, setSupplier] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saving, setSaving] = useState(false);
  const canSubmit = product.trim() !== '' && !saving;

  // margen en vivo: venta − costo, para que el alta ayude con la rentabilidad
  const costN = Number(unitCost) || 0;
  const saleN = Number(salePrice) || 0;
  const marginAbs = saleN - costN;
  const marginPct = saleN > 0 ? Math.round((marginAbs / saleN) * 100) : null;
  const marginTone = marginPct == null ? '' : marginPct >= 40 ? ' is-good' : marginPct >= 15 ? ' is-mid' : ' is-low';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const ok = await onSubmit({
      product: product.trim(),
      type,
      stock: Number(stock) || 0,
      minimum: Number(minimum) || 0,
      unit: unit.trim() || 'unidades',
      lot: lot.trim(),
      expiration: expiration || null,
      supplier: supplier.trim(),
      unitCost: Number(unitCost) || 0,
      salePrice: Number(salePrice) || 0,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <article className="panel mv" data-reveal>
      <div className="panel__head">
        <div>
          <span className="eyebrow">Nuevo</span>
          <h2>Producto</h2>
        </div>
      </div>
      <form className="mv__form" onSubmit={submit}>
        <div className="mv__field">
          <label className="mv__label">Producto</label>
          <input className="mv__input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Nombre del producto" required autoFocus />
        </div>
        <div className="mv__field">
          <label className="mv__label">Tipo</label>
          <div className="mv__chips">
            {['Peptido', 'Suero', 'Insumo medico', 'Suplemento'].map((t) => (
              <button type="button" key={t} className={`mv__chip${type === t ? ' is-active' : ''}`} onClick={() => setType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="mv__row3">
          <div className="mv__field">
            <label className="mv__label">Stock</label>
            <input className="mv__input" type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
          </div>
          <div className="mv__field">
            <label className="mv__label">Mínimo</label>
            <input className="mv__input" type="number" min="0" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="0" />
          </div>
          <div className="mv__field">
            <label className="mv__label">Unidad</label>
            <input className="mv__input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="viales, kits…" />
          </div>
        </div>
        <div className="mv__row">
          <div className="mv__field">
            <label className="mv__label">Costo unitario</label>
            <input className="mv__input" type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" />
          </div>
          <div className="mv__field">
            <label className="mv__label">Precio de venta</label>
            <input className="mv__input" type="number" min="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0" />
          </div>
        </div>
        {saleN > 0 && (
          <div className={`mv__margin${marginTone}`}>
            <span className="mv__margin-label">Margen por unidad</span>
            <span className="mv__margin-val">
              {formatCurrency(marginAbs)} {marginPct != null && <em>· {marginPct}%</em>}
            </span>
          </div>
        )}
        <div className="mv__row">
          <div className="mv__field">
            <label className="mv__label">Proveedor</label>
            <input className="mv__input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Proveedor" />
          </div>
          <div className="mv__field">
            <label className="mv__label">Lote</label>
            <input className="mv__input" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Lote" />
          </div>
        </div>
        <div className="mv__field">
          <label className="mv__label">Vencimiento</label>
          <DatePicker value={expiration} onChange={setExpiration} placeholder="Sin vencimiento" />
        </div>
        <div className="mv__actions">
          <button type="button" className="btn btn--soft" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary mv__submit" type="submit" disabled={!canSubmit}>
            {saving ? <span className="spinner spinner--sm" /> : <Plus size={18} />} Guardar producto
          </button>
        </div>
      </form>
    </article>
  );
}

/* ---- Movimiento rápido de stock (entrada/salida + motivo) ---- */
function StockMoveSheet({
  products,
  preset,
  onSubmit,
  onClose,
}: {
  products: InventoryItem[];
  preset: { item: InventoryItem | null; kind: 'Entrada' | 'Salida' };
  onSubmit: (p: StockMovePayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [productId, setProductId] = useState(preset.item?.productId ?? '');
  const [kind, setKind] = useState<'Entrada' | 'Salida'>(preset.kind);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO);
  const [saving, setSaving] = useState(false);

  const item = products.find((p) => p.productId === productId) ?? null;
  const reasons = STOCK_REASONS[kind];
  const overOut = kind === 'Salida' && item != null && qty > item.stock;
  const canSubmit = !!productId && qty > 0 && !overOut && !saving;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function confirm() {
    if (!canSubmit) return;
    setSaving(true);
    const ok = await onSubmit({ productId, kind, quantity: qty, reason: reason || kind, date });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Movimiento de stock">
      <article className="sheet sheet--quick" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <div>
            <span className="eyebrow">Movimiento rápido</span>
            <h3>{item ? item.product : 'Movimiento de stock'}</h3>
          </div>
          <button className="btn btn--icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>

        {!preset.item && (
          <div className="mv__field">
            <label className="mv__label">Producto</label>
            <select className="mv__input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Seleccionar producto…</option>
              {products.map((p) => (
                <option key={p.id} value={p.productId}>
                  {p.product} · {p.stock} {p.unit}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mv__type">
          <button
            type="button"
            className={`mv__type-btn mv__type-btn--in${kind === 'Entrada' ? ' is-active' : ''}`}
            onClick={() => {
              setKind('Entrada');
              setReason('');
            }}
          >
            <Plus size={16} /> Entrada
          </button>
          <button
            type="button"
            className={`mv__type-btn mv__type-btn--out${kind === 'Salida' ? ' is-active' : ''}`}
            onClick={() => {
              setKind('Salida');
              setReason('');
            }}
          >
            <Minus size={16} /> Salida
          </button>
        </div>

        <div className="qmove__qty">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">
            <Minus size={18} />
          </button>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Más">
            <Plus size={18} />
          </button>
          {item && (
            <span className="qmove__stock">
              {item.stock} {item.unit} en stock
            </span>
          )}
        </div>
        {overOut && <p className="qmove__warn">No puedes sacar más de {item?.stock} en stock.</p>}

        <div className="mv__field">
          <label className="mv__label">Motivo</label>
          <div className="mv__chips">
            {reasons.map((r) => (
              <button type="button" key={r} className={`mv__chip${reason === r ? ' is-active' : ''}`} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
            <input
              className="mv__chip-input"
              value={reasons.includes(reason) ? '' : reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Otro…"
            />
          </div>
        </div>

        <button
          className={`btn btn--primary btn--block qmove__cta qmove__cta--${kind === 'Entrada' ? 'in' : 'out'}`}
          onClick={confirm}
          disabled={!canSubmit}
        >
          {saving ? <span className="spinner spinner--sm" /> : kind === 'Entrada' ? <Plus size={18} /> : <Minus size={18} />}
          {kind === 'Entrada' ? 'Registrar entrada' : 'Registrar salida'} · {qty}
        </button>
      </article>
    </div>
  );
}

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: ElementType;
  tone: 'ok' | 'warn' | 'danger' | 'brand';
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi__top">
        <span className={`kpi__icon kpi__icon--${tone}`}>
          <Icon size={17} />
        </span>
        <span className="kpi__label">{label}</span>
      </div>
      <span className="kpi__value">{value}</span>
      <span className="kpi__hint">{hint}</span>
    </div>
  );
}

/* ============================================================
   CONTABILIDAD / CAJA
   ============================================================ */
function DateRangeBar({
  range,
  onChange,
  onCsv,
  onPdf,
  busy,
}: {
  range: DateRange;
  onChange: (r: DateRange) => void;
  onCsv: () => void;
  onPdf: () => void;
  busy?: boolean;
}) {
  return (
    <div className="range-bar" data-reveal>
      <div className="range-presets">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`range-preset${range.preset === p.id ? ' is-active' : ''}`}
            onClick={() => onChange(rangeForPreset(p.id))}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="range-custom">
        <DatePicker
          value={range.from}
          max={range.to || undefined}
          onChange={(v) => onChange({ from: v, to: range.to, preset: 'custom' })}
          placeholder="Desde"
        />
        <span className="range-sep">→</span>
        <DatePicker
          value={range.to}
          min={range.from || undefined}
          onChange={(v) => onChange({ from: range.from, to: v, preset: 'custom' })}
          placeholder="Hasta"
        />
      </div>
      <div className="range-actions">
        {busy && <span className="spinner spinner--sm range-spin" aria-label="Actualizando" />}
        <button className="btn btn--soft" onClick={onCsv} disabled={busy}>
          <Download size={15} /> CSV
        </button>
        <button className="btn btn--soft" onClick={onPdf} disabled={busy}>
          <FileDown size={15} /> PDF
        </button>
      </div>
    </div>
  );
}

function ContabilidadView({
  dataVersion,
  addMovement,
  notify,
  intent,
  onIntentDone,
}: {
  dataVersion: number;
  addMovement: (p: MovementPayload) => Promise<boolean>;
  notify: (msg: string, error?: boolean) => void;
  intent: string | null;
  onIntentDone: () => void;
}) {
  const [range, setRange] = useState<DateRange>(emptyRange);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [rows, setRows] = useState<FinanceMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AccountingTab>('ingresos');
  const [support, setSupport] = useState<FinanceMovement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const reveal = useScrollReveal(`${loading}-${tab}-${formOpen}`);

  useEffect(() => {
    if (intent === 'cash') {
      setFormOpen(true);
      onIntentDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([fetchFinanceSummary(range), fetchFinanceRows(range)])
      .then(([s, r]) => {
        if (!alive) return;
        setSummary(s);
        setRows(r);
      })
      .catch(() => {
        if (!alive) return;
        setSummary(null);
        setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, dataVersion]);

  // Filas por pestaña (filtro barato, no agregación: los totales vienen del backend).
  const ingresoRows = rows.filter((m) => m.kind === 'Ingreso' && m.scope === 'Empresa');
  const egresoRows = rows.filter((m) => m.kind === 'Gasto');
  const cobrarRows = rows.filter(isReceivable);
  const active = tab === 'ingresos' ? ingresoRows : tab === 'egresos' ? egresoRows : cobrarRows;

  const s = summary;
  const focus: Array<[string, string]> = !s
    ? []
    : tab === 'ingresos'
      ? [
          ['Recibido', formatCompact(s.income)],
          ['Registros', String(s.income_count)],
          ['Ticket prom.', formatCompact(s.ticket_avg)],
          ['Clientes', String(s.income_clients)],
        ]
      : tab === 'egresos'
        ? [
            ['Egresos', formatCompact(s.expenses)],
            ['Empresa', formatCompact(s.expenses_company)],
            ['No empresa', formatCompact(s.personal_out)],
            ['Soportes', `${s.supports_with}/${s.supports_total}`],
          ]
        : [
            ['Por cobrar', formatCompact(s.receivable)],
            ['Vencido', formatCompact(s.receivable_overdue)],
            ['Abonado', formatCompact(s.receivable_paid)],
            ['Facturado', formatCompact(s.receivable_invoiced)],
          ];

  const primaryTitle = tab === 'egresos' ? 'Centros de costo' : tab === 'cobrar' ? 'Estado de recaudo' : 'Categorías';
  const primaryBreak: KV[] = !s ? [] : tab === 'ingresos' ? s.income_by_category : tab === 'egresos' ? s.expense_by_center : s.receivable_by_status;
  const paymentBreak: KV[] = !s ? [] : tab === 'egresos' ? s.expense_by_payment : s.income_by_payment;
  const showPayment = tab !== 'cobrar';

  function exportRows(): { headers: string[]; rows: Array<Array<string | number>> } {
    if (tab === 'ingresos')
      return {
        headers: ['Cliente', 'ID', 'Fecha', 'Servicio', 'Categoría', 'Método', 'Recibido', 'Estado'],
        rows: ingresoRows.map((m) => [m.person, m.id, m.date, m.concept, m.category, m.paymentMethod, m.value, m.status]),
      };
    if (tab === 'egresos')
      return {
        headers: ['Concepto', 'Proveedor', 'Fecha', 'Centro', 'Valor', 'Clasificación', 'Estado'],
        rows: egresoRows.map((m) => [m.concept, m.person, m.date, m.costCenter, m.value, m.scope, m.status]),
      };
    return {
      headers: ['Paciente', 'Facturado', 'Abonado', 'Saldo', 'Límite', 'Estado'],
      rows: cobrarRows.map((m) => {
        const saldo = (m.invoiceValue ?? m.value) - (m.paidValue ?? 0);
        return [m.person, m.invoiceValue ?? m.value, m.paidValue ?? 0, saldo, m.dueDate ?? '', m.status];
      }),
    };
  }

  const tabLabel = tab === 'ingresos' ? 'Ingresos' : tab === 'egresos' ? 'Egresos' : 'Por cobrar';
  const stamp = range.from || 'todo';

  function onCsv() {
    try {
      const { headers, rows: r } = exportRows();
      if (!r.length) {
        notify('No hay datos para exportar en este periodo.', true);
        return;
      }
      downloadCsv(`healen-caja-${tab}-${stamp}`, headers, r);
      notify('CSV descargado');
    } catch {
      notify('No se pudo exportar el CSV.', true);
    }
  }
  async function onPdf() {
    if (!s) {
      notify('Espera a que cargue la información.', true);
      return;
    }
    const { headers, rows: r } = exportRows();
    try {
      await downloadPdf({
        filename: `healen-caja-${tab}-${stamp}`,
        title: `Caja · ${tabLabel}`,
        subtitle: rangeLabel(range),
        kpis: [
          { label: 'Ingresos', value: formatCompact(s.income) },
          { label: 'Egresos', value: formatCompact(s.expenses_company + s.personal_out) },
          { label: 'Por cobrar', value: formatCompact(s.receivable) },
          { label: 'Utilidad', value: formatCompact(s.income - s.expenses_company) },
        ],
        sections: [
          { heading: primaryTitle, headers: ['Concepto', 'Valor'], rows: primaryBreak.map((x) => [x.k, formatCurrency(x.v)]) },
          { heading: `Detalle · ${tabLabel}`, headers, rows: r },
        ],
      });
      notify('PDF descargado');
    } catch {
      notify('No se pudo generar el PDF.', true);
    }
  }

  return (
    <div className="view-wrap" ref={reveal}>
      <DateRangeBar range={range} onChange={setRange} onCsv={onCsv} onPdf={onPdf} busy={loading} />

      <div className="acct-tabs" data-reveal role="tablist">
        <button className={`acct-tab${tab === 'ingresos' ? ' is-active' : ''}`} onClick={() => setTab('ingresos')} role="tab">
          <span className="acct-tab__top">
            <TrendingUp size={16} /> Ingresos
          </span>
          <strong>{formatCompact(s?.income ?? 0)}</strong>
        </button>
        <button className={`acct-tab${tab === 'egresos' ? ' is-active' : ''}`} onClick={() => setTab('egresos')} role="tab">
          <span className="acct-tab__top">
            <CreditCard size={16} /> Egresos
          </span>
          <strong>{formatCompact((s?.expenses_company ?? 0) + (s?.personal_out ?? 0))}</strong>
        </button>
        <button className={`acct-tab${tab === 'cobrar' ? ' is-active' : ''}`} onClick={() => setTab('cobrar')} role="tab">
          <span className="acct-tab__top">
            <CalendarClock size={16} /> Por cobrar
          </span>
          <strong>{formatCompact(s?.receivable ?? 0)}</strong>
        </button>
      </div>

      {loading && !s ? (
        <div className="view-loading" data-reveal>
          <span className="spinner" /> Cargando caja…
        </div>
      ) : (
        <article className="panel stack" data-reveal>
          <div className="acct-focus">
            {focus.map(([label, val]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{val}</strong>
              </div>
            ))}
          </div>

          <div className="breakdown">
            <article>
              <strong>{primaryTitle}</strong>
              {primaryBreak.length === 0 && <p className="muted-line">Sin datos en el periodo.</p>}
              {primaryBreak.map((x) => (
                <div className="detail-line" key={x.k}>
                  <span>{x.k}</span>
                  <strong>{formatCurrency(x.v)}</strong>
                </div>
              ))}
            </article>
            {showPayment && (
              <article>
                <strong>Medios de pago</strong>
                {paymentBreak.length === 0 && <p className="muted-line">Sin datos en el periodo.</p>}
                {paymentBreak.map((x) => (
                  <div className="detail-line" key={x.k}>
                    <span>{x.k}</span>
                    <strong>{formatCurrency(x.v)}</strong>
                  </div>
                ))}
              </article>
            )}
          </div>

          <FinanceTable tab={tab} movements={active} onSupport={setSupport} />
        </article>
      )}

      <div className="toolbar" data-reveal>
        <button className="btn btn--soft" onClick={() => setFormOpen((o) => !o)}>
          <Plus size={17} /> {formOpen ? 'Cerrar' : 'Registrar movimiento'}
        </button>
      </div>

      {formOpen && <MovementForm onSubmit={addMovement} onClose={() => setFormOpen(false)} notify={notify} />}

      {support && <SupportSheet movement={support} onClose={() => setSupport(null)} />}
    </div>
  );
}

/* ---- Buscador de cliente / proveedor (typeahead, vínculo relacional) ---- */
function PayeeSearch({
  payees,
  text,
  onText,
  linked,
  onLink,
  onClear,
  preferKind,
}: {
  payees: Payee[];
  text: string;
  onText: (v: string) => void;
  linked: Payee | null;
  onLink: (p: Payee) => void;
  onClear: () => void;
  preferKind: 'cliente' | 'proveedor';
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const q = text.trim().toLowerCase();
  const results = q
    ? payees
        .filter((p) => p.name.toLowerCase().includes(q) || (p.ref ?? '').toLowerCase().includes(q))
        .sort((a, b) => (a.kind === preferKind ? 0 : 1) - (b.kind === preferKind ? 0 : 1))
        .slice(0, 6)
    : [];
  useEffect(() => setHi(0), [text]);

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && results[hi]) {
      e.preventDefault();
      onLink(results[hi]);
    }
  }

  if (linked) {
    return (
      <div className={`payee-chip payee-chip--${linked.kind}`}>
        {linked.kind === 'cliente' ? <User size={15} /> : <Building2 size={15} />}
        <strong>{linked.name}</strong>
        {linked.ref && <span className="payee-chip__ref">{linked.ref}</span>}
        <button type="button" className="payee-chip__x" onClick={onClear} aria-label="Quitar vínculo">
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <div className="payee">
      <div className="payee__box">
        <Search size={16} />
        <input
          value={text}
          onChange={(e) => {
            onText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder="Buscar existente o escribir nombre…"
        />
      </div>
      {open && results.length > 0 && (
        <div className="payee__results">
          {results.map((p, i) => (
            <button
              type="button"
              key={p.id}
              className={`payee__result${i === hi ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => onLink(p)}
            >
              <span className={`payee__badge payee__badge--${p.kind}`}>{p.kind === 'cliente' ? 'Cliente' : 'Proveedor'}</span>
              <strong>{p.name}</strong>
              {p.ref && <span className="payee__ref">{p.ref}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CATEGORY_SUGGEST: Record<'Ingreso' | 'Gasto', string[]> = {
  Ingreso: ['Tratamientos', 'Productos', 'Otro'],
  Gasto: ['Inventario', 'Nómina', 'Marketing', 'Servicios', 'Arriendo', 'Otro'],
};
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---- Movimiento de caja: formulario luxury (segmentado + monto + payee + chips) ---- */
function MovementForm({
  onSubmit,
  onClose,
  notify,
}: {
  onSubmit: (p: MovementPayload) => Promise<boolean>;
  onClose: () => void;
  notify: (msg: string, error?: boolean) => void;
}) {
  const [payees, setPayees] = useState<Payee[]>([]);
  const [kind, setKind] = useState<'Ingreso' | 'Gasto'>('Ingreso');
  const [value, setValue] = useState('');
  const [text, setText] = useState('');
  const [linked, setLinked] = useState<Payee | null>(null);
  const [concept, setConcept] = useState('');
  const [date, setDate] = useState(todayISO);
  const [method, setMethod] = useState('transferencia');
  const [category, setCategory] = useState('');
  const [costCenter, setCostCenter] = useState('Operacion');
  const [scope, setScope] = useState('Empresa');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [note, setNote] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPayees().then(setPayees).catch(() => {});
  }, []);

  const valueNum = Number(value) || 0;
  const canSubmit = valueNum > 0 && concept.trim() !== '' && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const ok = await onSubmit({
      kind,
      scope,
      category: category.trim(),
      concept: concept.trim(),
      value: valueNum,
      date: date || todayISO(),
      costCenter,
      paymentMethod: method,
      person: linked?.name ?? text.trim(),
      clientId: linked?.kind === 'cliente' ? linked.id : null,
      supplierId: linked?.kind === 'proveedor' ? linked.id : null,
      attachmentUrl: attachmentUrl.trim() || null,
      note: note.trim() || null,
    });
    setSaving(false);
    if (ok) {
      setValue('');
      setText('');
      setLinked(null);
      setConcept('');
      setCategory('');
      setNote('');
      setAttachmentUrl('');
    }
  }

  return (
    <article className="panel mv" data-reveal>
      <form className="mv__form" onSubmit={submit}>
        <div className="mv__type">
          <button
            type="button"
            className={`mv__type-btn mv__type-btn--in${kind === 'Ingreso' ? ' is-active' : ''}`}
            onClick={() => setKind('Ingreso')}
          >
            <TrendingUp size={17} /> Ingreso
          </button>
          <button
            type="button"
            className={`mv__type-btn mv__type-btn--out${kind === 'Gasto' ? ' is-active' : ''}`}
            onClick={() => setKind('Gasto')}
          >
            <CreditCard size={17} /> Egreso
          </button>
        </div>

        <label className="mv__amount">
          <span className="mv__amount-cur">$</span>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </label>

        <div className="mv__field">
          <label className="mv__label">
            {kind === 'Ingreso' ? 'Cliente' : 'Proveedor'} <span className="mv__opt">· opcional</span>
          </label>
          <PayeeSearch
            payees={payees}
            text={text}
            onText={setText}
            linked={linked}
            onLink={setLinked}
            onClear={() => setLinked(null)}
            preferKind={kind === 'Ingreso' ? 'cliente' : 'proveedor'}
          />
        </div>

        <div className="mv__field">
          <label className="mv__label">Concepto</label>
          <input
            className="mv__input"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder={kind === 'Ingreso' ? 'Abono de plan, venta de producto…' : 'Compra de insumos, servicio…'}
            required
          />
        </div>

        <div className="mv__field">
          <label className="mv__label">Categoría</label>
          <div className="mv__chips">
            {CATEGORY_SUGGEST[kind].map((c) => (
              <button
                type="button"
                key={c}
                className={`mv__chip${category === c ? ' is-active' : ''}`}
                onClick={() => setCategory(category === c ? '' : c)}
              >
                {c}
              </button>
            ))}
            <input
              className="mv__chip-input"
              value={CATEGORY_SUGGEST[kind].includes(category) ? '' : category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Otra…"
            />
          </div>
        </div>

        <div className="mv__row">
          <div className="mv__field">
            <label className="mv__label">Fecha</label>
            <DatePicker value={date} onChange={setDate} placeholder="Hoy" />
          </div>
          <div className="mv__field">
            <label className="mv__label">Medio de pago</label>
            <div className="mv__chips">
              {PAY_METHODS.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`mv__chip${method === m.id ? ' is-active' : ''}`}
                  onClick={() => setMethod(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button type="button" className="mv__more" onClick={() => setAdvanced((a) => !a)}>
          <ChevronDown size={15} className={`mv__more-chev${advanced ? ' is-open' : ''}`} />
          {advanced ? 'Menos opciones' : 'Más opciones'}
        </button>
        {advanced && (
          <div className="mv__advanced">
            <div className="mv__field">
              <label className="mv__label">Centro de costo</label>
              <select className="mv__input" value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
                {['Operacion', 'Inventario', 'Marketing', 'Nomina', 'Administrativo', 'Personal'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="mv__field">
              <label className="mv__label">Clasificación</label>
              <select className="mv__input" value={scope} onChange={(e) => setScope(e.target.value)}>
                {['Empresa', 'Personal', 'Retiro socio', 'Reembolso'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="mv__field mv__field--full">
              <label className="mv__label">Soporte · foto, PDF o archivo</label>
              <FileUpload value={attachmentUrl} onChange={setAttachmentUrl} onError={(m) => notify(m, true)} />
            </div>
            <div className="mv__field mv__field--full">
              <label className="mv__label">Nota</label>
              <input
                className="mv__input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Acuerdo, abono o detalle importante"
              />
            </div>
          </div>
        )}

        <div className="mv__actions">
          <button type="button" className="btn btn--soft" onClick={onClose}>
            Cancelar
          </button>
          <button
            className={`btn btn--primary mv__submit mv__submit--${kind === 'Ingreso' ? 'in' : 'out'}`}
            type="submit"
            disabled={!canSubmit}
          >
            {saving ? <span className="spinner spinner--sm" /> : <Check size={18} />}
            Registrar {kind === 'Ingreso' ? 'ingreso' : 'egreso'}
          </button>
        </div>
      </form>
    </article>
  );
}

function FinanceTable({
  tab,
  movements,
  onSupport,
}: {
  tab: AccountingTab;
  movements: FinanceMovement[];
  onSupport: (m: FinanceMovement) => void;
}) {
  if (movements.length === 0) {
    return (
      <div className="table-wrap">
        <p className="empty-cell">No hay registros en esta vista.</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          {tab === 'ingresos' && (
            <tr>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Servicio</th>
              <th>Método</th>
              <th>Recibido</th>
              <th>Estado</th>
            </tr>
          )}
          {tab === 'egresos' && (
            <tr>
              <th>Concepto</th>
              <th>Fecha</th>
              <th>Centro</th>
              <th>Valor</th>
              <th>Soporte</th>
              <th>Estado</th>
            </tr>
          )}
          {tab === 'cobrar' && (
            <tr>
              <th>Paciente</th>
              <th>Facturado</th>
              <th>Abonado</th>
              <th>Saldo</th>
              <th>Límite</th>
              <th>Estado</th>
            </tr>
          )}
        </thead>
        <tbody>
          {movements.map((m) => {
            if (tab === 'ingresos') {
              return (
                <tr key={m.id}>
                  <td>
                    <strong>{m.person}</strong>
                    <span>{m.id}</span>
                  </td>
                  <td className="num">{formatDate(m.date)}</td>
                  <td>
                    <strong>{m.concept}</strong>
                    <span>{m.category}</span>
                  </td>
                  <td>{m.paymentMethod}</td>
                  <td className="num">{formatCurrency(m.value)}</td>
                  <td>
                    <Badge label={m.status} tone={statusTone(m.status)} />
                  </td>
                </tr>
              );
            }
            if (tab === 'egresos') {
              return (
                <tr key={m.id}>
                  <td>
                    <strong>{m.concept}</strong>
                    <span>{m.person}</span>
                  </td>
                  <td className="num">{formatDate(m.date)}</td>
                  <td>{m.costCenter}</td>
                  <td className="num">{formatCurrency(m.value)}</td>
                  <td>
                    {m.attachment || m.attachmentUrl ? (
                      <button className="support-link" onClick={() => onSupport(m)}>
                        <Eye size={14} /> Ver
                      </button>
                    ) : (
                      <span style={{ color: 'var(--faint)' }}>—</span>
                    )}
                  </td>
                  <td>
                    <Badge label={m.scope === 'Empresa' ? m.status : m.scope} tone={statusTone(m.status)} />
                  </td>
                </tr>
              );
            }
            const saldo = (m.invoiceValue ?? m.value) - (m.paidValue ?? 0);
            return (
              <tr key={m.id}>
                <td>
                  <strong>{m.person}</strong>
                  <span>{m.note ?? m.concept}</span>
                </td>
                <td className="num">{formatCurrency(m.invoiceValue ?? m.value)}</td>
                <td className="num">{formatCurrency(m.paidValue ?? 0)}</td>
                <td className="num">{formatCurrency(saldo)}</td>
                <td className="num">{m.dueDate ? formatDate(m.dueDate) : '—'}</td>
                <td>
                  <Badge label={m.status} tone={statusTone(m.status)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   REPORTES
   ============================================================ */
function ReportesView({
  dataVersion,
  notify,
}: {
  dataVersion: number;
  notify: (msg: string, error?: boolean) => void;
}) {
  const [range, setRange] = useState<DateRange>(emptyRange);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const reveal = useScrollReveal(`${loading}`);
  const grown = useGrow();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAnalytics(range)
      .then((a) => {
        if (alive) setData(a);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, dataVersion]);

  const a = data;
  const max = a ? Math.max(a.company_income, a.company_expenses, a.personal_out, Math.abs(a.net_profit), 1) : 1;
  const monthMax = a && a.monthly.length ? Math.max(...a.monthly.map((m) => Math.max(m.income, m.expenses)), 1) : 1;
  const bars = a
    ? [
        { label: 'Ingresos empresa', value: a.company_income, tone: 'success' as const },
        { label: 'Gastos empresa', value: a.company_expenses, tone: 'warning' as const },
        { label: 'Utilidad real', value: a.net_profit, tone: 'neutral' as const },
        { label: 'Personal / retiros', value: a.personal_out, tone: 'warning' as const },
      ]
    : [];

  function onCsv() {
    if (!a) {
      notify('Espera a que carguen los reportes.', true);
      return;
    }
    try {
      downloadCsv(
        `healen-reportes-${range.from || 'todo'}`,
        ['Mes', 'Ingresos', 'Gastos', 'Utilidad'],
        a.monthly.map((m) => [formatMonth(`${m.month}-01`), m.income, m.expenses, m.profit]),
      );
      notify('CSV descargado');
    } catch {
      notify('No se pudo exportar el CSV.', true);
    }
  }
  async function onPdf() {
    if (!a) {
      notify('Espera a que carguen los reportes.', true);
      return;
    }
    try {
      await downloadPdf({
        filename: `healen-reportes-${range.from || 'todo'}`,
        title: 'Reporte financiero',
        subtitle: rangeLabel(range),
        kpis: [
          { label: 'Ingresos', value: formatCompact(a.company_income) },
          { label: 'Gastos', value: formatCompact(a.company_expenses) },
          { label: 'Utilidad', value: formatCompact(a.net_profit) },
          { label: 'Margen', value: `${a.margin_pct}%` },
        ],
        sections: [
          {
            heading: 'Serie mensual',
            headers: ['Mes', 'Ingresos', 'Gastos', 'Utilidad'],
            rows: a.monthly.map((m) => [formatMonth(`${m.month}-01`), formatCurrency(m.income), formatCurrency(m.expenses), formatCurrency(m.profit)]),
          },
          {
            heading: 'Gastos por categoría',
            headers: ['Categoría', 'Valor'],
            rows: a.expenses_by_category.map((x) => [x.k, formatCurrency(x.v)]),
          },
        ],
      });
      notify('PDF descargado');
    } catch {
      notify('No se pudo generar el PDF.', true);
    }
  }

  if (loading && !a) {
    return (
      <div className="view-wrap" ref={reveal}>
        <DateRangeBar range={range} onChange={setRange} onCsv={onCsv} onPdf={onPdf} busy />
        <div className="view-loading" data-reveal>
          <span className="spinner" /> Cargando reportes…
        </div>
      </div>
    );
  }

  return (
    <div className="view-wrap" ref={reveal}>
      <DateRangeBar range={range} onChange={setRange} onCsv={onCsv} onPdf={onPdf} busy={loading || !a} />

      <section className="kpi-grid" data-reveal>
        <SignalKpi icon={Activity} tone="ok" label="Margen" value={`${a?.margin_pct ?? 0}%`} hint="Utilidad / ingresos" />
        <SignalKpi icon={Sparkles} tone="brand" label="Pacientes VIP" value={a?.vip_count ?? 0} hint="Por valor de venta" />
        <Kpi icon={Package} tone="warn" label="Valor inventario" value={formatCompact(a?.stock_value ?? 0)} hint="Stock valorizado" />
        <Kpi icon={Wallet} tone="brand" label="Separado personal" value={formatCompact(a?.personal_out ?? 0)} hint="No afecta utilidad" />
      </section>

      <div className="grid-2">
        <article className="panel" data-reveal>
          <div className="panel__head">
            <div>
              <span className="eyebrow">Flujo</span>
              <h2>Empresa vs operación</h2>
            </div>
          </div>
          <div className="bars">
            {bars.map((b) => (
              <div key={b.label}>
                <div className="bar__top">
                  <span>{b.label}</span>
                  <strong className="tnum">{formatCurrency(b.value)}</strong>
                </div>
                <span className="bar__track">
                  <span
                    className={`bar__fill bar__fill--${b.tone}`}
                    style={{ width: grown ? `${Math.max(3, (Math.abs(b.value) / max) * 100)}%` : '0%' }}
                  />
                </span>
              </div>
            ))}
          </div>
        </article>

        <div className="stack">
          <article className="panel" data-reveal>
            <div className="panel__head">
              <div>
                <span className="eyebrow">Tendencia</span>
                <h2>Ingresos por mes</h2>
              </div>
            </div>
            {a && a.monthly.length > 0 ? (
              <div className="rev-bars">
                {a.monthly.map((m) => (
                  <div className="rev-bar" key={m.month}>
                    <span className="rev-bar__track">
                      <span
                        className="rev-bar__fill"
                        style={{ height: grown ? `${Math.max(6, (m.income / monthMax) * 100)}%` : '0%' }}
                      />
                    </span>
                    <span className="rev-bar__val">{formatCompact(m.income)}</span>
                    <span className="rev-bar__month">{formatMonth(`${m.month}-01`)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-line">Sin movimientos en el periodo.</p>
            )}
          </article>

          <article className="panel" data-reveal>
            <div className="panel__head">
              <div>
                <span className="eyebrow">Categorías</span>
                <h2>Gastos empresa</h2>
              </div>
            </div>
            <div className="cat-list">
              {(a?.expenses_by_category ?? []).map((x) => (
                <div key={x.k}>
                  <span>{x.k}</span>
                  <strong className="tnum">{formatCurrency(x.v)}</strong>
                </div>
              ))}
              {(!a || a.expenses_by_category.length === 0) && (
                <div>
                  <span>Sin gastos</span>
                  <strong>$0</strong>
                </div>
              )}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SHEETS (modales)
   ============================================================ */
function Sheet({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <article className="sheet" onClick={(e) => e.stopPropagation()}>
        <span className="sheet__grab" />
        <header className="sheet__head">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h3>{title}</h3>
          </div>
          <button className="btn btn--icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>
        {children}
      </article>
    </div>
  );
}

const SIGNAL_TONE: Record<Signal, Tone> = { ok: 'success', warn: 'warning', danger: 'danger' };

const NOTE_ICON: Record<NoteKind, ElementType> = {
  nota: FileText,
  alergia: AlertTriangle,
  recomendacion: Lightbulb,
  hito: Award,
  seguimiento: CalendarClock,
};
const TL_ICON: Record<string, ElementType> = {
  tratamiento: Dna,
  venta: Wallet,
  abono: CreditCard,
  dosis: Syringe,
};
function timelineIcon(category: string): ElementType {
  if (category.startsWith('nota_')) return NOTE_ICON[category.slice(5) as NoteKind] ?? FileText;
  return TL_ICON[category] ?? ClipboardList;
}
const STEP_ICON: Record<NextStep['action'], ElementType> = {
  recetar: Syringe,
  cobrar: Wallet,
  reponer: Package,
  seguimiento: CalendarClock,
};

/** Semáforo compacto: cuántos productos del paciente están en cada color. */
function SignalSummary({ counts, label = false }: { counts: SignalCounts; label?: boolean }) {
  const shown = ([['danger', counts.danger], ['warn', counts.warn], ['ok', counts.ok]] as Array<[Signal, number]>).filter(
    ([, n]) => n > 0,
  );
  if (!shown.length) return null;
  return (
    <span className="sig-summary" title="Semáforo de productos">
      {shown.map(([s, n]) => (
        <span key={s} className={`sig-pill sig-pill--${s}`}>
          <span className={`dot dot--${s}`} />
          {n}
          {label ? ` ${signalLabel(s)}` : ''}
        </span>
      ))}
    </span>
  );
}

/** Estado del tratamiento en el héroe: veredicto honesto (palabra+frase, sin un
 *  número que contradiga el color) + un mini-anillo por producto con su color
 *  real, o un anillo grande si hay 1/0 productos. Reemplaza el anillo único. */
function TreatmentStatus({ patient, counts, signal }: { patient: Patient; counts: SignalCounts; signal: Signal }) {
  const peptides = patient.peptides;
  const ordered = [...peptides].sort((a, b) => a.endsInDays - b.endsInDays);
  return (
    <div className="detail__status">
      <div className={`detail__verdict detail__verdict--${signal}`}>
        <span className="detail__verdict-word">{signalLabel(signal)}</span>
        <span className="detail__verdict-phrase">{verdictPhrase(patient)}</span>
      </div>

      {peptides.length > 1 && (
        <div className="detail__rings">
          {ordered.slice(0, 4).map((p, i) => (
            <div className="detail__ringitem" key={`${p.name}-${i}`}>
              <TreatmentRing daysLeft={p.endsInDays} totalDays={30} size={56} stroke={5} showUnit={false} />
              <span className="detail__ringitem-label">
                {shortName(p.name)} · {p.endsInDays}d
              </span>
            </div>
          ))}
          {peptides.length > 4 && <span className="detail__rings-more">+{peptides.length - 4}</span>}
        </div>
      )}
      {peptides.length === 1 && (
        <TreatmentRing daysLeft={peptides[0].endsInDays} totalDays={30} size={96} stroke={9} />
      )}
      {peptides.length === 0 && (
        <TreatmentRing daysLeft={patient.daysLeft} totalDays={patient.totalDays} size={96} stroke={9} />
      )}

      <SignalSummary counts={counts} label />
    </div>
  );
}

type InflammationStage = { grade: string; phase: string; tone: 'danger' | 'warn' | 'ok' };

function patientInflammationStage(patient: Patient, dossier: PatientDossier | null): InflammationStage | null {
  const searchable = [
    patient.plan,
    dossier?.summary?.notes,
    ...(dossier?.notes ?? []).map((n) => n.body),
    ...(dossier?.milestones ?? []).flatMap((m) => [m.phase, m.title, m.description ?? '']),
  ]
    .filter(Boolean)
    .join(' ');

  const gradeMatch = searchable.match(/grado\s*(\d+)\s*(?:de\s*)?inflamaci[oó]n/i);
  if (!gradeMatch) return null;

  const grade = Number(gradeMatch[1]);
  const tone: InflammationStage['tone'] = grade >= 2 ? 'danger' : grade === 1 ? 'warn' : 'ok';
  const phaseMatch = searchable.match(/fase\s+cl[ií]nica\s*:\s*([^\.\n]+)/i);
  const phase = phaseMatch?.[1]?.trim() || (patient.plan.toLowerCase().includes('fase 1') ? 'Ciclo 1 de inicio' : patient.plan);

  return { grade: `Grado ${grade} de inflamación`, phase, tone };
}

/** Página completa de paciente = ficha clínica viva con pestañas
 *  (Resumen · Notas · Historial · Dinero). Carga el dossier al abrir. */
function PatientDetail({
  patient,
  onBack,
  onPrescribe,
  go,
}: {
  patient: Patient;
  onBack: () => void;
  onPrescribe?: (p: Patient) => void;
  go: (v: View) => void;
}) {
  const ref = useScrollReveal(`${patient.id}-${0}`);
  const [tab, setTab] = useState<'resumen' | 'notas' | 'historial' | 'relacionado' | 'dinero'>('resumen');
  const [dossier, setDossier] = useState<PatientDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const signal = overallSignal(patient);
  const counts = patientSignalCounts(patient);

  const reload = useCallback(async () => {
    if (!patient.clientUuid) {
      setLoading(false);
      return;
    }
    try {
      const d = await fetchDossier(patient.clientUuid);
      setDossier(d);
    } catch {
      setDossier(null);
    } finally {
      setLoading(false);
    }
  }, [patient.clientUuid]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setLoading(true);
    setDossier(null);
    reload();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, reload]);

  const steps = buildNextSteps(patient, dossier);
  const inflammationStage = patientInflammationStage(patient, dossier);
  function act(step: NextStep) {
    if (step.action === 'recetar' && onPrescribe) onPrescribe(patient);
    else go(step.target);
  }

  const TABS = [
    { id: 'resumen' as const, label: 'Resumen', icon: Activity, count: undefined as number | undefined },
    { id: 'notas' as const, label: 'Notas', icon: FileText, count: dossier?.notes.length },
    { id: 'historial' as const, label: 'Historial', icon: ClipboardList, count: dossier?.timeline.length },
    { id: 'relacionado' as const, label: 'Relacionado', icon: LinkIcon, count: dossier?.related ? dossier.related.treatments.length + dossier.related.sales.length + dossier.related.appointments.length + dossier.related.relationships.length : undefined },
    { id: 'dinero' as const, label: 'Dinero', icon: Wallet, count: undefined },
  ];

  return (
    <div className="detail" ref={ref}>
      <div className="detail__bar" data-reveal>
        <button className="detail__back" onClick={onBack}>
          <ArrowLeft size={17} /> Pacientes
        </button>
        <nav className="detail__crumbs" aria-label="Ruta">
          <button onClick={onBack}>Pacientes</button>
          <ChevronRight size={13} />
          <span>{patient.name}</span>
        </nav>
      </div>

      <header className={`detail__hero detail__hero--${signal}`} data-reveal>
        <div className="detail__identity">
          <span className="eyebrow">Ficha clínica</span>
          <h1>{patient.name}</h1>
          <div className="detail__tags">
            <span className={`tier${patient.tier === 'VIP' ? ' tier--vip' : ''}`}>{patient.tier}</span>
            <Badge label={patient.status} tone={statusTone(patient.status)} />
            <span className="detail__pid">{patient.id}</span>
          </div>
          <p className="detail__plan">
            {patient.plan} · <strong>{formatCurrency(patient.saleValue)}</strong>
          </p>
          {inflammationStage && (
            <div className={`detail__phase-alert detail__phase-alert--${inflammationStage.tone}`}>
              <AlertTriangle size={16} />
              <div>
                <strong>{inflammationStage.grade}</strong>
                <span>{inflammationStage.phase}</span>
              </div>
            </div>
          )}
        </div>
        <TreatmentStatus patient={patient} counts={counts} signal={signal} />
      </header>

      <div className="detail__toolbar" data-reveal>
        <div className="detail__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`detail__tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
            >
              <t.icon size={15} /> {t.label}
              {typeof t.count === 'number' && t.count > 0 && <small>{t.count}</small>}
            </button>
          ))}
        </div>
        {onPrescribe && (
          <button className="btn btn--primary detail__cta" onClick={() => onPrescribe(patient)}>
            <Syringe size={17} /> Recetar
          </button>
        )}
      </div>

      {tab === 'resumen' && (
        <ResumenPanel patient={patient} dossier={dossier} steps={steps} onAct={act} counts={counts} reload={reload} />
      )}
      {tab === 'notas' && <NotasPanel patient={patient} dossier={dossier} loading={loading} onChanged={reload} />}
      {tab === 'historial' && <HistorialPanel patient={patient} dossier={dossier} loading={loading} />}
      {tab === 'relacionado' && <RelacionadoPanel dossier={dossier} loading={loading} />}
      {tab === 'dinero' && <DineroPanel patient={patient} dossier={dossier} />}
    </div>
  );
}

/* ---- Próximos pasos auto-gestionados ---- */
function NextStepsPanel({ steps, onAct }: { steps: NextStep[]; onAct: (s: NextStep) => void }) {
  return (
    <section className="detail-block" data-reveal>
      <div className="label">
        <Sparkles size={17} /> Próximos pasos
      </div>
      <div className="steps">
        {steps.map((s) => {
          const Icon = STEP_ICON[s.action];
          return (
            <button key={s.id} className={`step step--${s.signal}`} onClick={() => onAct(s)}>
              <span className={`step__icon step__icon--${s.signal}`}>
                <Icon size={17} />
              </span>
              <span className="step__body">
                <strong>{s.title}</strong>
                <span>{s.detail}</span>
              </span>
              <ChevronRight className="chev" size={17} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---- Tratamiento activo con semáforo por producto ---- */
function TreatmentBlock({ patient }: { patient: Patient }) {
  return (
    <section className="detail-block" data-reveal>
      <div className="label">
        <Syringe size={17} /> Tratamiento activo <SignalSummary counts={patientSignalCounts(patient)} />
      </div>
      <div className="treatment-list">
        {patient.peptides.length === 0 && <p className="muted-line">Sin productos en el plan vigente.</p>}
        {patient.peptides.map((p, i) => {
          const sig = treatmentSignal(p.endsInDays);
          return (
            <article key={`${p.name}-${i}`}>
              <span className={`dot dot--${sig}`} />
              <div>
                <strong>{p.name}</strong>
                <span className="treatment-list__dose">
                  {p.dose}
                  {p.route ? ` · ${p.route}` : ''}
                </span>
              </div>
              <span className={`ti-flag ti-flag--${sig}`}>{p.endsInDays <= 0 ? 'Hoy' : `${p.endsInDays} días`}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ---- Alergias y recomendaciones (notas fijadas / clínicas clave) ---- */
function ClinicalFlags({ dossier }: { dossier: PatientDossier | null }) {
  const flags = (dossier?.notes ?? []).filter(
    (n) => n.kind === 'alergia' || n.kind === 'recomendacion' || n.pinned,
  );
  return (
    <section className="detail-block" data-reveal>
      <div className="label">
        <AlertTriangle size={17} /> Alergias y recomendaciones
      </div>
      {flags.length === 0 ? (
        <p className="muted-line">Sin alergias ni recomendaciones registradas. Agrégalas en la pestaña Notas.</p>
      ) : (
        <div className="flag-list">
          {flags.map((n) => {
            const Icon = NOTE_ICON[n.kind];
            return (
              <div key={n.id} className={`flag flag--${noteKindTone(n.kind)}`}>
                <Icon size={16} />
                <div>
                  <strong>{noteKindLabel(n.kind)}</strong>
                  <p>{n.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}


function milestoneDateLabel(m: PatientMilestone): string {
  if (m.targetDate) return formatDate(m.targetDate);
  if (m.relativeDay !== null) return `Día ${m.relativeDay}`;
  return 'Sin fecha';
}

function milestoneDueLabel(m: PatientMilestone): string {
  if (m.status === 'completado') return 'Completado';
  if (m.status === 'omitido') return 'Omitido';
  if (m.daysLeft === null) return 'Sin fecha objetivo';
  if (m.daysLeft < 0) return `${Math.abs(m.daysLeft)} días vencido`;
  if (m.daysLeft === 0) return 'Vence hoy';
  if (m.daysLeft === 1) return 'Mañana';
  return `En ${m.daysLeft} días`;
}

function MilestonesPanel({
  patient,
  milestones,
  loading,
  onChanged,
}: {
  patient: Patient;
  milestones: PatientMilestone[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const completed = milestones.filter((m) => m.status === 'completado').length;
  const progress = milestones.length ? Math.round((completed / milestones.length) * 100) : 0;
  const canWrite = !!patient.clientUuid;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!patient.clientUuid) return;
    // React nulls currentTarget after the async boundary. Keep the real form
    // element before awaiting RPCs so reset() does not crash after a successful save.
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const title = String(form.get('title') || '').trim();
    if (!title) return;
    setSaving(true);
    setError('');
    try {
      await addMilestone({
        clientId: patient.clientUuid,
        treatmentId: patient.treatmentId ?? null,
        title,
        description: String(form.get('description') || '').trim() || null,
        category: String(form.get('category') || 'seguimiento'),
        modality: String(form.get('modality') || '').trim() || null,
        targetDate: String(form.get('targetDate') || '') || null,
        relativeDay: form.get('relativeDay') ? Number(form.get('relativeDay')) : null,
        phase: String(form.get('phase') || 'Fase 1').trim() || 'Fase 1',
        pinned: form.get('pinned') === 'on',
      });
      formEl.reset();
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el hito');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(m: PatientMilestone) {
    setSaving(true);
    setError('');
    try {
      const done = m.status !== 'completado';
      await toggleMilestone(m.id, done, done ? 'Marcado desde el dashboard.' : null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el hito');
    } finally {
      setSaving(false);
    }
  }

  async function remove(m: PatientMilestone) {
    if (!window.confirm(`¿Archivar el hito “${m.title}”?`)) return;
    setSaving(true);
    setError('');
    try {
      await deleteMilestone(m.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo archivar el hito');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="detail-block milestones" data-reveal>
      <div className="label">
        <ClipboardList size={17} /> Hitos clínicos
        <small className="count-chip">{completed}/{milestones.length}</small>
        {canWrite && (
          <button className="detail-block__edit" onClick={() => setOpen((v) => !v)}>
            {open ? <X size={14} /> : <Plus size={14} />} {open ? 'Cerrar' : 'Nuevo hito'}
          </button>
        )}
      </div>

      <div className="milestones__progress" aria-label={`Progreso de hitos ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      {open && (
        <form className="form milestone-form" onSubmit={submit}>
          <Field label="Título" full>
            <input name="title" placeholder="Ej. Control de tolerancia inicial" required />
          </Field>
          <Field label="Fase">
            <input name="phase" placeholder="Fase 1" defaultValue="Fase 1" />
          </Field>
          <Field label="Categoría">
            <select name="category" defaultValue="seguimiento">
              {MILESTONE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Modalidad">
            <input name="modality" placeholder="Chat / Telemedicina / Consulta" />
          </Field>
          <Field label="Fecha objetivo">
            <input name="targetDate" type="date" />
          </Field>
          <Field label="Día relativo">
            <input name="relativeDay" type="number" placeholder="Ej. 5" />
          </Field>
          <Field label="Objetivo" full>
            <textarea name="description" rows={3} placeholder="Qué debe revisarse, qué variables monitorear y qué decisión se espera tomar…" />
          </Field>
          <label className="milestone-pin field--full">
            <input name="pinned" type="checkbox" /> <Pin size={14} /> Fijar arriba
          </label>
          {error && <p className="note-composer__error field--full">{error}</p>}
          <div className="info-form__actions field--full">
            <button className="btn btn--primary" type="submit" disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : <Check size={16} />} Guardar hito
            </button>
            <button className="btn btn--soft" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && !open && <p className="note-composer__error">{error}</p>}
      {loading ? (
        <p className="muted-line">Cargando hitos…</p>
      ) : milestones.length === 0 ? (
        <p className="muted-line">Aún no hay hitos para este paciente. Crea el primer checkpoint clínico.</p>
      ) : (
        <div className="milestone-list">
          {milestones.map((m) => {
            const tone = milestoneDueTone(m.daysLeft, m.status);
            const done = m.status === 'completado';
            return (
              <article key={m.id} className={`milestone milestone--${tone}${done ? ' is-done' : ''}`}>
                <button className="milestone__check" onClick={() => toggle(m)} disabled={saving} aria-label={done ? 'Desmarcar hito' : 'Completar hito'}>
                  {done ? <Check size={17} /> : <span />}
                </button>
                <div className="milestone__body">
                  <div className="milestone__top">
                    {m.pinned && <Pin className="note__pin" size={13} />}
                    <span className={`note__kind note__kind--${tone}`}>{milestoneCategoryLabel(m.category)}</span>
                    <span className="note__meta">{m.phase}</span>
                  </div>
                  <strong>{m.title}</strong>
                  {m.description && <p>{m.description}</p>}
                  <div className="milestone__meta">
                    <span><CalendarClock size={13} /> {milestoneDateLabel(m)}</span>
                    <span className={`ti-flag ti-flag--${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warn' : 'ok'}`}>{milestoneDueLabel(m)}</span>
                    {m.modality && <span>{m.modality}</span>}
                    <span>{milestoneStatusLabel(m.status)}</span>
                  </div>
                  {done && m.completedAt && (
                    <p className="milestone__done">Cerrado {formatDate(m.completedAt)} · {m.completedBy}</p>
                  )}
                </div>
                <button className="note__del" onClick={() => remove(m)} disabled={saving} aria-label="Archivar hito">
                  <Trash2 size={15} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResumenPanel({
  patient,
  dossier,
  steps,
  onAct,
  counts,
  reload,
}: {
  patient: Patient;
  dossier: PatientDossier | null;
  steps: NextStep[];
  onAct: (s: NextStep) => void;
  counts: SignalCounts;
  reload: () => void;
}) {
  const lifetime = dossier?.summary?.total_purchased ?? patient.saleValue;
  const balance = dossier?.summary?.balance ?? 0;
  const sessions = dossier?.summary?.sales_count ?? 0;
  const since = daysSince(dossier?.summary?.last_sale);
  return (
    <div className="detail__grid">
      <aside className="detail__aside">
        <NextStepsPanel steps={steps} onAct={onAct} />
        <PatientInfoCard summary={dossier?.summary ?? null} patient={patient} onSaved={reload} />
        <div className="fact-card" data-reveal>
          <div className="fact">
            <span>Valor de vida</span>
            <strong>{formatCompact(lifetime)}</strong>
          </div>
          <div className="fact">
            <span>Saldo</span>
            <strong className={balance > 0 ? 'fact--danger' : undefined}>{formatCompact(balance)}</strong>
          </div>
          <div className="fact">
            <span>Sesiones</span>
            <strong>{sessions}</strong>
          </div>
          <div className="fact">
            <span>Última visita</span>
            <strong className="fact__sm">{since === null ? '—' : since === 0 ? 'Hoy' : `Hace ${since}d`}</strong>
          </div>
          <div className="fact">
            <span>Inicio</span>
            <strong className="fact__sm">{formatDate(patient.startDate)}</strong>
          </div>
          <div className="fact">
            <span>Cierre</span>
            <strong className="fact__sm">{formatDate(patient.endDate)}</strong>
          </div>
          {patient.weeklySerum && (
            <div className="fact">
              <span>Suero</span>
              <strong className="fact__sm">{patient.serumDay}</strong>
            </div>
          )}
          <div className="fact">
            <span>Semáforo</span>
            <strong className="fact__sm">
              <SignalSummary counts={counts} />
            </strong>
          </div>
        </div>
      </aside>
      <main className="detail__main">
        <TreatmentBlock patient={patient} />
        <ClinicalFlags dossier={dossier} />
        <MilestonesPanel patient={patient} milestones={dossier?.milestones ?? []} loading={!dossier} onChanged={reload} />
      </main>
    </div>
  );
}

/* ---- Ficha de datos del paciente (lectura + edición inline) ---- */
function InfoRow({ k, v, sub, full }: { k: string; v: string | null; sub?: string; full?: boolean }) {
  return (
    <div className={`info-row${full ? ' info-row--full' : ''}`}>
      <span className="info-k">{k}</span>
      {v ? <strong>{v}</strong> : <span className="info-empty">Sin registrar</span>}
      {v && sub && <span className="info-sub">{sub}</span>}
    </div>
  );
}

function PatientInfoCard({
  summary,
  patient,
  onSaved,
}: {
  summary: PatientSummary | null;
  patient: Patient;
  onSaved: () => void;
}) {
  const clientUuid = patient.clientUuid;
  // Solo se puede editar cuando el summary YA cargó: si no, el form se
  // inicializaría desde valores vacíos y Guardar borraría los datos en BD.
  const canEdit = !!clientUuid && !!summary;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const name = summary?.full_name || patient.name;
  const documentId = summary?.document_id ?? null;
  const phone = summary?.phone ?? null;
  const email = summary?.email ?? null;
  const birthdate = summary?.birthdate ?? null;
  const address = summary?.address ?? null;
  const notes = summary?.notes ?? null;
  const age = ageFromBirthdate(birthdate);

  const [form, setForm] = useState({
    full_name: '',
    document_id: '',
    phone: '',
    email: '',
    birthdate: '',
    address: '',
    notes: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function startEdit() {
    setForm({
      full_name: name,
      document_id: documentId ?? '',
      phone: phone ?? '',
      email: email ?? '',
      birthdate: birthdate ? birthdate.slice(0, 10) : '',
      address: address ?? '',
      notes: notes ?? '',
    });
    setError('');
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!clientUuid || !summary) return; // nunca guardar sobre un summary sin cargar
    setSaving(true);
    setError('');
    try {
      await updateClient(clientUuid, form);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  const waDigits = phone ? phone.replace(/\D/g, '') : '';
  const dialable = waDigits.length >= 10; // evita tel:/wa.me rotos con datos sucios
  const wa = waDigits.startsWith('57') ? waDigits : `57${waDigits}`;

  return (
    <section className="detail-block" data-reveal>
      <div className="label">
        <User size={17} /> Datos del paciente
        {canEdit && !editing && (
          <button className="detail-block__edit" onClick={startEdit}>
            <Pencil size={14} /> Editar
          </button>
        )}
      </div>

      {editing ? (
        <form className="form info-form" onSubmit={save}>
          <Field label="Nombre">
            <input value={form.full_name} onChange={set('full_name')} placeholder="Nombre y apellido" required />
          </Field>
          <Field label="Documento">
            <input value={form.document_id} onChange={set('document_id')} placeholder="CC / pasaporte" />
          </Field>
          <Field label="Teléfono">
            <input type="tel" value={form.phone} onChange={set('phone')} placeholder="300 000 0000" />
          </Field>
          <Field label="Correo">
            <input type="email" value={form.email} onChange={set('email')} placeholder="nombre@correo.com" />
          </Field>
          <Field label="Nacimiento">
            <input type="date" value={form.birthdate} onChange={set('birthdate')} />
          </Field>
          <Field label="Dirección" full>
            <input value={form.address} onChange={set('address')} placeholder="Calle, ciudad" />
          </Field>
          <Field label="Notas de ficha" full>
            <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Preferencias, contacto, observaciones…" />
          </Field>
          {error && <p className="note-composer__error field--full">{error}</p>}
          <div className="info-form__actions field--full">
            <button className="btn btn--primary" type="submit" disabled={saving}>
              {saving ? <span className="spinner spinner--sm" /> : <Check size={16} />} Guardar cambios
            </button>
            <button className="btn btn--soft" type="button" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="info-grid">
          <InfoRow k="Nombre" v={name} />
          <InfoRow k="Documento" v={documentId} />
          <InfoRow
            k="Edad"
            v={age !== null ? `${age} años` : null}
            sub={age !== null && birthdate ? formatLongDate(birthdate) : undefined}
          />
          <InfoRow k="Código" v={patient.id} />
          <div className="info-row">
            <span className="info-k">Teléfono</span>
            {phone ? (
              <>
                <strong>{phone}</strong>
                {dialable && (
                  <span className="info-actions">
                    <a className="info-act" href={`tel:+${wa}`} aria-label="Llamar">
                      <Phone size={14} />
                    </a>
                    <a className="info-act" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                      <MessageCircle size={14} />
                    </a>
                  </span>
                )}
              </>
            ) : (
              <span className="info-empty">Sin registrar</span>
            )}
          </div>
          <div className="info-row">
            <span className="info-k">Correo</span>
            {email ? (
              <>
                <strong className="info-mail">{email}</strong>
                <span className="info-actions">
                  <a className="info-act" href={`mailto:${email}`} aria-label="Correo">
                    <Mail size={14} />
                  </a>
                </span>
              </>
            ) : (
              <span className="info-empty">Sin registrar</span>
            )}
          </div>
          <InfoRow k="Dirección" v={address} full />
          {notes && <InfoRow k="Notas de ficha" v={notes} full />}
        </div>
      )}
    </section>
  );
}

/* ---- Notas: composer + lista ---- */
function NotasPanel({
  patient,
  dossier,
  loading,
  onChanged,
}: {
  patient: Patient;
  dossier: PatientDossier | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<NoteKind>('nota');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canWrite = !!patient.clientUuid;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!patient.clientUuid || !body.trim()) return;
    setSaving(true);
    setError('');
    try {
      await addNote(patient.clientUuid, body.trim(), kind, patient.treatmentId ?? null);
      setBody('');
      setKind('nota');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await deleteNote(id);
      await onChanged();
    } catch {
      /* noop */
    } finally {
      setSaving(false);
    }
  }

  const notes = dossier?.notes ?? [];
  return (
    <div className="detail__single">
      {canWrite && (
        <form className="detail-block note-composer" data-reveal onSubmit={submit}>
          <div className="label">
            <Plus size={17} /> Nueva nota
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escribe una nota, alergia, recomendación o hito…"
            rows={3}
          />
          <div className="note-composer__row">
            <div className="note-kinds">
              {NOTE_KINDS.map((k) => (
                <button
                  type="button"
                  key={k.id}
                  className={`note-kind note-kind--${k.tone}${kind === k.id ? ' is-active' : ''}`}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <button className="btn btn--primary" type="submit" disabled={saving || !body.trim()}>
              {saving ? <span className="spinner spinner--sm" /> : <Check size={16} />} Guardar
            </button>
          </div>
          {error && <p className="note-composer__error">{error}</p>}
        </form>
      )}

      <section className="detail-block" data-reveal>
        <div className="label">
          <FileText size={17} /> Notas clínicas <small className="count-chip">{notes.length}</small>
        </div>
        {loading ? (
          <p className="muted-line">Cargando historia…</p>
        ) : notes.length === 0 ? (
          <p className="muted-line">Aún no hay notas. Registra la primera arriba.</p>
        ) : (
          <div className="note-list">
            {notes.map((n) => {
              const Icon = NOTE_ICON[n.kind];
              return (
                <article key={n.id} className={`note note--${noteKindTone(n.kind)}`}>
                  <span className="note__icon">
                    <Icon size={16} />
                  </span>
                  <div className="note__body">
                    <div className="note__top">
                      <span className={`note__kind note__kind--${noteKindTone(n.kind)}`}>{noteKindLabel(n.kind)}</span>
                      {n.pinned && <Pin size={12} className="note__pin" />}
                      <span className="note__meta">
                        {n.author} · {formatDate(n.created_at.slice(0, 10))}
                      </span>
                    </div>
                    <p>{n.body}</p>
                  </div>
                  {canWrite && (
                    <button className="note__del" onClick={() => remove(n.id)} aria-label="Eliminar nota">
                      <Trash2 size={15} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- Historial: línea de tiempo unificada (hechos reales) ---- */
function HistorialPanel({
  patient,
  dossier,
  loading,
}: {
  patient: Patient;
  dossier: PatientDossier | null;
  loading: boolean;
}) {
  const events = dossier?.timeline ?? [];
  const fallback = patientHistory(patient);
  return (
    <div className="detail__single">
      <section className="detail-block" data-reveal>
        <div className="label">
          <ClipboardList size={17} /> Historia clínica
        </div>
        {loading ? (
          <p className="muted-line">Cargando historia…</p>
        ) : events.length > 0 ? (
          <div className="feed">
            {events.map((ev, i) => {
              const Icon = timelineIcon(ev.category);
              return (
                <div className={`feed__item feed__item--${ev.tone}`} key={`${ev.ts}-${i}`}>
                  <span className={`feed__icon feed__icon--${ev.tone}`}>
                    <Icon size={15} />
                  </span>
                  <div className="feed__body">
                    <div className="feed__head">
                      <strong>{ev.title}</strong>
                      {ev.amount != null && ev.amount > 0 && <span className="feed__amount">{formatCompact(ev.amount)}</span>}
                    </div>
                    <p>{ev.detail}</p>
                    <span className="feed__date">{formatDate(ev.date)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="timeline">
            {fallback.map((item, i) => (
              <div className={`timeline__item timeline__item--${item.tone}`} key={`${item.date}-${item.title}-${i}`}>
                <span>{item.date === '-' ? 'Sin fecha' : formatDate(item.date) || item.date}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- Relacionado: tratamientos, ventas, pagos, agenda y beneficiarios importados ---- */
function RelacionadoPanel({ dossier, loading }: { dossier: PatientDossier | null; loading: boolean }) {
  const related = dossier?.related;
  const treatments = related?.treatments ?? [];
  const sales = related?.sales ?? [];
  const appointments = related?.appointments ?? [];
  const relationships = related?.relationships ?? [];

  if (loading) {
    return (
      <div className="detail__single">
        <section className="detail-block" data-reveal>
          <div className="label"><LinkIcon size={17} /> Información relacionada</div>
          <p className="muted-line">Cargando relaciones, tratamientos, cartera y agenda…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="detail__single">
      <section className="kpi-grid" data-reveal>
        <MoneyKpi icon={Syringe} tone="brand" label="Tratamientos" value={treatments.length} money={false} />
        <MoneyKpi icon={Wallet} tone="ok" label="Ventas" value={sales.length} money={false} />
        <MoneyKpi icon={CalendarClock} tone="warn" label="Agenda" value={appointments.length} money={false} />
        <MoneyKpi icon={Users} tone="brand" label="Relaciones" value={relationships.length} money={false} />
      </section>

      <section className="detail-block" data-reveal>
        <div className="label"><Syringe size={17} /> Tratamientos e insumos</div>
        {treatments.length === 0 ? <p className="muted-line">Sin tratamientos asociados.</p> : (
          <div className="note-list">
            {treatments.map((t) => (
              <article key={t.id} className="note note--success">
                <span className="note__icon"><Syringe size={16} /></span>
                <div className="note__body">
                  <div className="note__top">
                    <span className="note__kind note__kind--success">{t.status ?? 'tratamiento'}</span>
                    <span className="note__meta">{t.startDate ? formatDate(t.startDate) : 'Sin inicio'} → {t.endDate ? formatDate(t.endDate) : 'Sin cierre'}</span>
                  </div>
                  <strong>{t.name}</strong>
                  <p>{formatCurrency(t.salePrice ?? 0)}{t.weeklySerum ? ` · suero ${t.serumDay ?? ''}` : ''}</p>
                  {t.notes && <p>{t.notes}</p>}
                  {t.items.length > 0 && (
                    <ul className="agenda-card__services">
                      {t.items.map((item) => (
                        <li key={item.id}>{item.name}{item.dose ? ` · ${item.dose}` : ''}{item.route ? ` · ${item.route}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="detail-block" data-reveal>
        <div className="label"><Wallet size={17} /> Ventas, pagos y cartera</div>
        {sales.length === 0 ? <p className="muted-line">Sin ventas asociadas.</p> : (
          <div className="note-list">
            {sales.map((s) => (
              <article key={s.id} className={`note note--${s.balance > 0 ? 'warning' : 'success'}`}>
                <span className="note__icon"><Wallet size={16} /></span>
                <div className="note__body">
                  <div className="note__top">
                    <span className={`note__kind note__kind--${s.balance > 0 ? 'warning' : 'success'}`}>{s.status ?? 'venta'}</span>
                    <span className="note__meta">{s.saleDate ? formatDate(s.saleDate) : 'Sin fecha'} · {s.code ?? 'sin código'}</span>
                  </div>
                  <strong>{formatCurrency(s.total)}</strong>
                  <p>Abonado {formatCurrency(s.paid)} · Saldo {formatCurrency(s.balance)}</p>
                  {s.notes && <p>{s.notes}</p>}
                  {s.payments.length > 0 && (
                    <ul className="agenda-card__services">
                      {s.payments.map((p) => (
                        <li key={p.id}>{formatCurrency(p.amount)} · {p.method ?? 'método no registrado'} · {p.paidAt ? formatDate(p.paidAt.slice(0, 10)) : 'sin fecha'}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="detail-block" data-reveal>
        <div className="label"><CalendarClock size={17} /> Agenda importada</div>
        {appointments.length === 0 ? <p className="muted-line">Sin agenda asociada.</p> : (
          <div className="timeline">
            {appointments.map((a) => (
              <div className="timeline__item timeline__item--neutral" key={a.id}>
                <span>{a.startsAt ? formatDate(a.startsAt.slice(0, 10)) : 'Sin fecha'}</span>
                <div>
                  <strong>{a.service || a.eventType || 'Evento'}</strong>
                  <p>{a.notes || a.status || 'Sin nota'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="detail-block" data-reveal>
        <div className="label"><Users size={17} /> Beneficiarios y relaciones</div>
        {relationships.length === 0 ? <p className="muted-line">Sin relaciones asociadas.</p> : (
          <div className="flag-list">
            {relationships.map((r) => (
              <div key={r.id} className="flag flag--neutral">
                <Users size={16} />
                <div>
                  <strong>{r.relatedCode ? `${r.relatedCode} · ` : ''}{r.relatedName}</strong>
                  <p>{r.relationshipType}{r.notes ? ` · ${r.notes}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- Dinero: revenue en el tiempo + KPIs ---- */
function DineroPanel({ patient, dossier }: { patient: Patient; dossier: PatientDossier | null }) {
  const s = dossier?.summary;
  const revenue = dossier?.revenue ?? [];
  const max = Math.max(1, ...revenue.map((r) => r.income));
  const grown = useGrow();
  return (
    <div className="detail__single">
      <section className="kpi-grid" data-reveal>
        <MoneyKpi icon={TrendingUp} tone="brand" label="Valor de vida" value={s?.total_purchased ?? patient.saleValue} />
        <MoneyKpi icon={CreditCard} tone="ok" label="Abonado" value={s?.total_paid ?? 0} />
        <MoneyKpi icon={Wallet} tone={(s?.balance ?? 0) > 0 ? 'danger' : 'ok'} label="Saldo" value={s?.balance ?? 0} />
        <MoneyKpi icon={Activity} tone="brand" label="Sesiones" value={s?.sales_count ?? 0} money={false} />
      </section>

      <section className="detail-block" data-reveal>
        <div className="label">
          <BarChart3 size={17} /> Revenue en el tiempo
        </div>
        {revenue.length === 0 ? (
          <p className="muted-line">Sin abonos registrados todavía.</p>
        ) : (
          <div className="rev-bars">
            {revenue.map((r) => (
              <div className="rev-bar" key={r.month}>
                <span className="rev-bar__track">
                  <span
                    className="rev-bar__fill"
                    style={{ height: grown ? `${Math.max(6, (r.income / max) * 100)}%` : '0%' }}
                  />
                </span>
                <span className="rev-bar__val">{formatCompact(r.income)}</span>
                <span className="rev-bar__month">{formatMonth(r.month)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MoneyKpi({
  icon: Icon,
  tone,
  label,
  value,
  money = true,
}: {
  icon: ElementType;
  tone: 'ok' | 'warn' | 'danger' | 'brand';
  label: string;
  value: number;
  money?: boolean;
}) {
  return (
    <div className="kpi" data-reveal>
      <div className="kpi__top">
        <span className={`kpi__icon kpi__icon--${tone}`}>
          <Icon size={17} />
        </span>
        <span className="kpi__label">{label}</span>
      </div>
      <span className="kpi__value">{money ? <CountUp value={value} /> : value}</span>
    </div>
  );
}

/** Página completa de alerta de producto (reemplaza el viejo modal). */
function AlertDetail({ alert, onBack }: { alert: PatientProductAlert; onBack: () => void }) {
  const ref = useScrollReveal(alert.id);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="detail" ref={ref}>
      <div className="detail__bar" data-reveal>
        <button className="detail__back" onClick={onBack}>
          <ArrowLeft size={17} /> Alertas
        </button>
        <nav className="detail__crumbs" aria-label="Ruta">
          <button onClick={onBack}>Alertas</button>
          <ChevronRight size={13} />
          <span>{alert.patientName}</span>
        </nav>
      </div>

      <header className={`detail__hero detail__hero--${alert.signal}`} data-reveal>
        <div className="detail__identity">
          <span className="eyebrow">Alerta de producto</span>
          <h1>{alert.patientName}</h1>
          <div className="detail__tags">
            <Badge label={signalLabel(alert.signal)} tone={SIGNAL_TONE[alert.signal]} />
            <span className="detail__pid">
              {alert.patientId} · {alert.plan}
            </span>
          </div>
          <p className="detail__plan">
            {alert.product} · <strong>{alert.dose}</strong>
          </p>
        </div>
        <div className="detail__ringwrap">
          <TreatmentRing daysLeft={alert.daysLeft} totalDays={30} size={128} stroke={11} />
          <span className={`detail__ringcap detail__ringcap--${alert.signal}`}>{alert.statusText}</span>
        </div>
      </header>

      <div className="detail__grid">
        <aside className="detail__aside">
          <div className="fact-card" data-reveal>
            <div className="fact">
              <span>Días</span>
              <strong>{alert.daysLeft}</strong>
            </div>
            <div className="fact">
              <span>Estado</span>
              <strong className="fact__sm">{signalLabel(alert.signal)}</strong>
            </div>
            <div className="fact">
              <span>Stock</span>
              <strong>
                {alert.inventoryStock === null ? '—' : `${alert.inventoryStock} ${alert.inventoryUnit}`}
              </strong>
            </div>
            <div className="fact">
              <span>Mínimo</span>
              <strong>{alert.inventoryMinimum === null ? '—' : alert.inventoryMinimum}</strong>
            </div>
          </div>
          <div className="next-steps" data-reveal>
            <strong>Acción sugerida</strong>
            <span>{alert.nextAction}</span>
          </div>
        </aside>

        <main className="detail__main">
          <section className="detail-block" data-reveal>
            <div className="label">
              <ClipboardList size={17} /> Histórico
            </div>
            <div className="timeline">
              {alert.history.map((item, i) => (
                <div className={`timeline__item timeline__item--${item.tone}`} key={`${item.date}-${item.title}-${i}`}>
                  <span>{item.date}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/* ---- Subida de soporte (archivo a Supabase Storage) ---- */
function FileUpload({
  value,
  onChange,
  onError,
}: {
  value: string;
  onChange: (path: string) => void;
  onError: (msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = value ? (value.split('/').pop() ?? value).replace(/^\d+-/, '') : '';

  async function onPick(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadSupport(file);
      onChange(path);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
      input.value = '';
    }
  }

  if (value) {
    return (
      <div className="upl-file">
        <Paperclip size={15} />
        <span className="upl-file__name">{fileName}</span>
        <button type="button" className="upl-file__x" onClick={() => onChange('')} aria-label="Quitar soporte">
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="upl" onClick={() => inputRef.current?.click()} disabled={uploading}>
      {uploading ? <span className="spinner spinner--sm" /> : <Upload size={16} />}
      {uploading ? 'Subiendo…' : 'Subir foto, PDF o archivo'}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"
        hidden
        onChange={(e) => onPick(e.currentTarget)}
      />
    </button>
  );
}

/* ---- Vista/descarga de un soporte (resuelve signed URL) ---- */
function SupportFile({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const isImage = /\.(png|jpe?g|gif|webp|heic|avif)$/i.test(path);
  useEffect(() => {
    let alive = true;
    supportUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [path]);

  if (err) return <p className="muted-line">No se pudo cargar el soporte.</p>;
  if (!url)
    return (
      <div className="view-loading" style={{ padding: '20px 0' }}>
        <span className="spinner spinner--sm" />
      </div>
    );
  return (
    <div className="support-file">
      {isImage && (
        <a href={url} target="_blank" rel="noreferrer" className="support-file__img">
          <img src={url} alt="Soporte" />
        </a>
      )}
      <a className="btn btn--primary btn--block" href={url} target="_blank" rel="noreferrer" download>
        <Download size={16} /> {isImage ? 'Descargar imagen' : 'Ver / descargar soporte'}
      </a>
    </div>
  );
}

function SupportSheet({ movement, onClose }: { movement: FinanceMovement; onClose: () => void }) {
  return (
    <Sheet eyebrow="Soporte del movimiento" title={movement.concept} onClose={onClose}>
      <div className="sheet__hero">
        <div>
          <span>
            {movement.person} · {formatDate(movement.date)}
          </span>
          <strong>{formatCurrency(movement.value)}</strong>
          <span>
            {movement.costCenter} · {movement.paymentMethod}
          </span>
        </div>
        <Badge label={movement.status} tone={statusTone(movement.status)} />
      </div>

      <div className="sheet__section">
        <div className="label">
          <Paperclip size={17} /> Soporte
        </div>
        {movement.attachmentUrl ? (
          <SupportFile path={movement.attachmentUrl} />
        ) : (
          <p className="muted-line">Sin soporte adjunto.</p>
        )}
      </div>

      {movement.note && (
        <div className="next-steps" style={{ marginTop: 16 }}>
          <strong>Nota</strong>
          <span>{movement.note}</span>
        </div>
      )}
    </Sheet>
  );
}

/* ============================================================
   PRESCRIBE SHEET — recetar = checkout (command palette + RxCards)
   ============================================================ */
interface RxUiLine {
  uid: string;
  product_id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: number | null;
  quantity: number;
  unit_price: number;
  stock: number;
  signal: 'ok' | 'warn' | 'danger';
  unitCost: number;
  instructions?: string;
}

function PrescribeSheet({
  patient,
  onClose,
  onDone,
  onError,
}: {
  patient: Patient;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [lines, setLines] = useState<RxUiLine[]>([]);
  const [method, setMethod] = useState<string>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('healen_pay')) || 'efectivo',
  );
  const [paid, setPaid] = useState<number | null>(null); // null = pago completo
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrescribeResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // el catálogo es el núcleo del cobro; los planes son secundarios (sólo chips).
    // Se cargan por separado para que un fallo de planes no deje el catálogo vacío.
    fetchCatalog()
      .then(setCatalog)
      .catch(() => onError('No se pudo cargar el catálogo.'));
    fetchPlans()
      .then(setPlans)
      .catch(() => {
        /* sin planes: recetar sigue funcionando, sólo no se muestran los chips */
      });
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const results = q
    ? catalog.filter((c) => `${c.name} ${c.category}`.toLowerCase().includes(q)).slice(0, 6)
    : [];
  useEffect(() => setHighlight(0), [query]);

  const total = lines.reduce((t, l) => t + l.quantity * l.unit_price, 0);
  const estCogs = lines.reduce((t, l) => t + l.quantity * l.unitCost, 0);
  const estMargin = total - estCogs;
  const marginPct = total > 0 ? Math.round((estMargin / total) * 100) : 0;
  const marginSignal: 'ok' | 'warn' | 'danger' = marginPct >= 50 ? 'ok' : marginPct >= 25 ? 'warn' : 'danger';
  // sólo las líneas con producto consumen inventario; las indicaciones (producto borrado) no topan ni bloquean
  const shortage = lines.some((l) => l.product_id && l.quantity > l.stock);
  const payAmount = paid == null ? total : Math.max(0, Math.min(paid, total));
  const canConfirm = lines.length > 0 && !shortage && !busy;

  function addProduct(c: CatalogItem) {
    if (c.signal === 'danger' || c.stock <= 0) return;
    setLines((prev) => [
      ...prev,
      {
        uid: `${c.productId}-${prev.length}-${Date.now() % 100000}`,
        product_id: c.productId,
        name: c.name,
        dose: c.defaultDose || '',
        route: c.defaultRoute || 'subcutanea',
        frequency: c.defaultFrequency || 'semanal',
        duration_days: c.defaultDurationDays ?? 30,
        // cantidad inicial topada al stock disponible para no nacer en faltante
        quantity: Math.max(1, Math.min(c.defaultQuantity || 1, c.stock)),
        unit_price: c.salePrice,
        stock: c.stock,
        signal: c.signal,
        unitCost: c.unitCost,
      },
    ]);
    setQuery('');
    inputRef.current?.focus();
  }

  // aplica un plan: agrega sus líneas (append) con dedupe por product_id, resolviendo
  // precio/stock SIEMPRE contra el catálogo fresco (precio del día para líneas dinámicas).
  function applyPlan(pl: Plan) {
    // clave de dedupe: por product_id, y por nombre para las indicaciones (producto borrado, sin id)
    const keyOf = (pid: string, name: string) => pid || `ind:${name}`;
    setLines((prev) => {
      const present = new Set(prev.map((l) => keyOf(l.product_id, l.name)));
      const adds: RxUiLine[] = pl.items
        .filter((it) => !present.has(keyOf(it.product_id ?? '', it.name)))
        .map((it, i) => {
          const c = it.product_id ? catalog.find((x) => x.productId === it.product_id) : undefined;
          const stock = c?.stock ?? 0;
          const signal = c?.signal ?? 'danger';
          const unitCost = c?.unitCost ?? it.unit_cost ?? 0;
          const price = it.unit_price ?? c?.salePrice ?? it.sale_price ?? 0; // dinámico => precio del día
          return {
            uid: `${it.product_id ?? 'ind'}-plan-${pl.id}-${i}-${Date.now() % 100000}`,
            product_id: it.product_id ?? '',
            name: it.name,
            dose: it.dose ?? '',
            route: it.route ?? 'subcutanea',
            frequency: it.frequency ?? 'semanal',
            duration_days: it.duration_days ?? 30,
            // se preserva la cantidad del plan; sólo se topa al stock cuando hay producto Y stock real
            quantity: it.product_id && stock > 0 ? Math.max(1, Math.min(it.quantity, stock)) : it.quantity,
            unit_price: price,
            stock,
            signal,
            unitCost,
            instructions: it.instructions ?? '',
          };
        });
      return [...prev, ...adds];
    });
    setQuery('');
    inputRef.current?.focus();
  }

  function patch(uid: string, p: Partial<RxUiLine>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...p } : l)));
  }
  function remove(uid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) addProduct(results[highlight]);
    } else if (e.key === 'Backspace' && query === '' && lines.length > 0) {
      setLines((prev) => prev.slice(0, -1));
    }
  }

  async function confirm() {
    if (!canConfirm) return;
    if (!patient.clientUuid) {
      onError('Paciente sin identificador; recarga e intenta de nuevo.');
      return;
    }
    setBusy(true);
    try {
      const res = await prescribeCheckout({
        clientUuid: patient.clientUuid,
        treatmentId: patient.treatmentId ?? null,
        items: lines.map((l) => ({
          product_id: l.product_id,
          name: l.name,
          dose: l.dose,
          route: l.route,
          frequency: l.frequency,
          duration_days: l.duration_days,
          quantity: l.quantity,
          unit_price: l.unit_price,
          instructions: l.instructions || undefined,
        })),
        charge: true,
        payment: payAmount,
        method,
      });
      if (typeof localStorage !== 'undefined') localStorage.setItem('healen_pay', method);
      setBusy(false);
      setResult(res);
      window.setTimeout(() => onDone('Receta activa · venta registrada'), REDUCED ? 0 : 1100);
    } catch (e) {
      setBusy(false);
      onError((e as Error).message || 'No se pudo registrar la receta.');
    }
  }

  // ⌘/Ctrl+Enter confirma · Esc cierra. confirm() vive en un ref para no
  // re-suscribir el listener en cada render ni capturar un closure viejo.
  const confirmRef = useRef<() => void>(() => {});
  confirmRef.current = confirm;
  useEffect(() => {
    function onWinKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        confirmRef.current();
      }
    }
    window.addEventListener('keydown', onWinKey);
    return () => window.removeEventListener('keydown', onWinKey);
  }, [onClose]);

  const signal = overallSignal(patient);
  const counts = patientSignalCounts(patient);

  // Atrapa Tab dentro del sheet (a11y: el foco no se escapa al dashboard de atrás).
  function trapTab(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab') return;
    const f = e.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]',
    );
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Recetar a ${patient.name}`}>
      <article className="sheet sheet--rx" onClick={(e) => e.stopPropagation()} onKeyDown={trapTab}>
        <span className="sheet__grab" />
        <header className="sheet__head">
          <div>
            <span className="eyebrow">Recetar</span>
            <h3>{patient.name}</h3>
          </div>
          <button className="btn btn--icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>

        <div className={`rx-hero rx-hero--${signal}`}>
          <div className="rx-hero__id">
            <span className="rx-hero__meta">
              {patient.id} · {patient.tier} · {patient.plan}
            </span>
            <strong>Receta nueva</strong>
            <span className="rx-hero__hint">Defaults clínicos listos. Escribe, ajusta y cobra.</span>
          </div>
          <div className="rx-hero__status">
            <span className={`rx-hero__verdict rx-hero__verdict--${signal}`}>{verdictPhrase(patient)}</span>
            <SignalSummary counts={counts} />
          </div>
        </div>

        {/* Aplicar un plan: carga todas sus líneas de un clic */}
        {plans.filter((p) => p.itemCount > 0).length > 0 && (
          <div className="rx-plans">
            <span className="rx-plans__label">Aplicar plan</span>
            <div className="rx-plans__chips">
              {plans
                .filter((p) => p.itemCount > 0)
                .map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    className="rx-plan-chip"
                    onClick={() => applyPlan(pl)}
                    title={`${pl.itemCount} productos · ${pl.hasDynamicPrice ? '~' : ''}${formatCurrency(pl.totalEstimated)}`}
                  >
                    <ClipboardList size={14} /> {pl.name} <em>{pl.itemCount}</em>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Barra de comando */}
        <div className="rx-cmdbar">
          <Syringe size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Buscar péptido, suero o insumo…"
            aria-label="Buscar producto para recetar"
          />
          <kbd className="rx-kbd">↵</kbd>
        </div>

        {results.length > 0 && (
          <div className="rx-results">
            {results.map((c, i) => {
              const out = c.signal === 'danger' || c.stock <= 0;
              return (
                <button
                  key={c.productId}
                  className={`rx-result${i === highlight ? ' is-active' : ''}${out ? ' is-out' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => addProduct(c)}
                  disabled={out}
                >
                  <span className={`dot dot--${c.signal}`} />
                  <div className="rx-result__main">
                    <strong>{c.name}</strong>
                    <span className="rx-result__defaults">
                      {[c.defaultDose, c.defaultRoute, c.defaultFrequency, c.defaultDurationDays ? `${c.defaultDurationDays} días` : null]
                        .filter(Boolean)
                        .join(' · ') || c.category}
                    </span>
                  </div>
                  <div className="rx-result__meta">
                    <span className="tnum">{formatCurrency(c.salePrice)}</span>
                    <span>{out ? 'sin stock' : `${c.stock} ${c.unit}`}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Receta en curso */}
        <div className="rx-lines">
          {lines.length === 0 ? (
            <div className="rx-empty">
              <Syringe size={22} />
              <p>Escribe arriba para recetar. Cada producto trae dosis, vía, frecuencia y duración listas.</p>
            </div>
          ) : (
            lines.map((l) => {
              const short = !!l.product_id && l.quantity > l.stock;
              return (
                <article className="rx-card" key={l.uid}>
                  <div className="rx-card__top">
                    <span className={`dot dot--${short ? 'danger' : l.signal}`} />
                    <strong>{l.name}</strong>
                    <span className="rx-card__price tnum">{formatCurrency(l.quantity * l.unit_price)}</span>
                    <button className="btn btn--icon rx-card__x" onClick={() => remove(l.uid)} aria-label="Quitar">
                      <X size={15} />
                    </button>
                  </div>
                  <div className="rx-card__fields">
                    <label className="rx-field">
                      <span>Dosis</span>
                      <input value={l.dose} onChange={(e) => patch(l.uid, { dose: e.target.value })} placeholder="250 mg" />
                    </label>
                    <label className="rx-field">
                      <span>Vía</span>
                      <select value={l.route} onChange={(e) => patch(l.uid, { route: e.target.value })}>
                        {ROUTES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rx-field">
                      <span>Frecuencia</span>
                      <select value={l.frequency} onChange={(e) => patch(l.uid, { frequency: e.target.value })}>
                        {FREQS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rx-field rx-field--sm">
                      <span>Días</span>
                      <input
                        type="number"
                        min="0"
                        max="365"
                        value={l.duration_days ?? ''}
                        onChange={(e) =>
                          patch(l.uid, {
                            duration_days: e.target.value ? Math.min(365, Math.max(0, Number(e.target.value))) : null,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="rx-card__foot">
                    <div className="rx-stepper">
                      <button onClick={() => patch(l.uid, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Menos">
                        <Minus size={15} />
                      </button>
                      <span className="tnum">{l.quantity}</span>
                      <button
                        onClick={() => patch(l.uid, { quantity: Math.min(l.quantity + 1, Math.max(l.stock, 1)) })}
                        disabled={l.quantity >= l.stock}
                        aria-label="Más"
                      >
                        <Plus size={15} />
                      </button>
                      <em>{l.unit_price ? `${formatCurrency(l.unit_price)} c/u` : ''}</em>
                    </div>
                    {short ? (
                      <span className="badge badge--danger">Faltan {l.quantity - l.stock}</span>
                    ) : (
                      <span className="rx-card__stock">{l.stock} en stock</span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Barra de checkout */}
        <div className={`rx-checkout${result ? ' is-done' : ''}`}>
          {result ? (
            <div className="rx-done">
              <span className="rx-check" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              </span>
              <div>
                <strong>Receta activa · venta registrada</strong>
                <span>
                  {result.code} · margen {formatCurrency(result.margin)}
                  {result.balance > 0 ? ` · saldo ${formatCompact(result.balance)} a cartera` : ''}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="rx-checkout__top">
                <div className="rx-checkout__total">
                  <span>Total</span>
                  <strong className="tnum">
                    <CountUp value={total} format={formatCurrency} />
                  </strong>
                </div>
                <span
                  className={`rx-margin rx-margin--${marginSignal}`}
                  title="Margen estimado sobre el costo del lote actual; el definitivo se calcula al cobrar."
                >
                  {marginPct}% margen est.
                </span>
              </div>
              <div className="rx-pay">
                {PAY_METHODS.map((m) => (
                  <button
                    key={m.id}
                    className={`rx-pay__chip${method === m.id ? ' is-active' : ''}`}
                    onClick={() => setMethod(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="rx-checkout__foot">
                <label className="rx-paid">
                  <span>Abonado</span>
                  <input
                    type="number"
                    min="0"
                    value={paid == null ? '' : paid}
                    placeholder={formatCurrency(total)}
                    onChange={(e) => setPaid(e.target.value === '' ? null : Number(e.target.value))}
                  />
                  {payAmount < total && <em>Saldo {formatCompact(total - payAmount)} a cartera</em>}
                </label>
                <button className="btn btn--primary rx-cta" onClick={confirm} disabled={!canConfirm}>
                  <Check size={18} />
                  {busy ? 'Recetando…' : 'Recetar y cobrar'}
                  <kbd className="rx-kbd rx-kbd--light">⌘↵</kbd>
                </button>
              </div>
            </>
          )}
        </div>
      </article>
    </div>
  );
}
