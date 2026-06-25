// Exportación a CSV (Blob, sin dependencias) y PDF (jsPDF + autotable cargado
// dinámicamente, para no inflar el bundle inicial — solo pesa al exportar).
type Cell = string | number;

function csvCell(v: Cell): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Descarga un CSV (con BOM para que Excel respete los acentos). */
export function downloadCsv(filename: string, headers: string[], rows: Cell[][]) {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export interface PdfSection {
  heading: string;
  headers: string[];
  rows: Cell[][];
}

const BRAND: [number, number, number] = [122, 31, 155]; // #7A1F9B

/** Descarga un PDF con membrete Healen: KPIs + tablas. jsPDF se importa
 *  dinámicamente (chunk aparte) para no pesar en la carga inicial. */
export async function downloadPdf(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  kpis?: Array<{ label: string; value: string }>;
  sections?: PdfSection[];
}) {
  try {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  // Membrete
  doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('HEALEN', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Centro de medicina regenerativa', 14, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(opts.title, 14, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(new Date().toLocaleString('es-CO'), W - 14, 17, { align: 'right' });

  let y = 38;
  doc.setTextColor(60, 60, 60);
  if (opts.subtitle) {
    doc.setFontSize(10);
    doc.text(opts.subtitle, 14, y);
    y += 8;
  }

  if (opts.kpis?.length) {
    const colW = (W - 28) / opts.kpis.length;
    opts.kpis.forEach((k, i) => {
      const x = 14 + i * colW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 130);
      doc.text(k.label, x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(25, 25, 25);
      doc.text(k.value, x, y + 6);
    });
    y += 14;
  }

  for (const s of opts.sections ?? []) {
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(25, 25, 25);
    doc.text(s.heading, 14, y);
    autoTable(doc, {
      startY: y + 2,
      head: [s.headers],
      body: s.rows.map((r) => r.map((c) => String(c ?? ''))),
      theme: 'striped',
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (after?.finalY ?? y) + 10;
  }

  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`);
  } catch (e) {
    console.error('No se pudo generar el PDF', e);
    throw e instanceof Error ? e : new Error('No se pudo generar el PDF');
  }
}
