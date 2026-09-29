// =============================================================================
// Sulphur Powder — Batch Analysis parameter catalog (shared source of truth).
//
// Used by BOTH:
//   • the text email (buildBatchAnalysisEmail) — shows the party's raw inputs
//     + calculated result for each party parameter,
//   • the Excel report generator — shows only the party's calculated results.
//
// `resultKey`  = the calculated test_results key that a customer spec references
//                (coa_customer_specs.parameter matches this).
// `rawInputs`  = the raw measurement keys the chemist enters that feed the
//                calculation (shown in the text email, hidden in the report).
//
// Keys mirror the live qc_test_definitions for material SULPHUR_POWDER phase B.
// =============================================================================

export interface BatchAnalysisParam {
  resultKey: string;
  label: string;
  unit: string | null;
  rawInputs: string[];
}

/**
 * Full/default parameter set, in report order. When NO party is selected the
 * form + reports fall back to this complete list.
 */
export const BATCH_ANALYSIS_PARAMS: BatchAnalysisParam[] = [
  { resultKey: "purity_percent",        label: "Purity / Solubility in CS2", unit: "%",  rawInputs: ["ash_m1", "ash_m"] },
  { resultKey: "insolubility_toluene",  label: "Insolubility in Toluene",    unit: "%",  rawInputs: [] },
  { resultKey: "acidity_percent",       label: "Acidity (as H2SO4)",         unit: "%",  rawInputs: ["acidity_v1", "acidity_v2", "acidity_n", "acidity_m"] },
  { resultKey: "ash_percent",           label: "Ash Content",                unit: "%",  rawInputs: ["ash_m1", "ash_m"] },
  { resultKey: "mesh100_pct",           label: "Mesh 150µ / 100 Mesh",       unit: "%",  rawInputs: ["mesh100_m", "mesh100_m_ret"] },
  { resultKey: "mesh200_pct",           label: "Mesh 75µ / 200 Mesh",        unit: "%",  rawInputs: ["mesh200_m", "mesh200_m_ret"] },
  { resultKey: "mesh325_pct",           label: "Mesh 45µ / 325 Mesh",        unit: "%",  rawInputs: ["mesh325_m", "mesh325_m_ret"] },
  { resultKey: "oil_percent",           label: "Oil Content",                unit: "%",  rawInputs: ["oil_mass_loss", "oil_original_mass"] },
  { resultKey: "heat_loss_percent",     label: "Heat Loss",                  unit: "%",  rawInputs: ["heat_loss_temp", "heat_loss_m_before", "heat_loss_m_after"] },
  { resultKey: "sg_value",              label: "Specific Gravity @ 25°C",    unit: null, rawInputs: ["sg_w1", "sg_w2", "sg_w3", "sg_w4", "sg_sl"] },
  { resultKey: "bd_value",              label: "Bulk Density",               unit: null, rawInputs: ["bd_mass", "bd_volume"] },
  { resultKey: "melting_point",         label: "Melting Point",              unit: "°C", rawInputs: [] },
  { resultKey: "alkalinity_naoh",       label: "Alkalinity (as NaOH)",       unit: "%",  rawInputs: [] },
  { resultKey: "total_sulphur_percent", label: "Total Sulphur Content",      unit: "%",  rawInputs: [] },
  { resultKey: "softening_point",       label: "Softening Point",            unit: "°C", rawInputs: [] },
  { resultKey: "acetone_solubility",    label: "Acetone Solubility",         unit: "%",  rawInputs: [] },
  { resultKey: "colour_appearance",     label: "Colour & Appearance",        unit: null, rawInputs: [] },
];

const BY_RESULT_KEY = new Map(BATCH_ANALYSIS_PARAMS.map((p) => [p.resultKey, p]));

/** Human label for a raw-input key (falls back to a de-underscored key). */
export function rawInputLabel(key: string): string {
  return RAW_INPUT_LABELS[key] ?? key.replace(/_/g, " ");
}

const RAW_INPUT_LABELS: Record<string, string> = {
  ash_m1: "Residue M1 (g)",
  ash_m: "Sample M (g)",
  acidity_v1: "Titre material V1 (mL)",
  acidity_v2: "Titre blank V2 (mL)",
  acidity_n: "Normality N",
  acidity_m: "Sample M (g)",
  mesh100_m: "100 Mesh sample M (g)",
  mesh100_m_ret: "100 Mesh retained m (g)",
  mesh200_m: "200 Mesh sample M (g)",
  mesh200_m_ret: "200 Mesh retained m (g)",
  mesh325_m: "325 Mesh sample M (g)",
  mesh325_m_ret: "325 Mesh retained m (g)",
  oil_mass_loss: "Oil mass loss (g)",
  oil_original_mass: "Oil original mass (g)",
  heat_loss_temp: "Heat loss temp (°C)",
  heat_loss_m_before: "Heat loss mass before (g)",
  heat_loss_m_after: "Heat loss mass after (g)",
  sg_w1: "SG W1", sg_w2: "SG W2", sg_w3: "SG W3", sg_w4: "SG W4", sg_sl: "SG of liquid",
  bd_mass: "Bulk density mass (g)",
  bd_volume: "Bulk density volume (mL)",
};

/**
 * Given the party's result-parameter keys (from coa_customer_specs.parameter),
 * return the ordered subset of the catalog to show. If `partyResultKeys` is
 * null/empty (no party), returns the full default set.
 */
export function paramsForParty(
  partyResultKeys: string[] | null | undefined
): BatchAnalysisParam[] {
  if (!partyResultKeys || partyResultKeys.length === 0) {
    return BATCH_ANALYSIS_PARAMS;
  }
  const wanted = new Set(partyResultKeys);
  // Preserve catalog order; include only params the party specs on.
  const picked = BATCH_ANALYSIS_PARAMS.filter((p) => wanted.has(p.resultKey));
  // Fallback: if none of the party's keys matched the catalog (unexpected),
  // show the full set rather than an empty report.
  return picked.length > 0 ? picked : BATCH_ANALYSIS_PARAMS;
}

/** Lookup a single catalog entry by result key. */
export function paramByResultKey(key: string): BatchAnalysisParam | undefined {
  return BY_RESULT_KEY.get(key);
}
