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
  PatientDossier,
  PatientProductAlert,
  patientSignalCounts,
  PatientSummary,
  Payee,
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
  addNote,
  CatalogItem,
  createPatient,
  deleteNote,
  fetchAll,
  fetchAnalytics,
  fetchCatalog,
  fetchDossier,
  fetchFinanceRows,
  fetchFinanceSummary,
  fetchPayees,
  financeEntry,
  supportUrl,
  uploadSupport,
  inventoryMovement,
  MovementRow,
  prescribeCheckout,
  PrescribeResult,
  updateClient,
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

const NAV: Array<{ id: View; label: string; short: string; icon: ElementType }> = [
  { id: 'inicio', label: 'Inicio', short: 'Hoy', icon: LayoutDashboard },
  { id: 'pacientes', label: 'Pacientes', short: 'Pacientes', icon: Users },
  { id: 'inventario', label: 'Inventario', short: 'Stock', icon: Package },
  { id: 'contabilidad', label: 'Caja', short: 'Caja', icon: Wallet },
  { id: 'reportes', label: 'Reportes', short: 'Reportes', icon: BarChart3 },
];

const VIEW_LEAD: Record<View, { eyebrow: string; title: string }> = {
  inicio: { eyebrow: 'Healen OS', title: 'Hoy en el centro' },
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
  const serumCount = patients.filter((p) => p.weeklySerum && p.status !== 'Finalizado').length;
  const finishingTreatments = patients.filter((p) => p.daysLeft <= 12 && p.status !== 'Finalizado').length;

  const filteredPatients = patients.filter((p) =>
    `${p.id} ${p.name} ${p.plan} ${p.tier}`.toLowerCase().includes(patientSearch.toLowerCase()),
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
                patients={patients}
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
  const urgent = [...patients].sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 4);
  const stockView = [...inventory]
    .sort((a, b) => a.stock / Math.max(a.minimum, 1) - b.stock / Math.max(b.minimum, 1))
    .slice(0, 4);
  const grown = useGrow();

  return (
    <>
      <section className="hero" data-reveal>
        <div className="hero__intro">
          <span className="eyebrow">Healen OS · Centro de mando</span>
          <h1>Quién está por terminar, qué falta y cuánto entró.</h1>
          <p>Un vistazo y sabes qué vender, qué reponer y a quién llamar. Sin perseguir datos en chats ni cuadernos.</p>
          <div className="hero__chips">
            <span className="hero__chip">
              <span className="dot dot--warn" />
              {finishingTreatments} por terminar
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
            <h2>Por terminar primero</h2>
            <button className="alert-card__more" onClick={() => go('pacientes')}>
              Ver todos <ChevronRight size={15} />
            </button>
          </div>
          <div className="today__rings">
            {urgent.map((p) => (
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar paciente, plan o ID" />
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
                        {p.id} · {p.plan}
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
  intent,
  onIntentDone,
}: {
  inventory: InventoryItem[];
  allInventory: InventoryItem[];
  movements: MovementRow[];
  addInventory: (p: ProductPayload) => Promise<boolean>;
  registerMovement: (p: StockMovePayload) => Promise<boolean>;
  intent: string | null;
  onIntentDone: () => void;
}) {
  const [productOpen, setProductOpen] = useState(false);
  const [move, setMove] = useState<{ item: InventoryItem | null; kind: 'Entrada' | 'Salida' } | null>(null);
  const grown = useGrow();
  const reveal = useScrollReveal(`${productOpen}`);

  useEffect(() => {
    if (intent === 'product') setProductOpen(true);
    else if (intent === 'stock') setMove({ item: null, kind: 'Salida' });
    if (intent === 'product' || intent === 'stock') onIntentDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

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
                <div key={item.id} className="inv-row">
                  <div className="inv-row__id">
                    <span className={`dot dot--${signal}`} />
                    <div>
                      <strong>{item.product}</strong>
                      <span>
                        {item.type} · {formatCurrency(item.unitCost)} ·{' '}
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
    </div>
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
  const [saving, setSaving] = useState(false);
  const canSubmit = product.trim() !== '' && !saving;

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
            <label className="mv__label">Proveedor</label>
            <input className="mv__input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Proveedor" />
          </div>
        </div>
        <div className="mv__row">
          <div className="mv__field">
            <label className="mv__label">Lote</label>
            <input className="mv__input" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Lote" />
          </div>
          <div className="mv__field">
            <label className="mv__label">Vencimiento</label>
            <DatePicker value={expiration} onChange={setExpiration} placeholder="Sin vencimiento" />
          </div>
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
  const [tab, setTab] = useState<'resumen' | 'notas' | 'historial' | 'dinero'>('resumen');
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
  function act(step: NextStep) {
    if (step.action === 'recetar' && onPrescribe) onPrescribe(patient);
    else go(step.target);
  }

  const TABS = [
    { id: 'resumen' as const, label: 'Resumen', icon: Activity, count: undefined as number | undefined },
    { id: 'notas' as const, label: 'Notas', icon: FileText, count: dossier?.notes.length },
    { id: 'historial' as const, label: 'Historial', icon: ClipboardList, count: dossier?.timeline.length },
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
    fetchCatalog().then(setCatalog).catch(() => onError('No se pudo cargar el catálogo.'));
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
  const shortage = lines.some((l) => l.quantity > l.stock);
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
              const short = l.quantity > l.stock;
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
