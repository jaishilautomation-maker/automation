// =============================================================================
// lib/job-card-workflow.ts
//
// Status helpers and label maps for the Phase A / Phase B chemist approval
// workflow on A-20 production job cards (migration 031).
// =============================================================================

export type JobCardStatus =
  | "draft"
  | "submitted"          // legacy
  | "phase_a_pending"
  | "phase_a_approved"
  | "phase_a_rejected"
  | "phase_b_pending"
  | "phase_b_rejected"
  | "completed";

// ---------------------------------------------------------------------------
// What the operator is allowed to submit to
// ---------------------------------------------------------------------------

/** True if the card is in a state where the operator can still save Phase A */
export function canSubmitPhaseA(status: JobCardStatus): boolean {
  return status === "draft" || status === "phase_a_rejected";
}

/** True if the operator can now work on and submit Phase B */
export function canSubmitPhaseB(status: JobCardStatus): boolean {
  return status === "phase_a_approved" || status === "phase_b_rejected";
}

/** True if the card is locked — chemist has final-approved it */
export function isCompleted(status: JobCardStatus): boolean {
  return status === "completed";
}

/** True if the chemist needs to act on this card */
export function awaitingChemist(status: JobCardStatus): boolean {
  return status === "phase_a_pending" || status === "phase_b_pending";
}

/** True if Phase A has been approved */
export function phaseAApproved(status: JobCardStatus): boolean {
  return (
    status === "phase_a_approved" ||
    status === "phase_b_pending" ||
    status === "phase_b_rejected" ||
    status === "completed"
  );
}

// ---------------------------------------------------------------------------
// Human-readable labels (bilingual)
// ---------------------------------------------------------------------------

export const STATUS_LABEL_EN: Record<JobCardStatus, string> = {
  draft:              "Phase A In Progress",
  submitted:          "Submitted (legacy)",
  phase_a_pending:    "Pending Chemist Approval – Phase A",
  phase_a_approved:   "Phase A Approved",
  phase_a_rejected:   "Phase A Rejected",
  phase_b_pending:    "Pending Chemist Approval – Phase B",
  phase_b_rejected:   "Phase B Rejected",
  completed:          "Completed / Final Approved",
};

export const STATUS_LABEL_HI: Record<JobCardStatus, string> = {
  draft:              "फेज़ A जारी है",
  submitted:          "सबमिट (पुराना रिकॉर्ड)",
  phase_a_pending:    "केमिस्ट अनुमोदन प्रतीक्षित – फेज़ A",
  phase_a_approved:   "फेज़ A अनुमोदित",
  phase_a_rejected:   "फेज़ A अस्वीकृत",
  phase_b_pending:    "केमिस्ट अनुमोदन प्रतीक्षित – फेज़ B",
  phase_b_rejected:   "फेज़ B अस्वीकृत",
  completed:          "पूर्ण / अंतिम अनुमोदित",
};

// ---------------------------------------------------------------------------
// Badge styling
// ---------------------------------------------------------------------------

type BadgeStyle = { background: string; color: string };

export function statusBadgeStyle(status: JobCardStatus): BadgeStyle {
  switch (status) {
    case "draft":            return { background: "#fff3e0", color: "#e65100" };
    case "submitted":        return { background: "#e8f5e9", color: "#2e7d32" };
    case "phase_a_pending":  return { background: "#e3f2fd", color: "#1565c0" };
    case "phase_a_approved": return { background: "#e8f5e9", color: "#2e7d32" };
    case "phase_a_rejected": return { background: "#fce4ec", color: "#c62828" };
    case "phase_b_pending":  return { background: "#e3f2fd", color: "#1565c0" };
    case "phase_b_rejected": return { background: "#fce4ec", color: "#c62828" };
    case "completed":        return { background: "#e8f5e9", color: "#1b5e20" };
    default:                 return { background: "#f5f5f5", color: "#666" };
  }
}
