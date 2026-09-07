import { describe, expect, it } from 'vitest';
import { closuresForRange } from './closure-ranges';

type Row = { id: string; date: string; salesTotal: number };

const rows: Row[] = [
  { id: 'jan-15', date: '2026-01-15', salesTotal: 1_000_000 },
  { id: 'aug-31', date: '2026-08-31', salesTotal: 5_500_000 },
  { id: 'sep-01', date: '2026-09-01', salesTotal: 7_300_000 },
  { id: 'sep-02', date: '2026-09-02', salesTotal: 4_500_000 },
];

describe('closure date-range filtering', () => {
  it('shows all closures and orders newest first when Todo is selected', () => {
    expect(closuresForRange(rows, { from: '', to: '' }).map((row) => row.id)).toEqual([
      'sep-02',
      'sep-01',
      'aug-31',
      'jan-15',
    ]);
  });

  it('keeps August out of the September month range', () => {
    const september = closuresForRange(rows, { from: '2026-09-01', to: '2026-09-30' });
    expect(september.map((row) => row.id)).toEqual(['sep-02', 'sep-01']);
    expect(september.reduce((sum, row) => sum + row.salesTotal, 0)).toBe(11_800_000);
  });

  it('supports year and custom date ranges', () => {
    expect(closuresForRange(rows, { from: '2026-01-01', to: '2026-12-31' })).toHaveLength(4);
    expect(closuresForRange(rows, { from: '2026-08-31', to: '2026-09-01' }).map((row) => row.id)).toEqual([
      'sep-01',
      'aug-31',
    ]);
  });
});
