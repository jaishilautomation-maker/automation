// Shared status vocabulary for the Phase A -> chemist -> Phase B job-card flow.
// The authoritative status machine is the DB trigger fn_pjc_phase_guard
// (migration 039); this file only provides labels and UI helpers.

export type JobCardStatus =
  | "draft"
  | "submitted"
  | "phase_a_submitted"
  | "phase_b_ready"
  | "phase_b_started"
  | "rejected_limit_exceeded";

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  phase_a_submitted: "Waiting for chemist",
  phase_b_ready: "Phase B ready",
  phase_b_started: "Phase B in progress",
  rejected_limit_exceeded: "Limit exceeded",
  submitted: "Submitted",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
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
    default:
      return { bg: "#fff3e0", fg: "var(--warn)" };
  }
}
