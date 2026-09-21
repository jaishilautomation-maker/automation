// =============================================================================
// Crude Sulphur Incoming Inspection PDF (Doc JSCI/QC/03) — pdf-lib
//
// Matches the paper "TEST REPORT OF CRUDE SULPHUR INCOMING" layout:
//   - Company letterhead
//   - Supplier / date / item / quantity header block
//   - Parameter table: SR | Parameter | Sample 1 | Sample 2 | A-Grade Min/Max
//     | B-Grade Min/Max | Test Method | Remarks
//   - Grade remark (auto-computed from purity average)
//   - Checked By signature line
//
// Two rm_qc rows are picked from the database (Sample 1 / Sample 2) — the
// selection logic (which two records) lives in the API route, this template
// only lays out whatever two rows it's given.
// =============================================================================

import {
  PDFDocument, StandardFonts,
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  INK, MUTED, GREEN, AMBER, RED, LINE, HEADBG,
  drawText, fit, drawLetterhead, drawSignatures,
} from "./pdf-helpers";

export interface RmQcIncomingParamRow {
  label: string;         // e.g. "% PURITY/solubility in CS2"
  sample1: string;
  sample2: string;
  aGradeMin: string;     // pre-formatted, e.g. "98"
  aGradeMax: string;     // e.g. "100"
  bGradeMin: string;     // e.g. "90"
  bGradeMax: string;     // e.g. "97.99"
  testMethod: string;    // e.g. "IS - 6655"
  remarks?: string;      // e.g. "GRADE B" — usually only on the purity row
}

export interface RmQcIncomingPdfData {
  companyName: string;
  companyAddress: string;
  docRef: string;          // "JSCI/QC/03"

  supplierName: string;
  date: string;            // formatted
  item: string;            // e.g. "Crude Sulphur"
  quantity: string;        // e.g. "514.892 MT + 734.478 MT"

  parameters: RmQcIncomingParamRow[];
  grade: "A" | "B" | "Reject" | null;

  checkedBy: string | null;
}

export async function generateRmQcIncomingPdf(data: RmQcIncomingPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Crude Sulphur Incoming — ${data.supplierName}`);
  pdf.setProducer("JSCI Lab QC Automation");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  y = drawLetterhead(
    page, font, bold,
    data.companyName, data.companyAddress, data.docRef,
    "TEST REPORT OF CRUDE SULPHUR INCOMING", null,
    y,
  );

  // ── Header block: supplier / date / item / quantity ──────────────────────
  const headerRows: [string, string][] = [
    ["Name of Supplier", data.supplierName],
    ["Date",             data.date],
    ["Item",             data.item],
    ["Quantity",         data.quantity],
  ];
  for (const [k, v] of headerRows) {
    drawText(page, `${k}:`, MARGIN, y, bold, 9.5, INK);
    drawText(page, fit(v, font, 9.5, CONTENT_W - 110), MARGIN + 110, y, font, 9.5, INK);
    y -= 15;
  }
  y -= 6;

  // ── Parameter table ───────────────────────────────────────────────────────
  const cols = [
    { label: "Parameter",    w: 0.26 },
    { label: "Sample 1",     w: 0.10 },
    { label: "Sample 2",     w: 0.10 },
    { label: "A Min",        w: 0.08 },
    { label: "A Max",        w: 0.08 },
    { label: "B Min",        w: 0.08 },
    { label: "B Max",        w: 0.08 },
    { label: "Method",       w: 0.11 },
    { label: "Remarks",      w: 0.11 },
  ];
  const colX: number[] = [];
  { let cx = MARGIN; for (const c of cols) { colX.push(cx); cx += c.w * CONTENT_W; } }
  const rowH = 24;

  const drawHeader = (startY: number): number => {
    page.drawRectangle({ x: MARGIN, y: startY - rowH + 4, width: CONTENT_W, height: rowH, color: HEADBG });
    cols.forEach((c, i) => drawText(page, c.label, colX[i] + 3, startY - rowH + 12, bold, 7.5, INK));
    page.drawLine({ start: { x: MARGIN, y: startY - rowH + 4 }, end: { x: PAGE_W - MARGIN, y: startY - rowH + 4 }, thickness: 0.8, color: LINE });
    return startY - rowH;
  };

  y = drawHeader(y);

  for (const p of data.parameters) {
    if (y < MARGIN + 100) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      y = drawHeader(y);
    }
    const cellY = y - 14;
    const cw = (i: number) => cols[i].w * CONTENT_W - 6;
    drawText(page, fit(p.label, font, 7.5, cw(0)), colX[0] + 3, cellY, font, 7.5, INK);
    drawText(page, p.sample1,   colX[1] + 3, cellY, bold, 8, INK);
    drawText(page, p.sample2,   colX[2] + 3, cellY, bold, 8, INK);
    drawText(page, p.aGradeMin, colX[3] + 3, cellY, font, 7.5, MUTED);
    drawText(page, p.aGradeMax, colX[4] + 3, cellY, font, 7.5, MUTED);
    drawText(page, p.bGradeMin, colX[5] + 3, cellY, font, 7.5, MUTED);
    drawText(page, p.bGradeMax, colX[6] + 3, cellY, font, 7.5, MUTED);
    drawText(page, fit(p.testMethod, font, 7, cw(7)), colX[7] + 3, cellY, font, 7, MUTED);
    if (p.remarks) {
      drawText(page, fit(p.remarks, bold, 7.5, cw(8)), colX[8] + 3, cellY, bold, 7.5, GREEN);
    }
    page.drawLine({ start: { x: MARGIN, y: y - rowH + 4 }, end: { x: PAGE_W - MARGIN, y: y - rowH + 4 }, thickness: 0.4, color: LINE });
    y -= rowH;
  }

  // ── Grade summary ─────────────────────────────────────────────────────────
  y -= 20;
  if (y < MARGIN + 80) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN - 20;
  }
  if (data.grade) {
    const gradeColor = data.grade === "A" ? GREEN : data.grade === "B" ? AMBER : RED;
    drawText(page, `Overall Grade: ${data.grade}`, MARGIN, y, bold, 12, gradeColor);
    y -= 24;
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  drawSignatures(page, font, data.checkedBy, null, y);

  return await pdf.save();
}
