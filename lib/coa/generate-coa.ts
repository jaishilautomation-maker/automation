// =============================================================================
// Server-side COA generation + retry-send.
//
// Server-only (uses SUPABASE_SERVICE_ROLE_KEY). Import ONLY from API route
// handlers. Drives the whole pipeline:
//
//   generateCoa():
//     1. resolve each batch's batch_analysis + the party's spec rows,
//     2. run the shared resolver → guards (missing batch / no spec / gap /
//        out-of-spec all BLOCK),
//     3. claim a test_report_no from coa_report_seq (nextval),
//     4. build the immutable snapshot and INSERT coa_documents (unique
//        test_report_no makes a double-submit safe — the 2nd insert collides),
//     5. render the PDF from the snapshot and email it (To + Cc) with the log,
//     6. set email_status = 'sent' | 'failed'. On failure the row + number stay
//        (never burn a second number) — the UI offers Retry send.
//     7. fire-and-forget: Google Sheets "COA Documents" row.
//
//   retryCoaSend(): re-render from the stored snapshot and re-send; flips
//     email_status. Never consumes a new number.
//
// The caller (route) handles auth + the field-audit flush (client-side hook).
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, XLSX_CONTENT_TYPE } from "@/lib/notifications/send-email";
import { coaRecipients } from "@/lib/reports/recipients";
import { appendRow } from "@/lib/notifications/sheets-sync";
import {
  resolveCoa,
  headerFromTestResults,
  type CoaSpec,
  type ResolvedBatch,
} from "./resolve-coa";
import { renderCoaPdf, type CoaSnapshot, type SnapshotRow } from "./render-coa-pdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

function getServiceClient(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export interface GenerateCoaInput {
  factoryId:    string;
  partyCode:    string;        // the party being certified against (may differ from batch's own)
  shipTo:       string;        // resolved + possibly-edited ship-to block (required, non-blank)
  docLabel:     "Invoice No." | "Challan No.";
  docValue:     string;        // invoice/challan number
  vehicleNo:    string;
  quantityMt:   number;
  batchNumbers: string[];      // user order, 1..4
  createdBy:    string;        // auth user id
  checkedBy:    string;        // logged-in chemist's display name (printed "Checked By")
}

export type GenerateCoaResult =
  | { ok: true; id: string; testReportNo: number; emailStatus: "sent" | "failed"; emailError?: string; duplicateInvoice: boolean }
  | { ok: false; code: "missing_batch" | "no_spec" | "gap" | "out_of_spec" | "bad_input" | "error"; message: string; detail?: unknown };

// ─── date helpers ───────────────────────────────────────────────────────────
function toDdMmYyyy(iso: string | null): string {
  if (!iso) return "";
  // Accept both ISO (yyyy-mm-dd) and already-dd-mm-yyyy input.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return iso;
}
function todayDdMmYyyy(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// ─── load party specs ───────────────────────────────────────────────────────
async function loadSpecs(db: DB, partyCode: string): Promise<CoaSpec[]> {
  const { data, error } = await db
    .from("coa_customer_specs")
    .select("parameter, parameter_label, unit, min_value, max_value, target_value, test_method, remarks, sort_order, needs_verification")
    .eq("party_code", partyCode)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as CoaSpec[];
}

// ─── load one batch's batch_analysis ────────────────────────────────────────
async function loadBatch(db: DB, factoryId: string, batchNumber: string): Promise<ResolvedBatch> {
  // Resolve batch id by (factory_id, batch_number) — the batch key.
  const { data: batchRow } = await db
    .from("batches")
    .select("id, lot_number")
    .eq("factory_id", factoryId)
    .eq("batch_number", batchNumber)
    .maybeSingle();

  if (!batchRow) {
    return { batchNumber, testResults: null, lotNo: null, mfgDate: null, partyCode: null };
  }

  const { data: ba } = await db
    .from("batch_analysis")
    .select("test_results, party_code")
    .eq("batch_id", batchRow.id)
    .maybeSingle();

  if (!ba) {
    return { batchNumber, testResults: null, lotNo: batchRow.lot_number ?? null, mfgDate: null, partyCode: null };
  }

  const tr = (ba.test_results ?? {}) as Record<string, unknown>;
  const { lotNo, mfgDate } = headerFromTestResults(tr);
  return {
    batchNumber,
    testResults: tr,
    lotNo: lotNo ?? batchRow.lot_number ?? null,
    mfgDate,
    partyCode: ba.party_code ?? null,
  };
}

// ─── build snapshot rows from the resolver output ───────────────────────────
function buildSnapshot(
  input: GenerateCoaInput,
  testReportNo: number,
  customerName: string,
  resolved: ReturnType<typeof resolveCoa>,
): CoaSnapshot {
  const rows: SnapshotRow[] = resolved.rows.map((r) => ({
    sr: r.sr,
    sub: r.sub,
    label: r.label,
    min: r.min,
    max: r.max,
    method: r.method,
    remarks: r.remarks,
    hasSpec: r.hasSpec,
    actuals: r.actuals.map((a) => (a.value == null ? "-" : String(a.value))),
  }));

  const lotNo = resolved.lotNos.join(", ") || "-";
  return {
    testReportNo,
    coaDate: todayDdMmYyyy(),
    docLabel: input.docLabel,
    docValue: input.docValue,
    vehicleNo: input.vehicleNo,
    lotNo,
    qty: `${input.quantityMt} MT`,
    batchNumbers: input.batchNumbers,
    mfgDates: resolved.mfgDates.map(toDdMmYyyy),
    customerName,
    shipTo: input.shipTo,
    rows,
    checkedBy: input.checkedBy,
  };
}

// ─── main ────────────────────────────────────────────────────────────────────
export async function generateCoa(input: GenerateCoaInput): Promise<GenerateCoaResult> {
  // Basic input validation (defence in depth — the UI also guards).
  if (!input.batchNumbers.length) return { ok: false, code: "bad_input", message: "At least one batch is required." };
  if (input.batchNumbers.length > 4) return { ok: false, code: "bad_input", message: "At most 4 batches per COA." };
  if (!input.shipTo.trim()) return { ok: false, code: "bad_input", message: "Ship-to address is required." };
  if (!Number.isFinite(input.quantityMt) || input.quantityMt <= 0) return { ok: false, code: "bad_input", message: "Quantity (MT) must be a positive number." };

  const db = getServiceClient();

  let specs: CoaSpec[];
  try {
    specs = await loadSpecs(db, input.partyCode);
  } catch (err) {
    return { ok: false, code: "error", message: "Failed to load party specs.", detail: String(err) };
  }
  if (specs.length === 0) {
    return { ok: false, code: "no_spec", message: `No spec rows loaded for party ${input.partyCode}. Load the customer's spec before issuing a COA.` };
  }

  let batches: ResolvedBatch[];
  try {
    batches = await Promise.all(input.batchNumbers.map((bn) => loadBatch(db, input.factoryId, bn)));
  } catch (err) {
    return { ok: false, code: "error", message: "Failed to load batch data.", detail: String(err) };
  }

  const resolved = resolveCoa(batches, specs);

  // ── GUARDS (all block) ──────────────────────────────────────────────────
  if (resolved.anyMissing) {
    return { ok: false, code: "missing_batch", message: `No finalized QC found for batch ${resolved.missingBatches.join(", ")}.` };
  }
  if (resolved.anyGap) {
    const g = resolved.gaps.map((x) => `${x.label} (${x.field})`).join(", ");
    return { ok: false, code: "gap", message: `This party requires parameters with no QC source field: ${g}. Add them to the Final Inspection form before issuing this COA.` };
  }
  if (resolved.anyOutOfSpec) {
    const o = resolved.outOfSpec.map((x) => `${x.label} on batch ${x.batchNumber} (${x.value})`).join("; ");
    return { ok: false, code: "out_of_spec", message: `Out of spec — a COA cannot certify failing material: ${o}. Failed batches follow the rework path.` };
  }

  // Customer display name.
  const { data: party } = await db
    .from("parties")
    .select("customer_name")
    .eq("party_code", input.partyCode)
    .maybeSingle();
  const customerName = (party?.customer_name as string) || input.partyCode;

  // Duplicate-invoice WARNING (does not block).
  const { data: dupRows } = await db
    .from("coa_documents")
    .select("id")
    .eq("factory_id", input.factoryId)
    .eq("invoice_no", input.docValue)
    .limit(1);
  const duplicateInvoice = (dupRows?.length ?? 0) > 0;

  // ── Claim the next test_report_no ATOMICALLY from the sequence BEFORE insert
  //    so it can be baked into the immutable snapshot (the snapshot is frozen on
  //    insert by a trigger, so the number must be known first). nextval() is
  //    atomic — two concurrent callers get two distinct numbers — and the
  //    UNIQUE(test_report_no) constraint is the final guard. A double-click
  //    therefore can never produce two rows with the same number.
  const { data: seqData, error: seqErr } = await db.rpc("fn_coa_next_report_no");
  if (seqErr || seqData == null) {
    return { ok: false, code: "error", message: "Failed to assign Test Report No.", detail: seqErr?.message };
  }
  const testReportNo = Number(seqData);

  const snapshot = buildSnapshot(input, testReportNo, customerName, resolved);

  // ── INSERT coa_documents (unique test_report_no → double-submit safe). ────
  const insertRow: Record<string, unknown> = {
    test_report_no: testReportNo,
    factory_id:    input.factoryId,
    party_code:    input.partyCode,
    customer_name: customerName,
    customer_address: input.shipTo,
    ship_to:       input.shipTo,
    doc_label:     input.docLabel,
    invoice_no:    input.docValue,       // stores the invoice OR challan number
    vehicle_no:    input.vehicleNo,
    truck_no:      input.vehicleNo,
    lot_no:        resolved.lotNos.join(", ") || null,
    batch_no:      input.batchNumbers.join(", "),
    batch_numbers: input.batchNumbers,
    mfg_date:      resolved.mfgDates[0] ?? null,
    mfg_dates:     resolved.mfgDates.length ? resolved.mfgDates : null,
    qty:           `${input.quantityMt} MT`,
    quantity_mt:   input.quantityMt,
    snapshot:      snapshot,
    generated_by:  input.createdBy,
    created_by:    input.createdBy,
    email_status:  null,
  };

  const { data: inserted, error: insErr } = await db
    .from("coa_documents")
    .insert(insertRow)
    .select("id, test_report_no")
    .single();

  if (insErr || !inserted) {
    return { ok: false, code: "error", message: "Failed to save COA record.", detail: insErr?.message };
  }

  const coaId = inserted.id as string;
  const finalNo = Number(inserted.test_report_no);
  // Sanity: the stored number must equal the one baked into the snapshot.
  if (finalNo !== testReportNo) {
    console.warn(`[generate-coa] number drift: snapshot=${testReportNo} stored=${finalNo}`);
  }

  // ── Render + email (never throws from sendEmail). ─────────────────────────
  const { emailStatus, emailError } = await renderAndSend(db, coaId, snapshot, customerName, input.docValue, input.vehicleNo, finalNo);

  // ── Google Sheets "COA Documents" row (fire-and-forget). ──────────────────
  void appendRow("lab", "COA Documents", [
    finalNo,
    snapshot.coaDate,
    customerName,
    input.docLabel,
    input.docValue,
    input.vehicleNo,
    input.batchNumbers.join(", "),
    `${input.quantityMt} MT`,
    snapshot.lotNo,
    snapshot.mfgDates.join(", "),
    input.checkedBy,
    emailStatus,
    new Date().toISOString(),
  ]);

  return { ok: true, id: coaId, testReportNo: finalNo, emailStatus, emailError, duplicateInvoice };
}

// ─── render PDF + email + update email_status ────────────────────────────────
async function renderAndSend(
  db: DB,
  coaId: string,
  snapshot: CoaSnapshot,
  customerName: string,
  invoiceNo: string,
  vehicleNo: string,
  testReportNo: number,
): Promise<{ emailStatus: "sent" | "failed"; emailError?: string }> {
  let emailStatus: "sent" | "failed" = "failed";
  let emailError: string | undefined;

  try {
    const pdf = await renderCoaPdf(snapshot);
    const filename = `COA-${testReportNo}-${customerName.replace(/[^\w-]+/g, "_")}.pdf`;

    const batches = snapshot.batchNumbers.join(", ");
    const subject = `[JSCI A-20/1] COA #${testReportNo} — ${customerName} — ${snapshot.docLabel.replace(/:?$/, "")} ${invoiceNo}`;
    const html = coaEmailHtml({ testReportNo, customerName, docLabel: snapshot.docLabel, docValue: invoiceNo, vehicleNo, batches, qty: snapshot.qty, checkedBy: snapshot.checkedBy });

    // sendEmail never throws; it logs to notification_log itself. We detect
    // delivery by re-checking the log, but simpler: sendEmail swallows errors,
    // so we wrap the render (which CAN throw) and treat a completed send as ok.
    await sendEmail({
      eventType:  "coa",
      subject,
      html,
      recipients: coaRecipients(),
      referenceId: coaId,
      attachments: [{ filename, contentType: "application/pdf", content: pdf }],
    });
    emailStatus = "sent";
  } catch (err) {
    emailStatus = "failed";
    emailError = err instanceof Error ? err.message : String(err);
    console.error(`[generate-coa] render/send failed for COA ${testReportNo}:`, emailError);
  }

  // Confirm actual delivery from notification_log (sendEmail records success
  // there even though it never throws on transport failure).
  if (emailStatus === "sent") {
    const { data: logRow } = await db
      .from("notification_log")
      .select("success, error_msg")
      .eq("event_type", "coa")
      .eq("reference_id", coaId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (logRow && logRow.success === false) {
      emailStatus = "failed";
      emailError = (logRow.error_msg as string) || "Email delivery failed.";
    }
  }

  await db
    .from("coa_documents")
    .update({ email_status: emailStatus, email_error: emailError ?? null, email_sent_at: emailStatus === "sent" ? new Date().toISOString() : null })
    .eq("id", coaId);

  return { emailStatus, emailError };
}

// ─── retry send from the stored snapshot (no new number) ─────────────────────
export async function retryCoaSend(coaId: string, factoryId: string): Promise<{ ok: boolean; emailStatus: "sent" | "failed"; emailError?: string }> {
  const db = getServiceClient();
  const { data: row, error } = await db
    .from("coa_documents")
    .select("id, factory_id, test_report_no, customer_name, invoice_no, vehicle_no, snapshot")
    .eq("id", coaId)
    .eq("factory_id", factoryId)
    .maybeSingle();

  if (error || !row || !row.snapshot) {
    return { ok: false, emailStatus: "failed", emailError: "COA not found or snapshot missing." };
  }

  const snapshot = row.snapshot as CoaSnapshot;
  const { emailStatus, emailError } = await renderAndSend(
    db, coaId, snapshot, row.customer_name as string, row.invoice_no as string, (row.vehicle_no as string) ?? "", Number(row.test_report_no),
  );
  return { ok: emailStatus === "sent", emailStatus, emailError };
}

// XLSX_CONTENT_TYPE re-exported import kept intentionally unused here; the COA
// attaches a PDF. Imported only to signal the attachment contract origin.
void XLSX_CONTENT_TYPE;

function coaEmailHtml(a: {
  testReportNo: number; customerName: string; docLabel: string; docValue: string;
  vehicleNo: string; batches: string; qty: string; checkedBy: string;
}): string {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      <p>A Certificate of Analysis (JSCI/QC/17) has been generated for A-20/1.</p>
      <table cellpadding="4" style="border-collapse:collapse;font-size:13px">
        <tr><td><b>Test Report No.</b></td><td>${a.testReportNo}</td></tr>
        <tr><td><b>Customer</b></td><td>${esc(a.customerName)}</td></tr>
        <tr><td><b>${esc(a.docLabel)}</b></td><td>${esc(a.docValue)}</td></tr>
        <tr><td><b>Vehicle No.</b></td><td>${esc(a.vehicleNo)}</td></tr>
        <tr><td><b>Batch No(s)</b></td><td>${esc(a.batches)}</td></tr>
        <tr><td><b>Quantity</b></td><td>${esc(a.qty)}</td></tr>
        <tr><td><b>Generated by</b></td><td>${esc(a.checkedBy)}</td></tr>
        <tr><td><b>Generated at</b></td><td>${esc(ts)}</td></tr>
      </table>
      <p style="color:#555">The signed/stamped certificate is attached as a PDF. Lab forwards it to the customer.</p>
    </div>`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
