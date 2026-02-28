import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PRESET_LABELS = {
  all: 'All Data',
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 Days',
  last14: 'Last 14 Days',
  last30: 'Last 30 Days',
  this_month: 'This Month',
  last_month: 'Last Month',
  custom: 'Custom',
};

function formatDate(s) {
  if (!s || typeof s !== 'string') return '—';
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(m || 1) - 1]} ${d || 1}, ${y}`;
}

/**
 * Build date range label from preset and optional dateFrom/dateTo.
 * @param {string} preset - e.g. 'this_month', 'custom', 'last30'
 * @param {string} dateFrom - ISO date string (for custom)
 * @param {string} dateTo - ISO date string (for custom)
 * @returns {string}
 */
export function getDateRangeLabel(preset, dateFrom, dateTo) {
  const label = PRESET_LABELS[preset] || 'Custom';
  if (preset === 'custom' && dateFrom && dateTo) {
    return `${formatDate(dateFrom)} – ${formatDate(dateTo)}`;
  }
  return label;
}

const MARGIN = 20;
const FOOTER_HEIGHT = 22;
const BRAND_FONT_SIZE = 10;

/**
 * Generate a PDF report with title, date range, KPIs, table, and Chipper Digital branding footer.
 * @param {Object} opts
 * @param {string} opts.reportTitle - e.g. "Meta Performance", "Google Ads", "TikTok Ads"
 * @param {string} opts.dateRangeText - e.g. "This Month" or "Jan 1, 2025 – Jan 31, 2025"
 * @param {Array<{label: string, value: string}>} opts.kpis - KPI rows for summary
 * @param {string[]} opts.tableHeaders - Column headers
 * @param {Array<string|number>[]} opts.tableRows - Row arrays (same length as headers)
 * @param {{ agencyName?: string, agencyLogo?: string }} opts.branding - Footer text; default "chipper" + "DIGITAL"
 * @param {string} [opts.filename] - Download filename (without .pdf)
 */
export function exportReportPdf(opts) {
  const {
    reportTitle,
    dateRangeText,
    kpis = [],
    tableHeaders = [],
    tableRows = [],
    branding = {},
    filename = 'report',
  } = opts;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentBottom = pageHeight - FOOTER_HEIGHT;

  const brandLine1 = (branding.agencyName || 'chipper').trim();
  const brandLine2 = (branding.agencyLogo || 'DIGITAL').trim();
  const brandingText = `${brandLine1} ${brandLine2}`.trim() || 'chipper DIGITAL';

  const addFooter = () => {
    doc.setFontSize(BRAND_FONT_SIZE);
    doc.setTextColor(100, 100, 100);
    doc.text(brandingText, pageWidth / 2, pageHeight - 12, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  };

  let y = MARGIN;

  // Title
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text(reportTitle || 'Report', MARGIN, y);
  doc.setFont(undefined, 'normal');
  y += 22;

  // Date range
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(`Date range: ${dateRangeText || '—'}`, MARGIN, y);
  doc.setTextColor(0, 0, 0);
  y += 20;

  // KPIs (two columns of label: value)
  if (kpis.length > 0) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Summary', MARGIN, y);
    doc.setFont(undefined, 'normal');
    y += 16;
    doc.setFontSize(10);
    const col1 = MARGIN;
    const col2 = pageWidth / 2 + 10;
    const rowHeight = 14;
    const perCol = Math.ceil(kpis.length / 2);
    kpis.forEach((kpi, i) => {
      const col = i < perCol ? col1 : col2;
      const row = i < perCol ? i : i - perCol;
      doc.text(`${kpi.label}: ${kpi.value}`, col, y + row * rowHeight);
    });
    y += perCol * rowHeight + 16;
  }

  // Table
  if (tableHeaders.length > 0 && tableRows.length > 0) {
    const head = [tableHeaders];
    const body = tableRows.map((row) => row.map((cell) => String(cell ?? '')));

    autoTable(doc, {
      head,
      body,
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: pageWidth - MARGIN * 2,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [60, 60, 60], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      didDrawPage: (data) => {
        addFooter();
      },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  // First page footer if we didn't use autoTable (no table)
  if (tableHeaders.length === 0 || tableRows.length === 0) {
    addFooter();
  }

  doc.save(`${filename}.pdf`);
}
