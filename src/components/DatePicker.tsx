// DatePicker branded con popover animado (framer-motion). Controlado por ISO yyyy-mm-dd.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s: string): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Seleccionar fecha',
  max,
  min,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  max?: string;
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const [view, setView] = useState<Date>(() => selected ?? new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && selected) setView(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const y = view.getFullYear();
  const m = view.getMonth();
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array<null>(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const today = toISO(new Date());
  const maxISO = max ? toISO(parseISO(max) ?? new Date()) : null;
  const minISO = min ? toISO(parseISO(min) ?? new Date()) : null;

  const label = selected
    ? selected.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="dp" ref={ref}>
      <button type="button" className={`dp__field${value ? '' : ' is-empty'}`} onClick={() => setOpen((o) => !o)}>
        <Calendar size={16} />
        <span>{label || placeholder}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="dp__pop"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="dp__head">
              <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <strong>
                {MONTHS[m]} {y}
              </strong>
              <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="dp__dow">
              {DOW.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="dp__grid">
              {cells.map((day, i) => {
                if (day == null) return <span key={i} className="dp__cellempty" />;
                const iso = toISO(new Date(y, m, day));
                const disabled = (maxISO != null && iso > maxISO) || (minISO != null && iso < minISO);
                return (
                  <button
                    type="button"
                    key={i}
                    disabled={disabled}
                    className={`dp__day${iso === value ? ' is-sel' : ''}${iso === today ? ' is-today' : ''}`}
                    onClick={() => {
                      onChange(iso);
                      setOpen(false);
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="dp__foot">
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(today);
                  setOpen(false);
                }}
              >
                Hoy
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
