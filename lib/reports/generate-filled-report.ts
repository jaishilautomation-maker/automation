// =============================================================================
// generate-filled-report.ts
//
// Given a finalized QC record (+ its product/material + form type), produce a
// populated .xlsx report and email it as an attachment. The report is built
// entirely IN-MEMORY and is NEVER written back to Storage or any persistent
// location — the only durable trace is the notification_log row that sendEmail
// writes (proof of submission without keeping the file).
//
// Flow:
//   1. Resolve the template basename from (source, product/material code) and
//      load the .xlsx + field-map .json from the private `report-templates`
//      bucket, in-memory, via the service-role client.
//   2. Load the finalized DB record + a few joins (batch, product/material,
//      chemist) so every field reference in the map can be resolved.
//   3. Open the template with exceljs, write each mapped value into its Named
//      Range, export to a Buffer.
//   4. Attach the Buffer to the outgoing email (role-routed recipients), which
//      also logs the attempt to notification_log.
//
// This module is server-only (uses SUPABASE_SERVICE_ROLE_KEY). Import it only
// from API route handlers.
// =============================================================================

import "server-only";
import ExcelJS from "exceljs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  sendEmail,
  XLSX_CONTENT_TYPE,
  type EmailAttachment,
} from "@/lib/notifications/send-email";
import { recipientsFor } from "@/lib/reports/recipients";
import {
  templateBasename,
  templateFiles,
  formTypeFor,
  type ReportSource,
  type ReportVariant,
  type ReportFieldMap,
} from "@/lib/reports/template-map";
import { paramsForParty } from "@/lib/reports/batch-analysis-params";

const BUCKET = "report-templates";

// ---------------------------------------------------------------------------
// Service-role client (same inline pattern as the other Lab QC report routes).
// ---------------------------------------------------------------------------
function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface GenerateReportArgs {
  /** Which finalization event fired this. Determines the form type. */
  source: ReportSource;
  /** Primary key of the finalized row in the source table. */
  recordId: string;
  /** batch_analysis only: "final" (JSCI/QC/16) vs "inprocess" (Finish Goods). */
  variant?: ReportVariant;
  /** For COA reports: the coa_documents.id (source row is coa_documents). */
  factoryId?: string;
}

export interface GenerateReportResult {
  ok: boolean;
  /** Populated filename that was emailed (for logging / debugging). */
  filename?: string;
  /** Size of the generated attachment in bytes (spot-check the "small" claim). */
  sizeBytes?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------
export async function generateAndEmailReport(
  args: GenerateReportArgs
): Promise<GenerateReportResult> {
  const supabase = getServiceClient();

  // 1) Load the finalized record + joins into a flat, referenceable object.
  const record = await loadRecord(supabase, args.source, args.recordId);
  if (!record) {
    return { ok: false, reason: `record not found: ${args.source}/${args.recordId}` };
  }

  const productCode = record.__product_code as string | null;
  const basename = templateBasename(args.source, productCode, args.variant);

  // 2+3) Produce the populated workbook Buffer.
  //   batch_analysis → DYNAMIC: build a party-filtered, results-only table in
  //   code (no fixed template), so the report shows exactly the party's
  //   parameters and nothing blank. Every other source keeps the fixed
  //   named-range template path.
  let filled: Buffer;
  if (args.source === "batch_analysis") {
    filled = await buildBatchAnalysisWorkbook(record, args.variant);
  } else if (args.source === "job_card") {
    filled = await buildJobCardWorkbook(record);
  } else {
    const { xlsx: xlsxName, json: jsonName } = templateFiles(basename);
    const templateBuf = await downloadFile(supabase, xlsxName);
    if (!templateBuf) {
      return { ok: false, reason: `template not found in bucket: ${xlsxName}` };
    }
    const fieldMap = await loadFieldMap(supabase, jsonName);
    if (!fieldMap) {
      return { ok: false, reason: `field map not found in bucket: ${jsonName}` };
    }
    filled = await populateWorkbook(templateBuf, fieldMap, record);
  }
  const filename = `${basename}_${safeRef(record)}.xlsx`;

  const attachment: EmailAttachment = {
    filename,
    contentType: XLSX_CONTENT_TYPE,
    content: filled,
  };

  // 4) Email (role-routed) + log. sendEmail never throws and writes
  //    notification_log for us.
  const formType = formTypeFor(args.source, args.variant);
  const recipients = recipientsFor(formType);
  const subject = buildSubject(args.source, record, args.variant);

  await sendEmail({
    eventType: `report_${args.source}`,
    subject,
    html: buildBodyHtml(args.source, record, filename),
    recipients,
    factoryId: (record.factory_id as string) ?? args.factoryId,
    referenceId: args.recordId,
    attachments: [attachment],
  });

  return { ok: true, filename, sizeBytes: filled.byteLength };
}

// ---------------------------------------------------------------------------
// Storage helpers (in-memory only).
// ---------------------------------------------------------------------------
async function downloadFile(
  supabase: SupabaseClient,
  name: string
): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(name);
  if (error || !data) {
    // Surface the exact reason: missing bucket vs missing object vs auth.
    console.error(
      `[generate-report] storage download failed for "${BUCKET}/${name}":`,
      error ? error.message : "no data returned"
    );
    return null;
  }
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function loadFieldMap(
  supabase: SupabaseClient,
  jsonName: string
): Promise<ReportFieldMap | null> {
  const buf = await downloadFile(supabase, jsonName);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf-8")) as ReportFieldMap;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// exceljs population: write each mapped value into its Named Range.
// ---------------------------------------------------------------------------
async function populateWorkbook(
  templateBuf: Buffer,
  fieldMap: ReportFieldMap,
  record: FlatRecord
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Pass a fresh ArrayBuffer slice — avoids a Node/exceljs Buffer type-nominal
  // mismatch and gives exceljs an isolated buffer to read.
  const ab = templateBuf.buffer.slice(
    templateBuf.byteOffset,
    templateBuf.byteOffset + templateBuf.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(ab);

  for (const [namedRange, reference] of Object.entries(fieldMap.fields)) {
    const value = resolveReference(reference, record);
    if (value === undefined) continue; // no data → leave the cell blank
    writeNamedRange(workbook, namedRange, value);
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Dynamic batch-analysis workbook — built entirely in code (no fixed template).
// Shows ONLY the selected party's calculated result parameters (or the full
// default set when no party). Results only — raw inputs stay in the text email.
// ---------------------------------------------------------------------------
async function buildBatchAnalysisWorkbook(
  record: FlatRecord,
  variant?: ReportVariant
): Promise<Buffer> {
  const tr = (record.test_results ?? {}) as Record<string, unknown>;
  const partyKeys = record.__party_result_keys as string[] | undefined;
  const params = paramsForParty(partyKeys);
  const isInprocess = variant === "inprocess";

  const wb = new ExcelJS.Workbook();
  wb.creator = "JSCI Automation";
  const ws = wb.addWorksheet(isInprocess ? "Finish Goods Testing" : "Final Inspection");
  ws.columns = [{ width: 8 }, { width: 40 }, { width: 18 }, { width: 28 }];

  const thin = { style: "thin" as const };
  const medium = { style: "medium" as const };
  const boxAll = { top: thin, left: thin, bottom: thin, right: thin };
  const setBox = (cell: string) => { ws.getCell(cell).border = boxAll; };
  const centre = (cell: string) => {
    ws.getCell(cell).alignment = { horizontal: "center", vertical: "middle" };
  };
  // Shared fills for a cleaner, printable look.
  const HEADER_FILL = "FFEFE7DA"; // warm sand — company header band
  const TABLE_HEAD_FILL = "FFE4EFE3"; // soft green — parameter table header
  const fill = (cell: string, argb: string) => {
    ws.getCell(cell).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  };

  // Header band
  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = "M/s JAISHIL SULPHUR & CHEMICAL INDUSTRIES";
  ws.getCell("A1").font = { bold: true, size: 14 }; centre("A1");
  ws.getRow(1).height = 22;
  ws.mergeCells("A2:D2");
  ws.getCell("A2").value = "Plot No-A-20/1 MIDC, Phase-I, DOMBIVALI"; centre("A2");
  ws.mergeCells("A3:D3");
  ws.getCell("A3").value = isInprocess
    ? "FINISH GOODS TESTING OF SULPHUR"
    : "FINAL INSPECTION RECORD";
  ws.getCell("A3").font = { bold: true, underline: true, size: 12 }; centre("A3");
  ws.getRow(3).height = 20;
  // Header band fill + border box around the 3 title rows.
  for (const row of [1, 2, 3]) {
    for (const c of ["A", "B", "C", "D"]) {
      fill(`${c}${row}`, HEADER_FILL);
    }
  }
  ws.getCell("A1").border = { top: medium, left: medium, right: medium };
  ws.getCell("D1").border = { top: medium, right: medium };
  ws.getCell("A3").border = { left: medium, bottom: medium };
  ws.getCell("D3").border = { right: medium, bottom: medium };

  // Meta block — two-column label/value grid (Mfg + Analysis dates included).
  const meta: [string, string][] = [
    ["Manufacturing Date:", str(tr.mfg_date)],
    ["Analysis Date:", str(record.analysis_date)],
    ["Item:", "SULPHUR POWDER - 99.5%"],
    ["Sr No:", str(tr.sr_no)],
    ["Job No:", str(tr.job_no)],
    ["Shift:", str(tr.shift)],
    ["Lot No:", str(tr.lot_no)],
    ["Batch No:", str(record.batch_no)],
    ["Customer:", str(record.customer_name) || "— (no party — full set)"],
    ["Checked By:", str(record.chemist_name)],
  ];
  let r = 5;
  for (const [label, value] of meta) {
    ws.getCell(`A${r}`).value = label; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).alignment = { vertical: "middle" };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = value;
    ws.getCell(`B${r}`).alignment = { vertical: "middle" };
    setBox(`A${r}`); setBox(`B${r}`); setBox(`C${r}`); setBox(`D${r}`);
    r++;
  }

  // Parameter table header
  r++;
  const H = r;
  ws.getCell(`A${H}`).value = "SR NO";
  ws.getCell(`B${H}`).value = "PARAMETER";
  ws.getCell(`C${H}`).value = "OBSERVATION IN %";
  ws.getCell(`D${H}`).value = "REMARKS";
  ws.getRow(H).height = 18;
  for (const c of ["A", "B", "C", "D"]) {
    ws.getCell(`${c}${H}`).font = { bold: true };
    fill(`${c}${H}`, TABLE_HEAD_FILL);
    ws.getCell(`${c}${H}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    setBox(`${c}${H}`);
  }
  r++;

  // One row per party (or full) result parameter — RESULT ONLY.
  let sr = 1;
  for (const p of params) {
    const v = tr[p.resultKey];
    const display =
      v !== undefined && v !== null && v !== "" ? String(v) : "";
    ws.getCell(`A${r}`).value = sr; centre(`A${r}`);
    ws.getCell(`B${r}`).value = p.unit ? `${p.label} (${p.unit})` : p.label;
    ws.getCell(`C${r}`).value = display;
    for (const c of ["A", "B", "C", "D"]) setBox(`${c}${r}`);
    r++; sr++;
  }

  // In-process: rework action + reasons/reassigned party.
  if (isInprocess) {
    r++;
    ws.getCell(`A${r}`).value = "Confirmation / Non-Confirmation of Finish Goods";
    ws.getCell(`A${r}`).font = { bold: true }; r++;
    ws.getCell(`A${r}`).value = "Rework Action:"; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = str(record.rework_label); setBox(`B${r}`); r++;
    ws.getCell(`A${r}`).value = "Reasons / Reassigned Party:"; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = str(record.remarks); setBox(`B${r}`); r++;
  } else {
    r++;
    ws.getCell(`A${r}`).value = "Remarks:"; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = str(record.remarks); setBox(`B${r}`); r++;
  }

  // Footer
  r++;
  ws.getCell(`A${r}`).value = isInprocess
    ? "Doc. No. JSCI/QC (Finish Goods Testing)"
    : "Doc. No. JSCI/QC/16";
  ws.getCell(`C${r}`).value = "Rev: 00";
  ws.getCell(`D${r}`).value = "Authorised Sign.";

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** Format an ISO "YYYY-MM-DD" as "DD/MM/YYYY"; pass through anything else. */
function fmtIsoDate(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** Coerce a record value to a display string (empty for null/undefined). */
function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

// ---------------------------------------------------------------------------
// Pulveriser Job Card workbook — code-generated on Lab QC OK finalization.
// Layout mirrors the physical JSCI/PROD/02 form:
//   • Company header (merged, centred)
//   • Production header grid (2×2 pairs across the row)
//   • Batch details + sulphur/oil in a grid
//   • Hourly readings table (with Low Prod Reason column)
//   • Daily checkpoint checkboxes
//   • Stores & Oil consumption summary
//   • Four-column signature block
//   • QC sign-off
// ---------------------------------------------------------------------------
async function buildJobCardWorkbook(record: FlatRecord): Promise<Buffer> {
  const d = record;
  // All entries of this job number (set by loadJobCard). Falls back to the one
  // finalized card when the job has a single entry / null job_number.
  const entries = ((d.__entries as Record<string, unknown>[]) ?? [d]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "JSCI Automation";
  const ws = wb.addWorksheet("Job Card");

  // 8 columns to support the wide table.
  // A   B      C        D       E       F       G       H
  // col widths
  ws.columns = [
    { width: 5  },  // A – Sr. No.
    { width: 20 },  // B – माल का कोड नंबर / label
    { width: 22 },  // C – Sulphur details / value
    { width: 22 },  // D – Oil details / value
    { width: 14 },  // E – Classifier VFD / value
    { width: 14 },  // F – Blower In / Blower Out
    { width: 14 },  // G – FG Bag / Packing
    { width: 16 },  // H – Work details / notes
  ];

  const thin   = { style: "thin"   as const };
  const medium = { style: "medium" as const };
  const box    = { top: thin, left: thin, bottom: thin, right: thin };
  const mbox   = { top: medium, left: medium, bottom: medium, right: medium };

  const setBox  = (cell: string) => { ws.getCell(cell).border = box; };
  const setMBox = (cell: string) => { ws.getCell(cell).border = mbox; };
  const centre  = (cell: string) => {
    ws.getCell(cell).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };
  const wrap = (cell: string) => {
    ws.getCell(cell).alignment = { vertical: "middle", wrapText: true };
  };

  const HEADER_FILL  = "FFEFE7DA";
  const SECTION_FILL = "FFE8F5E9";
  const TABLE_H_FILL = "FFE4EFE3";
  const fillCell = (cell: string, argb: string) => {
    ws.getCell(cell).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  };

  // Production values stored in MT; display as kg (×1000).
  const mtToKg = (v: unknown): string =>
    typeof v === "number" ? String(v * 1000) : v == null ? "" : String(v);

  let r = 1;

  // ── Company header ────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "M/s JAISHIL SULPHUR & CHEMICAL INDUSTRIES";
  ws.getCell(`A${r}`).font  = { bold: true, size: 14 };
  ws.getRow(r).height = 22; centre(`A${r}`);
  for (const c of ["A","B","C","D","E","F","G","H"]) fillCell(`${c}${r}`, HEADER_FILL);
  r++;

  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "Plot No-A-20/1 MIDC, Phase-I, DOMBIVALI";
  centre(`A${r}`);
  for (const c of ["A","B","C","D","E","F","G","H"]) fillCell(`${c}${r}`, HEADER_FILL);
  r++;

  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "PULVERISER JOB CARD (Form JSCI/PROD/02)";
  ws.getCell(`A${r}`).font  = { bold: true, underline: true, size: 12 };
  ws.getRow(r).height = 20; centre(`A${r}`);
  for (const c of ["A","B","C","D","E","F","G","H"]) fillCell(`${c}${r}`, HEADER_FILL);
  r++;
  r++; // blank spacer

  // ── Production header grid (4 label-value pairs across 2 rows) ────────────
  // Row 1: Machine | Job Number | Shift | Job Date
  const hdrLabels1 = ["Machine Number", "Job Number", "Shift", "Job Date"];
  const hdrVals1   = [str(d.machine_number), str(d.job_number), str(d.shift), str(d.job_date)];
  // Columns A–B = Machine, C–D = Job Number, E–F = Shift, G–H = Job Date
  const hdrCols = [["A","B"],["C","D"],["E","F"],["G","H"]];
  for (let i = 0; i < 4; i++) {
    const [lc, vc] = hdrCols[i];
    ws.getCell(`${lc}${r}`).value = hdrLabels1[i];
    ws.getCell(`${lc}${r}`).font  = { bold: true };
    ws.getCell(`${lc}${r}`).border = box; fillCell(`${lc}${r}`, SECTION_FILL);
    ws.getCell(`${vc}${r}`).value = hdrVals1[i];
    ws.getCell(`${vc}${r}`).border = box; centre(`${vc}${r}`);
  }
  ws.getRow(r).height = 18; r++;

  // Row 2: Batch/Material Code | Party/CODE | Planned Production | Oil Required
  // For a multi-entry job these differ per entry, so the header shows a job
  // summary (count + totals) and the per-entry values appear in the table below.
  const multi = entries.length > 1;
  const sumPlannedKg = entries.reduce((s, e) =>
    s + (typeof e.planned_production_mt === "number" ? (e.planned_production_mt as number) * 1000 : 0), 0);
  const sumOilReq = entries.reduce((s, e) =>
    s + (typeof e.oil_required_kg === "number" ? (e.oil_required_kg as number) : 0), 0);
  const hdrLabels2 = ["Batch / Material Code", "Party / CODE", "Planned Prod. (kg)", "Oil Required (kg)"];
  const hdrVals2   = multi
    ? [
        `${entries.length} entries (see below)`,
        `${entries.length} entries (see below)`,
        `${Math.round(sumPlannedKg)} (total)`,
        `${Math.round(sumOilReq)} (total)`,
      ]
    : [
        str(d.material_code), str(d.party_code),
        mtToKg(d.planned_production_mt), str(d.oil_required_kg),
      ];
  for (let i = 0; i < 4; i++) {
    const [lc, vc] = hdrCols[i];
    ws.getCell(`${lc}${r}`).value = hdrLabels2[i];
    ws.getCell(`${lc}${r}`).font  = { bold: true };
    ws.getCell(`${lc}${r}`).border = box; fillCell(`${lc}${r}`, SECTION_FILL);
    ws.getCell(`${vc}${r}`).value = hdrVals2[i];
    ws.getCell(`${vc}${r}`).border = box; centre(`${vc}${r}`);
  }
  ws.getRow(r).height = 18; r++;
  r++;

  // ── Sulphur & Oil side-by-side block ─────────────────────────────────────
  // Only for a single-entry job; for multi-entry jobs each entry's sulphur/oil
  // appears in the per-entry Operator Details table below (avoids showing just
  // the first entry's values as if they were the whole job's).
  if (entries.length <= 1) {
    ws.mergeCells(`A${r}:D${r}`);
    ws.getCell(`A${r}`).value = "Sulphur Details";
    ws.getCell(`A${r}`).font  = { bold: true, color: { argb: "FF1B5E20" } };
    fillCell(`A${r}`, SECTION_FILL);
    ws.mergeCells(`E${r}:H${r}`);
    ws.getCell(`E${r}`).value = "Oil Details";
    ws.getCell(`E${r}`).font  = { bold: true, color: { argb: "FF1B5E20" } };
    fillCell(`E${r}`, SECTION_FILL); r++;

    const sulRows = [
      ["Supplier",   str(d.sulphur_supplier)],
      ["Lot Number", str(d.sulphur_lot_number)],
      ["Date RM Received", str(d.sulphur_empty_date)],
    ];
    const oilRows = [
      ["Supplier",       str(d.oil_supplier)],
      // oil_batch_number column now holds the Oil Received Date (ISO).
      ["Received Date",  fmtIsoDate(d.oil_batch_number)],
      ["Quantity (kg)",  str(d.oil_quantity ?? "")],
    ];
    for (let i = 0; i < 3; i++) {
      ws.getCell(`A${r}`).value = sulRows[i][0]; ws.getCell(`A${r}`).font = { bold: true };
      ws.mergeCells(`B${r}:D${r}`); ws.getCell(`B${r}`).value = sulRows[i][1];
      ws.getCell(`E${r}`).value = oilRows[i][0]; ws.getCell(`E${r}`).font = { bold: true };
      ws.mergeCells(`F${r}:H${r}`); ws.getCell(`F${r}`).value = oilRows[i][1];
      for (const c of ["A","B","E","F"]) setBox(`${c}${r}`);
      r++;
    }
    r++;
  }

  // ── Operator details table ────────────────────────────────────────────────
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "Operator Details";
  ws.getCell(`A${r}`).font  = { bold: true, size: 11, color: { argb: "FF1B5E20" } };
  fillCell(`A${r}`, SECTION_FILL); r++;

  // Table header row (Hindi labels matching physical form)
  const opHeaders = [
    "#",
    "माल का कोड नंबर",
    "सल्फर सप्लायर / लॉट / तारीख",
    "तेल सप्लायर / प्राप्ति तारीख",
    "Classifier VFD",
    "Blower In / Out",
    "FG Bag / Packing",
    "काम का विवरण",
  ];
  ws.getRow(r).height = 32;
  opHeaders.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font  = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = box;
    cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: TABLE_H_FILL } };
  });
  r++;

  // One data row PER ENTRY of this job number (Production files 1..N entries).
  entries.forEach((en, idx) => {
    ws.getRow(r).height = 28;
    const opValues = [
      String(idx + 1),
      str(en.material_code),
      [str(en.sulphur_supplier), str(en.sulphur_lot_number), str(en.sulphur_empty_date)].filter(Boolean).join(" / "),
      [str(en.oil_supplier), fmtIsoDate(en.oil_batch_number)].filter(Boolean).join(" / "),
      str(en.classifier_vfd),
      [str(en.blower_inlet_valve), str(en.blower_outlet_valve)].filter(Boolean).join(" / "),
      [str(en.finished_goods_bag) ? `${str(en.finished_goods_bag)} bags` : "", str(en.packing_size) ? `${str(en.packing_size)} kg` : ""].filter(Boolean).join(", "),
      str(en.work_details),
    ];
    opValues.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: "center" };
      cell.border = box;
    });
    r++;
  });
  r++;

  // ── Daily checkpoints ─────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "दैनिक जाँच बिंदु (Daily Checkpoints)";
  ws.getCell(`A${r}`).font  = { bold: true, color: { argb: "FF1B5E20" } };
  fillCell(`A${r}`, SECTION_FILL); r++;

  // Checkpoints are per-entry; show one line per entry when there are several.
  entries.forEach((en, idx) => {
    if (entries.length > 1) {
      ws.getCell(`A${r}`).value = `Entry ${idx + 1} — ${str(en.material_code)}`;
      ws.getCell(`A${r}`).font = { bold: true, size: 9, color: { argb: "FF555555" } };
      r++;
    }
    const checks = [
      ["1. मशीन की सफाई (Machine Cleaning)", en.checkpoint_machine_cleaning],
      ["2. रोलर की जाँच (Roller Check)",     en.checkpoint_roller_check],
      ["3. जाली के कपड़े की जाँच (Mesh Cloth Check)", en.checkpoint_mesh_cloth_check],
    ];
    checks.forEach(([label, val], i) => {
      const col = ["A","C","F"][i];
      const vcol= ["B","D","G"][i];
      ws.getCell(`${col}${r}`).value = String(label);
      ws.getCell(`${col}${r}`).font  = { bold: false, size: 10 };
      ws.getCell(`${vcol}${r}`).value = val ? "✓" : "✗";
      ws.getCell(`${vcol}${r}`).font  = { bold: true, size: 13, color: { argb: val ? "FF1B5E20" : "FFCC0000" } };
      ws.getCell(`${vcol}${r}`).alignment = { horizontal: "center" };
      setBox(`${col}${r}`); setBox(`${vcol}${r}`);
    });
    ws.getRow(r).height = 20; r++;
  });
  r++;

  // ── Hourly readings table ──────────────────────────────────────────────────
  const readings = (d.__readings as Record<string, unknown>[]) ?? [];
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = `तास रिडींग / Hourly Readings (${readings.length})`;
  ws.getCell(`A${r}`).font  = { bold: true, size: 11, color: { argb: "FF1B5E20" } };
  fillCell(`A${r}`, SECTION_FILL); r++;

  const rdHdrs = ["Date", "Machine", "Start", "Stop", "Hours", "Planned", "Batch No", "Bags"];
  ws.getRow(r).height = 18;
  rdHdrs.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h; cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = box;
    cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: TABLE_H_FILL } };
  });
  r++;

  if (readings.length === 0) {
    ws.mergeCells(`A${r}:H${r}`);
    ws.getCell(`A${r}`).value = "No readings recorded.";
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    r++;
  } else {
    for (const rd of readings) {
      const row = [
        str(rd.reading_date), str(rd.machine),
        str(rd.start_time), str(rd.stop_time), str(rd.total_hours),
        str(rd.planned_production), str(rd.batch_no), str(rd.bags),
      ];
      row.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = box;
      });
      // Low production reason as a sub-row if present
      if (rd.low_production_reason) {
        r++;
        ws.mergeCells(`A${r}:H${r}`);
        ws.getCell(`A${r}`).value = `  ↳ Low prod. reason: ${str(rd.low_production_reason)}`;
        ws.getCell(`A${r}`).font  = { italic: true, color: { argb: "FFCC6600" }, size: 9 };
      }
      r++;
    }
  }
  r++;

  // ── Stores & Oil consumption summary ──────────────────────────────────────
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "Stores & Oil Consumption";
  ws.getCell(`A${r}`).font  = { bold: true, size: 11, color: { argb: "FF1B5E20" } };
  fillCell(`A${r}`, SECTION_FILL); r++;

  // Oil consumption + stores figures are per entry; render one block per entry.
  entries.forEach((en, idx) => {
    if (entries.length > 1) {
      ws.mergeCells(`A${r}:H${r}`);
      ws.getCell(`A${r}`).value = `Entry ${idx + 1} — ${str(en.material_code)}`;
      ws.getCell(`A${r}`).font = { bold: true, size: 9, color: { argb: "FF555555" } };
      r++;
    }
    const oilSumRows: [string, string][] = [
      ["Oil Issued (kg)",               str(en.oil_issued_kg)],
      ["Actual Production (kg)",        mtToKg(en.actual_production_mt)],
      ["Expected Oil (kg)",             str(en.expected_oil_kg)],
      ["Actual Oil Consumption (kg)",   str(en.actual_oil_consumption_kg)],
      ["Oil Variance (kg)",             str(en.oil_variance_kg)],
      ["Extra / Leftover Balance (kg)", str(en.oil_extra_leftover_balance_kg)],
      ["Oil Consumption %",             typeof en.oil_consumption_percent === "number" ? `${(en.oil_consumption_percent as number).toFixed(2)}%` : str(en.oil_consumption_percent)],
      ["QC Incharge Note",              str(en.qc_incharge_note)],
      ["Stores Incharge Note",          str(en.stores_incharge_note)],
    ];
    // Two pairs per row (4 columns each)
    for (let i = 0; i < oilSumRows.length; i += 2) {
      const [l1, v1] = oilSumRows[i];
      const [l2, v2] = oilSumRows[i + 1] ?? ["", ""];
      ws.getCell(`A${r}`).value = l1; ws.getCell(`A${r}`).font = { bold: true };
      ws.mergeCells(`B${r}:D${r}`); ws.getCell(`B${r}`).value = v1;
      ws.getCell(`E${r}`).value = l2; ws.getCell(`E${r}`).font = { bold: true };
      ws.mergeCells(`F${r}:H${r}`); ws.getCell(`F${r}`).value = v2;
      for (const c of ["A","B","E","F"]) setBox(`${c}${r}`);
      r++;
    }
  });
  r++;

  // ── QC Sign-off ────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "QC Sign-off";
  ws.getCell(`A${r}`).font  = { bold: true, size: 11, color: { argb: "FF1B5E20" } };
  fillCell(`A${r}`, SECTION_FILL); r++;

  const labResult = d.__lab_result === "ok" ? "OK — Finalized ✓" : str(d.__lab_result);
  const qcRows: [string, string][] = [
    ["Lab Result",   labResult],
    ["Lab Remark",   str(d.__lab_remark)],
    ["Reviewed By",  str(d.__lab_by)],
    ["Reviewed At",  str(d.__lab_at)],
  ];
  for (const [lbl, val] of qcRows) {
    ws.getCell(`A${r}`).value = lbl; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:H${r}`); ws.getCell(`B${r}`).value = val;
    setBox(`A${r}`); setBox(`B${r}`);
    r++;
  }
  r++;

  // ── Signature block ────────────────────────────────────────────────────────
  ws.getRow(r).height = 40;
  const sigLabels = ["Operator", "Maintenance\nIncharge", "Production\nIncharge", "QC Incharge"];
  const sigCols   = [["A","B"],["C","D"],["E","F"],["G","H"]];
  sigLabels.forEach((lbl, i) => {
    const [lc, vc] = sigCols[i];
    ws.mergeCells(`${lc}${r}:${vc}${r}`);
    ws.getCell(`${lc}${r}`).value = lbl;
    ws.getCell(`${lc}${r}`).font  = { bold: true, size: 9 };
    ws.getCell(`${lc}${r}`).alignment = { horizontal: "center", vertical: "bottom", wrapText: true };
    setMBox(`${lc}${r}`);
  });
  r++;

  // ── Footer ─────────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = "DOC NO- JSCI/PROD/02    REV: 02    Date: 01/01/2024";
  ws.getCell(`A${r}`).font  = { size: 8, italic: true };
  ws.mergeCells(`E${r}:H${r}`);
  ws.getCell(`E${r}`).value = "Authorised Sign.";
  ws.getCell(`E${r}`).alignment = { horizontal: "right" };
  ws.getCell(`E${r}`).font  = { bold: true };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/**
 * Write a value into every cell of a Named Range. definedNames.getRanges
 * returns entries like `Sheet1!$B$5` or `Sheet1!$B$5:$B$5`; we expand each and
 * set the value on the target cell(s).
 */
function writeNamedRange(
  workbook: ExcelJS.Workbook,
  name: string,
  value: string | number | boolean
): void {
  const { ranges } = workbook.definedNames.getRanges(name);
  if (!ranges || ranges.length === 0) return; // Named Range not in workbook

  for (const rangeStr of ranges) {
    const parsed = parseRange(rangeStr);
    if (!parsed) continue;
    const sheet = workbook.getWorksheet(parsed.sheet);
    if (!sheet) continue;
    // For a single-cell name (the common case) start === end.
    for (let r = parsed.startRow; r <= parsed.endRow; r++) {
      for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        sheet.getCell(r, c).value = value as ExcelJS.CellValue;
      }
    }
  }
}

interface ParsedRange {
  sheet: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** Parse `Sheet Name!$B$5` or `Sheet!$B$5:$C$7` into row/col bounds. */
function parseRange(rangeStr: string): ParsedRange | null {
  const bang = rangeStr.lastIndexOf("!");
  if (bang < 0) return null;
  let sheet = rangeStr.slice(0, bang);
  // Sheet names with spaces/specials are wrapped in single quotes: 'My Sheet'
  if (sheet.startsWith("'") && sheet.endsWith("'")) {
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }
  const addr = rangeStr.slice(bang + 1);
  const [a, b] = addr.split(":");
  const start = parseCellAddress(a);
  if (!start) return null;
  const end = b ? parseCellAddress(b) : start;
  if (!end) return null;
  return {
    sheet,
    startRow: Math.min(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endRow: Math.max(start.row, end.row),
    endCol: Math.max(start.col, end.col),
  };
}

/** `$B$5` / `B5` → { row, col } (1-indexed). */
function parseCellAddress(a: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a.trim());
  if (!m) return null;
  const col = colToNumber(m[1]);
  const row = parseInt(m[2], 10);
  if (!col || !row) return null;
  return { row, col };
}

function colToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Field reference resolution: "table.column" or "table.test_results.key".
// ---------------------------------------------------------------------------
type FlatRecord = Record<string, unknown> & {
  test_results?: Record<string, unknown>;
};

function resolveReference(
  reference: string,
  record: FlatRecord
): string | number | boolean | undefined {
  const parts = reference.split(".");
  // Drop the leading table name — the record is already the right row.
  // Supported: <table>.<column>  and  <table>.test_results.<key>
  if (parts.length >= 3 && parts[1] === "test_results") {
    const key = parts.slice(2).join(".");
    const v = record.test_results?.[key];
    return normaliseValue(v);
  }
  const column = parts[parts.length - 1];
  return normaliseValue(record[column]);
}

function normaliseValue(
  v: unknown
): string | number | boolean | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v;
  // dates / objects → string
  return String(v);
}

// ---------------------------------------------------------------------------
// Record loading — one query per source, flattened with derived aliases so the
// field map can reference `batch_no`, `product_name`, `chemist_name`, etc.
// ---------------------------------------------------------------------------
async function loadRecord(
  supabase: SupabaseClient,
  source: ReportSource,
  recordId: string
): Promise<FlatRecord | null> {
  switch (source) {
    case "rm_qc":
      return loadRmQc(supabase, recordId);
    case "batch_analysis":
      return loadBatchAnalysis(supabase, recordId);
    case "product_qc":
      return loadProductQc(supabase, recordId);
    case "coa":
      return loadCoa(supabase, recordId);
    case "job_card":
      return loadJobCard(supabase, recordId);
  }
}

async function loadJobCard(
  supabase: SupabaseClient,
  id: string
): Promise<FlatRecord | null> {
  const { data, error } = await supabase
    .from("pulveriser_job_cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[generate-report] pulveriser_job_cards load error:", error.message);
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;

  // ── Gather ALL entries that share this card's job_number ──────────────────
  // Production files up to several entries under one job_number; the finalized
  // report should cover every entry of that job, not just the one that was
  // reviewed. Fall back to this single card when job_number is null/empty.
  const jobNumber = (d.job_number as string | null) ?? null;
  let entries: Record<string, unknown>[] = [d];
  if (jobNumber && jobNumber.trim() !== "") {
    const { data: siblings } = await supabase
      .from("pulveriser_job_cards")
      .select("*")
      .eq("factory_id", d.factory_id as string)
      .eq("job_number", jobNumber)
      .order("created_at");
    if (siblings && siblings.length > 0) {
      entries = siblings as Record<string, unknown>[];
    }
  }
  const entryIds = entries.map(e => e.id as string);

  // Hourly readings for ALL entries of this job (readings are job-level, but we
  // union across every entry id so none are missed regardless of anchor).
  const { data: readings } = await supabase
    .from("pulveriser_hourly_readings")
    .select("*")
    .in("job_card_id", entryIds)
    .order("created_at");

  // De-duplicate readings (job-level readings are anchored to one id, but a
  // union across ids is safe; dedupe by row id just in case).
  const seenReading = new Set<string>();
  const allReadings = ((readings ?? []) as Record<string, unknown>[]).filter(rd => {
    const rid = rd.id as string;
    if (seenReading.has(rid)) return false;
    seenReading.add(rid);
    return true;
  });

  // Latest lab review on the finalized card for the QC sign-off block.
  const { data: review } = await supabase
    .from("pulveriser_job_card_reviews")
    .select("result, remark, reviewed_by, reviewed_at")
    .eq("job_card_id", id)
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rev = (review ?? null) as Record<string, unknown> | null;
  const labByName = rev?.reviewed_by
    ? await getChemistName(supabase, rev.reviewed_by as string)
    : null;

  return flatten(d, {
    // batch_no alias for the shared filename helper / subject line.
    batch_no: d.job_number ?? d.material_code ?? d.id,
    __entries: entries,
    __readings: allReadings,
    __lab_result: rev?.result ?? null,
    __lab_remark: rev?.remark ?? null,
    __lab_by: labByName,
    __lab_at: rev?.reviewed_at ?? null,
  });
}

async function loadRmQc(
  supabase: SupabaseClient,
  id: string
): Promise<FlatRecord | null> {
  const { data, error } = await supabase
    .from("rm_qc")
    .select(
      "id, factory_id, batch_id, material_id, chemist_id, test_date, appearance, remarks, test_results"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[generate-report] rm_qc load error:", error.message);
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const batch = await getBatch(supabase, d.batch_id as string);
  const material = await getMaterial(supabase, d.material_id as string);
  return flatten(d, {
    batch_no: batch?.batch_number ?? null,
    lot_no: batch?.lot_number ?? null,
    material_name: material?.name ?? null,
    chemist_name: await getChemistName(supabase, d.chemist_id as string),
    __product_code: material?.code ?? null,
  });
}

async function loadBatchAnalysis(
  supabase: SupabaseClient,
  id: string
): Promise<FlatRecord | null> {
  const { data, error } = await supabase
    .from("batch_analysis")
    .select(
      "id, factory_id, batch_id, chemist_id, party_code, rework_action, analysis_date, appearance, remarks, test_results"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[generate-report] batch_analysis load error:", error.message);
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const batch = await getBatch(supabase, d.batch_id as string);
  const product = batch?.product_id
    ? await getProduct(supabase, batch.product_id as string)
    : null;
  const party = await getPartyName(supabase, d.party_code as string);
  // The party's result-parameter keys drive which rows appear in the report.
  const partyResultKeys = d.party_code
    ? await getPartySpecKeys(supabase, d.party_code as string)
    : [];
  // Human-readable rework action for the in-process report.
  const reworkLabel =
    d.rework_action === "downgrade_grade_b" ? "Downgrade to Grade B"
    : d.rework_action === "reroute_repackaging" ? "Reroute for repackaging"
    : null;
  return flatten(d, {
    rework_label: reworkLabel,
    __party_result_keys: partyResultKeys,
    batch_no: batch?.batch_number ?? null,
    lot_no: batch?.lot_number ?? null,
    chemist_name: await getChemistName(supabase, d.chemist_id as string),
    // Customer / party for the Final Inspection header. party_code is the raw
    // code; customer_name is the display name from the parties master.
    customer_name: party?.customer_name ?? (d.party_code as string) ?? null,
    // batch_analysis is Sulphur-Powder-only; fall back to that code if the
    // batch has no product linked.
    __product_code: product?.code ?? "SULPHUR_POWDER_FG",
  });
}

async function loadProductQc(
  supabase: SupabaseClient,
  id: string
): Promise<FlatRecord | null> {
  const { data, error } = await supabase
    .from("product_qc")
    .select(
      "id, factory_id, batch_id, product_id, chemist_id, phase, test_date, appearance, overall_result, remarks, test_results"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[generate-report] product_qc load error:", error.message);
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const batch = await getBatch(supabase, d.batch_id as string);
  const product = await getProduct(supabase, d.product_id as string);
  return flatten(d, {
    batch_no: batch?.batch_number ?? null,
    lot_no: batch?.lot_number ?? null,
    product_name: product?.name ?? null,
    chemist_name: await getChemistName(supabase, d.chemist_id as string),
    // job_no is not a column; expose null so a template Named Range stays blank.
    job_no: null,
    __product_code: product?.code ?? null,
  });
}

async function loadCoa(
  supabase: SupabaseClient,
  id: string
): Promise<FlatRecord | null> {
  // COA joins in the source product_qc so the field map can pull actual results
  // from `product_qc.test_results.*` alongside coa dispatch metadata.
  const { data, error } = await supabase
    .from("coa_documents")
    .select(
      `id, factory_id, product_qc_id, customer_name, customer_address, test_report_no,
       lot_no, batch_no, qty, invoice_no, vehicle_no, mfg_date, generated_at`
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[generate-report] coa_documents load error:", error.message);
    return null;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;

  // Pull actual results from the source product_qc row.
  let pqc: Record<string, unknown> | null = null;
  let product: { code: string | null; name: string | null } | null = null;
  if (d.product_qc_id) {
    const { data: pq } = await supabase
      .from("product_qc")
      .select("product_id, appearance, test_results")
      .eq("id", d.product_qc_id as string)
      .maybeSingle();
    pqc = (pq as Record<string, unknown>) ?? null;
    if (pqc?.product_id) {
      product = await getProduct(supabase, pqc.product_id as string);
    }
  }

  // The COA field map references both `coa.*` and `product_qc.test_results.*`.
  // Flatten so the resolver (which drops the table prefix) finds them: put the
  // product_qc appearance/test_results at the top level.
  const flat: FlatRecord = {
    ...d,
    appearance: (pqc?.appearance as string) ?? null,
    test_results: (pqc?.test_results as Record<string, unknown>) ?? {},
    __product_code: product?.code ?? "SULPHUR_POWDER_FG",
  };
  return flat;
}

// ---------------------------------------------------------------------------
// Follow-up lookups. QC tables reference auth.users(id) for chemist_id, and
// there is no PostgREST FK embed to public.profiles, so we resolve names and
// related rows with simple separate queries (the pattern used elsewhere).
// ---------------------------------------------------------------------------
async function getBatch(
  supabase: SupabaseClient,
  batchId: string | null | undefined
): Promise<{
  batch_number: string | null;
  lot_number: string | null;
  product_id: string | null;
} | null> {
  if (!batchId) return null;
  const { data } = await supabase
    .from("batches")
    .select("batch_number, lot_number, product_id")
    .eq("id", batchId)
    .maybeSingle();
  return (data as {
    batch_number: string | null;
    lot_number: string | null;
    product_id: string | null;
  }) ?? null;
}

async function getProduct(
  supabase: SupabaseClient,
  productId: string | null | undefined
): Promise<{ code: string | null; name: string | null } | null> {
  if (!productId) return null;
  const { data } = await supabase
    .from("products")
    .select("code, name")
    .eq("id", productId)
    .maybeSingle();
  return (data as { code: string | null; name: string | null }) ?? null;
}

async function getMaterial(
  supabase: SupabaseClient,
  materialId: string | null | undefined
): Promise<{ code: string | null; name: string | null } | null> {
  if (!materialId) return null;
  const { data } = await supabase
    .from("materials")
    .select("code, name")
    .eq("id", materialId)
    .maybeSingle();
  return (data as { code: string | null; name: string | null }) ?? null;
}

async function getPartyName(
  supabase: SupabaseClient,
  partyCode: string | null | undefined
): Promise<{ customer_name: string | null } | null> {
  if (!partyCode) return null;
  const { data } = await supabase
    .from("parties")
    .select("customer_name")
    .eq("party_code", partyCode)
    .maybeSingle();
  return (data as { customer_name: string | null }) ?? null;
}

/** The result-parameter keys a party specs on (coa_customer_specs.parameter). */
async function getPartySpecKeys(
  supabase: SupabaseClient,
  partyCode: string
): Promise<string[]> {
  const { data } = await supabase
    .from("coa_customer_specs")
    .select("parameter")
    .eq("party_code", partyCode)
    .eq("is_active", true);
  return ((data ?? []) as { parameter: string }[]).map((r) => r.parameter);
}

async function getChemistName(
  supabase: SupabaseClient,
  chemistId: string | null | undefined
): Promise<string | null> {
  if (!chemistId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", chemistId)
    .maybeSingle();
  return (data as { full_name: string | null })?.full_name ?? null;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
function flatten(
  base: Record<string, unknown>,
  derived: Record<string, unknown>
): FlatRecord {
  return { ...base, ...derived } as FlatRecord;
}

function safeRef(record: FlatRecord): string {
  const raw =
    (record.batch_no as string) ||
    (record.test_report_no != null ? `RPT${record.test_report_no}` : "") ||
    (record.id as string) ||
    "report";
  return String(raw).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40);
}

function buildSubject(
  source: ReportSource,
  record: FlatRecord,
  variant?: ReportVariant
): string {
  const batch = (record.batch_no as string) ?? (record.id as string) ?? "";
  switch (source) {
    case "rm_qc":
      return `[JSCI A-20/1] Incoming Inspection Report — ${batch}`;
    case "batch_analysis":
      return variant === "inprocess"
        ? `[JSCI A-20/1] In-Process Inspection Report — ${batch}`
        : `[JSCI A-20/1] Final Inspection Report — ${batch}`;
    case "product_qc":
      return `[JSCI A-20] Final Inspection Report — ${batch}`;
    case "coa":
      return `[JSCI A-20/1] Certificate of Analysis — ${
        (record.customer_name as string) ?? batch
      }`;
    case "job_card":
      return `[JSCI A-20/1] Pulveriser Job Card — ${
        (record.job_number as string) ?? batch
      }`;
  }
}

function buildBodyHtml(
  source: ReportSource,
  record: FlatRecord,
  filename: string
): string {
  const batch = (record.batch_no as string) ?? "—";
  const date =
    (record.test_date as string) ??
    (record.analysis_date as string) ??
    (record.job_date as string) ??
    (record.generated_at as string) ??
    "";
  const rows: string[] = [
    `<tr><td style="padding:2px 8px;color:#555">Report</td><td style="padding:2px 8px"><b>${escapeHtml(
      filename
    )}</b></td></tr>`,
    `<tr><td style="padding:2px 8px;color:#555">Batch</td><td style="padding:2px 8px">${escapeHtml(
      batch
    )}</td></tr>`,
  ];
  if (date) {
    rows.push(
      `<tr><td style="padding:2px 8px;color:#555">Date</td><td style="padding:2px 8px">${escapeHtml(
        date
      )}</td></tr>`
    );
  }
  if (source === "coa" && record.customer_name) {
    rows.push(
      `<tr><td style="padding:2px 8px;color:#555">Customer</td><td style="padding:2px 8px">${escapeHtml(
        String(record.customer_name)
      )}</td></tr>`
    );
  }
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">
      <p>The attached report was generated automatically on finalization.
      The filled Excel workbook is attached to this email.</p>
      <table style="border-collapse:collapse;margin-top:8px">${rows.join(
        ""
      )}</table>
      <p style="color:#888;font-size:12px;margin-top:14px">
        Generated by JSCI Automation. No copy of this file is stored on the
        server — this email is the record of submission.
      </p>
    </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
