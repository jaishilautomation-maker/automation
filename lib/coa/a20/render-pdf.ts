// =============================================================================
// A-20 COA PDF renderer (pdf-lib, in memory). Renders ONLY from an
// A20CoaSnapshot so an issued COA always re-renders identically.
//
// Two document styles, matching the issued certificates:
//   certificate - "Certificate of Analysis": Product / Date / Mfg / Batch /
//                 Quantity on the left, Test report no / Invoice / Lorry on the
//                 right; Sr | Parameter | Units | Specification | Actual Report;
//                 Company Seal + Signature.
//   report      - "ANALYSIS REPORT OF <product>": Date / Quantity / Batch /
//                 Mfg / Expiry; Sr | Parameter | Specifications | Results;
//                 Checked By + Approved By.
// =============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { JAISHIL_LOGO_JPEG_BASE64, JAISHIL_LOGO_WIDTH, JAISHIL_LOGO_HEIGHT } from "../logo-data";
import { A20_LETTERHEAD } from "./catalog";
import type { A20CoaSnapshot } from "./build";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 32;
const ink = rgb(0, 0, 0);
const soft = rgb(0.35, 0.35, 0.35);

interface Ctx { page: PDFPage; reg: PDFFont; bold: PDFFont }

const text = (c: Ctx, s: string, x: number, y: number, size: number, font?: PDFFont, color = ink) =>
  c.page.drawText(s, { x, y, size, font: font ?? c.reg, color });

const hline = (c: Ctx, x1: number, x2: number, y: number, t = 0.8, color = ink) =>
  c.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color });

const vline = (c: Ctx, x: number, y1: number, y2: number, t = 0.8, color = ink) =>
  c.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: t, color });

function wrap(font: PDFFont, s: string, size: number, maxW: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Centre `s` in a cell [x, x+w], shrinking the font if it would overflow. */
function centred(c: Ctx, s: string, x: number, w: number, y: number, size: number, font?: PDFFont) {
  const f = font ?? c.reg;
  let sz = size;
  while (sz > 5 && f.widthOfTextAtSize(s, sz) > w - 6) sz -= 0.25;
  text(c, s, x + (w - f.widthOfTextAtSize(s, sz)) / 2, y, sz, f);
}

export async function renderA20CoaPdf(snap: A20CoaSnapshot): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { page, reg, bold };

  const left = MARGIN;
  const right = A4.w - MARGIN;
  const contentW = right - left;
  let y = A4.h - MARGIN;

  // ── Letterhead ────────────────────────────────────────────────────────────
  const hdrH = 62;
  const hdrTop = y + 4;
  const hdrBot = hdrTop - hdrH;
  page.drawRectangle({ x: left, y: hdrBot, width: contentW, height: hdrH, borderColor: ink, borderWidth: 1 });
  vline(c, left + hdrH, hdrBot, hdrTop, 1);
  try {
    const logo = await doc.embedJpg(Buffer.from(JAISHIL_LOGO_JPEG_BASE64, "base64"));
    const box = hdrH - 8;
    const lw = box * (JAISHIL_LOGO_WIDTH / JAISHIL_LOGO_HEIGHT);
    const scale = lw > box ? box / lw : 1;
    page.drawImage(logo, {
      x: left + (hdrH - lw * scale) / 2,
      y: hdrBot + (hdrH - box * scale) / 2,
      width: lw * scale,
      height: box * scale,
    });
  } catch { /* a missing logo must never block a COA */ }

  const nameArea = right - (left + hdrH);
  let nameSize = 18;
  while (nameSize > 11 && bold.widthOfTextAtSize(A20_LETTERHEAD.companyName, nameSize) > nameArea - 16) nameSize -= 0.5;
  text(c, A20_LETTERHEAD.companyName,
    left + hdrH + (nameArea - bold.widthOfTextAtSize(A20_LETTERHEAD.companyName, nameSize)) / 2,
    hdrTop - 26, nameSize, bold);
  text(c, A20_LETTERHEAD.tagline,
    left + hdrH + (nameArea - bold.widthOfTextAtSize(A20_LETTERHEAD.tagline, 9)) / 2,
    hdrTop - 44, 9, bold, soft);

  y = hdrBot - 14;
  const colR = left + contentW * 0.56;
  let oy = y;
  for (const l of A20_LETTERHEAD.office) { text(c, l, left, oy, 7.5, bold); oy -= 10; }
  let fy = y;
  for (const l of A20_LETTERHEAD.factory) { text(c, l, colR, fy, 7.5, bold); fy -= 10; }
  y = Math.min(oy, fy) - 4;
  hline(c, left, right, y, 1.2);
  y -= 30;

  if (snap.draft) text(c, "DRAFT PREVIEW - NOT ISSUED", right - 150, A4.h - 18, 8, bold, rgb(0.75, 0.1, 0.1));

  // ── Title + header block ──────────────────────────────────────────────────
  if (snap.docStyle === "certificate") {
    const t = "Certificate of Analysis";
    text(c, t, (A4.w - bold.widthOfTextAtSize(t, 16)) / 2, y, 16, bold);
    y -= 38;

    const lx = left + 20, lv = left + 130;
    const rx = left + contentW * 0.62, rv = rx + 90;
    const leftRows: Array<[string, string]> = [
      ["Product :", snap.productTitle],
      ["Date :", snap.coaDate],
      ["Date of Manufacture :", snap.mfgDate],
    ];
    if (snap.expiryDate) leftRows.push(["Date of Expiry :", snap.expiryDate]);
    leftRows.push(["Batch Number:", snap.batchNumber], [`${snap.qtyLabel} :`, snap.qty || "----"]);
    const rightRows: Array<[string, string]> = [
      ["Test report no-", String(snap.testReportNo).padStart(2, "0")],
      ["Invoice No:", snap.invoiceNo || "------"],
      ["Date :", snap.invoiceDate || "------"],
      ["Lorry No:", snap.lorryNo || "------"],
    ];
    let ly = y;
    for (const [k, v] of leftRows) {
      text(c, k, lx, ly, 9, bold);
      let vs = 9;
      while (vs > 6 && bold.widthOfTextAtSize(v, vs) > rx - lv - 8) vs -= 0.25;
      text(c, v, lv, ly, vs, bold);
      ly -= 20;
    }
    let ry = y;
    for (const [k, v] of rightRows) {
      text(c, k, rx, ry, 9, bold);
      text(c, v, rv, ry, 9, bold);
      ry -= 20;
    }
    y = Math.min(ly, ry) - 10;
  } else {
    const t = `ANALYSIS REPORT OF ${snap.productTitle.toUpperCase()}`;
    let ts = 11;
    while (ts > 7 && bold.widthOfTextAtSize(t, ts) > contentW - 20) ts -= 0.25;
    text(c, t, left + 20, y, ts, bold);
    y -= 40;
    const lines: Array<[string, string]> = [
      ["Date", snap.coaDate],
      [snap.qtyLabel, snap.qty || ""],
      ["Batch no", snap.batchNumber],
      ["Mfg date", snap.mfgDate],
    ];
    if (snap.expiryDate) lines.push(["Expiry date", snap.expiryDate]);
    for (const [k, v] of lines) {
      text(c, k, left + 20, y, 10, bold);
      text(c, `: ${v}`, left + 105, y, 10, bold);
      y -= 15;
    }
    text(c, "Test report no", left + 20, y, 10, bold);
    text(c, `: ${String(snap.testReportNo).padStart(2, "0")}`, left + 105, y, 10, bold);
    if (snap.invoiceNo) {
      text(c, "Invoice No", left + contentW * 0.5, y, 10, bold);
      text(c, `: ${snap.invoiceNo}`, left + contentW * 0.5 + 70, y, 10, bold);
    }
    y -= 25;
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  const style = snap.specStyle;
  const cert = snap.docStyle === "certificate";
  // column widths
  let cols: Array<{ title: string; w: number; kind: "sr" | "param" | "unit" | "spec" | "min" | "max" | "actual" }>;
  if (style === "minmax") {
    cols = [
      { title: "Sr. no", w: 40, kind: "sr" }, { title: "Parameter", w: 190, kind: "param" },
      { title: "Units", w: 50, kind: "unit" }, { title: "Min", w: 60, kind: "min" },
      { title: "Max", w: 60, kind: "max" }, { title: "Actual Report", w: contentW - 400, kind: "actual" },
    ];
  } else if (style === "suffix") {
    cols = [
      { title: "Sr.No.", w: 45, kind: "sr" }, { title: "Parameter", w: contentW - 45 - 150 - 120, kind: "param" },
      { title: "Specifications", w: 150, kind: "spec" }, { title: "Results", w: 120, kind: "actual" },
    ];
  } else {
    cols = [
      { title: "Sr. no", w: 45, kind: "sr" }, { title: "Parameter", w: 200, kind: "param" },
      { title: "Units", w: 55, kind: "unit" }, { title: "Specification", w: 115, kind: "spec" },
      { title: "Actual Report", w: contentW - 415, kind: "actual" },
    ];
  }
  const xs: number[] = [];
  { let x = left; for (const col of cols) { xs.push(x); x += col.w; } xs.push(right); }

  const tableTop = y;
  const headH = cert ? 34 : 20;
  hline(c, left, right, tableTop, 1);
  cols.forEach((col, i) => {
    if (style === "minmax" && (col.kind === "min" || col.kind === "max")) return;
    centred(c, col.title, xs[i], col.w, tableTop - headH / 2 - 3, cert ? 9 : 9.5, bold);
  });
  if (style === "minmax") {
    const iMin = cols.findIndex((k) => k.kind === "min");
    centred(c, "Specification", xs[iMin], cols[iMin].w + cols[iMin + 1].w, tableTop - 12, 9, bold);
    centred(c, "Min", xs[iMin], cols[iMin].w, tableTop - headH + 8, 8.5, bold);
    centred(c, "Max", xs[iMin + 1], cols[iMin + 1].w, tableTop - headH + 8, 8.5, bold);
  }
  y = tableTop - headH;
  hline(c, left, right, y, 1);

  const bodySize = cert ? 9 : 9.5;
  for (const r of snap.rows) {
    const pi = cols.findIndex((k) => k.kind === "param");
    const lines = wrap(reg, r.label, bodySize, cols[pi].w - 12);
    const rowH = Math.max(cert ? 28 : 18, lines.length * 11 + 12);
    const baseY = y - rowH / 2 - 3;
    cols.forEach((col, i) => {
      const x = xs[i];
      if (col.kind === "sr") centred(c, cert ? `${r.sr}.` : String(r.sr), x, col.w, baseY, bodySize, reg);
      else if (col.kind === "param") {
        const total = lines.length * 11;
        let ly = y - (rowH - total) / 2 - 9;
        for (const l of lines) {
          if (cert) centred(c, l, x, col.w, ly, bodySize, bold); else text(c, l, x + 4, ly, bodySize, bold);
          ly -= 11;
        }
      }
      else if (col.kind === "unit") centred(c, r.unit, x, col.w, baseY, bodySize, bold);
      else if (col.kind === "spec") centred(c, r.specText, x, col.w, baseY, bodySize, bold);
      else if (col.kind === "min") centred(c, r.specMin, x, col.w, baseY, bodySize, bold);
      else if (col.kind === "max") centred(c, r.specMax, x, col.w, baseY, bodySize, bold);
      else centred(c, r.actual, x, col.w, baseY, bodySize, bold);
    });
    y -= rowH;
    hline(c, left, right, y, 0.8);
  }
  const iMinCol = style === "minmax" ? cols.findIndex((k) => k.kind === "min") : -1;
  for (let i = 0; i < xs.length; i++) {
    // "Specification" spans Min+Max: the Min|Max divider starts below the span title.
    vline(c, xs[i], y, i === iMinCol + 1 && iMinCol >= 0 ? tableTop - headH / 2 : tableTop, 0.8);
  }
  if (iMinCol >= 0) hline(c, xs[iMinCol], xs[iMinCol + 2], tableTop - headH / 2, 0.8);

  // ── Signatures ────────────────────────────────────────────────────────────
  y -= 70;
  if (cert) {
    text(c, "Company Seal", left + 40, y, 10, bold);
    text(c, "Signature", right - 130, y, 10, bold);
    hline(c, right - 150, right - 30, y + 28, 0.6, soft);
  } else {
    text(c, "CHECKED BY", left + 10, y, 9, bold);
    if (snap.checkedBy) text(c, snap.checkedBy, left + 10, y - 16, 9);
    text(c, "APPROVED BY", left + contentW * 0.62, y, 9, bold);
    hline(c, left + contentW * 0.62, left + contentW * 0.62 + 120, y + 28, 0.6, soft);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const pg = "Page 1 of 1";
  text(c, pg, right - reg.widthOfTextAtSize(pg, 10), MARGIN, 10, reg, soft);

  return Buffer.from(await doc.save());
}
