// =============================================================================
// COA (Certificate of Analysis) PDF generator — pdf-lib
//
// Server-side only. Produces an A4 certificate matching the JSCI paper layout:
//   - Company letterhead (name + address + doc reference)
//   - Customer address block + report metadata (report no, dates, dispatch)
//   - Parameter table: Parameter | Actual Report | Customer Min | Customer Max | Status
//   - Checked By / Approved By signature lines
//
// pdf-lib is pure JS (no native binaries) so it runs cleanly in the Next.js
// Node serverless runtime. Returns a Uint8Array (the raw PDF bytes) which the
// API route uploads to Supabase Storage.
// =============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoaParameterRow {
  /** Human-readable parameter label, e.g. "Purity in CS2" */
  label: string;
  unit: string | null;
  /** Actual measured value from product_qc.test_results */
  actual: string;
  /** Customer spec limits (null = no limit specified) */
  minValue: number | null;
  maxValue: number | null;
  /** Whether the actual value is within the customer spec range */
  withinSpec: boolean | null;
}

export interface CoaPdfData {
  // Company (letterhead)
  companyName: string;
  companyAddress: string;
  docRef: string;             // e.g. "JSCI/QC/COA"

  // Report metadata
  testReportNo: string;       // e.g. "COA-000123"
  productName: string;
  generatedDate: string;      // formatted date string
  mfgDate: string | null;

  // Customer
  customerName: string;
  customerAddress: string | null;

  // Dispatch
  lotNo: string | null;
  batchNo: string | null;
  qty: string | null;
  invoiceNo: string | null;
  vehicleNo: string | null;

  // Results
  parameters: CoaParameterRow[];

  // Signatures
  checkedBy: string | null;
  approvedBy: string | null;
}

// ---------------------------------------------------------------------------
// Layout constants (A4 portrait, points)
// ---------------------------------------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK    = rgb(0.13, 0.13, 0.13);
const MUTED  = rgb(0.45, 0.45, 0.45);
const GREEN  = rgb(0.11, 0.37, 0.13);
const RED    = rgb(0.78, 0.16, 0.16);
const LINE   = rgb(0.80, 0.80, 0.80);
const HEADBG = rgb(0.93, 0.95, 0.93);

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

function drawText(
  page: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, color = INK,
) {
  page.drawText(text ?? "", { x, y, size, font, color });
}

/** Truncate text so it fits within maxWidth at the given font/size. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateCoaPdf(data: CoaPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of Analysis — ${data.testReportNo}`);
  pdf.setSubject(`COA for ${data.productName} — ${data.customerName}`);
  pdf.setProducer("JSCI Lab QC Automation");

  const font  = await pdf.embedFont(StandardFonts.Helvetica);
  const bold  = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // ── Letterhead ────────────────────────────────────────────────────────
  drawText(page, data.companyName, MARGIN, y - 4, bold, 18, GREEN);
  y -= 22;
  drawText(page, data.companyAddress, MARGIN, y, font, 9, MUTED);
  y -= 14;
  drawText(page, `Doc Ref: ${data.docRef}`, MARGIN, y, font, 8, MUTED);

  // Title (right aligned block)
  const title = "CERTIFICATE OF ANALYSIS";
  const titleW = bold.widthOfTextAtSize(title, 13);
  drawText(page, title, PAGE_W - MARGIN - titleW, PAGE_H - MARGIN - 4, bold, 13, INK);
  const rptLabel = `Report No: ${data.testReportNo}`;
  const rptW = font.widthOfTextAtSize(rptLabel, 9);
  drawText(page, rptLabel, PAGE_W - MARGIN - rptW, PAGE_H - MARGIN - 20, font, 9, INK);

  y -= 16;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
    thickness: 1.2, color: GREEN,
  });
  y -= 20;

  // ── Customer + metadata (two columns) ────────────────────────────────────
  const colGap = 20;
  const colW = (CONTENT_W - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;
  const blockTop = y;

  // Left column: customer
  drawText(page, "Issued To", leftX, y, bold, 9, MUTED);
  y -= 14;
  drawText(page, fit(data.customerName, bold, 11, colW), leftX, y, bold, 11, INK);
  y -= 14;
  if (data.customerAddress) {
    // wrap address into lines of ~colW width
    const words = data.customerAddress.split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(test, 9) > colW && line) {
        lines.push(line); line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    for (const l of lines.slice(0, 4)) {
      drawText(page, l, leftX, y, font, 9, INK);
      y -= 12;
    }
  }

  // Right column: report metadata
  let ry = blockTop;
  const metaRows: [string, string][] = [
    ["Product",      data.productName],
    ["Batch No",     data.batchNo ?? "—"],
    ["Lot No",       data.lotNo ?? "—"],
    ["Quantity",     data.qty ?? "—"],
    ["Invoice No",   data.invoiceNo ?? "—"],
    ["Vehicle No",   data.vehicleNo ?? "—"],
    ["Mfg Date",     data.mfgDate ?? "—"],
    ["Report Date",  data.generatedDate],
  ];
  for (const [k, v] of metaRows) {
    drawText(page, k, rightX, ry, font, 8, MUTED);
    drawText(page, fit(v, font, 9, colW - 90), rightX + 90, ry, bold, 9, INK);
    ry -= 13;
  }

  // Move y below the taller of the two columns
  y = Math.min(y, ry) - 16;

  // ── Parameter table ───────────────────────────────────────────────────────
  // Columns: Parameter | Actual | Min | Max | Status
  const cols = [
    { key: "param",  label: "Parameter",       w: 0.40 },
    { key: "actual", label: "Actual Report",   w: 0.20 },
    { key: "min",    label: "Cust. Min",       w: 0.13 },
    { key: "max",    label: "Cust. Max",       w: 0.13 },
    { key: "status", label: "Status",          w: 0.14 },
  ];
  const colX: number[] = [];
  {
    let cx = MARGIN;
    for (const c of cols) { colX.push(cx); cx += c.w * CONTENT_W; }
  }
  const rowH = 20;

  const drawTableHeader = (startY: number): number => {
    page.drawRectangle({
      x: MARGIN, y: startY - rowH + 4, width: CONTENT_W, height: rowH,
      color: HEADBG,
    });
    cols.forEach((c, i) => {
      drawText(page, c.label, colX[i] + 4, startY - rowH + 10, bold, 8, INK);
    });
    // header underline
    page.drawLine({
      start: { x: MARGIN, y: startY - rowH + 4 },
      end:   { x: PAGE_W - MARGIN, y: startY - rowH + 4 },
      thickness: 0.8, color: LINE,
    });
    return startY - rowH;
  };

  y = drawTableHeader(y);

  for (const row of data.parameters) {
    // Page-break check
    if (y < MARGIN + 90) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      y = drawTableHeader(y);
    }

    const cellY = y - 14;
    const label = fit(row.unit ? `${row.label} (${row.unit})` : row.label, font, 8.5, cols[0].w * CONTENT_W - 8);
    drawText(page, label, colX[0] + 4, cellY, font, 8.5, INK);
    drawText(page, fit(row.actual || "—", bold, 8.5, cols[1].w * CONTENT_W - 8), colX[1] + 4, cellY, bold, 8.5, INK);
    drawText(page, row.minValue != null ? String(row.minValue) : "—", colX[2] + 4, cellY, font, 8.5, MUTED);
    drawText(page, row.maxValue != null ? String(row.maxValue) : "—", colX[3] + 4, cellY, font, 8.5, MUTED);

    let statusText = "—";
    let statusColor = MUTED;
    if (row.withinSpec === true)  { statusText = "PASS"; statusColor = GREEN; }
    if (row.withinSpec === false) { statusText = "CHECK"; statusColor = RED; }
    drawText(page, statusText, colX[4] + 4, cellY, bold, 8.5, statusColor);

    // row separator
    page.drawLine({
      start: { x: MARGIN, y: y - rowH + 4 },
      end:   { x: PAGE_W - MARGIN, y: y - rowH + 4 },
      thickness: 0.4, color: LINE,
    });
    y -= rowH;
  }

  // table outer border
  // (left/right verticals for the visible rows region omitted for simplicity;
  // header + row separators provide sufficient structure)

  // ── Footer note ────────────────────────────────────────────────────────
  y -= 24;
  if (y < MARGIN + 70) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN - 20;
  }
  drawText(page,
    "The above results certify that the material conforms to the analysis reported. Actual values are measured in the JSCI laboratory.",
    MARGIN, y, font, 8, MUTED);

  // ── Signatures ────────────────────────────────────────────────────────
  y -= 50;
  const sigW = 180;
  // Checked By
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + sigW, y }, thickness: 0.8, color: INK });
  drawText(page, "Checked By", MARGIN, y - 12, font, 8, MUTED);
  if (data.checkedBy) drawText(page, data.checkedBy, MARGIN, y + 4, font, 9, INK);

  // Approved By
  const apX = PAGE_W - MARGIN - sigW;
  page.drawLine({ start: { x: apX, y }, end: { x: apX + sigW, y }, thickness: 0.8, color: INK });
  drawText(page, "Approved By", apX, y - 12, font, 8, MUTED);
  if (data.approvedBy) drawText(page, data.approvedBy, apX, y + 4, font, 9, INK);

  return await pdf.save();
}
