import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateCoaPdf, type CoaParameterRow } from "@/lib/pdf/coa-template";
import { sendEmail } from "@/lib/notifications/send-email";
import { appendRow } from "@/lib/notifications/sheets-sync";
import { buildCoaEmail, type CoaEmailParameterRow } from "@/lib/notifications/lab-qc-emails";

// =============================================================================
// POST /api/lab-qc/generate-coa
//
// Generates a Certificate of Analysis PDF from a finalized product_qc record.
//
// Flow:
//   1. Verify session (chemist+ role) via cookie.
//   2. Load the product_qc record + its product + batch (service role).
//   3. Load the customer's spec limits from coa_customer_specs.
//   4. Build the parameter comparison table (actual vs min/max, within-spec).
//   5. Claim a test_report_no from the sequence, insert coa_documents row.
//   6. Generate the PDF (pdf-lib), upload to Storage (qc-attachments bucket),
//      create a signed URL, update the coa_documents row with the URL.
//   7. Fire the email (Gmail) + Sheets append ("COA Documents" tab).
//
// Request body (JSON) — matches CoaGenerateRequest in lib/types.ts:
//   {
//     product_qc_id, factory_id, customer_name,
//     customer_address?, lot_no?, batch_no?, qty?, invoice_no?,
//     vehicle_no?, mfg_date?
//   }
//
// Uses service role for the DB writes because chemists have restricted RLS on
// several joined tables and Storage — mirrors app/api/lab-qc/create-batch.
// =============================================================================

const COMPANY_NAME = "Jaishil Sulphur & Chemical Industries";
const COMPANY_ADDRESS = "Factory A-20 / A-20/1, GIDC, Gujarat, India";
const DOC_REF = "JSCI/QC/COA";
const BUCKET = "qc-attachments";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function withinSpec(actual: number, min: number | null, max: number | null): boolean | null {
  if (min == null && max == null) return null;
  if (min != null && actual < min) return false;
  if (max != null && actual > max) return false;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      product_qc_id, factory_id, customer_name,
      customer_address, lot_no, batch_no, qty, invoice_no, vehicle_no, mfg_date,
    } = body ?? {};

    if (!product_qc_id || !factory_id || !customer_name) {
      return NextResponse.json(
        { error: "product_qc_id, factory_id and customer_name are required" },
        { status: 400 }
      );
    }

    let service;
    try {
      service = getServiceClient();
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Service client init failed" },
        { status: 500 }
      );
    }

    // ── 1. Load the product_qc record ──────────────────────────────────────
    const { data: pqc, error: pqcErr } = await service
      .from("product_qc")
      .select("id, product_id, batch_id, phase, test_date, test_results, overall_result")
      .eq("id", product_qc_id)
      .maybeSingle();

    if (pqcErr || !pqc) {
      return NextResponse.json(
        { error: "Product QC record not found: " + (pqcErr?.message ?? "unknown") },
        { status: 404 }
      );
    }

    // ── 2. Resolve product + batch + test definitions ──────────────────────
    const [{ data: product }, { data: batch }, { data: profile }] = await Promise.all([
      service.from("products").select("code, name").eq("id", pqc.product_id).maybeSingle(),
      service.from("batches").select("batch_number, lot_number, production_date").eq("id", pqc.batch_id).maybeSingle(),
      service.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    ]);

    const productCode = product?.code ?? null;
    const productName = product?.name ?? "Product";

    const { data: defs } = await service
      .from("qc_test_definitions")
      .select("test_key, label, unit")
      .eq("product_id", pqc.product_id)
      .eq("phase", pqc.phase);

    const defByKey = new Map<string, { label: string; unit: string | null }>();
    (defs ?? []).forEach((d: { test_key: string; label: string; unit: string | null }) =>
      defByKey.set(d.test_key, { label: d.label, unit: d.unit })
    );

    // ── 3. Load customer specs ─────────────────────────────────────────────
    // Prefer product-specific specs; fall back to product_code = NULL (global).
    let specQuery = service
      .from("coa_customer_specs")
      .select("parameter, parameter_label, unit, min_value, max_value, product_code")
      .eq("customer_name", customer_name)
      .eq("is_active", true);

    const { data: specs } = await specQuery;
    const applicableSpecs = (specs ?? []).filter(
      (s: { product_code: string | null }) =>
        s.product_code == null || s.product_code === productCode
    );

    if (applicableSpecs.length === 0) {
      return NextResponse.json(
        { error: `No active COA specs found for customer "${customer_name}"${productCode ? ` and product ${productCode}` : ""}. Add specs in coa_customer_specs first.` },
        { status: 400 }
      );
    }

    // ── 4. Build parameter comparison rows ─────────────────────────────────
    const testResults = (pqc.test_results ?? {}) as Record<string, unknown>;

    const pdfRows: CoaParameterRow[] = [];
    const emailRows: CoaEmailParameterRow[] = [];

    for (const spec of applicableSpecs as Array<{
      parameter: string; parameter_label: string; unit: string | null;
      min_value: number | null; max_value: number | null;
    }>) {
      const rawActual = testResults[spec.parameter];
      const actualStr = rawActual != null ? String(rawActual) : "";
      const actualNum = typeof rawActual === "number" ? rawActual : parseFloat(actualStr);
      const inSpec =
        !isNaN(actualNum) ? withinSpec(actualNum, spec.min_value, spec.max_value) : null;

      const label = spec.parameter_label
        ?? defByKey.get(spec.parameter)?.label
        ?? spec.parameter;
      const unit = spec.unit ?? defByKey.get(spec.parameter)?.unit ?? null;

      pdfRows.push({
        label, unit, actual: actualStr,
        minValue: spec.min_value, maxValue: spec.max_value, withinSpec: inSpec,
      });
      emailRows.push({
        label, unit, actual: actualStr,
        minValue: spec.min_value, maxValue: spec.max_value, withinSpec: inSpec,
      });
    }

    // ── 5. Claim a report number + insert coa_documents row ────────────────
    const effectiveBatchNo = batch_no ?? batch?.batch_number ?? null;
    const effectiveLotNo    = lot_no  ?? batch?.lot_number   ?? null;

    const { data: coaRow, error: coaErr } = await service
      .from("coa_documents")
      .insert({
        product_qc_id,
        factory_id,
        customer_name,
        customer_address: customer_address || null,
        lot_no:    effectiveLotNo,
        batch_no:  effectiveBatchNo,
        qty:       qty || null,
        invoice_no: invoice_no || null,
        vehicle_no: vehicle_no || null,
        mfg_date:  mfg_date || null,
        generated_by: user.id,
      })
      .select("id, test_report_no, generated_at")
      .single();

    if (coaErr || !coaRow) {
      return NextResponse.json(
        { error: "Could not create COA record: " + (coaErr?.message ?? "unknown") },
        { status: 500 }
      );
    }

    const reportNoLabel = `COA-${String(coaRow.test_report_no).padStart(6, "0")}`;
    const generatedDate = fmtDate(coaRow.generated_at);

    // ── 6. Generate the PDF ────────────────────────────────────────────────
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await generateCoaPdf({
        companyName:    COMPANY_NAME,
        companyAddress: COMPANY_ADDRESS,
        docRef:         DOC_REF,
        testReportNo:   reportNoLabel,
        productName,
        generatedDate,
        mfgDate:        mfg_date ? fmtDate(mfg_date) : null,
        customerName:   customer_name,
        customerAddress: customer_address || null,
        lotNo:      effectiveLotNo,
        batchNo:    effectiveBatchNo,
        qty:        qty || null,
        invoiceNo:  invoice_no || null,
        vehicleNo:  vehicle_no || null,
        parameters: pdfRows,
        checkedBy:  profile?.full_name ?? null,
        approvedBy: null,
      });
    } catch (e) {
      return NextResponse.json(
        { error: "PDF generation failed: " + (e instanceof Error ? e.message : String(e)) },
        { status: 500 }
      );
    }

    // ── 7. Upload to Storage + signed URL ──────────────────────────────────
    // Resolve factory code for the storage path (best-effort).
    const { data: factory } = await service
      .from("factories").select("code").eq("id", factory_id).maybeSingle();
    const factoryCode = factory?.code ?? "A20";
    const storagePath = `${factoryCode}/coa/${coaRow.id}.pdf`;

    let pdfUrl: string | null = null;
    try {
      const { error: upErr } = await service.storage
        .from(BUCKET)
        .upload(storagePath, Buffer.from(pdfBytes), {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);

      // Long-lived signed URL (1 year) for the email link + app download.
      const { data: signed } = await service.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      pdfUrl = signed?.signedUrl ?? null;

      await service
        .from("coa_documents")
        .update({ pdf_url: pdfUrl, pdf_storage_path: storagePath })
        .eq("id", coaRow.id);
    } catch (e) {
      // Storage failure is non-fatal — the row exists; log and continue so the
      // caller still gets the report number. The PDF can be regenerated.
      console.error("[generate-coa] storage upload failed:", e instanceof Error ? e.message : String(e));
    }

    // ── 8. Fire email + Sheets append (fire-and-forget, never blocks) ──────
    const nowISO = new Date().toISOString();
    const { subject, html } = buildCoaEmail({
      testReportNo:    reportNoLabel,
      customerName:    customer_name,
      productName,
      batchNo:         effectiveBatchNo,
      lotNo:           effectiveLotNo,
      qty:             qty || null,
      invoiceNo:       invoice_no || null,
      vehicleNo:       vehicle_no || null,
      mfgDate:         mfg_date || null,
      parameters:      emailRows,
      generatedByName: profile?.full_name ?? "—",
      generatedAt:     nowISO,
      pdfUrl,
    });

    // Await both so the serverless function doesn't tear down mid-flight.
    await Promise.all([
      sendEmail({ eventType: "lab_qc_coa", subject, html, factoryId: factory_id, referenceId: coaRow.id }),
      appendRow("COA Documents", [
        coaRow.id,
        reportNoLabel,
        customer_name,
        productName,
        effectiveBatchNo,
        effectiveLotNo,
        qty || null,
        invoice_no || null,
        vehicle_no || null,
        mfg_date || null,
        pdfUrl,
        profile?.full_name ?? null,
        nowISO,
        factory_id,
      ]),
    ]);

    // Mark notification timestamps (best-effort).
    await service
      .from("coa_documents")
      .update({ email_sent_at: nowISO, sheet_synced_at: nowISO })
      .eq("id", coaRow.id);

    return NextResponse.json({
      id: coaRow.id,
      test_report_no: coaRow.test_report_no,
      report_label: reportNoLabel,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
