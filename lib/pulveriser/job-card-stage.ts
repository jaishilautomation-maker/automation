// =============================================================================
// Pulveriser job-card stage → role label (client-safe).
//
// The canonical status→next-role mapping also lives in the server-only
// whatsapp-jobcard notifier; this is a small client-importable copy so the
// dashboard can show WHICH ROLE a pending card is waiting on, matching the
// notifier's "next role in line" exactly.
//
// Status flow (migrations 015/016b/019/052/053):
//   pending_stores     → Stores     must issue oil
//   pending            → Operator   must run the batch + submit for QC
//   submitted_for_qc   → Lab        must review OK / NOT OK
//   pending_production → Production  must triage a Lab rejection
//   finalized          → nobody (terminal)
// =============================================================================

export type PulveriserStatus =
  | "pending_stores"
  | "pending"
  | "submitted_for_qc"
  | "pending_production"
  | "finalized"
  | (string & {}); // tolerate unknown/future values without breaking the UI

/** The role that must act next, as a display label. "" for finalized/unknown. */
export function stageRoleLabel(status: PulveriserStatus): string {
  switch (status) {
    case "pending_stores":     return "Stores";
    case "pending":            return "Operator";
    case "submitted_for_qc":   return "Lab QC";
    case "pending_production": return "Production";
    default:                   return "";
  }
}

/** Full status label for a dashboard badge, e.g. "Pending — Operator". */
export function statusLabel(status: PulveriserStatus): string {
  if (status === "finalized") return "Finalized";
  const role = stageRoleLabel(status);
  return role ? `Pending — ${role}` : "Pending";
}

/** Is this a terminal (locked) status? */
export function isFinalized(status: PulveriserStatus): boolean {
  return status === "finalized";
}
