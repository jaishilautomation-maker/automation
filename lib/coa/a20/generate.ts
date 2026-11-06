// =============================================================================
// A-20 COA - server side (uses SUPABASE_SERVICE_ROLE_KEY). Import ONLY from API
// route handlers.
//
//   resolveA20Preview(): product + batch -> saved Product QC record -> rows.
//   generateA20Coa():    guards -> claim Test Report No. -> insert immutable
//                        snapshot -> render PDF -> email -> log.
//   retryA20CoaSend():   re-send from the stored snapshot (no new number).
//   previewA20CoaPdf():  DRAFT PDF without claiming a number.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notifications/send-email";
import { coaRecipients } from "@/lib/reports/recipients";
import { getA20Template, type A20ProductTemplate } from "./catalog";
import {
  buildPreviewRows, finalizeRows, expiryFromMfg, isoToDdMmYyyy, todayIso,
  type A20CoaSnapshot, type PreviewRowOut, type QcSpecRow,
} from "./build";
import { renderA20CoaPdf } from "./render-pdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

export function a20ServiceClient(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ─── inputs / outputs ───────────────────────────────────────────────────────
export interface A20ProductOption { code: string; name: string; coaTitle: string }

export interface A20PreviewResult {
  ok: boolean;
  found: boolean;               // a saved Product QC record exists for this batch
  message?: string;
  productName: string;
  coaTitle: string;
  docStyle: string;
  qtyLabel: string;
  showExpiry: boolean;
  mfgDate: string | null;       // ISO
  expiryDate: string | null;    // ISO
  rows: PreviewRowOut[];
  rejected: boolean;            // QC decision was "rejected"
}

export interface GenerateA20Input {
  factoryId: string;
  productCode: string;
  batchNumber: string;
  coaTitle?: string;
  coaDate?: string;             // ISO
  mfgDate?: string;             // ISO (blank = from QC)
  qty?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  lorryNo?: string;
  values: Record<string, string>;
  testReportNo?: number;
  createdBy: string;
  checkedBy: string;
}

export type GenerateA20Result =
  | { ok: true; id: string; testReportNo: number; emailStatus: "sent" | "failed"; emailError?: string }
  | { ok: false; code: "bad_input" | "no_qc" | "rejected" | "out_of_spec" | "error"; message: string; problems?: string[] };

const clean = (s: unknown, max = 120): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

// ─── products ───────────────────────────────────────────────────────────────
export async function listA20Products(): Promise<A20ProductOption[]> {
  const db = a20ServiceClient();
  const { data, error } = await db.from("products").select("code, name").eq("is_active", true);
  if (error) throw error;
  const byCode = new Map((data ?? []).map((p) => [p.code as string, p.name as string]));
  const out: A20ProductOption[] = [];
  for (const code of ["SULPHUR_SC", "ZINC_SC", "LIQUID_BORON", "LIQUID_CALCIUM", "ZIDDI"]) {
    const tpl = getA20Template(code);
    if (tpl && byCode.has(code)) out.push({ code, name: byCode.get(code)!, coaTitle: tpl.coaTitle });
  }
  return out;
}

// ─── load QC for (product, batch) ───────────────────────────────────────────
interface QcLoad {
  productId: string;
  productName: string;
  qc: {
    test_results: Record<string, unknown> | null;
    appearance: string | null;
    mfg_date: string | null;
    test_date: string | null;
    approval_decision: string | null;
  } | null;
  batchProductionDate: string | null;
  dbSpecs: QcSpecRow[];
}

async function loadQc(db: DB, factoryId: string, tpl: A20ProductTemplate, batchNumber: string): Promise<QcLoad | null> {
  const { data: product } = await db.from("products").select("id, name").eq("code", tpl.productCode).maybeSingle();
  if (!product) return null;

  // Batch may be a linked batches row or just a typed batch_no on product_qc.
  // Product QC accepts a batch number OR a lot number, so resolve either here.
  let { data: batchRow } = await db
    .from("batches").select("id, production_date")
    .eq("factory_id", factoryId).eq("batch_number", batchNumber).maybeSingle();
  if (!batchRow) {
    ({ data: batchRow } = await db
      .from("batches").select("id, production_date")
      .eq("factory_id", factoryId).eq("product_id", product.id).eq("lot_number", batchNumber)
      .order("production_date", { ascending: false }).limit(1).maybeSingle());
  }

  const cols = "test_results, appearance, mfg_date, test_date, approval_decision";
  let qc: QcLoad["qc"] = null;
  if (batchRow) {
    const { data } = await db.from("product_qc").select(cols)
      .eq("factory_id", factoryId).eq("product_id", product.id).eq("phase", tpl.phase)
      .eq("batch_id", batchRow.id).maybeSingle();
    qc = (data as QcLoad["qc"]) ?? null;
  }
  if (!qc) {
    const { data } = await db.from("product_qc").select(cols)
      .eq("factory_id", factoryId).eq("product_id", product.id).eq("phase", tpl.phase)
      .eq("batch_no", batchNumber).is("batch_id", null).maybeSingle();
    qc = (data as QcLoad["qc"]) ?? null;
  }

  const { data: specs } = await db.from("product_qc_specs")
    .select("test_key, min_value, max_value")
    .eq("product_code", tpl.productCode).eq("phase", tpl.phase).eq("is_active", true);

  return {
    productId: product.id as string,
    productName: product.name as string,
    qc,
    batchProductionDate: (batchRow?.production_date as string) ?? null,
    dbSpecs: (specs ?? []) as QcSpecRow[],
  };
}

export async function resolveA20Preview(factoryId: string, productCode: string, batchNumber: string): Promise<A20PreviewResult> {
  const tpl = getA20Template(productCode);
  const empty: A20PreviewResult = {
    ok: false, found: false, productName: "", coaTitle: "", docStyle: "certificate", qtyLabel: "Quantity",
    showExpiry: false, mfgDate: null, expiryDate: null, rows: [], rejected: false,
  };
  if (!tpl) return { ...empty, message: `No COA template for product ${productCode}.` };

  const db = a20ServiceClient();
  const q = await loadQc(db, factoryId, tpl, batchNumber);
  if (!q) return { ...empty, message: `Product ${productCode} not found.` };

  const base = {
    productName: q.productName, coaTitle: tpl.coaTitle, docStyle: tpl.docStyle,
    qtyLabel: tpl.qtyLabel, showExpiry: tpl.showExpiry,
  };
  if (!q.qc) {
    return {
      ...empty, ...base, ok: true, found: false,
      message: `No saved Product QC found for batch ${batchNumber} (${q.productName}${tpl.phase !== "none" ? `, Phase ${tpl.phase}` : ""}). Save the QC record first.`,
      rows: buildPreviewRows(tpl, null, null, q.dbSpecs),
    };
  }
  const mfg = q.qc.mfg_date ?? q.batchProductionDate ?? q.qc.test_date ?? null;
  return {
    ...base, ok: true, found: true,
    mfgDate: mfg,
    expiryDate: tpl.showExpiry ? expiryFromMfg(mfg) : null,
    rows: buildPreviewRows(tpl, q.qc.test_results, q.qc.appearance, q.dbSpecs),
    rejected: q.qc.approval_decision === "rejected",
  };
}

// ─── snapshot ───────────────────────────────────────────────────────────────
interface Built {
  snapshot: A20CoaSnapshot;
  mfgIso: string | null;
  productName: string;
}

async function buildSnapshot(
  db: DB, input: GenerateA20Input, testReportNo: number, draft: boolean,
): Promise<{ ok: true; built: Built } | { ok: false; res: Extract<GenerateA20Result, { ok: false }> }> {
  const tpl = getA20Template(input.productCode);
  if (!tpl) return { ok: false, res: { ok: false, code: "bad_input", message: `No COA template for ${input.productCode}.` } };
  const batchNumber = clean(input.batchNumber, 60);
  if (!batchNumber) return { ok: false, res: { ok: false, code: "bad_input", message: "Batch number is required." } };

  const q = await loadQc(db, input.factoryId, tpl, batchNumber);
  if (!q) return { ok: false, res: { ok: false, code: "error", message: `Product ${input.productCode} not found.` } };
  if (!q.qc) {
    return { ok: false, res: { ok: false, code: "no_qc", message: `No saved Product QC found for batch ${batchNumber}. Save the QC record before issuing a COA.` } };
  }
  if (q.qc.approval_decision === "rejected") {
    return { ok: false, res: { ok: false, code: "rejected", message: `Batch ${batchNumber} was Rejected in Product QC. A COA cannot certify rejected material.` } };
  }

  const preview = buildPreviewRows(tpl, q.qc.test_results, q.qc.appearance, q.dbSpecs);
  const typed: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.values ?? {})) typed[k] = clean(v, 80);
  const { rows, problems } = finalizeRows(tpl, preview, typed);
  if (problems.length) {
    const outOfSpec = problems.some((p) => /above the maximum|below the minimum/.test(p));
    return {
      ok: false,
      res: {
        ok: false, code: outOfSpec ? "out_of_spec" : "bad_input", problems,
        message: outOfSpec ? "Out of spec - a COA cannot certify failing material." : "Some parameters are incomplete.",
      },
    };
  }

  const mfgIso = clean(input.mfgDate) || q.qc.mfg_date || q.batchProductionDate || q.qc.test_date || null;
  const coaIso = clean(input.coaDate) || todayIso();
  const expiryIso = tpl.showExpiry ? expiryFromMfg(mfgIso) : null;

  const snapshot: A20CoaSnapshot = {
    testReportNo,
    coaDate: isoToDdMmYyyy(coaIso),
    productCode: tpl.productCode,
    productTitle: clean(input.coaTitle, 100) || tpl.coaTitle,
    docStyle: tpl.docStyle,
    specStyle: tpl.specStyle,
    batchNumber,
    mfgDate: isoToDdMmYyyy(mfgIso),
    expiryDate: expiryIso ? isoToDdMmYyyy(expiryIso) : null,
    qtyLabel: tpl.qtyLabel,
    qty: clean(input.qty, 40),
    invoiceNo: clean(input.invoiceNo, 40),
    invoiceDate: clean(input.invoiceDate, 20),
    lorryNo: clean(input.lorryNo, 30),
    rows,
    checkedBy: clean(input.checkedBy, 60),
    draft: draft || undefined,
  };
  return { ok: true, built: { snapshot, mfgIso, productName: q.productName } };
}

// ─── next number / list ─────────────────────────────────────────────────────
export async function peekA20NextReportNo(): Promise<number | null> {
  const { data, error } = await a20ServiceClient().rpc("fn_coa_peek_next_report_no");
  return error || data == null ? null : Number(data);
}

export interface A20CoaListRow {
  id: string; test_report_no: number; product_name: string; batch_no: string;
  invoice_no: string | null; generated_at: string; email_status: string | null;
}

export async function listA20Coas(factoryId: string, limit = 100): Promise<A20CoaListRow[]> {
  const { data, error } = await a20ServiceClient()
    .from("coa_documents")
    .select("id, test_report_no, product_name, batch_no, invoice_no, generated_at, email_status")
    .eq("factory_id", factoryId)
    .order("test_report_no", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as A20CoaListRow[];
}

// ─── draft PDF ──────────────────────────────────────────────────────────────
export async function previewA20CoaPdf(input: GenerateA20Input): Promise<{ ok: true; pdf: Buffer } | { ok: false; message: string; problems?: string[] }> {
  try {
    const db = a20ServiceClient();
    const shown = input.testReportNo ?? (await peekA20NextReportNo()) ?? 0;
    const r = await buildSnapshot(db, input, shown, true);
    if (!r.ok) return { ok: false, message: r.res.message, problems: r.res.problems };
    return { ok: true, pdf: await renderA20CoaPdf(r.built.snapshot) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── generate ───────────────────────────────────────────────────────────────
export async function generateA20Coa(input: GenerateA20Input): Promise<GenerateA20Result> {
  if (!input.factoryId) return { ok: false, code: "bad_input", message: "factoryId is required." };
  if (input.testReportNo != null && (!Number.isInteger(input.testReportNo) || input.testReportNo <= 0)) {
    return { ok: false, code: "bad_input", message: "Test Report No. must be a positive whole number." };
  }
  const db = a20ServiceClient();

  if (input.testReportNo != null) {
    const { data: dup } = await db.from("coa_documents").select("id").eq("test_report_no", input.testReportNo).maybeSingle();
    if (dup) return { ok: false, code: "bad_input", message: `Test Report No. ${input.testReportNo} is already used.` };
  }

  // Validate everything BEFORE a number is consumed.
  const pre = await buildSnapshot(db, input, 0, false);
  if (!pre.ok) return pre.res;

  const { data: seq, error: seqErr } = await db.rpc("fn_coa_claim_report_no", { p_requested: input.testReportNo ?? null });
  if (seqErr || seq == null) {
    return { ok: false, code: "error", message: seqErr?.message ?? "Failed to assign Test Report No." };
  }
  const testReportNo = Number(seq);

  const fin = await buildSnapshot(db, input, testReportNo, false);
  if (!fin.ok) return fin.res;
  const { snapshot, mfgIso, productName } = fin.built;

  const { data: inserted, error: insErr } = await db
    .from("coa_documents")
    .insert({
      test_report_no: testReportNo,
      factory_id: input.factoryId,
      product_code: snapshot.productCode,
      product_name: snapshot.productTitle || productName,
      batch_no: snapshot.batchNumber,
      invoice_no: snapshot.invoiceNo || null,
      invoice_date: snapshot.invoiceDate || null,
      lorry_no: snapshot.lorryNo || null,
      qty: snapshot.qty || null,
      mfg_date: mfgIso,
      snapshot,
      generated_by: input.createdBy,
      created_by: input.createdBy,
    })
    .select("id, test_report_no")
    .single();
  if (insErr || !inserted) {
    return { ok: false, code: "error", message: insErr?.code === "23505" ? `Test Report No. ${testReportNo} is already used.` : "Failed to save COA record." };
  }

  const coaId = inserted.id as string;
  const { emailStatus, emailError } = await renderAndSend(db, coaId, input.factoryId, snapshot);
  return { ok: true, id: coaId, testReportNo, emailStatus, emailError };
}

// ─── render + email ─────────────────────────────────────────────────────────
async function renderAndSend(
  db: DB, coaId: string, factoryId: string, snap: A20CoaSnapshot,
): Promise<{ emailStatus: "sent" | "failed"; emailError?: string }> {
  let emailStatus: "sent" | "failed" = "failed";
  let emailError: string | undefined;
  try {
    const pdf = await renderA20CoaPdf(snap);
    const filename = `COA-${snap.testReportNo}-${snap.productTitle.replace(/[^\w-]+/g, "_")}-${snap.batchNumber.replace(/[^\w-]+/g, "_")}.pdf`;
    await sendEmail({
      eventType: "coa",
      subject: `[JSCI A-20] COA #${snap.testReportNo} - ${snap.productTitle} - Batch ${snap.batchNumber}`,
      html: coaEmailHtml(snap),
      recipients: coaRecipients(),
      factoryId,
      referenceId: coaId,
      attachments: [{ filename, contentType: "application/pdf", content: pdf }],
    });
    emailStatus = "sent";
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error(`[a20-coa] render/send failed for COA ${snap.testReportNo}:`, emailError);
  }

  // sendEmail never throws; confirm real delivery from notification_log.
  if (emailStatus === "sent") {
    const { data: logRow } = await db
      .from("notification_log").select("success, error_msg")
      .eq("event_type", "coa").eq("reference_id", coaId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (logRow && logRow.success === false) {
      emailStatus = "failed";
      emailError = (logRow.error_msg as string) || "Email delivery failed.";
    }
  }

  await db.from("coa_documents")
    .update({
      email_status: emailStatus,
      email_error: emailError ?? null,
      email_sent_at: emailStatus === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", coaId);
  return { emailStatus, emailError };
}

export async function retryA20CoaSend(coaId: string, factoryId: string): Promise<{ ok: boolean; emailStatus: "sent" | "failed"; emailError?: string }> {
  const db = a20ServiceClient();
  const { data: row } = await db.from("coa_documents").select("snapshot")
    .eq("id", coaId).eq("factory_id", factoryId).maybeSingle();
  if (!row?.snapshot) return { ok: false, emailStatus: "failed", emailError: "COA not found or snapshot missing." };
  const r = await renderAndSend(db, coaId, factoryId, row.snapshot as A20CoaSnapshot);
  return { ok: r.emailStatus === "sent", ...r };
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
}

function coaEmailHtml(s: A20CoaSnapshot): string {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      <p>A Certificate of Analysis has been generated for A-20.</p>
      <table cellpadding="4" style="border-collapse:collapse;font-size:13px">
        <tr><td><b>Test Report No.</b></td><td>${s.testReportNo}</td></tr>
        <tr><td><b>Product</b></td><td>${esc(s.productTitle)}</td></tr>
        <tr><td><b>Batch No.</b></td><td>${esc(s.batchNumber)}</td></tr>
        <tr><td><b>Invoice No.</b></td><td>${esc(s.invoiceNo || "-")}</td></tr>
        <tr><td><b>Lorry No.</b></td><td>${esc(s.lorryNo || "-")}</td></tr>
        <tr><td><b>Quantity</b></td><td>${esc(s.qty || "-")}</td></tr>
        <tr><td><b>Generated by</b></td><td>${esc(s.checkedBy || "-")}</td></tr>
        <tr><td><b>Generated at</b></td><td>${esc(ts)}</td></tr>
      </table>
      <p style="color:#555">The certificate is attached as a PDF. Lab signs, stamps and forwards it.</p>
    </div>`;
}
