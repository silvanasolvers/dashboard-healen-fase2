import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardList,
  Clock3,
  RefreshCw,
  Send,
  UserCheck,
} from 'lucide-react';
import {
  fetchPortalCheckinOperations,
  type PortalCheckinOperation,
  type PortalCheckinScope,
  updatePortalCheckin,
} from './api';

type Props = {
  notify: (message: string, error?: boolean) => void;
  onOpenPatient?: (clientId: string) => void;
  previewSnapshot?: Awaited<ReturnType<typeof fetchPortalCheckinOperations>>;
};

const scopes: Array<{ id: PortalCheckinScope; label: string }> = [
  { id: 'open', label: 'Pendientes' },
  { id: 'priority', label: 'Prioridad' },
  { id: 'reviewed', label: 'Revisados' },
  { id: 'all', label: 'Todos' },
];

const number = new Intl.NumberFormat('es-CO');
const dateTime = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

function metric(item: PortalCheckinOperation, key: string): string {
  const value = item.answers?.[key];
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '—';
}

function relativeDue(value: string | null): string {
  if (!value) return 'Sin vencimiento';
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  const amount = Math.abs(minutes);
  if (minutes < 0) return `Venció hace ${amount < 60 ? `${amount} min` : `${Math.round(amount / 60)} h`}`;
  if (minutes < 60) return `Vence en ${minutes} min`;
  return `Vence en ${Math.round(minutes / 60)} h`;
}

export function PortalOperations({ notify, onOpenPatient, previewSnapshot }: Props) {
  const [scope, setScope] = useState<PortalCheckinScope>('open');
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof fetchPortalCheckinOperations>> | null>(previewSnapshot ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (previewSnapshot) { setSnapshot(previewSnapshot); setSelectedId((current) => current ?? previewSnapshot.items[0]?.id ?? null); setLoading(false); return; }
    if (!quiet) setLoading(true);
    setError('');
    try {
      const next = await fetchPortalCheckinOperations(scope);
      setSnapshot(next);
      setSelectedId((current) => current && next.items.some((item) => item.id === current)
        ? current
        : next.items[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar la bandeja.');
    } finally {
      setLoading(false);
    }
  }, [previewSnapshot, scope]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => snapshot?.items.find((item) => item.id === selectedId) ?? null,
    [selectedId, snapshot],
  );

  useEffect(() => { setResponse(selected?.responseToPatient ?? ''); }, [selectedId]);

  async function act(action: 'assign_to_me' | 'review_complete' | 'dismiss') {
    if (!selected) return;
    if (previewSnapshot) { notify('Vista de prueba: la acción no modifica datos.'); return; }
    setBusy(true);
    try {
      await updatePortalCheckin(selected.id, action, response);
      notify(action === 'assign_to_me' ? 'Check-in asignado.' : action === 'review_complete' ? 'Revisión enviada al paciente.' : 'Check-in descartado.');
      await load(true);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No se pudo actualizar el check-in.', true);
    } finally {
      setBusy(false);
    }
  }

  const summary = snapshot?.summary ?? { open: 0, priority: 0, overdue: 0, reviewedToday: 0 };
  const closed = selected?.reviewStatus === 'reviewed' || selected?.reviewStatus === 'dismissed';

  return (
    <section className="portal-ops" aria-labelledby="portal-ops-title">
      <header className="portal-ops__intro" data-reveal>
        <div>
          <h2 id="portal-ops-title">Seguimiento del portal</h2>
          <p>Revisa señales del paciente, deja una respuesta clínica y valida la evolución desde un solo lugar.</p>
        </div>
        <button className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'is-spinning' : ''} /> Actualizar
        </button>
      </header>

      <div className="portal-ops__pulse" data-reveal aria-label="Resumen de operación">
        <article><span>Pendientes</span><strong>{number.format(summary.open)}</strong></article>
        <article className={summary.priority ? 'is-urgent' : ''}><span>Prioridad clínica</span><strong>{number.format(summary.priority)}</strong></article>
        <article className={summary.overdue ? 'is-overdue' : ''}><span>Fuera de tiempo</span><strong>{number.format(summary.overdue)}</strong></article>
        <article><span>Revisados hoy</span><strong>{number.format(summary.reviewedToday)}</strong></article>
      </div>

      <div className="portal-ops__filters" data-reveal role="tablist" aria-label="Filtrar check-ins">
        {scopes.map((item) => (
          <button key={item.id} role="tab" aria-selected={scope === item.id} className={scope === item.id ? 'is-active' : ''} onClick={() => setScope(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="portal-ops__state portal-ops__state--error" role="alert" data-reveal>
          <AlertTriangle size={22} /><strong>No pudimos abrir la bandeja</strong><span>{error}</span>
          <button className="btn btn--soft" onClick={() => void load()}>Intentar de nuevo</button>
        </div>
      )}

      {!error && loading && (
        <div className="portal-ops__state" aria-live="polite"><span className="spinner" /><strong>Preparando seguimiento…</strong></div>
      )}

      {!error && !loading && snapshot?.items.length === 0 && (
        <div className="portal-ops__state" data-reveal>
          <Check size={24} /><strong>Todo está al día</strong><span>No hay check-ins en este filtro.</span>
        </div>
      )}

      {!error && !loading && snapshot && snapshot.items.length > 0 && (
        <div className="portal-ops__workspace" data-reveal>
          <div className="portal-ops__queue" role="list" aria-label="Check-ins">
            {snapshot.items.map((item) => (
              <button
                key={item.id}
                role="listitem"
                className={`portal-checkin${selectedId === item.id ? ' is-active' : ''}${item.reviewStatus === 'escalated' ? ' is-urgent' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="portal-checkin__status" aria-hidden="true" />
                <span className="portal-checkin__body">
                  <span className="portal-checkin__top"><strong>{item.patientName}</strong><time>{dateTime.format(new Date(item.createdAt))}</time></span>
                  <span className="portal-checkin__metrics">Energía {metric(item, 'energy')}/10 · Sueño {metric(item, 'sleep')}/10 · Molestia {metric(item, 'pain')}/10</span>
                  <span className={`portal-checkin__due${item.isOverdue ? ' is-overdue' : ''}`}><Clock3 size={13} /> {relativeDue(item.dueAt)}</span>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>

          {selected && (
            <article className="portal-review" aria-live="polite">
              <header className="portal-review__head">
                <div>
                  <span className={`portal-review__priority portal-review__priority--${selected.reviewStatus === 'escalated' ? 'urgent' : selected.reviewStatus}`}>
                    {selected.reviewStatus === 'escalated' ? 'Prioridad clínica' : selected.reviewStatus === 'reviewed' ? 'Revisado' : selected.reviewStatus === 'dismissed' ? 'Descartado' : 'Seguimiento normal'}
                  </span>
                  <h3>{selected.patientName}</h3>
                  <p>{selected.patientCode || 'Sin código'} · recibido {dateTime.format(new Date(selected.createdAt))}</p>
                </div>
                {onOpenPatient && <button className="btn btn--ghost" onClick={() => onOpenPatient(selected.clientId)}>Abrir ficha</button>}
              </header>

              <dl className="portal-review__signals">
                <div><dt>Energía</dt><dd>{metric(selected, 'energy')}<small>/10</small></dd></div>
                <div><dt>Sueño</dt><dd>{metric(selected, 'sleep')}<small>/10</small></dd></div>
                <div><dt>Molestia</dt><dd>{metric(selected, 'pain')}<small>/10</small></dd></div>
              </dl>

              {selected.alarmFlags.length > 0 && (
                <div className="portal-review__alert" role="alert"><AlertTriangle size={18} /><div><strong>Requiere contacto prioritario</strong><span>El paciente pidió contacto o reportó molestia alta.</span></div></div>
              )}

              <div className="portal-review__context">
                <h4>Contexto enviado</h4>
                <p>{String(selected.answers.note ?? selected.answers.message ?? 'El paciente no agregó observaciones.')}</p>
              </div>

              <div className="portal-review__owner">
                <UserCheck size={17} />
                <span>{selected.assignedName ? `Responsable: ${selected.assignedName}` : 'Aún no tiene responsable'}</span>
                {!selected.assignedName && !closed && <button onClick={() => void act('assign_to_me')} disabled={busy}>Asignarme</button>}
              </div>

              <label className="portal-review__response">
                <span>Respuesta para el paciente</span>
                <textarea
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder="Resume la lectura y explica el siguiente paso con lenguaje claro."
                  rows={5}
                  maxLength={1200}
                  disabled={closed}
                />
                <small>{response.length}/1200 · se publicará en Progreso</small>
              </label>

              <footer className="portal-review__actions">
                {closed ? (
                  <span className="portal-review__closed"><Check size={16} /> Cerrado {selected.reviewedAt ? dateTime.format(new Date(selected.reviewedAt)) : ''}</span>
                ) : (
                  <>
                    <button className="btn btn--ghost" onClick={() => void act('dismiss')} disabled={busy}><ClipboardList size={16} /> Descartar</button>
                    <button className="btn btn--primary" onClick={() => void act('review_complete')} disabled={busy || response.trim().length < 10}><Send size={16} /> {busy ? 'Guardando…' : 'Validar y responder'}</button>
                  </>
                )}
              </footer>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export function PortalOperationsPreview() {
  const createdAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  return <PortalOperations notify={() => undefined} onOpenPatient={() => undefined} previewSnapshot={{
    summary: { open: 7, priority: 2, overdue: 1, reviewedToday: 11 },
    items: [
      {
        id: 'preview-priority', clientId: 'preview-client', patientCode: 'HLN-214', patientName: 'Valentina Demo', patientPhone: '+573000000000',
        reviewStatus: 'escalated', priority: 'urgent', answers: { energy: 4, sleep: 5, pain: 8, note: 'Dolor lumbar más intenso desde anoche. Solicito que el equipo me contacte.' },
        alarmFlags: ['patient_requested_contact_or_high_pain'], assignedTo: null, assignedName: null, assignedAt: null,
        dueAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), createdAt, reviewedAt: null, responseToPatient: null, isOverdue: true,
      },
      {
        id: 'preview-routine', clientId: 'preview-client-2', patientCode: 'HLN-188', patientName: 'Gabriel Piedrahita', patientPhone: '+573000000001',
        reviewStatus: 'pending', priority: 'routine', answers: { energy: 8, sleep: 7, pain: 2 }, alarmFlags: [],
        assignedTo: 'preview-staff', assignedName: 'Laura · Equipo clínico', assignedAt: createdAt,
        dueAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        reviewedAt: null, responseToPatient: null, isOverdue: false,
      },
    ],
  }} />;
}
