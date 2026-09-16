// =============================================================================
// Client helper: push a finalized QC record from A-20/1 to A-20.
//
// Why this exists:
//   The QC exchange has server routes (/api/qc-exchange/send -> A-20's
//   /receive), but nothing on the client ever triggered the send. As a result,
//   QC finalized in A-20/1 never reached A-20's qc_imports table, so A-20's
//   Sulphur Powder "Look up" always reported "Source QC not found".
//
// This helper is called (fire-and-forget) right after a QC row is saved in
// A-20/1. It only runs when the deployment is A-20/1 — on A-20 it is a no-op
// so A-20 never pushes to itself.
//
// It resolves the human-readable batch_number / material_name / product_name
// that A-20's receive route expects on the payload (A-20 users search by the
// batch number, e.g. "B-0025"), then POSTs to /api/qc-exchange/send. Any
// failure is swallowed and left to the retry-pending cron — the QC save UX is
// never blocked by sync.
// =============================================================================

import { createClient } from "@/lib/supabase-browser";
import { FACTORY_CODE } from "@/lib/factory-config";

type SourceTable = "product_qc" | "rm_qc" | "batch_analysis";

interface NotifyArgs {
  sourceTable:  SourceTable;
  sourceRecordId: string;
  factoryId:    string;
  batchId:      string;
  /** 'A' | 'B' | 'none' — only meaningful for product_qc. */
  phase?:       string;
  /** product_qc.overall_result (or omit for tables without it). */
  overallResult?: string | null;
  testDate?:    string | null;
  testResults?: Record<string, unknown>;
  /** Extra payload fields to preserve (appearance, remarks, etc.). */
  extra?:       Record<string, unknown>;
}

/**
 * Fire-and-forget: notify A-20 of a finalized QC record.
 * Safe to call unconditionally — it self-gates to the A-20/1 deployment and
 * never throws (errors are logged, then handled by the retry cron).
 */
export async function notifyQcFinalized(args: NotifyArgs): Promise<void> {
  // Only A-20/1 pushes QC to A-20. On A-20 this is a no-op.
  if (FACTORY_CODE !== "A20_1") {
    console.info(`[qc-exchange/notify] skipped — factory code is "${FACTORY_CODE}", expected "A20_1".`);
    return;
  }

  try {
    console.info("[qc-exchange/notify] pushing QC to A-20:", args.sourceTable, args.sourceRecordId);
    const supabase = createClient();

    // Resolve the batch number + any linked material/product names so the
    // A-20 receive route can index this record by batch number.
    const { data: batch } = await supabase
      .from("batches")
      .select("batch_number, lot_number, material_id, product_id")
      .eq("id", args.batchId)
      .maybeSingle();

    let materialName: string | null = null;
    let productName:  string | null = null;

    if (batch?.material_id) {
      const { data: mat } = await supabase
        .from("materials").select("name").eq("id", batch.material_id).maybeSingle();
      materialName = mat?.name ?? null;
    }
    if (batch?.product_id) {
      const { data: prod } = await supabase
        .from("products").select("name").eq("id", batch.product_id).maybeSingle();
      productName = prod?.name ?? null;
    }

    const payload: Record<string, unknown> = {
      batch_number:   batch?.batch_number ?? null,
      lot_number:     batch?.lot_number ?? null,
      material_name:  materialName,
      product_name:   productName,
      phase:          args.phase ?? "none",
      overall_result: args.overallResult ?? "pending",
      test_date:      args.testDate ?? null,
      test_results:   args.testResults ?? {},
      ...(args.extra ?? {}),
    };

    // Fire-and-forget. We intentionally do not await UI-blocking behaviour;
    // failures are retried by the cron. keepalive lets it survive navigation.
    const res = await fetch("/api/qc-exchange/send", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_table:     args.sourceTable,
        source_record_id: args.sourceRecordId,
        factory_id:       args.factoryId,
        payload,
      }),
      keepalive: true,
    });
    const info = await res.json().catch(() => ({}));
    console.info("[qc-exchange/notify] send response:", res.status, info);
  } catch (err) {
    // Never surface to the user — the retry cron will re-attempt.
    console.error("[qc-exchange/notify] send failed (will retry via cron):", err);
  }
}
