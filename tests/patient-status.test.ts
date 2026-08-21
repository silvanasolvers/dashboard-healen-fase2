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

describe('active service plans without a confirmed end date', () => {
  const fourSerumPlan: Patient = {
    ...finalizedService,
    id: 'HLN-249',
    clientUuid: 'client-maria-victoria',
    treatmentId: 'treatment-four-serums',
    name: 'María Victoria López',
    plan: 'Plan de 4 sueros',
    saleValue: 1400000,
    status: 'Activo',
  };

  it('does not label a service plan as recompra only because it has no end date', () => {
    expect(patientEvolutionLabel(fourSerumPlan)).toBe('Plan de servicio activo');
  });

  it('asks to program sessions instead of suggesting a recompra', () => {
    expect(patientNextAction(fourSerumPlan)).toBe('Programar y registrar cada sesión del plan.');
  });
});
