// =============================================================================
// Finish Goods Testing of Sulphur PDF — pdf-lib
//
// Matches the paper "FINISH GOODS TESTING OF SULPHUR" layout:
//   Production / Date / Batch No / Sample Size / Lot No header
//   (A) Purity %  (B) Mesh Size (200/170/325)  (C) Ash %  (D) Acidity %
//   Confirmation / Non-Confirmation of Finish Goods + reasons + signature
//
// Single-shift version (one batch_analysis record = one shift's report).
// =============================================================================

import {
  PDFDocument, StandardFonts,
  PAGE_W, PAGE_H, MARGIN, CONTENT_W,
  INK, MUTED, GREEN, RED,
  drawText, fit, drawLetterhead,
} from "./pdf-helpers";

export interface FinishGoodsPdfData {
  companyName: string;
  companyAddress: string;
  docRef: string;         // no formal doc number on this form — pass "" if none

  production: string;     // e.g. "1st Shift"
  date: string;            // formatted
  batchNo: string;
  sampleSize: string;
  lotNo: string;

  purityPercent: string;
  mesh200Percent: string;
  mesh170Percent: string;
  mesh325Percent: string;
  ashPercent: string;
  acidityPercent: string;

  confirmed: boolean | null;   // true = Confirmation, false = Non-Confirmation, null = not decided
  reasons: string | null;

  authorisedSign: string | null;
}

export async function generateFinishGoodsPdf(data: FinishGoodsPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Finish Goods Testing — Batch ${data.batchNo}`);
  pdf.setProducer("JSCI Lab QC Automation");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  y = drawLetterhead(
    page, font, bold,
    data.companyName, data.companyAddress, data.docRef || "—",
    "FINISH GOODS TESTING OF SULPHUR", null,
    y,
  );

  // ── Header block ──────────────────────────────────────────────────────────
  const headerRows: [string, string][] = [
    ["Production", data.production],
    ["Date",       data.date],
    ["Batch No.",  data.batchNo],
    ["Sample Size", data.sampleSize],
    ["Lot No.",    data.lotNo],
  ];
  for (const [k, v] of headerRows) {
    drawText(page, `${k}:`, MARGIN, y, bold, 10, INK);
    drawText(page, fit(v, font, 10, CONTENT_W - 110), MARGIN + 110, y, font, 10, INK);
    y -= 16;
  }
  y -= 10;

  // ── Formula blocks ────────────────────────────────────────────────────────
  const block = (title: string, formula: string, value: string) => {
    drawText(page, title, MARGIN, y, bold, 10, INK);
    y -= 14;
    drawText(page, formula, MARGIN + 10, y, font, 8.5, MUTED);
    y -= 16;
    drawText(page, `Result: ${value}%`, MARGIN + 10, y, bold, 12, GREEN);
    y -= 24;
  };

  block("(A) PURITY %", "= 100 - [M1/M x 100]", data.purityPercent);

  drawText(page, "(B) MESH SIZE = 100 x [1 - retained/sample]", MARGIN, y, bold, 10, INK);
  y -= 16;
  drawText(page, `200 Mesh: ${data.mesh200Percent}%   170 Mesh: ${data.mesh170Percent}%   325 Mesh: ${data.mesh325Percent}%`,
    MARGIN + 10, y, bold, 11, GREEN);
  y -= 26;

  block("(C) ASH %", "= 100 x M1/M", data.ashPercent);
  block("(D) ACIDITY %", "= (V1-V2) x N x 4.904 / M", data.acidityPercent);

  // ── Confirmation ──────────────────────────────────────────────────────────
  y -= 6;
  drawText(page, "Confirmation / Non-Confirmation of Finish Goods", MARGIN, y, bold, 10.5, INK);
  y -= 18;

  const statusLabel = data.confirmed === true ? "CONFIRMED"
    : data.confirmed === false ? "NON-CONFIRMED"
    : "PENDING";
  const statusColor = data.confirmed === true ? GREEN
    : data.confirmed === false ? RED
    : MUTED;
  drawText(page, statusLabel, MARGIN, y, bold, 12, statusColor);
  y -= 20;

  if (data.reasons) {
    drawText(page, "Reasons:", MARGIN, y, bold, 9, INK);
    y -= 13;
    drawText(page, fit(data.reasons, font, 9, CONTENT_W - 10), MARGIN, y, font, 9, INK);
    y -= 24;
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  y -= 20;
  const sigW = 200;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + sigW, y }, thickness: 0.8, color: INK });
  drawText(page, "Authorised Sign.", MARGIN, y - 12, font, 8, MUTED);
  if (data.authorisedSign) drawText(page, data.authorisedSign, MARGIN, y + 4, font, 9, INK);

  return await pdf.save();
}
