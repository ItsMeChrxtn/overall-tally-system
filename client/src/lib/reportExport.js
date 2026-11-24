import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import api, { downloadFile } from '../api/client';

/** Fetches the neutral report structure built by the backend. */
export async function fetchReport(eventId, type, params = {}, logAs) {
  const { data } = await api.get(`/reports/${eventId}/${type}`, { params: { ...params, ...(logAs ? { log: '1', as: logAs } : {}) } });
  return data.report;
}

export function exportExcel(eventId, type, params = {}) {
  return downloadFile(`/reports/${eventId}/${type}`, { ...params, format: 'xlsx' }, 'report.xlsx');
}

const safeName = (s) => s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 100);

// ------------------------------------------------------------------ PDF (jsPDF + autotable)
export function reportToPdf(report) {
  const wide = report.sections.some((s) => (s.columns?.length || 0) > 6);
  const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  doc.setFont('helvetica', 'normal');
  if (report.organization) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(report.organization, pageW / 2, y, { align: 'center' });
    y += 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(report.event.name, pageW / 2, y, { align: 'center' });
  y += 18;
  doc.setFontSize(12);
  doc.text(`${report.title}${report.subtitle ? ` — ${report.subtitle}` : ''}`, pageW / 2, y, { align: 'center' });
  y += 15;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`${report.event.date}  ·  ${report.event.venue}`, pageW / 2, y, { align: 'center' });
  y += 14;
  if (report.statusLabel) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(43, 57, 163);
    doc.text(report.statusLabel, pageW / 2, y, { align: 'center' });
    y += 8;
  }
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y + 4, pageW - margin, y + 4);
  y += 18;

  for (const section of report.sections) {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(section.heading, margin, y);
    y += 6;
    if (section.note) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100);
      const lines = doc.splitTextToSize(section.note, pageW - margin * 2);
      doc.text(lines, margin, y + 8);
      y += 8 + lines.length * 9;
    }
    const isKV = !!section.keyValues;
    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: isKV ? undefined : [section.columns.map((c) => c.label)],
      body: isKV ? section.keyValues : section.rows.map((r) => section.columns.map((c) => (r[c.key] ?? '') + '')),
      theme: isKV ? 'plain' : 'grid',
      styles: { fontSize: 8, cellPadding: 4, lineColor: [226, 232, 240], lineWidth: 0.5, textColor: [30, 41, 59] },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: isKV ? { 0: { fontStyle: 'bold', cellWidth: 120 } } : Object.fromEntries(section.columns.map((c, i) => [i, { halign: c.align || 'left' }])),
      didParseCell: (data) => {
        if (!isKV && data.section === 'body' && section.rows[data.row.index]?._bold) data.cell.styles.fontStyle = 'bold';
      },
    });
    y = doc.lastAutoTable.finalY + 22;
  }

  // Signatories
  const sig = report.signatories || [];
  if (sig.length) {
    if (y > doc.internal.pageSize.getHeight() - 110) {
      doc.addPage();
      y = margin;
    }
    y += 14;
    const colW = (pageW - margin * 2) / Math.min(sig.length, 3);
    sig.forEach((s, i) => {
      const col = i % 3;
      if (i > 0 && col === 0) y += 70;
      const x = margin + col * colW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(s.label, x, y);
      doc.setDrawColor(100);
      doc.line(x, y + 30, x + colW - 30, y + 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(s.name || ' ', x, y + 26);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(s.role || '', x, y + 42);
    });
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(140);
    const h = doc.internal.pageSize.getHeight();
    doc.text(`Generated ${report.generatedAt} by ${report.generatedBy}. ${report.footer || ''}`, margin, h - 20);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, h - 20, { align: 'right' });
  }
  return doc;
}

export async function exportPdf(eventId, type, params = {}) {
  const report = await fetchReport(eventId, type, params, 'PDF');
  const doc = reportToPdf(report);
  doc.save(`${safeName(`${report.event.name}-${report.title}${report.subtitle ? `-${report.subtitle}` : ''}`)}.pdf`);
}

// ------------------------------------------------------------------ Printable HTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function reportToHtml(report) {
  const sections = report.sections
    .map((s) => {
      const body = s.keyValues
        ? `<table class="kv">${s.keyValues.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
        : `<table><thead><tr>${s.columns.map((c) => `<th style="text-align:${c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left'}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${s.rows
            .map((r) => `<tr${r._bold ? ' class="b"' : ''}>${s.columns.map((c) => `<td style="text-align:${c.align || 'left'}">${esc(r[c.key])}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`;
      return `<section><h2>${esc(s.heading)}</h2>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}${body}</section>`;
    })
    .join('');
  const sig = (report.signatories || []).map((s) => `<div class="sig"><span>${esc(s.label)}</span><strong>${esc(s.name || '')}</strong><em>${esc(s.role || '')}</em></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)} — ${esc(report.event.name)}</title>
<style>
  @page { size: A4 ${report.sections.some((s) => (s.columns?.length || 0) > 6) ? 'landscape' : 'portrait'}; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter Variable', Inter, 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; padding: 24px; }
  header { text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 18px; }
  header .org { color: #64748b; font-size: 10px; }
  header h1 { font-size: 18px; margin: 4px 0; }
  header h3 { font-size: 13px; margin: 2px 0; }
  header .meta { color: #64748b; }
  header .status { color: #2b39a3; font-weight: 700; margin-top: 4px; }
  section { margin-bottom: 18px; break-inside: auto; }
  h2 { font-size: 12px; margin: 0 0 4px; }
  .note { color: #64748b; font-style: italic; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 6px; }
  thead th { background: #1e293b; color: #fff; font-weight: 600; }
  tr.b td { font-weight: 700; }
  table.kv th { background: #f8fafc; text-align: left; width: 30%; }
  .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px 28px; margin-top: 40px; break-inside: avoid; }
  .sig span { color: #64748b; font-size: 10px; display: block; }
  .sig strong { display: block; margin-top: 28px; border-bottom: 1px solid #475569; padding-bottom: 2px; min-height: 18px; }
  .sig em { color: #64748b; font-size: 10px; font-style: normal; }
  footer { margin-top: 30px; color: #94a3b8; font-size: 9px; }
  .toolbar { position: sticky; top: 0; text-align: right; margin: -24px -24px 16px; padding: 10px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  .toolbar button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; background: #3446c7; color: #fff; cursor: pointer; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print</button></div>
<header>${report.organization ? `<div class="org">${esc(report.organization)}</div>` : ''}<h1>${esc(report.event.name)}</h1><h3>${esc(report.title)}${report.subtitle ? ` — ${esc(report.subtitle)}` : ''}</h3><div class="meta">${esc(report.event.date)} · ${esc(report.event.venue)}</div>${report.statusLabel ? `<div class="status">${esc(report.statusLabel)}</div>` : ''}</header>
${sections}
${sig ? `<div class="sigs">${sig}</div>` : ''}
<footer>Generated ${esc(report.generatedAt)} by ${esc(report.generatedBy)}. ${esc(report.footer || '')}</footer>
</body></html>`;
}

export async function printReport(eventId, type, params = {}) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups to open the printable report.');
  win.document.write('<p style="font-family:sans-serif;padding:24px">Preparing report…</p>');
  try {
    const report = await fetchReport(eventId, type, params, 'Print');
    win.document.open();
    win.document.write(reportToHtml(report));
    win.document.close();
    setTimeout(() => win.print(), 400);
  } catch (err) {
    win.close();
    throw err;
  }
}
