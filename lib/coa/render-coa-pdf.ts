// =============================================================================
// COA PDF renderer — reproduces doc JSCI/QC/17 using pdf-lib (pure JS, no
// headless browser). Renders ENTIRELY from a CoaSnapshot so an issued COA always
// looks identical regardless of later QC/spec changes. Generated in memory;
// never written to disk.
//
// Layout mirrors the two real certificates (MRF #395, Dalmia #400):
//   letterhead (company + office/factory blocks) → title → ship-to → meta grid
//   → parameter table (Sr | Parameters | Actual[per batch] | Spec Min | Max |
//   Method | Remarks) → Checked By / Approved By → footer.
// =============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COA_LETTERHEAD } from "./catalog";

export interface SnapshotRow {
  sr:      number;
  sub?:    "a" | "b" | "c";
  label:   string;
  min:     number | null;
  max:     number | null;
  method:  string | null;
  remarks: string | null;
  /** Per-batch printed actual values, aligned to snapshot.batchNumbers order. */
  actuals: (string | null)[];
  hasSpec: boolean;
}

export interface CoaSnapshot {
  testReportNo: number;
  coaDate:      string;        // dd-mm-yyyy
  docLabel:     string;        // "Invoice No." | "Challan No."
  docValue:     string;        // the invoice/challan number
  vehicleNo:    string;
  lotNo:        string;        // may be "-"
  qty:          string;        // e.g. "10.000 MT"
  batchNumbers: string[];      // e.g. ["347","349"]
  mfgDates:     string[];      // dd-mm-yyyy each
  customerName: string;
  shipTo:       string;        // multi-line ship-to block
  rows:         SnapshotRow[];
  checkedBy:    string;        // logged-in chemist's name
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 32;

const ink   = rgb(0, 0, 0);
const soft  = rgb(0.35, 0.35, 0.35);
const line  = rgb(0.1, 0.1, 0.1);
const faint = rgb(0.6, 0.6, 0.6);

interface Ctx {
  page: PDFPage;
  reg:  PDFFont;
  bold: PDFFont;
  y:    number;
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, font?: PDFFont, color = ink) {
  ctx.page.drawText(s, { x, y, size, font: font ?? ctx.reg, color });
}

function hline(ctx: Ctx, x1: number, x2: number, y: number, thickness = 0.8, color = line) {
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

function vline(ctx: Ctx, x: number, y1: number, y2: number, thickness = 0.8, color = line) {
  ctx.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color });
}

/** Wrap `s` into lines no wider than maxW at the given size. */
function wrap(font: PDFFont, s: string, size: number, maxW: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function fmtLimit(v: number | null): string {
  return v == null ? "-" : String(v);
}

export async function renderCoaPdf(snap: CoaSnapshot): Promise<Buffer> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { page, reg, bold, y: A4.h - MARGIN };

  const left  = MARGIN;
  const right = A4.w - MARGIN;
  const contentW = right - left;

  // ── Letterhead ──────────────────────────────────────────────────────────
  text(ctx, COA_LETTERHEAD.companyName, left, ctx.y, 15, bold);
  ctx.y -= 15;
  text(ctx, COA_LETTERHEAD.tagline, left, ctx.y, 8, reg, soft);
  ctx.y -= 14;
  hline(ctx, left, right, ctx.y, 1.2);
  ctx.y -= 12;

  // Office (left) + Factory (right) address blocks.
  const colR = left + contentW * 0.56;
  let oy = ctx.y;
  for (const l of COA_LETTERHEAD.office) { text(ctx, l, left, oy, 7.5); oy -= 10; }
  let fy = ctx.y;
  for (const l of COA_LETTERHEAD.factory) { text(ctx, l, colR, fy, 7.5); fy -= 10; }
  ctx.y = Math.min(oy, fy) - 4;
  hline(ctx, left, right, ctx.y, 1.2);
  ctx.y -= 18;

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = COA_LETTERHEAD.title;
  const tw = bold.widthOfTextAtSize(title, 12);
  text(ctx, title, (A4.w - tw) / 2, ctx.y, 12, bold);
  ctx.y -= 20;

  // ── Ship-to block ("TO,") ───────────────────────────────────────────────
  text(ctx, "TO,", left, ctx.y, 8.5, bold);
  ctx.y -= 11;
  const shipLines = snap.shipTo.split("\n");
  for (const l of shipLines) { text(ctx, l, left, ctx.y, 8); ctx.y -= 10; }
  ctx.y -= 6;

  // ── Meta grid (two columns) ─────────────────────────────────────────────
  const metaLeft: Array<[string, string]> = [
    ["TEST REPORT NO:", String(snap.testReportNo)],
    ["DATE:", snap.coaDate],
    [snap.docLabel.toUpperCase() + ":", snap.docValue || "-"],
    ["VEHICLE NO:", snap.vehicleNo || "-"],
  ];
  const metaRight: Array<[string, string]> = [
    ["LOT NO:", snap.lotNo || "-"],
    ["QTY:", snap.qty || "-"],
    ["BATCH NO:", snap.batchNumbers.join(", ") || "-"],
    ["MFG DATE:", snap.mfgDates.join(", ") || "-"],
  ];
  let my = ctx.y;
  for (const [k, v] of metaLeft) {
    text(ctx, k, left, my, 7.5, bold);
    text(ctx, v, left + 78, my, 7.5);
    my -= 11;
  }
  let mry = ctx.y;
  for (const [k, v] of metaRight) {
    text(ctx, k, colR, mry, 7.5, bold);
    text(ctx, v, colR + 56, mry, 7.5);
    mry -= 11;
  }
  ctx.y = Math.min(my, mry) - 6;

  // ── Parameter table ──────────────────────────────────────────────────────
  const nB = snap.batchNumbers.length;
  // Column widths: Sr | Parameters | Actual(nB sub-cols) | Min | Max | Method | Remarks
  const wSr = 22;
  const wMin = 34, wMax = 34, wMethod = 50, wRemarks = 58;
  const fixed = wSr + wMin + wMax + wMethod + wRemarks;
  const wActualTotal = Math.max(70, contentW * 0.28);
  const wParam = contentW - fixed - wActualTotal;
  const wActualCol = wActualTotal / Math.max(1, nB);

  const xSr      = left;
  const xParam   = xSr + wSr;
  const xActual  = xParam + wParam;
  const xMin     = xActual + wActualTotal;
  const xMax     = xMin + wMin;
  const xMethod  = xMax + wMax;
  const xRemarks = xMethod + wMethod;
  const xEnd     = right;

  // Header rows (two-deep: top labels, with Actual spanning batch sub-cols,
  // and Spec spanning Min/Max).
  const headTop = ctx.y;
  const headH = 24;
  const headBot = headTop - headH;

  // outer box top
  hline(ctx, left, right, headTop, 1);
  // header texts
  text(ctx, "SR", xSr + 3, headTop - 9, 6.5, bold);
  text(ctx, "NO.", xSr + 2, headTop - 17, 6.5, bold);
  text(ctx, "PARAMETERS", xParam + 4, headTop - 13, 7, bold);
  text(ctx, "ACTUAL REPORT", xActual + 3, headTop - 8, 6.5, bold);
  // batch sub-labels
  for (let i = 0; i < nB; i++) {
    const bx = xActual + i * wActualCol;
    text(ctx, "B-" + snap.batchNumbers[i], bx + 2, headTop - 18, 6, reg);
    if (i > 0) vline(ctx, bx, headBot, headTop - 10, 0.5, faint);
  }
  text(ctx, "PARTY'S SPEC", xMin + 2, headTop - 8, 6, bold);
  text(ctx, "MIN", xMin + 8, headTop - 18, 6, bold);
  text(ctx, "MAX", xMax + 8, headTop - 18, 6, bold);
  text(ctx, "TEST", xMethod + 4, headTop - 8, 6, bold);
  text(ctx, "METHOD", xMethod + 2, headTop - 18, 6, bold);
  text(ctx, "REMARKS", xRemarks + 3, headTop - 13, 6, bold);

  hline(ctx, left, right, headBot, 1);
  ctx.y = headBot;

  // vertical column dividers helper
  const colXs = [xSr, xParam, xActual, xMin, xMax, xMethod, xRemarks, xEnd];

  // body rows
  for (const r of snap.rows) {
    const paramLines = wrap(reg, srLabel(r), 7, wParam - 6);
    const rowH = Math.max(16, paramLines.length * 9 + 6);
    const top = ctx.y;
    const bot = top - rowH;
    const baseY = top - 11;

    // Sr number (only on first sub-row of a mesh group; show "4" with a/b/c)
    const srTxt = r.sub ? `${r.sr}${r.sub})` : String(r.sr);
    text(ctx, srTxt, xSr + 3, baseY, 7, reg);

    // Parameter label (wrapped)
    let ly = baseY;
    for (const pl of paramLines) { text(ctx, pl, xParam + 4, ly, 7, reg); ly -= 9; }

    // Per-batch actuals (red if the row is a fail for that batch — but we only
    // store strings in the snapshot; failing rows never reach the PDF because
    // generation is blocked on out-of-spec. So all printed actuals are passing.)
    for (let i = 0; i < nB; i++) {
      const bx = xActual + i * wActualCol;
      const val = r.actuals[i] ?? "-";
      text(ctx, val, bx + 2, baseY, 7, reg);
      if (i > 0) vline(ctx, bx, bot, top, 0.4, faint);
    }

    // Spec min/max
    text(ctx, r.hasSpec ? fmtLimit(r.min) : "-", xMin + 4, baseY, 7, reg);
    text(ctx, r.hasSpec ? fmtLimit(r.max) : "-", xMax + 4, baseY, 7, reg);

    // Method / remarks (wrapped, small)
    for (const [mx, mw, mtxt] of [
      [xMethod, wMethod, r.method ?? ""],
      [xRemarks, wRemarks, r.remarks ?? ""],
    ] as const) {
      const mlines = wrap(reg, mtxt, 6.5, mw - 4);
      let myy = baseY;
      for (const l of mlines) { text(ctx, l, mx + 2, myy, 6.5, reg); myy -= 8; }
    }

    hline(ctx, left, right, bot, 0.5, faint);
    ctx.y = bot;
  }

  // outer vertical borders down the whole table
  const tableTop = headTop;
  const tableBot = ctx.y;
  for (const cx of colXs) vline(ctx, cx, tableBot, tableTop, 0.8);

  ctx.y -= 26;

  // ── Signatures ────────────────────────────────────────────────────────────
  text(ctx, "CHECKED BY", left, ctx.y, 8, bold);
  text(ctx, snap.checkedBy || "", left + 2, ctx.y - 20, 8, reg);
  hline(ctx, left, left + 130, ctx.y - 24, 0.6, soft);

  const apX = colR + 20;
  text(ctx, "APPROVED BY", apX, ctx.y, 8, bold);
  hline(ctx, apX, apX + 130, ctx.y - 24, 0.6, soft); // blank signature line (manual stamp)

  ctx.y -= 44;

  // ── Footer ──────────────────────────────────────────────────────────────
  hline(ctx, left, right, ctx.y, 0.6, soft);
  ctx.y -= 11;
  text(ctx, COA_LETTERHEAD.footer, left, ctx.y, 7, reg, soft);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/** Mesh sub-rows read a little clearer with the group hint stripped. */
function srLabel(r: SnapshotRow): string {
  return r.label;
}
