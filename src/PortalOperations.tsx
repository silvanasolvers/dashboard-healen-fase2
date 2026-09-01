import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  ClipboardList,
  Clock3,
  MapPin,
  RefreshCw,
  Send,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  fetchPortalAppointmentOperations,
  fetchPortalCheckinOperations,
  type PortalAppointmentOperation,
  type PortalAppointmentScope,
  type PortalCheckinOperation,
  type PortalCheckinScope,
  updatePortalAppointment,
  updatePortalCheckin,
} from './api';

type Props = {
  notify: (message: string, error?: boolean) => void;
  onOpenPatient?: (clientId: string) => void;
  previewSnapshot?: Awaited<ReturnType<typeof fetchPortalCheckinOperations>>;
  previewAppointmentSnapshot?: Awaited<ReturnType<typeof fetchPortalAppointmentOperations>>;
};

const scopes: Array<{ id: PortalCheckinScope; label: string }> = [
  { id: 'open', label: 'Pendientes' },
  { id: 'priority', label: 'Prioridad' },
  { id: 'reviewed', label: 'Revisados' },
  { id: 'all', label: 'Todos' },
];

const appointmentScopes: Array<{ id: PortalAppointmentScope; label: string }> = [
  { id: 'open', label: 'Pendientes' },
  { id: 'new', label: 'Nuevas' },
  { id: 'reschedule', label: 'Reprogramar' },
  { id: 'cancel', label: 'Cancelar' },
  { id: 'resolved', label: 'Resueltas' },
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

function CheckinOperations({ notify, onOpenPatient, previewSnapshot }: Props) {
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
    <section className="portal-ops" aria-labelledby="portal-checkins-title">
      <header className="portal-ops__intro" data-reveal>
        <div>
          <h2 id="portal-checkins-title">Seguimiento clínico</h2>
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
          <div className="portal-ops__queue" aria-label="Check-ins">
            {snapshot.items.map((item) => (
              <button
                key={item.id}
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

function appointmentTypeLabel(item: PortalAppointmentOperation): string {
  if (item.requestType === 'reschedule') return 'Reprogramación';
  if (item.requestType === 'cancel') return 'Cancelación';
  return 'Nueva cita';
}

function localDateTimeValue(value?: string | null): string {
  const date = value ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (!value) date.setHours(9, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialAppointmentResponse(item: PortalAppointmentOperation): string {
  if (item.staffResponse) return item.staffResponse;
  if (item.requestType === 'cancel') return 'Confirmamos la cancelación de tu cita. Si necesitas una nueva fecha, puedes solicitarla desde tu portal.';
  if (item.requestType === 'reschedule') return 'Reprogramamos tu cita. Revisa la nueva fecha y los detalles en tu agenda Healen.';
  return 'Programamos tu cita. Revisa la fecha y los detalles en tu agenda Healen.';
}

function AppointmentOperations({ notify, onOpenPatient, previewAppointmentSnapshot }: Omit<Props, 'previewSnapshot'>) {
  const [scope, setScope] = useState<PortalAppointmentScope>('open');
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof fetchPortalAppointmentOperations>> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ startsAt: localDateTimeValue(), duration: 60, service: 'Seguimiento Healen', location: 'Healen', response: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (previewAppointmentSnapshot) {
      setSnapshot(previewAppointmentSnapshot);
      setSelectedId((current) => current ?? previewAppointmentSnapshot.items[0]?.id ?? null);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError('');
    try {
      const next = await fetchPortalAppointmentOperations(scope);
      setSnapshot(next);
      setSelectedId((current) => current && next.items.some((item) => item.id === current)
        ? current
        : next.items[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar la agenda solicitada.');
    } finally {
      setLoading(false);
    }
  }, [previewAppointmentSnapshot, scope]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => snapshot?.items.find((item) => item.id === selectedId) ?? null,
    [selectedId, snapshot],
  );

  useEffect(() => {
    if (!selected) return;
    const duration = selected.appointment?.startsAt && selected.appointment?.endsAt
      ? Math.max(15, Math.round((new Date(selected.appointment.endsAt).getTime() - new Date(selected.appointment.startsAt).getTime()) / 60000))
      : 60;
    setForm({
      startsAt: localDateTimeValue(selected.appointment?.startsAt),
      duration,
      service: selected.appointment?.title || 'Seguimiento Healen',
      location: selected.appointment?.location || 'Healen',
      response: initialAppointmentResponse(selected),
    });
  }, [selectedId, selected]);

  async function act(action: 'assign_to_me' | 'accept' | 'decline') {
    if (!selected) return;
    if (previewAppointmentSnapshot) { notify('Vista de prueba: la acción no modifica datos.'); return; }
    setBusy(true);
    try {
      const startsAt = selected.requestType === 'cancel' ? undefined : new Date(form.startsAt).toISOString();
      const endsAt = startsAt ? new Date(new Date(startsAt).getTime() + form.duration * 60000).toISOString() : undefined;
      await updatePortalAppointment(selected.id, action, {
        startsAt,
        endsAt,
        service: form.service.trim(),
        location: form.location.trim(),
        response: form.response.trim(),
      });
      notify(action === 'assign_to_me' ? 'Solicitud asignada.' : action === 'accept' ? 'Solicitud resuelta y paciente notificado.' : 'Solicitud rechazada y paciente notificado.');
      await load(true);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'No se pudo resolver la solicitud.', true);
    } finally {
      setBusy(false);
    }
  }

  const summary = snapshot?.summary ?? { open: 0, new: 0, changes: 0, overdue: 0, resolvedToday: 0 };
  const closed = selected?.status !== 'pending';
  const requiresSchedule = selected?.requestType !== 'cancel';
  const canAccept = Boolean(selected) && form.response.trim().length >= 8 && (!requiresSchedule || (form.startsAt && form.service.trim().length > 1));

  return (
    <section className="portal-ops portal-appointments" aria-labelledby="portal-appointments-title">
      <header className="portal-ops__intro" data-reveal>
        <div>
          <h2 id="portal-appointments-title">Solicitudes de agenda</h2>
          <p>Programa, reprograma o cancela sin copiar datos: la decisión actualiza la agenda canónica y vuelve al portal del paciente.</p>
        </div>
        <button className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'is-spinning' : ''} /> Actualizar
        </button>
      </header>

      <div className="portal-ops__pulse" data-reveal aria-label="Resumen de solicitudes de agenda">
        <article><span>Pendientes</span><strong>{number.format(summary.open)}</strong></article>
        <article><span>Nuevas citas</span><strong>{number.format(summary.new)}</strong></article>
        <article><span>Cambios solicitados</span><strong>{number.format(summary.changes)}</strong></article>
        <article className={summary.overdue ? 'is-overdue' : ''}><span>Fuera de tiempo</span><strong>{number.format(summary.overdue)}</strong></article>
      </div>

      <div className="portal-ops__filters" data-reveal role="tablist" aria-label="Filtrar solicitudes de agenda">
        {appointmentScopes.map((item) => (
          <button key={item.id} role="tab" aria-selected={scope === item.id} className={scope === item.id ? 'is-active' : ''} onClick={() => setScope(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="portal-ops__state portal-ops__state--error" role="alert" data-reveal>
          <AlertTriangle size={22} /><strong>No pudimos abrir las solicitudes</strong><span>{error}</span>
          <button className="btn btn--soft" onClick={() => void load()}>Intentar de nuevo</button>
        </div>
      )}
      {!error && loading && <div className="portal-ops__state" aria-live="polite"><span className="spinner" /><strong>Preparando agenda…</strong></div>}
      {!error && !loading && snapshot?.items.length === 0 && (
        <div className="portal-ops__state" data-reveal><CalendarClock size={25} /><strong>Agenda al día</strong><span>No hay solicitudes en este filtro.</span></div>
      )}

      {!error && !loading && snapshot && snapshot.items.length > 0 && (
        <div className="portal-ops__workspace" data-reveal>
          <div className="portal-ops__queue" aria-label="Solicitudes de citas">
            {snapshot.items.map((item) => {
              const Icon = item.requestType === 'cancel' ? CalendarX : item.requestType === 'reschedule' ? CalendarClock : CalendarPlus;
              return (
                <button key={item.id} className={`portal-checkin portal-appointment-request${selectedId === item.id ? ' is-active' : ''}${item.isUrgent ? ' is-urgent' : ''}`} onClick={() => setSelectedId(item.id)}>
                  <span className="portal-appointment-request__icon"><Icon size={16} /></span>
                  <span className="portal-checkin__body">
                    <span className="portal-checkin__top"><strong>{item.patientName}</strong><time>{dateTime.format(new Date(item.createdAt))}</time></span>
                    <span className="portal-checkin__metrics">{appointmentTypeLabel(item)} · {item.preferredWindow || 'Sin franja indicada'}</span>
                    <span className={`portal-checkin__due${item.isOverdue ? ' is-overdue' : ''}`}><Clock3 size={13} /> {item.status === 'pending' ? relativeDue(item.dueAt) : `Resuelta ${item.resolvedAt ? dateTime.format(new Date(item.resolvedAt)) : ''}`}</span>
                  </span>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>

          {selected && (
            <article className="portal-review portal-appointment-review" aria-live="polite">
              <header className="portal-review__head">
                <div>
                  <span className={`portal-review__priority${selected.isUrgent ? ' portal-review__priority--urgent' : selected.status === 'accepted' ? ' portal-review__priority--reviewed' : selected.status === 'declined' ? ' portal-review__priority--dismissed' : ''}`}>
                    {selected.isUrgent ? 'Próxima en menos de 24 h' : appointmentTypeLabel(selected)}
                  </span>
                  <h3>{selected.patientName}</h3>
                  <p>{selected.patientCode || 'Sin código'} · {selected.patientPhone || selected.patientEmail || 'Sin contacto registrado'}</p>
                </div>
                {onOpenPatient && <button className="btn btn--ghost" onClick={() => onOpenPatient(selected.clientId)}>Abrir ficha</button>}
              </header>

              <div className="portal-appointment-review__request">
                <div><span>Preferencia del paciente</span><strong>{selected.preferredWindow || 'No indicó una franja'}</strong></div>
                <p>{selected.message || 'No agregó observaciones.'}</p>
              </div>

              {selected.appointment && (
                <div className="portal-appointment-review__current">
                  <CalendarClock size={18} />
                  <div><span>Cita actual</span><strong>{dateTime.format(new Date(selected.appointment.startsAt))} · {selected.appointment.title}</strong></div>
                  {selected.appointment.location && <small><MapPin size={13} /> {selected.appointment.location}</small>}
                </div>
              )}

              {!closed && requiresSchedule && (
                <div className="portal-appointment-form">
                  <label><span>Fecha y hora confirmadas</span><input type="datetime-local" value={form.startsAt} min={localDateTimeValue(new Date(Date.now() + 10 * 60 * 1000).toISOString())} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label>
                  <label><span>Duración</span><select value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hora</option><option value={90}>1 h 30</option><option value={120}>2 horas</option></select></label>
                  <label><span>Servicio</span><input value={form.service} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, service: event.target.value }))} /></label>
                  <label><span>Lugar</span><input value={form.location} maxLength={200} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Healen o enlace virtual" /></label>
                </div>
              )}

              <div className="portal-review__owner">
                <UserCheck size={17} />
                <span>{selected.assignedName ? `Responsable: ${selected.assignedName}` : 'Aún no tiene responsable'}</span>
                {!selected.assignedName && !closed && <button onClick={() => void act('assign_to_me')} disabled={busy}>Asignarme</button>}
              </div>

              <label className="portal-review__response">
                <span>Respuesta para el paciente</span>
                <textarea value={form.response} onChange={(event) => setForm((current) => ({ ...current, response: event.target.value }))} rows={4} maxLength={1200} disabled={closed} />
                <small>{form.response.length}/1200 · aparecerá en la actividad del portal</small>
              </label>

              <footer className="portal-review__actions">
                {closed ? (
                  <span className="portal-review__closed"><Check size={16} /> {selected.status === 'declined' ? 'Solicitud rechazada' : 'Solicitud resuelta'} {selected.resolvedAt ? dateTime.format(new Date(selected.resolvedAt)) : ''}</span>
                ) : (
                  <>
                    <button className="btn btn--ghost" onClick={() => void act('decline')} disabled={busy || form.response.trim().length < 8}><XCircle size={16} /> No aceptar</button>
                    <button className="btn btn--primary" onClick={() => void act('accept')} disabled={busy || !canAccept}><Send size={16} /> {busy ? 'Guardando…' : selected.requestType === 'cancel' ? 'Confirmar cancelación' : selected.requestType === 'reschedule' ? 'Guardar nueva fecha' : 'Programar cita'}</button>
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

export function PortalOperations(props: Props) {
  const [area, setArea] = useState<'checkins' | 'appointments'>('checkins');
  return (
    <div className="portal-hub">
      <header className="portal-hub__header" data-reveal>
        <div><h2>Operación del portal</h2><p>Todo lo que el paciente envía llega aquí con responsable, tiempo de respuesta y trazabilidad.</p></div>
        <div className="portal-hub__switch" role="tablist" aria-label="Área operativa">
          <button role="tab" aria-selected={area === 'checkins'} className={area === 'checkins' ? 'is-active' : ''} onClick={() => setArea('checkins')}><ClipboardList size={17} /> Check-ins</button>
          <button role="tab" aria-selected={area === 'appointments'} className={area === 'appointments' ? 'is-active' : ''} onClick={() => setArea('appointments')}><CalendarClock size={17} /> Citas</button>
        </div>
      </header>
      {area === 'checkins' ? <CheckinOperations {...props} /> : <AppointmentOperations notify={props.notify} onOpenPatient={props.onOpenPatient} previewAppointmentSnapshot={props.previewAppointmentSnapshot} />}
    </div>
  );
}

export function PortalOperationsPreview() {
  const createdAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  return <PortalOperations notify={() => undefined} onOpenPatient={() => undefined} previewAppointmentSnapshot={{
    summary: { open: 4, new: 2, changes: 2, overdue: 1, resolvedToday: 6 },
    items: [
      {
        id: 'appointment-request-preview', clientId: 'preview-client', patientCode: 'HLN-214', patientName: 'Valentina Demo', patientPhone: '+57 300 000 0000', patientEmail: 'valentina@ejemplo.com',
        requestType: 'reschedule', status: 'pending', preferredWindow: '2026-09-04 · Mañana', message: 'Si es posible, prefiero la primera hora de la mañana.',
        assignedTo: null, assignedName: null, assignedAt: null, dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), createdAt, staffResponse: null, resolvedAt: null, resolvedByName: null,
        isOverdue: false, isUrgent: true, appointment: { id: 'appointment-preview', title: 'Control de seguimiento', startsAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(), endsAt: new Date(Date.now() + 21 * 60 * 60 * 1000).toISOString(), location: 'Healen', status: 'programada' },
      },
      {
        id: 'appointment-request-preview-2', clientId: 'preview-client-2', patientCode: 'HLN-188', patientName: 'Gabriel Piedrahita', patientPhone: '+57 300 000 0001', patientEmail: null,
        requestType: 'new', status: 'pending', preferredWindow: '2026-09-08 · Tarde', message: null,
        assignedTo: 'preview-staff', assignedName: 'Laura · Recepción', assignedAt: createdAt, dueAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), createdAt, staffResponse: null, resolvedAt: null, resolvedByName: null,
        isOverdue: false, isUrgent: false, appointment: null,
      },
    ],
  }} previewSnapshot={{
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
