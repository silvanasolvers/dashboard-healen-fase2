import { mostUrgentPeptide, type Patient } from './data';

export function treatmentProgress(patient: Patient): number {
  const elapsed = Math.max(0, patient.totalDays - patient.daysLeft);
  return Math.round(Math.min(100, Math.max(0, (elapsed / Math.max(patient.totalDays, 1)) * 100)));
}

function isServicePlan(patient: Patient): boolean {
  return /(suero|nebuliza|biopuntura|consulta|procedimiento)/i.test(patient.plan);
}

export function patientEvolutionLabel(patient: Patient): string {
  if (patient.status === 'Finalizado') return 'Atención finalizada';
  if (isServicePlan(patient)) return 'Plan de servicio activo';

  const progress = treatmentProgress(patient);
  if (patient.status === 'Por finalizar' || patient.daysLeft <= 5) return `Cierre / recompra · ${progress}%`;
  if (patient.daysLeft <= 12) return `Control cercano · ${progress}%`;
  return `En evolución · ${progress}%`;
}

export function patientNextAction(patient: Patient): string {
  if (patient.status === 'Finalizado') return 'Servicio finalizado · sin alerta de recompra.';
  if (isServicePlan(patient)) return 'Programar y registrar cada sesión del plan.';

  const urgent = mostUrgentPeptide(patient);
  if (patient.status === 'Por finalizar' || patient.daysLeft <= 5) return 'Revisar evolución clínica, saldo y recompra.';
  if (urgent && urgent.signal !== 'ok') return `Confirmar continuidad de ${urgent.name} (${urgent.endsInDays}d).`;
  if (patient.weeklySerum) return `Mantener suero semanal${patient.serumDay && patient.serumDay !== '-' ? ` · ${patient.serumDay}` : ''}.`;
  return 'Seguimiento activo sin alerta crítica.';
}
