-- =============================================================================
-- Migration 079 (A-20/1 project): Rubber — 100 Mesh on the PASSING basis
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 078.
--
-- Rubber Industries (party_code 'Rubber') was seeded in 055 with the 100-mesh
-- row converted to % RETAINED (max 1.0), because the sheet reads
-- "% passing min 99.0". The lab now wants 100 Mesh reported by the PASSING
-- method, using the standard formula:
--
--     W1 = weight of sample taken for test
--     W2 = weight of passing material
--     % passing = W2 / W1 x 100
--     (e.g. 19.2189 / 20.0000 x 100 = 96.0945 % passing)
--
-- This reuses the existing per-party flag coa_customer_specs.display_as_passing
-- (migration 073, used by MRF). With it set on Rubber's mesh100_pct row:
--   * Batch Analysis shows "100 Mesh: Passing W2 (g)" and "100 Mesh: % passing"
--     under the mesh fields (W1 = "Sample taken M", W2 = M - retained m, so
--     W2 / W1 x 100 = (M - m) / M x 100 -- identical to the formula above);
--   * the live Pass/Fail badge compares the PASSING value to the spec;
--   * the email/report and the COA print % passing (100 - retained);
--   * nothing changes in how the value is stored (still % retained in
--     batch_analysis.test_results.mesh100_pct), so history is untouched.
--
-- The spec moves to the sheet's own basis: passing MIN 99.0 (no max), replacing
-- the converted "retained max 1.0". Rubber 200 mesh is NOT changed here.
--
-- Idempotent.
-- =============================================================================

UPDATE public.coa_customer_specs
   SET parameter_label    = '% passing on wet sieve (150µ) 100 mesh',
       unit               = '%',
       min_value          = 99.0,
       max_value          = NULL,
       target_value       = NULL,
       display_as_passing = true,
       needs_verification = false,
       is_active          = true
 WHERE party_code = 'Rubber'
   AND parameter  = 'mesh100_pct';

-- Verify:
-- SELECT party_code, parameter, parameter_label, min_value, max_value, display_as_passing
-- FROM coa_customer_specs WHERE party_code = 'Rubber' AND parameter = 'mesh100_pct';
