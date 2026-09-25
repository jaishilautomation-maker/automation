// =============================================================================
// Role-based recipient routing for finalization report emails.
//
// Each finalized QC event maps to one "form type", and each form type routes
// to a set of role mailboxes. `automation@` is on EVERYTHING (proof-of-record),
// mirroring the AUTOMATION_EMAIL default already used by sendEmail().
//
// These are the addresses referenced by the report brief
// (Production / Stores / Operator / Lab + automation@ on everything). Keep them
// here as the single source of truth; the generator passes the resolved list
// as sendEmail({ recipients }).
// =============================================================================

import { AUTOMATION_EMAIL, LAB_QC_EMAIL } from "@/lib/notifications/send-email";

/** The four form types, one per finalization trigger point. */
export type ReportFormType =
  | "incoming-inspection" // rm_qc finalized
  | "inprocess-inspection" // batch_analysis finalized
  | "final-inspection" // product_qc finalized
  | "coa"; // COA generation action

/** Departmental mailboxes. Adjust addresses here as the org confirms them. */
export const ROLE_EMAILS = {
  lab:        LAB_QC_EMAIL,                          // qcdombivli@jaishilsulphur.com
  production: "production@jaishilsulphur.com",
  stores:     "stores@jaishilsulphur.com",
  operator:   "operator@jaishilsulphur.com",
} as const;

export type RoleKey = keyof typeof ROLE_EMAILS;

/**
 * Which roles receive each form type's report. automation@ is added
 * automatically in `recipientsFor`, so it is intentionally NOT listed here.
 */
const FORM_TYPE_ROLES: Record<ReportFormType, RoleKey[]> = {
  // Raw-material incoming inspection — Stores raised the receipt, Lab tested it.
  "incoming-inspection":  ["lab", "stores"],
  // In-process (batch) analysis — Production runs the batch, Lab analyses it.
  "inprocess-inspection": ["lab", "production", "operator"],
  // Final product inspection — Production + Lab; Stores dispatches finished goods.
  "final-inspection":     ["lab", "production", "stores"],
  // Certificate of Analysis — Lab issues it, Stores dispatches against it.
  "coa":                  ["lab", "stores"],
};

/**
 * Resolve the deduplicated recipient list for a form type. automation@ is
 * always included (proof of submission on every report).
 */
export function recipientsFor(formType: ReportFormType): string[] {
  const roleAddrs = FORM_TYPE_ROLES[formType].map((r) => ROLE_EMAILS[r]);
  return Array.from(new Set([AUTOMATION_EMAIL, ...roleAddrs]));
}
