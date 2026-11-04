// =============================================================================
// COA parameter catalog — the fixed JSCI/QC/17 certificate layout.
//
// The paper "TEST REPORT OF SULPHUR POWDER" (doc JSCI/QC/17) always prints the
// SAME 12 Sr. No. rows in the SAME order, regardless of customer (see the two
// real samples: MRF #395 and Dalmia #400). What varies per customer is:
//   - the row LABEL (row 1 is "Solubility in CS2" for MRF but "Insolubility in
//     Toluene" for Dalmia; mesh sub-rows swap 150µ/100 for 88µ/170, etc.),
//   - which rows have a spec (min/max) and an actual value,
//   - the test method + remarks text.
//
// Those per-party variations come from coa_customer_specs (display_label,
// qc_source_field=parameter, min, max, test_method, remarks, sort_order). This
// catalog is only the SKELETON: the fixed Sr. No. slots and the default label +
// the batch_analysis test_key each slot reads when the party has no spec row
// pinning a different source.
//
// qcSourceField is the key read from batch_analysis.test_results. A party spec
// row's `parameter` OVERRIDES this (that is how row 1 becomes CS2-purity for one
// customer and toluene-insolubility for another). Slots whose default source is
// null (e.g. the 170-mesh sub-row) have NO batch_analysis key at all — if a
// party specs them, the resolver reports a GAP rather than printing a blank.
// =============================================================================

export type MeshVariant = "150/100" | "88/170" | "75/200" | "45/325";

export interface CoaCatalogRow {
  /** Sr. No. on the certificate (1-based). Mesh sub-rows share sr with a/b/c. */
  sr: number;
  /** Sub-letter for the mesh group (a/b/c), else undefined. */
  sub?: "a" | "b" | "c";
  /** Default printed label (overridden by the party spec's parameter_label). */
  defaultLabel: string;
  /**
   * batch_analysis.test_results key this slot reads by default. A matching party
   * spec row's `parameter` wins. NULL = the slot has no QC source field at all;
   * if a party specs it, that is a reportable gap (e.g. 88µ/170 mesh).
   */
  qcSourceField: string | null;
  /**
   * C11: decimals printed for the ACTUAL value on the certificate. undefined =
   * print the stored value as-is. Defaults below come from the two real
   * certificates (MRF #395, Dalmia #400); Ganesh's full COA set is pending, so
   * each is a one-number change here.
   */
  decimals?: number;
  /**
   * Other batch_analysis fields this slot may print INSTEAD of qcSourceField,
   * chosen by which one the party's spec rows cover. First match wins; the
   * default field wins if the party specs it.
   */
  altSourceFields?: Array<{ field: string; decimals?: number }>;
}

/**
 * Spec parameters that are the SAME measurement under another name.
 * Migration 073 removed Moisture from Final Inspection ("use Heat Loss
 * instead"), so a party spec that says moisture_percent is certified from the
 * Heat Loss result (same crucible method: (W - (W2 - E)) / W x 100).
 */
export const SPEC_PARAMETER_ALIASES: Readonly<Record<string, string>> = {
  moisture_percent: "heat_loss_percent",
};

/** Return `specs` with aliased parameters renamed (never overriding a real row). */
export function applySpecAliases<T extends { parameter: string }>(specs: T[]): T[] {
  const have = new Set(specs.map((s) => s.parameter));
  return specs.map((s) => {
    const target = SPEC_PARAMETER_ALIASES[s.parameter];
    return target && !have.has(target) ? { ...s, parameter: target } : s;
  });
}

/**
 * The 12 fixed Sr. slots. Mesh (Sr 4) expands to three sub-rows. The default
 * mesh variants match the MRF layout (150/100, 75/200, 45/325); a party whose
 * spec pins a different mesh (e.g. Dalmia's 88/170) overrides via its spec row.
 */
export const COA_CATALOG: CoaCatalogRow[] = [
  { sr: 1,  defaultLabel: "% Purity solubility in CS2",        qcSourceField: "purity_percent", decimals: 2,
    // Sr 1 is "Insoluble in Toluene" for parties that spec that instead of CS2
    // purity (Apollo, Birla/Dalmia ...). The party's spec decides which field prints.
    altSourceFields: [{ field: "insolubility_toluene", decimals: 3 }] },
  { sr: 2,  defaultLabel: "% Acidity as H2SO4",                qcSourceField: "acidity_percent", decimals: 4 },
  { sr: 3,  defaultLabel: "% Ash content",                     qcSourceField: "ash_percent", decimals: 3 },
  // Sr 4 — Mesh size (three sub-rows). Defaults = MRF variant.
  { sr: 4, sub: "a", defaultLabel: "% passing on wet sieve (150µ) 100 mesh", qcSourceField: "mesh100_pct" },
  { sr: 4, sub: "b", defaultLabel: "% passing on wet sieve (75µ) 200 mesh",  qcSourceField: "mesh200_pct", decimals: 2 },
  { sr: 4, sub: "c", defaultLabel: "% passing on wet sieve (45µ) 325 mesh",  qcSourceField: "mesh325_pct", decimals: 2 },
  { sr: 5,  defaultLabel: "% Oil content",                     qcSourceField: "oil_percent", decimals: 2 },
  { sr: 6,  defaultLabel: "Melting Point °C",                  qcSourceField: "melting_point", decimals: 1 },
  { sr: 7,  defaultLabel: "Sp. Gravity @25°C",                 qcSourceField: "sg_value", decimals: 3 },
  { sr: 8,  defaultLabel: "% Heat of loss at 70°C 2 hrs.",     qcSourceField: "heat_loss_percent", decimals: 3 },
  { sr: 9,  defaultLabel: "% Alkalinity (as NaOH)",            qcSourceField: "alkalinity_naoh" },
  { sr: 10, defaultLabel: "% Total Sulphur Content",           qcSourceField: "total_sulphur_percent" },
  { sr: 11, defaultLabel: "% Acetone Solubility",              qcSourceField: "acetone_solubility" },
  { sr: 12, defaultLabel: "Softening Point °C",                qcSourceField: "softening_point" },
];

/**
 * Known batch_analysis (SULPHUR_POWDER phase 'B') test_result keys. A party spec
 * whose `parameter` is NOT in this set has NO QC source field, so the resolver
 * reports it as a gap (do NOT silently print "-" for a customer-required row).
 *
 * Confirmed from migrations 001 (phase B seed) + 040. Notably absent: any
 * 88µ/170-mesh key — Dalmia's 170-mesh row therefore has no QC source and is a
 * reportable gap until added to the Final Inspection form.
 */
export const BATCH_ANALYSIS_KEYS: ReadonlySet<string> = new Set([
  "purity_percent",
  "acidity_percent",
  "ash_percent",
  "moisture_percent",
  "mesh100_pct",
  "mesh200_pct",
  "mesh325_pct",
  "oil_percent",
  "melting_point",
  "sg_value",
  "bd_value",
  "heat_loss_percent",
  "alkalinity_naoh",
  "total_sulphur_percent",
  "insolubility_toluene",
  "softening_point",
  "acetone_solubility",
]);

/** Header fields the Batch Analysis page stuffs into test_results JSONB. */
export const BATCH_HEADER_KEYS = {
  lotNo:   "lot_no",
  mfgDate: "mfg_date",
  jobNo:   "job_no",
  srNo:    "sr_no",
  shift:   "shift",
} as const;

/**
 * Max batches on one COA. Real MRF certificates (e.g. #467 Kottayam) carry 5
 * batches, so 5 is the hard cap. Beyond 3 the per-batch Actual columns get
 * narrow; the PDF shrinks the actual-column font for 4–5 batches.
 */
export const MAX_BATCHES_PER_COA = 5;
/** Soft warning threshold — most COAs are <= 3 batches. */
export const BATCH_WARN_THRESHOLD = 3;

// ─── Company letterhead (verbatim from the current JSCI/QC/17 form) ─────────
export const COA_LETTERHEAD = {
  companyName: "JAISHIL SULPHUR & CHEMICAL INDUSTRIES",
  tagline:     "MANUFACTURER'S OF SULPHUR POWDER:",
  // Text taken from the reference COAs ("COA OF MRF, CEAT, ETC. WITH DIFF ADDRESS").
  // The docx has "forties Hospital" (typo); the scanned certificates read "Fortis".
  office: [
    "Office: 202/203, Pratik Industrial Estate, 2nd fl.,",
    "Bhandup - Goregaon Link Rd., Near Fortis Hospital,",
    "Bhandup, Mumbai - 400078.",
    "Phone: 61407900  FAX: 61407979",
    "E-Mail: jaishil@vsnl.net/jaishila20@gmail.com.",
  ],
  factory: [
    "Factory: Plot NO. A/20/1, PHASE 1, M.I.D.C.,",
    "Dombivli (East) 421203, Dist. Thane.",
    "Phone: 2471391/6454979",
  ],
  title:  "TEST REPORT OF SULPHUR POWDER",
  footer: "DOC NO. JSCI/QC/17 · REV-00 · DATE 01/01/2024",
} as const;
