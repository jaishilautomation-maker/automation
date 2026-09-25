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
  SOURCE_TO_FORM_TYPE,
  type ReportSource,
  type ReportFieldMap,
} from "@/lib/reports/template-map";

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
  const basename = templateBasename(args.source, productCode);
  const { xlsx: xlsxName, json: jsonName } = templateFiles(basename);

  // 2) Download the template + field-map in-memory.
  const templateBuf = await downloadFile(supabase, xlsxName);
  if (!templateBuf) {
    return { ok: false, reason: `template not found in bucket: ${xlsxName}` };
  }
  const fieldMap = await loadFieldMap(supabase, jsonName);
  if (!fieldMap) {
    return { ok: false, reason: `field map not found in bucket: ${jsonName}` };
  }

  // 3) Populate Named Ranges and export to a Buffer.
  const filled = await populateWorkbook(templateBuf, fieldMap, record);
  const filename = `${basename}_${safeRef(record)}.xlsx`;

  const attachment: EmailAttachment = {
    filename,
    contentType: XLSX_CONTENT_TYPE,
    content: filled,
  };

  // 4) Email (role-routed) + log. sendEmail never throws and writes
  //    notification_log for us.
  const formType = SOURCE_TO_FORM_TYPE[args.source];
  const recipients = recipientsFor(formType);
  const subject = buildSubject(args.source, record);

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
  }
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
      "id, factory_id, batch_id, chemist_id, analysis_date, appearance, remarks, test_results"
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
  return flatten(d, {
    batch_no: batch?.batch_number ?? null,
    lot_no: batch?.lot_number ?? null,
    chemist_name: await getChemistName(supabase, d.chemist_id as string),
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

function buildSubject(source: ReportSource, record: FlatRecord): string {
  const batch = (record.batch_no as string) ?? (record.id as string) ?? "";
  switch (source) {
    case "rm_qc":
      return `[JSCI A-20/1] Incoming Inspection Report — ${batch}`;
    case "batch_analysis":
      return `[JSCI A-20/1] In-Process Inspection Report — ${batch}`;
    case "product_qc":
      return `[JSCI A-20/1] Final Inspection Report — ${batch}`;
    case "coa":
      return `[JSCI A-20/1] Certificate of Analysis — ${
        (record.customer_name as string) ?? batch
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
