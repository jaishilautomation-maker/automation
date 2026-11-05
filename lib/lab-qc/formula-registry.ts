// =============================================================================
// Formula Registry — A-20 Lab QC
//
// Every calculated result for every product is defined here.
// To change a formula: update it here AND run the matching SQL migration
// UPDATE that references this comment block.
//
// Format per entry:
//   key          : qc_test_definitions.test_key
//   product      : product code
//   phase        : 'A' | 'B' | 'none'
//   formula      : JS expression (same string stored in DB)
//   status       : 'confirmed' | 'pending'
//   sopRef       : source document / section
//   checkInputs  : sample inputs for the check value
//   checkResult  : expected result (round to 2 d.p. for %)
// =============================================================================

export interface FormulaEntry {
  key: string;
  product: string;
  phase: "A" | "B" | "none";
  formula: string;
  status: "confirmed" | "pending";
  sopRef: string;
  checkInputs?: Record<string, number>;
  checkResult?: number;
}

/**
 * CONFIRMED FORMULAS
 * These match the SOPs supplied by the company.
 * The DB formula column stores the same expression string.
 * One-line swap: change `formula` here, run the paired SQL migration.
 */
export const FORMULA_REGISTRY: FormulaEntry[] = [

  // ---------------------------------------------------------------------------
  // LIQUID BORON — Boron (as B) %
  // SOP: "Determination of Boron Content" (AOAC 949.03)
  //   Boron % = 10.811 × V × N / W
  //   V = volume of NaOH used (naoh_v2 - naoh_v1), N = normality NaOH, W = sample g
  // Migration 008_a20_product_qc_formulas.sql
  // Check: V1=0, V2=9.71, N=0.1, W=1.0 → 10.50
  // ---------------------------------------------------------------------------
  {
    key: "boron_content",
    product: "LIQUID_BORON",
    phase: "none",
    formula: "10.811 * (naoh_v2 - naoh_v1) * naoh_normality / mass_taken_w",
    status: "confirmed",
    sopRef: "Insta Cal / Insta Bor — Appendix A (AOAC 949.03)",
    checkInputs: { naoh_v1: 0, naoh_v2: 9.71, naoh_normality: 0.1, mass_taken_w: 1.0 },
    checkResult: 10.50,
  },

  // ---------------------------------------------------------------------------
  // LIQUID CALCIUM — Calcium %
  // SOP: "Insta Cal — Appendix A — Procedure for the determination of calcium content"
  //   Ca% = Normality of EDTA × B.R × 40 / (10 × Weight of sample)
  //   N = calcium_normality (0.05 EDTA), B.R = calcium_br (burette reading), W = calcium_w
  // Migration 008_a20_product_qc_formulas.sql
  // Check: N=0.05, BR=8.25, W=0.15 → 11.00
  // ---------------------------------------------------------------------------
  {
    key: "calcium_content",
    product: "LIQUID_CALCIUM",
    phase: "none",
    formula: "calcium_normality * calcium_br * 40 / (10 * calcium_w)",
    status: "confirmed",
    sopRef: "Insta Cal — Appendix A (Calcium EDTA titrimetric)",
    checkInputs: { calcium_normality: 0.05, calcium_br: 8.25, calcium_w: 0.15 },
    checkResult: 11.00,
  },

  // ---------------------------------------------------------------------------
  // SULPHUR SC Phase A — Sulphur Content %
  // SOP: "SULPHUR 55.16% SC — Appendix A — Procedure for the determination of sulphur content"
  //   Sulphur % w/w = (B2 - B1) × 0.03206 × N × 100 / W
  //   B2 = sample burette (phase_a_titration_vol), B1 = blank (phase_a_titration_blank)
  //   N = phase_a_iodine_normality, W = phase_a_sample_mass
  // Migration 008 + 023
  // Check: B2=52.0, B1=0.2, N=0.1, W=0.30 → 55.36
  // ---------------------------------------------------------------------------
  {
    key: "sulphur_content",
    product: "SULPHUR_SC",
    phase: "A",
    formula: "(phase_a_titration_vol - phase_a_titration_blank) * 0.03206 * phase_a_iodine_normality * 100 / phase_a_sample_mass",
    status: "confirmed",
    sopRef: "SULPHUR 55.16% SC — Appendix A (Iodine titrimetric, IS SOP)",
    checkInputs: { phase_a_titration_vol: 52.0, phase_a_titration_blank: 0.2, phase_a_iodine_normality: 0.1, phase_a_sample_mass: 0.30 },
    checkResult: 55.36,
  },

  // ---------------------------------------------------------------------------
  // SULPHUR SC Phase B — Sulphur Content %
  // Same iodine formula, Phase B inputs
  // ---------------------------------------------------------------------------
  {
    key: "sulphur_content",
    product: "SULPHUR_SC",
    phase: "B",
    formula: "(phase_b_titration_vol - phase_b_titration_blank) * 0.03206 * phase_b_iodine_normality * 100 / phase_b_sample_mass",
    status: "confirmed",
    sopRef: "SULPHUR 55.16% SC — Appendix A (Iodine titrimetric, IS SOP)",
  },

  // ---------------------------------------------------------------------------
  // SULPHUR SC Phase B — Suspensibility %
  // SOP: "Determination of Suspensibility — Suphur SC" (IS: 6940-1982-11.1)
  //   Suspensibility % Mass = 1000 × (M − m) / (9 × M)
  //   M = suspension_sample_m (mass of pesticides in preparation, g)
  //   m = suspension_sediment_m (sediment mass recovered from bottom 25 mL, g)
  // Guard: if suspension_sample_m is 0 or missing → show "—" (handled in formula.ts)
  // 111% guard: shows warning if result > 100 (handled in frontend page.tsx)
  // ---------------------------------------------------------------------------
  {
    key: "suspensibility",
    product: "SULPHUR_SC",
    phase: "B",
    formula: "1000 * (suspension_sample_m - suspension_sediment_m) / (9 * suspension_sample_m)",
    status: "confirmed",
    sopRef: "SULPHUR SC SOP — Determination of Suspensibility (IS: 6940-1982-11.1)",
  },

  // ---------------------------------------------------------------------------
  // ZIDDI — Sulphur Content %
  // SOP: "SULPHUR 65% WG +10% Tebuconazole — Appendix A"
  //   Sulphur % w/w = B2 − B1 × 0.03206 × N × 100 / W
  //   content_iodine_vol = B2 (sample), content_iodine_blank = B1, content_iodine_normality = N
  //   content_mass_w = W
  // Migration 008
  // Check: B2=52.0, B1=0.2, N=0.1, W=0.30 → 55.36
  // ---------------------------------------------------------------------------
  {
    key: "sulphur_content",
    product: "ZIDDI",
    phase: "none",
    formula: "(content_iodine_vol - content_iodine_blank) * 0.03206 * content_iodine_normality * 100 / content_mass_w",
    status: "confirmed",
    sopRef: "SULPHUR 65% WG +10% Tebuconazole — Appendix A (Iodine titrimetric)",
  },

  // ---------------------------------------------------------------------------
  // ZIDDI — Sulphur Suspensibility %
  // SOP: "ZIDDI MOA — Determination of Suspensibility" (IS: 6940-1982-11.1)
  //   Suspensibility % Mass = 1000 × (M − m) / (9 × M)
  //   susp_mass_w = M, susp_sediment_m = m
  // Same formula as Sulphur SC Suspensibility.
  // ---------------------------------------------------------------------------
  {
    key: "sulphur_suspensibility",
    product: "ZIDDI",
    phase: "none",
    formula: "1000 * (susp_mass_w - susp_sediment_m) / (9 * susp_mass_w)",
    status: "confirmed",
    sopRef: "ZIDDI MOA — Determination of Suspensibility (IS: 6940-1982-11.1)",
  },

  // ---------------------------------------------------------------------------
  // ZIDDI — Tebuconazole Content % (by GC, internal standard = DOP)
  // SOP: "Determination of Tebuconazole 10% WG by G.C method"
  //   STD ratio    = tebu_std_area_tebu    / tebu_std_area_dop
  //   Sample ratio = tebu_sample_area_tebu / tebu_sample_area_dop
  //   Content %    = (Sample ratio / STD ratio)
  //                × (Wt of standard / Wt of sample)   (DOP cancels — same stock)
  //                × Purity of standard
  //   Prep: std 0.2 g + 10 mL DOP stock -> 100 mL; sample 2 g + 10 mL -> 100 mL.
  // Migration 030_ziddi_tebuconazole_gc.sql
  // Check: both areas equal ratios 1.0 at 0.2 g std / 2 g sample / 100% purity
  //        -> 1.0 × (0.2/2) × 100 = 10.00
  // ---------------------------------------------------------------------------
  {
    key: "tebu_std_ratio",
    product: "ZIDDI",
    phase: "none",
    formula: "tebu_std_area_tebu / tebu_std_area_dop",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG by G.C method — STD area ratio",
  },
  {
    key: "tebu_sample_ratio",
    product: "ZIDDI",
    phase: "none",
    formula: "tebu_sample_area_tebu / tebu_sample_area_dop",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG by G.C method — Sample area ratio",
  },
  {
    key: "gc_tebu_content",
    product: "ZIDDI",
    phase: "none",
    formula: "(tebu_sample_ratio / tebu_std_ratio) * (tebu_std_wt / tebu_sample_wt) * tebu_std_purity",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG by G.C method — content (internal standard)",
    checkInputs: {
      tebu_sample_ratio: 1.0, tebu_std_ratio: 1.0,
      tebu_std_wt: 0.2, tebu_sample_wt: 2.0, tebu_std_purity: 100,
    },
    checkResult: 10.0,
  },

  // ---------------------------------------------------------------------------
  // ZIDDI — Tebuconazole Suspensibility % (GC-based, 111 factor)
  // Guide: "TEBUCONAZOLE 10% WG — Actual GC Assay and Suspension Calculation"
  //   susp ratio  = tebu_susp_area_tebu / tebu_susp_area_dop
  //   susp assay  = (susp ratio / std ratio) × (std wt / susp prep wt) × purity
  //   C           = initial sample wt × (assay % / 100)       [a.i. in portion]
  //   Q           = residue wt × residue assay fraction        [a.i. in residue]
  //   Suspensibility % = 111 × (C − Q) / C
  //   111 ≈ 100 × (250/225) volume/percentage correction factor.
  // Migration 031_ziddi_tebuconazole_suspensibility_gc.sql
  // Check (guide §6): C=0.1467, Q=0.4440×0.09081=0.04032 -> ~80.5%
  // ---------------------------------------------------------------------------
  {
    key: "tebu_susp_ratio",
    product: "ZIDDI",
    phase: "none",
    formula: "tebu_susp_area_tebu / tebu_susp_area_dop",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG — suspension GC response ratio",
  },
  {
    key: "tebu_susp_assay",
    product: "ZIDDI",
    phase: "none",
    formula: "(tebu_susp_ratio / tebu_std_ratio) * (tebu_std_wt / tebu_susp_prep_wt) * tebu_std_purity",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG — suspension-prep assay (internal standard)",
  },
  {
    key: "tebu_susp_c",
    product: "ZIDDI",
    phase: "none",
    formula: "tebu_susp_init_wt * gc_tebu_content / 100",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG §3.1 — C = initial sample wt × assay fraction",
  },
  {
    key: "tebu_susp_q",
    product: "ZIDDI",
    phase: "none",
    formula: "tebu_susp_residue_wt * tebu_susp_residue_fraction",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG §3.2 — Q = residue wt × residue fraction",
  },
  {
    key: "gc_tebu_suspensibility",
    product: "ZIDDI",
    phase: "none",
    formula: "111 * (tebu_susp_c - tebu_susp_q) / tebu_susp_c",
    status: "confirmed",
    sopRef: "Tebuconazole 10% WG §4 — Suspension % = 111 × (C − Q) / C",
    checkInputs: { tebu_susp_c: 0.1467, tebu_susp_q: 0.04032 },
    checkResult: 80.49,
  },

  // ---------------------------------------------------------------------------
  // ZINC SC Phase B — Zinc Content %
  // SOP: "Determination of Zinc Content (%) and Suspension (%) in Zinc SC"
  //   Section 7.2: Zinc % = (V2 − V1) × 0.0098012 × 65.38
  //   Note: V1 = with cyanide, V2 = without cyanide
  //   The factor 0.0098012 already accounts for 0.01N EDTA and 10 mL aliquot
  //   from 100 mL (1.0 g sample → 100 mL → 10 mL aliquot).
  //   Example: V2=63.0, V1=0.5 → (62.5) × 0.0098012 × 65.38 = 40.06%
  // Migration 008 (Phase B), 024 (Phase A — same formula, same factor)
  // ---------------------------------------------------------------------------
  {
    key: "zinc_content",
    product: "ZINC_SC",
    phase: "B",
    formula: "(zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38",
    status: "confirmed",
    sopRef: "Zinc SC SOP — Section 7.2 (EDTA complexometric titration)",
    checkInputs: { zc_v2_without_cyanide: 63.0, zc_v1_with_cyanide: 0.5 },
    checkResult: 40.06,
  },

  // ---------------------------------------------------------------------------
  // ZINC SC Phase A — Zinc Content %
  // SOP: same as Phase B (section 7.2 applies to the same 10 mL aliquot from
  //   1 g / 100 mL prep). Phase A uses different input keys: v2_without_cyanide,
  //   v1_with_cyanide.
  // NOTE: Phase A does not have normality_edta in the formula — the 0.0098012
  //   factor is fixed for 0.01N EDTA. The normality field on screen is for record-
  //   keeping only; it does NOT appear in the calculation.
  // Migration 024 — removes needs_review from zinc_content_a
  // ---------------------------------------------------------------------------
  {
    key: "zinc_content_a",
    product: "ZINC_SC",
    phase: "A",
    formula: "(v2_without_cyanide - v1_with_cyanide) * 0.0098012 * 65.38",
    status: "confirmed",
    sopRef: "Zinc SC SOP — Section 7.2 (same factor, Phase A aliquot)",
    checkInputs: { v2_without_cyanide: 63.0, v1_with_cyanide: 0.5 },
    checkResult: 40.06,
  },

  // ---------------------------------------------------------------------------
  // ZINC SC Phase B — Suspension %
  // SOP: "Determination of Zinc Content (%) and Suspension (%) in Zinc SC"
  //   Section 7.3:
  //   A = (Zinc% × 0.25) / 100
  //   B = ((V2 − V1) × 0.0098012 × 65.38) / 1000
  //   Suspension % = ((A − B) / A) × 111
  //   Written self-contained (Zinc% substituted inline) for robustness.
  //   susp_v2_sediment = V2 (without cyanide from sediment aliquot)
  //   susp_v1_sediment = V1 (with cyanide from sediment aliquot)
  //   zc_v2_without_cyanide / zc_v1_with_cyanide = the zinc content titre
  //
  //   111% guard: result >100 triggers "check readings" warning in page.tsx.
  //   Empty-input guard: evalFormula returns null until all inputs are valid.
  //
  //   Example: Net zinc titre (V2-V1)=62.5 → Zinc%=40.06
  //            Net susp titre (V2s-V1s)=16.2 → B=0.0104... → Susp≈99.67%
  // Migration 008 — same formula already seeded
  // ---------------------------------------------------------------------------
  {
    key: "suspension",
    product: "ZINC_SC",
    phase: "B",
    formula:
      "(((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) - " +
      "((susp_v2_sediment - susp_v1_sediment) * 0.0098012 * 65.38 / 1000)) / " +
      "((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) * 111",
    status: "confirmed",
    sopRef: "Zinc SC SOP — Section 7.3 (Suspension, 0.01N EDTA, self-contained)",
  },
];

/**
 * Lookup a formula entry by product code, phase, and test_key.
 */
export function lookupFormula(
  product: string,
  phase: "A" | "B" | "none",
  key: string,
): FormulaEntry | undefined {
  return FORMULA_REGISTRY.find(
    f => f.product === product && f.phase === phase && f.key === key,
  );
}
