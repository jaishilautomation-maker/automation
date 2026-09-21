// =============================================================================
// Final Inspection Record PDF (Doc JSCI/QC/16) — pdf-lib
//
// Matches the paper "FINAL INSPECTION RECORD" layout for Sulphur Powder:
//   Header: Date / Item / Sr No / Job No / Shift / Lot No / Batch No
//   13-row parameter table: SR | Parameter | Observation (%) | Remarks
//   Checked By signature
// =============================================================================

import {
  PDFDocument, StandardFonts,
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  INK, MUTED, LINE, HEADBG,
  drawText, fit, drawLetterhead, drawSignatures,
} from "./pdf-helpers";

export interface FinalInspectionParamRow {
  srNo: string;        // "01", "02", "04-A", etc. (mesh sub-rows use letters)
  label: string;
  observation: string; // formatted value, "-" if not tested
  remarks?: string;
}

export interface FinalInspectionPdfData {
  companyName: string;
  companyAddress: string;
  docRef: string;          // "JSCI/QC/16"

  date: string;             // formatted
  item: string;              // e.g. "SULPHUR POWDER - 99.5%"
  srNo: string;
  jobNo: string;
  shift: string;             // "Day" | "Night"
  lotNo: string;
  batchNo: string;

  parameters: FinalInspectionParamRow[];
  overallRemarks: string | null;

  checkedBy: string | null;
}

export async function generateFinalInspectionPdf(data: FinalInspectionPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Final Inspection Record — Batch ${data.batchNo}`);
  pdf.setProducer("JSCI Lab QC Automation");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  y = drawLetterhead(
    page, font, bold,
    data.companyName, data.companyAddress, data.docRef,
    "FINAL INSPECTION RECORD", null,
    y,
  );

  // ── Header block (two columns) ────────────────────────────────────────────
  const colGap = 20;
  const colW = (CONTENT_W - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + colGap;
  const top = y;

  const leftRows: [string, string][] = [
    ["Date",    data.date],
    ["Sr No",   data.srNo],
    ["Shift",   data.shift],
    ["Lot No",  data.lotNo],
  ];
  const rightRows: [string, string][] = [
    ["Item",     data.item],
    ["Job No",   data.jobNo],
    ["Batch No", data.batchNo],
  ];

  let ly = top;
  for (const [k, v] of leftRows) {
    drawText(page, `${k}:`, leftX, ly, bold, 9.5, INK);
    drawText(page, fit(v, font, 9.5, colW - 60), leftX + 60, ly, font, 9.5, INK);
    ly -= 15;
  }
  let ry = top;
  for (const [k, v] of rightRows) {
    drawText(page, `${k}:`, rightX, ry, bold, 9.5, INK);
    drawText(page, fit(v, font, 9.5, colW - 60), rightX + 60, ry, font, 9.5, INK);
    ry -= 15;
  }
  y = Math.min(ly, ry) - 10;

  // ── Parameter table ───────────────────────────────────────────────────────
  const cols = [
    { label: "SR",           w: 0.06 },
    { label: "Parameter",    w: 0.48 },
    { label: "Observation %", w: 0.20 },
    { label: "Remarks",      w: 0.26 },
  ];
  const colX: number[] = [];
  { let cx = MARGIN; for (const c of cols) { colX.push(cx); cx += c.w * CONTENT_W; } }
  const rowH = 22;

  const drawHeader = (startY: number): number => {
    page.drawRectangle({ x: MARGIN, y: startY - rowH + 4, width: CONTENT_W, height: rowH, color: HEADBG });
    cols.forEach((c, i) => drawText(page, c.label, colX[i] + 4, startY - rowH + 11, bold, 8.5, INK));
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
    drawText(page, p.srNo, colX[0] + 4, cellY, font, 8.5, MUTED);
    drawText(page, fit(p.label, font, 8.5, cols[1].w * CONTENT_W - 8), colX[1] + 4, cellY, font, 8.5, INK);
    drawText(page, p.observation || "-", colX[2] + 4, cellY, bold, 8.5, INK);
    if (p.remarks) drawText(page, fit(p.remarks, font, 8, cols[3].w * CONTENT_W - 8), colX[3] + 4, cellY, font, 8, MUTED);
    page.drawLine({ start: { x: MARGIN, y: y - rowH + 4 }, end: { x: PAGE_W - MARGIN, y: y - rowH + 4 }, thickness: 0.4, color: LINE });
    y -= rowH;
  }

  // ── Overall remarks ────────────────────────────────────────────────────────
  y -= 16;
  if (y < MARGIN + 90) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN - 20;
  }
  drawText(page, "Remarks:", MARGIN, y, bold, 9.5, INK);
  y -= 14;
  if (data.overallRemarks) {
    drawText(page, fit(data.overallRemarks, font, 9, CONTENT_W - 10), MARGIN, y, font, 9, INK);
    y -= 20;
  } else {
    y -= 6;
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  y -= 20;
  drawSignatures(page, font, data.checkedBy, null, y);

  return await pdf.save();
}
