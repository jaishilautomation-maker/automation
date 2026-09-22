// =============================================================================
// Shared pdf-lib drawing helpers for all Lab QC report generators.
//
// Extracted from coa-template.ts so the 3 additional report templates
// (Crude Sulphur Incoming, Finish Goods Testing, Final Inspection Record)
// reuse the same layout primitives instead of duplicating them.
// =============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

export { PDFDocument, StandardFonts };
export type { PDFPage, PDFFont };

// ---------------------------------------------------------------------------
// A4 portrait layout constants (points)
// ---------------------------------------------------------------------------
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 40;
export const CONTENT_W = PAGE_W - MARGIN * 2;

export const INK    = rgb(0.13, 0.13, 0.13);
export const MUTED  = rgb(0.45, 0.45, 0.45);
export const GREEN  = rgb(0.11, 0.37, 0.13);
export const RED    = rgb(0.78, 0.16, 0.16);
export const AMBER  = rgb(0.72, 0.49, 0.05);
export const LINE   = rgb(0.80, 0.80, 0.80);
export const HEADBG = rgb(0.93, 0.95, 0.93);

export function drawText(
  page: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, color = INK,
) {
  page.drawText(text ?? "", { x, y, size, font, color });
}

/** Truncate text so it fits within maxWidth at the given font/size. */
export function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/** Format an ISO date string as "DD Mon YYYY", or "—" if missing/invalid. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Wrap a long line of text into multiple lines that fit maxWidth. */
export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 4): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line); line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/** Draw the shared company letterhead block. Returns the y position after it. */
export function drawLetterhead(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  companyName: string, companyAddress: string, docRef: string,
  title: string, reportNoLabel: string | null,
  startY: number,
): number {
  let y = startY;
  drawText(page, companyName, MARGIN, y - 4, bold, 16, GREEN);
  y -= 20;
  drawText(page, companyAddress, MARGIN, y, font, 8.5, MUTED);
  y -= 13;
  drawText(page, `Doc Ref: ${docRef}`, MARGIN, y, font, 8, MUTED);

  const titleW = bold.widthOfTextAtSize(title, 12);
  drawText(page, title, PAGE_W - MARGIN - titleW, startY - 4, bold, 12, INK);
  if (reportNoLabel) {
    const rptW = font.widthOfTextAtSize(reportNoLabel, 9);
    drawText(page, reportNoLabel, PAGE_W - MARGIN - rptW, startY - 19, font, 9, INK);
  }

  y -= 14;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
    thickness: 1.2, color: GREEN,
  });
  return y - 18;
}

/** Draw the shared Checked By / Approved By signature line block. */
export function drawSignatures(
  page: PDFPage, font: PDFFont,
  checkedBy: string | null, approvedBy: string | null,
  y: number,
): void {
  const sigW = 180;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + sigW, y }, thickness: 0.8, color: INK });
  drawText(page, "Checked By", MARGIN, y - 12, font, 8, MUTED);
  if (checkedBy) drawText(page, checkedBy, MARGIN, y + 4, font, 9, INK);

  const apX = PAGE_W - MARGIN - sigW;
  page.drawLine({ start: { x: apX, y }, end: { x: apX + sigW, y }, thickness: 0.8, color: INK });
  drawText(page, "Approved By", apX, y - 12, font, 8, MUTED);
  if (approvedBy) drawText(page, approvedBy, apX, y + 4, font, 9, INK);
}
