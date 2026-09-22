import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateFinishGoodsPdf } from "@/lib/pdf/finish-goods-template";
import { generateFinalInspectionPdf, type FinalInspectionParamRow } from "@/lib/pdf/final-inspection-template";
import { sendEmail } from "@/lib/notifications/send-email";
import { appendRow } from "@/lib/notifications/sheets-sync";
import { fmtDate } from "@/lib/pdf/pdf-helpers";
import { buildBatchAnalysisReportEmail } from "@/lib/notifications/lab-qc-emails";

// =============================================================================
// POST /api/lab-qc/generate-batch-analysis-report
//
// Generates ONE of two PDFs from an already-saved batch_analysis record
// (SULPHUR_POWDER, phase='B') — no new data entry, reads existing test_results.
//
//   report_type = "finish_goods"      -> "FINISH GOODS TESTING OF SULPHUR"
//   report_type = "final_inspection"  -> "FINAL INSPECTION RECORD" (JSCI/QC/16)
//
// Request body (JSON):
//   { batch_analysis_id, factory_id, report_type, extra? }
//   extra (final_inspection only, optional): { srNo, jobNo, shift }
//     — these three fields have no home in batch_analysis/batches and are
//     supplied at report-generation time.
// =============================================================================

const COMPANY_NAME = "M/s JAISHIL SULPHUR & CHEMICAL INDUSTRIES";
const COMPANY_ADDRESS = "Plot No-A-20/1 MIDC, Phase-I, DOMBIVALI";
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

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function fmtPct(v: unknown): string {
  const n = num(v);
  return n == null ? "-" : String(n);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { batch_analysis_id, factory_id, report_type, extra } = body ?? {};

    if (!batch_analysis_id || !factory_id || !report_type) {
      return NextResponse.json({ error: "batch_analysis_id, factory_id and report_type are required" }, { status: 400 });
    }
    if (report_type !== "finish_goods" && report_type !== "final_inspection") {
      return NextResponse.json({ error: "report_type must be 'finish_goods' or 'final_inspection'" }, { status: 400 });
    }

    let service;
    try {
      service = getServiceClient();
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Service client init failed" }, { status: 500 });
    }

    // ── 1. Load the batch_analysis record ───────────────────────────────────
    const { data: ba, error: baErr } = await service
      .from("batch_analysis")
      .select("id, batch_id, analysis_date, appearance, appearance_ok, test_results, remarks")
      .eq("id", batch_analysis_id)
      .maybeSingle();

    if (baErr || !ba) {
      return NextResponse.json({ error: "Batch analysis record not found: " + (baErr?.message ?? "unknown") }, { status: 404 });
    }

    const [{ data: batch }, { data: profile }] = await Promise.all([
      service.from("batches").select("batch_number, lot_number").eq("id", ba.batch_id).maybeSingle(),
      service.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    ]);

    const tr = (ba.test_results ?? {}) as Record<string, unknown>;

    let pdfBytes: Uint8Array;
    let storageSubdir: string;

    if (report_type === "finish_goods") {
      // ── Doc 2: FINISH GOODS TESTING OF SULPHUR ────────────────────────────
      pdfBytes = await generateFinishGoodsPdf({
        companyName: COMPANY_NAME,
        companyAddress: COMPANY_ADDRESS,
        docRef: "",
        production: extra?.production || "—",
        date: fmtDate(ba.analysis_date),
        batchNo: batch?.batch_number ?? "—",
        sampleSize: extra?.sampleSize || "—",
        lotNo: batch?.lot_number ?? "—",
        // NOTE: the paper form lists 200/170/325 mesh, but the original schema
        // (001_initial_schema.sql) only captures 100/200/325 mesh — there is no
        // 170-mesh field anywhere in the pre-task data model. Displaying the
        // 100-mesh result in its place would misrepresent the data, so the
        // 170-mesh slot is shown as "-" (not tested) until a 170-mesh field is
        // explicitly added.
        purityPercent: fmtPct(tr["purity_percent"]),
        mesh200Percent: fmtPct(tr["mesh200_pct"]),
        mesh170Percent: "-",
        mesh325Percent: fmtPct(tr["mesh325_pct"]),
        ashPercent: fmtPct(tr["ash_percent"]),
        acidityPercent: fmtPct(tr["acidity_percent"]),
        confirmed: ba.appearance_ok,
        reasons: ba.remarks || null,
        authorisedSign: profile?.full_name ?? null,
      });
      storageSubdir = "finish-goods";
    } else {
      // ── Doc 3: FINAL INSPECTION RECORD (JSCI/QC/16) ───────────────────────
      const parameters: FinalInspectionParamRow[] = [
        { srNo: "01", label: "Purity/solubility in Cs2 / Insolubility in Cs2", observation: fmtPct(tr["purity_percent"]) },
        { srNo: "",   label: "Insolubility In Toluene / solubility in Toluene", observation: fmtPct(tr["insolubility_toluene"]) },
        { srNo: "02", label: "Acidity as H2SO4", observation: fmtPct(tr["acidity_percent"]) },
        { srNo: "03", label: "Ash content", observation: fmtPct(tr["ash_percent"]) },
        { srNo: "04A", label: "Passing in/residue on wet sieve (150µ/100 Mesh)", observation: fmtPct(tr["mesh100_pct"]) },
        { srNo: "04B", label: "Passing in/residue on wet sieve (75µ/200 Mesh)", observation: fmtPct(tr["mesh200_pct"]) },
        { srNo: "04C", label: "Passing in/residue on wet sieve (45µ/325 Mesh)", observation: fmtPct(tr["mesh325_pct"]) },
        { srNo: "04D", label: "Passing in/residue on wet sieve (90µ/500 Mesh)", observation: "-" },
        { srNo: "05", label: "Oil content", observation: fmtPct(tr["oil_percent"]) },
        { srNo: "06", label: `Heat loss @ ${tr["heat_loss_temp"] ?? "—"}°C 2 Hrs`, observation: fmtPct(tr["heat_loss_percent"]) },
        { srNo: "07", label: "Specific Gravity @ 25°C", observation: fmtPct(tr["sg_value"]) },
        { srNo: "08", label: "Melting Point °C", observation: fmtPct(tr["melting_point"]) },
        { srNo: "09", label: "Alkalinity (as NaOH)", observation: fmtPct(tr["alkalinity_naoh"]) },
        { srNo: "10", label: "Total Sulphur Content", observation: fmtPct(tr["total_sulphur_percent"]) },
        { srNo: "11", label: "Softening Point °C", observation: fmtPct(tr["softening_point"]) },
        { srNo: "12", label: "Acetone Solubility", observation: fmtPct(tr["acetone_solubility"]) },
        { srNo: "13", label: "Appearance", observation: String(tr["colour_appearance"] ?? ba.appearance ?? "-") },
      ];

      pdfBytes = await generateFinalInspectionPdf({
        companyName: COMPANY_NAME,
        companyAddress: COMPANY_ADDRESS,
        docRef: "JSCI/QC/16",
        date: fmtDate(ba.analysis_date),
        item: "SULPHUR POWDER",
        srNo: extra?.srNo || "—",
        jobNo: extra?.jobNo || "—",
        shift: extra?.shift || "—",
        lotNo: batch?.lot_number ?? "—",
        batchNo: batch?.batch_number ?? "—",
        parameters,
        overallRemarks: ba.remarks || null,
        checkedBy: profile?.full_name ?? null,
      });
      storageSubdir = "final-inspection";
    }

    // ── Upload to Storage + signed URL ──────────────────────────────────────
    const { data: factory } = await service.from("factories").select("code").eq("id", factory_id).maybeSingle();
    const factoryCode = factory?.code ?? "A20_1";
    const storagePath = `${factoryCode}/${storageSubdir}/${ba.id}.pdf`;

    let pdfUrl: string | null = null;
    try {
      const { error: upErr } = await service.storage.from(BUCKET).upload(storagePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf", upsert: true,
      });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      pdfUrl = signed?.signedUrl ?? null;
    } catch (e) {
      console.error("[generate-batch-analysis-report] storage upload failed:", e instanceof Error ? e.message : String(e));
    }

    // ── Email + Sheets (fire-and-forget) ────────────────────────────────────
    const nowISO = new Date().toISOString();
    const reportLabel = report_type === "finish_goods" ? "Finish Goods Testing" : "Final Inspection Record";
    const { subject, html } = buildBatchAnalysisReportEmail({
      reportLabel,
      batchNumber: batch?.batch_number ?? null,
      generatedByName: profile?.full_name ?? "—",
      generatedAt: nowISO,
      pdfUrl,
    });

    await Promise.all([
      sendEmail({ eventType: `lab_qc_${report_type}_report`, subject, html, factoryId: factory_id, referenceId: ba.id }),
      appendRow(report_type === "finish_goods" ? "Finish Goods Reports" : "Final Inspection Reports", [
        ba.id, batch?.batch_number ?? null, fmtDate(ba.analysis_date), pdfUrl, profile?.full_name ?? null, nowISO, factory_id,
      ]),
    ]);

    return NextResponse.json({ pdf_url: pdfUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
