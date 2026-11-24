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

// ------------------------------------------------------------------ shared look (formal, monochrome)
const C = {
  ink: [17, 17, 17],
  text: [33, 33, 33],
  muted: [90, 90, 90],
  rule: [120, 120, 120],
  line: [190, 190, 190],
  head: [235, 235, 235],
};

/** Only a non-final result carries a status line; final and published reports show none. */
export function statusNote(label = '') {
  return /PRELIMINARY|RETURNED|INCOMPLETE|LIVE COMPUTATION/.test(label) ? label : '';
}

const isWide = (report) => report.sections.some((s) => (s.columns?.length || 0) > 6);

/** Winners as a plain table: places first, then special awards. */
export function winnersTable(report) {
  const list = report.highlights || [];
  if (!list.length) return null;
  const hasRemarks = list.some((h) => h.sub);
  return {
    heading: 'Winners',
    columns: [
      { key: 'title', label: 'Award', width: 24 },
      { key: 'name', label: 'Awardee', width: 32 },
      { key: 'value', label: 'Score', align: 'right', width: 10 },
      ...(hasRemarks ? [{ key: 'sub', label: 'Basis', width: 30 }] : []),
    ],
    rows: list.map((h) => ({ title: h.title, name: h.name, value: h.value, sub: h.sub || '', _bold: h.kind === 'place1' })),
  };
}

// ------------------------------------------------------------------ PDF (jsPDF + autotable)
export function reportToPdf(report) {
  const doc = new jsPDF({ orientation: isWide(report) ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 42;
  const contentW = pageW - margin * 2;
  const bottomLimit = pageH - 60;
  const center = pageW / 2;
  let y = 46;

  const ensure = (needed) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = margin;
    }
  };
  const line = (text, { size, bold, color = C.ink, gap }) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentW);
    doc.text(lines, center, y, { align: 'center' });
    y += gap + (lines.length - 1) * size * 1.15;
  };

  // ---- letterhead
  if (report.organization) line(report.organization, { size: 12, bold: true, gap: 15 });
  if (report.subheading) line(report.subheading, { size: 10, color: C.muted, gap: 20 });
  line(report.event.name, { size: 15, bold: true, gap: 17 });
  line(`${report.title}${report.subtitle && report.subtitle !== report.event.name ? ` — ${report.subtitle}` : ''}`, { size: 11, gap: 14 });
  const meta = [report.event.date, report.event.venue].filter((v) => v && v !== '—').join('   |   ');
  if (meta) line(meta, { size: 9, color: C.muted, gap: 12 });
  const note = statusNote(report.statusLabel);
  if (note) line(note, { size: 8.5, bold: true, color: C.muted, gap: 12 });
  y += 2;
  doc.setDrawColor(...C.ink);
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageW - margin, y);
  doc.setLineWidth(0.4);
  doc.line(margin, y + 3, pageW - margin, y + 3);
  y += 26;

  const heading = (text) => {
    ensure(60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.ink);
    doc.text(text.toUpperCase(), margin, y, { charSpace: 0.3 });
    y += 6;
  };

  const table = (section) => {
    heading(section.heading);
    if (section.note) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      const lines = doc.splitTextToSize(section.note, contentW);
      doc.text(lines, margin, y + 6);
      y += lines.length * 9 + 2;
    }
    const isKV = !!section.keyValues;
    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin, bottom: 50 },
      head: isKV ? undefined : [section.columns.map((c) => c.label)],
      body: isKV ? section.keyValues : section.rows.map((r) => section.columns.map((c) => (r[c.key] ?? '') + '')),
      theme: isKV ? 'plain' : 'grid',
      showHead: 'everyPage',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 }, lineColor: C.line, lineWidth: 0.5, textColor: C.text, valign: 'middle' },
      headStyles: { fillColor: C.head, textColor: C.ink, fontStyle: 'bold', halign: 'center', lineColor: C.line },
      columnStyles: isKV ? { 0: { fontStyle: 'bold', cellWidth: 150 } } : Object.fromEntries(section.columns.map((c, i) => [i, { halign: c.align || 'left' }])),
      didParseCell: (data) => {
        if (isKV || data.section !== 'body') return;
        const row = section.rows[data.row.index];
        if (row?._bold) data.cell.styles.fontStyle = 'bold';
      },
    });
    y = doc.lastAutoTable.finalY + 24;
  };

  const winners = winnersTable(report);
  if (winners) table(winners);
  for (const section of report.sections) table(section);

  // ---- signatures
  const sig = report.signatories || [];
  if (sig.length) {
    const perRow = Math.min(3, sig.length);
    const colW = contentW / perRow;
    ensure(80);
    y += 14;
    sig.forEach((s, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) {
        y += 70;
        ensure(66);
      }
      const x = margin + col * colW + 12;
      const w = colW - 24;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(s.label, x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.ink);
      doc.text((s.name || ' ').toUpperCase(), x + w / 2, y + 30, { align: 'center', maxWidth: w });
      doc.setDrawColor(...C.ink);
      doc.setLineWidth(0.6);
      doc.line(x, y + 34, x + w, y + 34);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(s.role || '', x + w / 2, y + 45, { align: 'center' });
    });
  }

  // ---- footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 32, pageW - margin, pageH - 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Generated ${report.generatedAt} by ${report.generatedBy}. ${report.footer || ''}`.trim(), margin, pageH - 20, { maxWidth: contentW - 80 });
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 20, { align: 'right' });
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
const align = (a) => (a === 'right' ? 'right' : a === 'center' ? 'center' : 'left');

export function reportToHtml(report) {
  const renderSection = (s) => {
    const body = s.keyValues
      ? `<table class="kv">${s.keyValues.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
      : `<table><thead><tr>${s.columns.map((c) => `<th style="text-align:center">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${s.rows
          .map((r) => `<tr${r._bold ? ' class="b"' : ''}>${s.columns.map((c) => `<td style="text-align:${align(c.align)}">${esc(r[c.key])}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;
    return `<section><h2>${esc(s.heading)}</h2>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}${body}</section>`;
  };
  const winners = winnersTable(report);
  const sections = [...(winners ? [winners] : []), ...report.sections].map(renderSection).join('');
  const sig = (report.signatories || []).map((s) => `<div class="sig"><span>${esc(s.label)}</span><strong>${esc(s.name || '')}</strong><em>${esc(s.role || '')}</em></div>`).join('');
  const meta = [report.event.date, report.event.venue].filter((v) => v && v !== '—').map(esc).join(' &nbsp;|&nbsp; ');
  const note = statusNote(report.statusLabel);
  const subtitle = report.subtitle && report.subtitle !== report.event.name ? ` — ${esc(report.subtitle)}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)} — ${esc(report.event.name)}</title>
<style>
  @page { size: A4 ${isWide(report) ? 'landscape' : 'portrait'}; margin: 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; padding: 28px 32px; }
  header { text-align: center; padding-bottom: 10px; margin-bottom: 22px; border-bottom: 3px double #111; }
  header .org { font-size: 14px; font-weight: 700; }
  header .sub { color: #555; font-size: 12px; margin-top: 2px; }
  header h1 { font-size: 18px; margin: 14px 0 2px; }
  header h3 { font-size: 13px; font-weight: 400; margin: 0; }
  header .meta { color: #555; margin-top: 4px; }
  header .status { color: #555; font-weight: 700; font-size: 10px; margin-top: 6px; letter-spacing: .04em; }
  section { margin-bottom: 22px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; }
  .note { color: #555; font-style: italic; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; font-variant-numeric: tabular-nums; }
  thead th { background: #ebebeb; font-weight: 700; }
  thead { display: table-header-group; }
  tr.b td { font-weight: 700; }
  table.kv th { text-align: left; width: 30%; }
  .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px 40px; margin-top: 48px; break-inside: avoid; }
  .sig span { color: #555; font-size: 10px; display: block; }
  .sig strong { display: block; margin-top: 28px; border-bottom: 1px solid #111; padding-bottom: 3px; min-height: 20px; font-size: 12px; text-align: center; text-transform: uppercase; }
  .sig em { display: block; color: #555; font-size: 10px; font-style: normal; text-align: center; margin-top: 2px; }
  footer { margin-top: 32px; padding-top: 8px; border-top: 1px solid #bbb; color: #777; font-size: 9px; }
  .toolbar { position: sticky; top: 0; text-align: right; margin: -28px -32px 18px; padding: 10px 32px; background: #f5f5f5; border-bottom: 1px solid #ddd; }
  .toolbar button { font: inherit; padding: 6px 14px; border-radius: 4px; border: 1px solid #333; background: #222; color: #fff; cursor: pointer; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print</button></div>
<header>${report.organization ? `<div class="org">${esc(report.organization)}</div>` : ''}${report.subheading ? `<div class="sub">${esc(report.subheading)}</div>` : ''}<h1>${esc(report.event.name)}</h1><h3>${esc(report.title)}${subtitle}</h3>${meta ? `<div class="meta">${meta}</div>` : ''}${note ? `<div class="status">${esc(note)}</div>` : ''}</header>
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
