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

import { AUTOMATION_EMAIL, LAB_QC_EMAIL, FACTORY_EMAIL } from "@/lib/notifications/send-email";

/** Form types, one per finalization trigger point. */
export type ReportFormType =
  | "incoming-inspection" // rm_qc finalized (JSCI/QC/03)
  | "final-inspection" // batch_analysis: party fully filled + all pass (JSCI/QC/16)
  | "inprocess-inspection" // batch_analysis: partial / no party / failed+rework
  | "product-final-inspection" // product_qc finalized — A-20 SC/liquid products
  | "coa" // COA generation action (JSCI/QC/17)
  | "job-card"; // Pulveriser job card finalized (Lab QC OK)

/** Departmental mailboxes. Adjust addresses here as the org confirms them. */
export const ROLE_EMAILS = {
  lab:        LAB_QC_EMAIL,                          // qcdombivli@jaishilsulphur.com
  production: "production@jaishilsulphur.com",
  stores:     "stores@jaishilsulphur.com",
  operator:   "operator@jaishilsulphur.com",
  factory:    FACTORY_EMAIL,                         // factory@jaishilsulphur.com
} as const;

export type RoleKey = keyof typeof ROLE_EMAILS;

/**
 * Which roles receive each form type's report. automation@ is added
 * automatically in `recipientsFor`, so it is intentionally NOT listed here.
 */
const FORM_TYPE_ROLES: Record<ReportFormType, RoleKey[]> = {
  // Raw-material incoming inspection — Stores raised the receipt, Lab tested it.
  "incoming-inspection":       ["lab", "stores"],
  // Final inspection of produced Sulphur Powder (A-20/1 batch analysis).
  "final-inspection":          ["lab", "production", "stores"],
  // In-process / finish-goods testing (partial, no party, or failed+rework).
  // Same recipients as final inspection, per requirement.
  "inprocess-inspection":      ["lab", "production", "stores"],
  // Final product inspection for A-20 SC/liquid products.
  "product-final-inspection":  ["lab", "production", "stores"],
  // Certificate of Analysis — Lab issues it, Stores dispatches against it.
  "coa":                       ["lab", "stores"],
  // Pulveriser job card (Lab QC OK) — automation@ + factory@ only.
  "job-card":                  ["factory"],
};

/**
 * Resolve the deduplicated recipient list for a form type. automation@ is
 * always included (proof of submission on every report).
 */
export function recipientsFor(formType: ReportFormType): string[] {
  const roleAddrs = FORM_TYPE_ROLES[formType].map((r) => ROLE_EMAILS[r]);
  return Array.from(new Set([AUTOMATION_EMAIL, ...roleAddrs]));
}

// ─── COA (JSCI/QC/17) recipients ────────────────────────────────────────────
// A COA is a customer-facing certificate tied to a dispatch. It goes to the
// internal mailboxes only — Lab forwards the PDF to the customer. There is no
// notification_recipients table in this project; recipient routing lives here
// in code (see the module header). The "Cc" is modelled as additional entries
// in the recipients array, which is exactly how sendEmail() delivers them
// (Gmail API sends one message per recipient). sendEmail also unions in its own
// global TEMP_CC_EMAILS (which already includes chinmaythakker@) and the lab_qc_
// eventType CC to qcdombivli@, so this list is deduped downstream.

/** Primary "To" recipients for a COA. */
export const COA_TO = [AUTOMATION_EMAIL, LAB_QC_EMAIL] as const; // automation@, qcdombivli@

/** Explicit "Cc" for a COA (per the brief). */
export const COA_CC = ["chinmaythakker@jaishilsulphur.com"] as const;

/**
 * Full deduplicated COA recipient list (To + Cc). Passed as sendEmail
 * ({ recipients }). Keeping To and Cc separate above lets the email body show
 * them distinctly if ever needed; the transport treats them as one list.
 */
export function coaRecipients(): string[] {
  return Array.from(new Set<string>([...COA_TO, ...COA_CC]));
}
