// Shared status vocabulary for production job cards.
//
// Two workflows coexist on the A-20 job cards:
//   1. Calculation flow (Sulphur SC, Zinc SC): Phase A -> chemist calculates
//      Phase B -> operator. Statuses below. The authoritative status machine is
//      the DB trigger fn_pjc_phase_guard (migration 039).
//   2. Approval flow (UPL, InstaCal, K-Gum, InstaBor): chemist approves/rejects
//      each phase. Statuses and labels live in lib/job-card-workflow.ts.
// This file gives labels/colours for BOTH so lists and badges work everywhere.

import { STATUS_LABEL_EN, statusBadgeStyle, type JobCardStatus as ApprovalStatus } from "@/lib/job-card-workflow";

export type JobCardStatus =
  | "draft"
  | "submitted"
  | "phase_a_submitted"
  | "phase_b_ready"
  | "phase_b_started"
  | "rejected_limit_exceeded";

/** Products that use the calculation flow (mirrors job_card_phase_config). */
export const CALC_FLOW_PRODUCT_CODES = ["SULPHUR_SC", "NUTRIZIN"];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  phase_a_submitted: "Waiting for chemist",
  phase_b_ready: "Phase B ready",
  phase_b_started: "Phase B in progress",
  rejected_limit_exceeded: "Limit exceeded",
  submitted: "Submitted",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? STATUS_LABEL_EN[status as ApprovalStatus] ?? status;
}

export function statusColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case "submitted":
    case "phase_b_ready":
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
    case "rejected_limit_exceeded":
      return { bg: "#fdecea", fg: "#b71c1c" };
    case "phase_a_submitted":
      return { bg: "#e3f2fd", fg: "#1565c0" };
    case "phase_b_started":
      return { bg: "#fff3e0", fg: "var(--warn)" };
    default: {
      if (status in STATUS_LABEL_EN) {
        const b = statusBadgeStyle(status as ApprovalStatus);
        return { bg: b.background, fg: b.color };
      }
      return { bg: "#fff3e0", fg: "var(--warn)" };
    }
  }
}

/** Operator can still open the card (everything except a fully approved/completed one). */
export function operatorCanOpen(status: string): boolean {
  return status !== "completed";
}
