// =============================================================================
// Client-side trigger for server report generation.
//
// Call this from a "use client" finalization handler AFTER the QC row is saved
// (so recordId exists). Fire-and-forget — never throws, never blocks the UI.
// The server route builds the .xlsx and emails it; nothing comes back to the
// browser and no file is stored.
//
//   void notifyReport({ source: "product_qc", recordId: newRow.id });
// =============================================================================

export type ReportSource =
  | "rm_qc"
  | "batch_analysis"
  | "product_qc"
  | "coa";

/**
 * Optional report variant. Currently only batch_analysis uses it:
 *   "final"     → Final Inspection (JSCI/QC/16) — party fully filled + all pass
 *   "inprocess" → In-Process / Finish Goods Testing — partial fill, no party,
 *                 or a spec fail routed to a rework action.
 * Omit for sources with a single report.
 */
export type ReportVariant = "final" | "inprocess";

export interface NotifyReportArgs {
  source: ReportSource;
  recordId: string;
  variant?: ReportVariant;
}

/** POST to /api/lab-qc/generate-report (fire-and-forget). Safe to `void`. */
export async function notifyReport(args: NotifyReportArgs): Promise<void> {
  try {
    await fetch("/api/lab-qc/generate-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      keepalive: true, // survives page navigation
    });
  } catch (err) {
    // Network failure — swallow. The DB write and UI are unaffected; the
    // notification_log simply won't gain a report row for this event.
    console.error("[notify-report] fetch failed:", err);
  }
}
