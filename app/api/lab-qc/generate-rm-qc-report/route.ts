import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateRmQcIncomingPdf, type RmQcIncomingParamRow } from "@/lib/pdf/rm-qc-incoming-template";
import { sendEmail } from "@/lib/notifications/send-email";
import { appendRow } from "@/lib/notifications/sheets-sync";
import { fmtDate } from "@/lib/pdf/pdf-helpers";
import { computeRmQcGrade } from "@/lib/types";
import { buildRmQcIncomingReportEmail } from "@/lib/notifications/lab-qc-emails";

// =============================================================================
// POST /api/lab-qc/generate-rm-qc-report
//
// Generates the "Test Report of Crude Sulphur Incoming" PDF (Doc JSCI/QC/03)
// from TWO already-saved rm_qc records (Sample 1 / Sample 2), read from the
// database — no new data entry. Mirrors the generate-coa route pattern.
//
// Request body (JSON):
//   { rm_qc_id_1, rm_qc_id_2, factory_id, quantity?, supplier_name?, item? }
//
//   rm_qc_id_1 / rm_qc_id_2 — the two rm_qc rows to lay out as Sample 1/2.
//   Selection of WHICH two rows is left to the caller (UI) for now — the
//   report generator only lays out whatever two rows it's given.
//
//   quantity / supplier_name / item are optional overrides; if omitted they
//   are inferred from the batch/receipt linked to Sample 1's batch_id.
// =============================================================================

const COMPANY_NAME = "Jaishil Sulphur & Chemical Industries";
const COMPANY_ADDRESS = "Plot No A-20/1 Phase 1, M.I.D.C., Dombivili Dist. Thane";
const DOC_REF = "JSCI/QC/03";
const BUCKET = "qc-attachments";

// Grade thresholds — mirrors the printed spec table on the paper form.
const A_GRADE = { purityMin: "98", purityMax: "100", acidityMax: "0.010", ashMax: "0.10", heatLossMax: "0.30" };
const B_GRADE = { purityMin: "90", purityMax: "97.99" };

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
    const { rm_qc_id_1, rm_qc_id_2, factory_id, quantity, supplier_name, item } = body ?? {};

    if (!rm_qc_id_1 || !rm_qc_id_2 || !factory_id) {
      return NextResponse.json(
        { error: "rm_qc_id_1, rm_qc_id_2 and factory_id are required" },
        { status: 400 }
      );
    }

    let service;
    try {
      service = getServiceClient();
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Service client init failed" }, { status: 500 });
    }

    // ── 1. Load both rm_qc rows ─────────────────────────────────────────────
    const [{ data: rq1, error: e1 }, { data: rq2, error: e2 }] = await Promise.all([
      service.from("rm_qc").select("id, batch_id, material_id, test_date, appearance, test_results, submitted_at").eq("id", rm_qc_id_1).maybeSingle(),
      service.from("rm_qc").select("id, batch_id, material_id, test_date, appearance, test_results, submitted_at").eq("id", rm_qc_id_2).maybeSingle(),
    ]);

    if (e1 || !rq1) return NextResponse.json({ error: "Sample 1 rm_qc record not found: " + (e1?.message ?? "unknown") }, { status: 404 });
    if (e2 || !rq2) return NextResponse.json({ error: "Sample 2 rm_qc record not found: " + (e2?.message ?? "unknown") }, { status: 404 });

    // ── 2. Resolve supplier/batch/profile context (best-effort) ────────────
    const [{ data: batch }, { data: receipt }, { data: profile }] = await Promise.all([
      service.from("batches").select("batch_number, production_date").eq("id", rq1.batch_id).maybeSingle(),
      service.from("rm_receipts").select("supplier_name, quantity, unit").eq("batch_id", rq1.batch_id).maybeSingle(),
      service.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    ]);

    const tr1 = (rq1.test_results ?? {}) as Record<string, unknown>;
    const tr2 = (rq2.test_results ?? {}) as Record<string, unknown>;

    // ── 3. Build the parameter table (matches the paper form's 5 rows) ─────
    const purity1 = num(tr1["purity_percent"]);
    const purity2 = num(tr2["purity_percent"]);
    const acidity1 = num(tr1["acidity_percent"]);
    const acidity2 = num(tr2["acidity_percent"]);
    const ash1 = num(tr1["ash_percent"]);
    const ash2 = num(tr2["ash_percent"]);
    // NOTE: original rm_qc schema captures moisture_percent, not a dedicated
    // heat-loss-at-70C field. Heat loss is displayed as "-" if not present.
    const heatLoss1 = num(tr1["heat_loss_percent"]) ?? num(tr1["moisture_percent"]);
    const heatLoss2 = num(tr2["heat_loss_percent"]) ?? num(tr2["moisture_percent"]);

    const avgPurity = purity1 != null && purity2 != null ? (purity1 + purity2) / 2 : null;
    const avgAcidity = acidity1 != null && acidity2 != null ? (acidity1 + acidity2) / 2 : undefined;
    const avgAsh = ash1 != null && ash2 != null ? (ash1 + ash2) / 2 : undefined;
    const avgHeatLoss = heatLoss1 != null && heatLoss2 != null ? (heatLoss1 + heatLoss2) / 2 : undefined;

    const grade = avgPurity != null ? computeRmQcGrade(avgPurity, avgAcidity, avgAsh, avgHeatLoss) : null;

    const parameters: RmQcIncomingParamRow[] = [
      {
        label: "% PURITY/solubility in CS2",
        sample1: fmtPct(tr1["purity_percent"]), sample2: fmtPct(tr2["purity_percent"]),
        aGradeMin: A_GRADE.purityMin, aGradeMax: A_GRADE.purityMax,
        bGradeMin: B_GRADE.purityMin, bGradeMax: B_GRADE.purityMax,
        testMethod: "IS - 6655",
        remarks: grade ? `GRADE ${grade}` : undefined,
      },
      {
        label: "% ACIDITY AS H2SO4",
        sample1: fmtPct(tr1["acidity_percent"]), sample2: fmtPct(tr2["acidity_percent"]),
        aGradeMin: "-", aGradeMax: A_GRADE.acidityMax,
        bGradeMin: "ABOVE", bGradeMax: A_GRADE.acidityMax,
        testMethod: "IS - 6655",
      },
      {
        label: "% ASH CONTENT",
        sample1: fmtPct(tr1["ash_percent"]), sample2: fmtPct(tr2["ash_percent"]),
        aGradeMin: "-", aGradeMax: A_GRADE.ashMax,
        bGradeMin: "ABOVE", bGradeMax: A_GRADE.ashMax,
        testMethod: "IS - 6655",
      },
      {
        label: "% HEAT OF LOSS AT 70°C 2 hrs",
        sample1: heatLoss1 != null ? String(heatLoss1) : "-",
        sample2: heatLoss2 != null ? String(heatLoss2) : "-",
        aGradeMin: "-", aGradeMax: A_GRADE.heatLossMax,
        bGradeMin: "ABOVE", bGradeMax: A_GRADE.heatLossMax,
        testMethod: "IS - 6655",
      },
      {
        label: "APPEARANCE BY VISUAL",
        sample1: String(tr1["appearance"] ?? rq1.appearance ?? "-"),
        sample2: String(tr2["appearance"] ?? rq2.appearance ?? "-"),
        aGradeMin: "Yellow powder", aGradeMax: "",
        bGradeMin: "", bGradeMax: "",
        testMethod: "IS - 6656",
      },
    ];

    // ── 4. Generate the PDF ─────────────────────────────────────────────────
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await generateRmQcIncomingPdf({
        companyName: COMPANY_NAME,
        companyAddress: COMPANY_ADDRESS,
        docRef: DOC_REF,
        supplierName: supplier_name || receipt?.supplier_name || "—",
        date: fmtDate(rq1.test_date),
        item: item || "Crude Sulphur",
        quantity: quantity || (receipt?.quantity != null ? `${receipt.quantity} ${receipt.unit ?? ""}`.trim() : "—"),
        parameters,
        grade,
        checkedBy: profile?.full_name ?? null,
      });
    } catch (e) {
      return NextResponse.json({ error: "PDF generation failed: " + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
    }

    // ── 5. Upload to Storage + signed URL ───────────────────────────────────
    const { data: factory } = await service.from("factories").select("code").eq("id", factory_id).maybeSingle();
    const factoryCode = factory?.code ?? "A20_1";
    const reportId = `${rq1.id}_${rq2.id}`;
    const storagePath = `${factoryCode}/rm-qc-incoming/${reportId}.pdf`;

    let pdfUrl: string | null = null;
    try {
      const { error: upErr } = await service.storage.from(BUCKET).upload(storagePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf", upsert: true,
      });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 365);
      pdfUrl = signed?.signedUrl ?? null;
    } catch (e) {
      console.error("[generate-rm-qc-report] storage upload failed:", e instanceof Error ? e.message : String(e));
    }

    // ── 6. Email + Sheets (fire-and-forget, never blocks) ───────────────────
    const nowISO = new Date().toISOString();
    const { subject, html } = buildRmQcIncomingReportEmail({
      supplierName: supplier_name || receipt?.supplier_name || null,
      grade,
      generatedByName: profile?.full_name ?? "—",
      generatedAt: nowISO,
      pdfUrl,
    });

    await Promise.all([
      sendEmail({ eventType: "lab_qc_rm_qc_report", subject, html, factoryId: factory_id, referenceId: rq1.id }),
      appendRow("RM QC Incoming Reports", [
        reportId, supplier_name || receipt?.supplier_name || null, batch?.batch_number ?? null,
        fmtDate(rq1.test_date), grade ?? null, pdfUrl, profile?.full_name ?? null, nowISO, factory_id,
      ]),
    ]);

    return NextResponse.json({ grade, pdf_url: pdfUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
