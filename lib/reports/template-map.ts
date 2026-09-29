// =============================================================================
// Template resolution: (source table + product/material code) → template file.
//
// Each finalized QC record maps to ONE .xlsx template stored in the private
// `report-templates` Storage bucket, plus a sibling field-map JSON that says
// which DB value fills each Named Range. Template + field-map live together:
//
//   report-templates/sulphur-powder_final-inspection.xlsx
//   report-templates/sulphur-powder_final-inspection.json
//
// This module holds NO Excel logic — just the string mapping and the
// field-map shape. The generator (generate-filled-report.ts) uses it to know
// which two files to download.
// =============================================================================

import type { ReportFormType } from "@/lib/reports/recipients";

/** The source event that fired report generation. */
export type ReportSource =
  | "rm_qc" // → incoming-inspection
  | "batch_analysis" // → final-inspection OR inprocess-inspection (variant)
  | "product_qc" // → product-final-inspection (A-20 products)
  | "coa"; // → coa

/**
 * Report variant — only batch_analysis uses it:
 *   "final"     → Final Inspection (JSCI/QC/16): party fully filled + all pass
 *   "inprocess" → In-Process / Finish Goods Testing: partial fill, no party,
 *                 or a spec fail routed to a rework action.
 */
export type ReportVariant = "final" | "inprocess";

/**
 * Default form type per source. batch_analysis defaults to final-inspection
 * but is overridden by the variant in templateBasename().
 */
export const SOURCE_TO_FORM_TYPE: Record<ReportSource, ReportFormType> = {
  rm_qc:          "incoming-inspection",
  batch_analysis: "final-inspection",
  product_qc:     "product-final-inspection",
  coa:            "coa",
};

/** Resolve the effective form type for a source + optional variant. */
export function formTypeFor(
  source: ReportSource,
  variant?: ReportVariant
): ReportFormType {
  if (source === "batch_analysis" && variant === "inprocess") {
    return "inprocess-inspection";
  }
  return SOURCE_TO_FORM_TYPE[source];
}

/**
 * Field-map JSON shape. `fields` maps a Named Range in the .xlsx to a
 * "table.column" reference or a "table.test_results.key" JSONB path. The
 * generator resolves each reference against the record it already loaded.
 *
 *   "batch_no":      "product_qc.batch_no"           (a plain column / derived)
 *   "purity_actual": "product_qc.test_results.purity_cs2"  (JSONB key)
 */
export interface ReportFieldMap {
  /** Filename of the .xlsx this map belongs to (sanity-check on load). */
  template: string;
  /** Named Range → DB reference string. */
  fields: Record<string, string>;
}

/**
 * Resolve the template basename (no extension) for a source + product code.
 *
 * The product/material "slug" is the lower-kebab form of the code, e.g.
 *   SULPHUR_POWDER_FG → sulphur-powder   (special-cased below)
 *   CRUDE_SULPHUR     → crude-sulphur
 * Anything not special-cased falls back to a generic slug so a newly added
 * product still resolves to a predictable filename an admin can upload.
 */
export function templateBasename(
  source: ReportSource,
  productOrMaterialCode: string | null | undefined,
  variant?: ReportVariant
): string {
  const formType = formTypeFor(source, variant);
  const slug = productSlug(productOrMaterialCode);
  return `${slug}_${formType}`;
}

/** File names (in the bucket) for a resolved template. */
export function templateFiles(basename: string): {
  xlsx: string;
  json: string;
} {
  return { xlsx: `${basename}.xlsx`, json: `${basename}.json` };
}

/**
 * Map a product/material code to the template slug. Explicit cases first so the
 * filenames exactly match the hand-authored templates named in the brief.
 */
export function productSlug(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase();
  switch (c) {
    case "SULPHUR_POWDER_FG":
    case "SULPHUR_POWDER":
    case "SULPHUR_SC":
      return "sulphur-powder";
    case "SULPHUR_CRUDE":
    case "CRUDE_SULPHUR":
      return "crude-sulphur";
    default:
      // Generic fallback: CODE_NAME → code-name
      return c
        ? c.toLowerCase().replace(/_/g, "-")
        : "generic";
  }
}
