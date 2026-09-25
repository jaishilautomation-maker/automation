// =============================================================================
// GET /api/test-report?source=rm_qc&recordId=<uuid>
//
// Quick smoke-test for the report pipeline WITHOUT triggering a real email.
// Returns a JSON summary of what would happen:
//   - Can the template be downloaded from Storage?
//   - Can the field map be parsed?
//   - Can the DB record be loaded and all fields resolved?
//   - What would the filename + recipient list be?
//
// Does NOT send an email. Safe to call repeatedly.
// Remove this file after confirming the system works end-to-end.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { templateBasename, templateFiles, SOURCE_TO_FORM_TYPE, type ReportSource } from "@/lib/reports/template-map";
import { recipientsFor } from "@/lib/reports/recipients";

const BUCKET = "report-templates";
const VALID_SOURCES: ReportSource[] = ["rm_qc", "batch_analysis", "product_qc", "coa"];

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source") as ReportSource | null;
  const recordId = searchParams.get("recordId");

  // ── Step 1: list bucket files ────────────────────────────────────────────
  const supabase = getAdmin();
  const { data: bucketFiles, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 50 });

  const bucketStatus = listErr
    ? { ok: false, error: listErr.message }
    : { ok: true, files: bucketFiles?.map(f => f.name) ?? [] };

  // If no source/recordId given, just return bucket status
  if (!source || !VALID_SOURCES.includes(source)) {
    return NextResponse.json({
      step: "bucket_check",
      bucket: BUCKET,
      bucketStatus,
      hint: "Add ?source=rm_qc&recordId=<uuid> to test a specific record",
    });
  }

  // ── Step 2: resolve template files ──────────────────────────────────────
  // We'll try with productCode=null first (falls back to generic slug).
  // Pass a dummy product code matching the expected templates.
  const productCode = source === "rm_qc" ? "CRUDE_SULPHUR" : "SULPHUR_POWDER_FG";
  const basename  = templateBasename(source, productCode);
  const { xlsx: xlsxName, json: jsonName } = templateFiles(basename);
  const formType  = SOURCE_TO_FORM_TYPE[source];
  const recipients = recipientsFor(formType);

  // ── Step 3: try downloading template + field map ─────────────────────────
  const templateResult = await tryDownload(supabase, xlsxName);
  const fieldMapResult = await tryDownload(supabase, jsonName);

  let workbookInfo: { namedRanges: string[] } | { error: string } | null = null;
  if (templateResult.ok && templateResult.buffer) {
    try {
      const wb = new ExcelJS.Workbook();
      const ab = templateResult.buffer.buffer.slice(
        templateResult.buffer.byteOffset,
        templateResult.buffer.byteOffset + templateResult.buffer.byteLength
      ) as ArrayBuffer;
      await wb.xlsx.load(ab);
      // List all defined names (Named Ranges) in the workbook
      const names: string[] = [];
      try {
        // ExcelJS stores definedNames as an object with a `model` Map or object
        const dn = wb.definedNames as unknown as { model: Map<string, unknown> | Record<string, unknown> };
        if (dn.model instanceof Map) {
          dn.model.forEach((_val, key) => { names.push(String(key)); });
        } else if (dn.model && typeof dn.model === "object") {
          Object.keys(dn.model).forEach(key => names.push(key));
        }
      } catch {
        // fallback: just try getRanges on known template names
        names.push("(could not enumerate — check ExcelJS version)");
      }
      workbookInfo = { namedRanges: names };
    } catch (e) {
      workbookInfo = { error: String(e) };
    }
  }

  // ── Step 4: try loading the DB record (if recordId given) ────────────────
  let recordStatus: Record<string, unknown> = { skipped: "no recordId provided" };
  if (recordId) {
    const tableMap: Record<ReportSource, string> = {
      rm_qc:          "rm_qc",
      batch_analysis: "batch_analysis",
      product_qc:     "product_qc",
      coa:            "coa_documents",
    };
    const table = tableMap[source];
    const { data, error } = await supabase.from(table).select("id, factory_id").eq("id", recordId).maybeSingle();
    recordStatus = error
      ? { ok: false, error: error.message }
      : data
      ? { ok: true, id: data.id, factory_id: data.factory_id }
      : { ok: false, error: "record not found" };
  }

  return NextResponse.json({
    source,
    formType,
    basename,
    xlsxFile: xlsxName,
    jsonFile: jsonName,
    recipients,
    bucketStatus,
    templateDownload: { ok: templateResult.ok, sizeBytes: templateResult.sizeBytes, error: templateResult.error },
    fieldMapDownload:  { ok: fieldMapResult.ok, sizeBytes: fieldMapResult.sizeBytes, error: fieldMapResult.error },
    workbook: workbookInfo,
    record: recordStatus,
    conclusion: templateResult.ok && fieldMapResult.ok
      ? "✅ Ready — templates found. Save a QC record to trigger a real report email."
      : "❌ Not ready — see templateDownload/fieldMapDownload errors above.",
  });
}

async function tryDownload(supabase: ReturnType<typeof getAdmin>, name: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(name);
  if (error || !data) return { ok: false, error: error?.message ?? "no data", sizeBytes: 0, buffer: null };
  const ab = await data.arrayBuffer();
  const buf = Buffer.from(ab);
  return { ok: true, error: null, sizeBytes: buf.length, buffer: buf };
}
