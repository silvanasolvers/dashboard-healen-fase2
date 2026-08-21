import { describe, expect, it } from 'vitest';

import { patientEvolutionLabel, patientNextAction } from '../src/patient-status';
import type { Patient } from '../src/data';

const finalizedService: Patient = {
  id: 'HLN-015',
  clientUuid: 'client-margarita',
  treatmentId: 'treatment-margarita',
  name: 'Margarita Londoño',
  plan: 'Atención realizada · Biopuntura de colon + sueroterapia de detoxificación',
  saleValue: 480000,
  tier: 'Basico',
  startDate: '2026-08-20',
  endDate: '2026-08-20',
  daysLeft: 0,
  totalDays: 1,
  weeklySerum: false,
  serumDay: '-',
  status: 'Finalizado',
  peptides: [],
};

describe('finalized patient visibility', () => {
  it('labels a completed one-day service as finalized instead of recompra', () => {
    expect(patientEvolutionLabel(finalizedService)).toBe('Atención finalizada');
  });

  it('does not create a recompra action for a completed service', () => {
    expect(patientNextAction(finalizedService)).toBe('Servicio finalizado · sin alerta de recompra.');
  });
});
