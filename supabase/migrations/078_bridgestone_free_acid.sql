-- =============================================================================
-- Migration 078 (A-20/1 project): Bridgestone Free Acid method
--
-- Source: Bridgestone Raw Material Standard ZEN-Z-ZAI-551, "Test Method for
-- Free acid content (as H2SO4)":
--     weigh 5 g, add 50 mL water + 5 mL ethyl alcohol, stand 30 min at 55+/-5 C,
--     titrate with 0.01 mol/L NaOH (phenolphthalein)
--     Free acid (%) = ( mL of 0.01 mol/L NaOH consumed x F x 0.00049
--                       / original sample mass (g) ) x 100
--     F = factor of the 0.01 mol/L NaOH solution
--
-- For Bridgestone (WE-10 / WE-15) this REPLACES the normal acidity fields
-- (V1 / V2 / N / M), which stay unchanged for every other party:
--     only_parties  : field is shown ONLY for these party codes
--     hide_parties  : field is hidden for these party codes
-- Bridgestone's spec rows now point at the new result (free_acid_percent) so the
-- form's pass/fail badge and the COA both use it. Nothing is deleted.
--
-- Idempotent. Run AFTER 077.
-- =============================================================================

BEGIN;

ALTER TABLE public.qc_test_definitions
  ADD COLUMN IF NOT EXISTS only_parties text[],
  ADD COLUMN IF NOT EXISTS hide_parties text[];

DO $$
DECLARE mid uuid;
BEGIN
  SELECT id INTO mid FROM public.materials WHERE code = 'SULPHUR_POWDER';
  IF mid IS NULL THEN
    RAISE NOTICE '078: SULPHUR_POWDER not found - nothing changed';
    RETURN;
  END IF;

  -- New Bridgestone free-acid fields (sit where the normal acidity group sits)
  INSERT INTO public.qc_test_definitions
    (material_id, phase, test_key, label, unit, input_type, formula, is_calculated,
     sort_order, section_label, only_parties)
  SELECT mid, 'B', v.test_key, v.label, v.unit, 'number', v.formula, v.calc,
         v.so, 'Free Acid (as H2SO4) - Bridgestone', ARRAY['WE-10','WE-15']
    FROM (VALUES
      ('free_acid_ml',      '0.01 mol/L NaOH solution consumed', 'mL', NULL::text, false, 81),
      ('free_acid_f',       'Factor F of 0.01 mol/L NaOH solution', NULL, NULL, false, 82),
      ('free_acid_m',       'Original sample mass', 'g', NULL, false, 83),
      ('free_acid_percent', 'Free Acid Content (as H2SO4)', '%',
         '(free_acid_ml * free_acid_f * 0.00049 / free_acid_m) * 100', true, 84)
    ) AS v(test_key, label, unit, formula, calc, so)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.qc_test_definitions d
      WHERE d.material_id = mid AND d.phase::text = 'B' AND d.test_key = v.test_key);

  -- Make sure re-runs also refresh the formula / party restriction
  UPDATE public.qc_test_definitions
     SET formula = '(free_acid_ml * free_acid_f * 0.00049 / free_acid_m) * 100',
         is_calculated = true, only_parties = ARRAY['WE-10','WE-15']
   WHERE material_id = mid AND phase::text = 'B' AND test_key = 'free_acid_percent';
  UPDATE public.qc_test_definitions
     SET only_parties = ARRAY['WE-10','WE-15']
   WHERE material_id = mid AND phase::text = 'B'
     AND test_key IN ('free_acid_ml','free_acid_f','free_acid_m');

  -- Normal acidity fields are hidden for Bridgestone only
  UPDATE public.qc_test_definitions
     SET hide_parties = ARRAY['WE-10','WE-15']
   WHERE material_id = mid AND phase::text = 'B'
     AND test_key IN ('acidity_v1','acidity_v2','acidity_n','acidity_m','acidity_percent');
END $$;

-- Bridgestone specs: the free-acid limit (max 0.03) now belongs to the new result.
UPDATE public.coa_customer_specs
   SET parameter = 'free_acid_percent'
 WHERE party_code IN ('WE-10','WE-15')
   AND parameter = 'acidity_percent'
   AND NOT EXISTS (
     SELECT 1 FROM public.coa_customer_specs x
      WHERE x.party_code = coa_customer_specs.party_code
        AND x.customer_name = coa_customer_specs.customer_name
        AND x.parameter = 'free_acid_percent'
        AND x.product_code IS NOT DISTINCT FROM coa_customer_specs.product_code);

COMMIT;

-- Verify:
-- SELECT test_key, sort_order, only_parties, hide_parties FROM qc_test_definitions d
--   JOIN materials m ON m.id = d.material_id
--  WHERE m.code='SULPHUR_POWDER' AND d.phase::text='B' AND d.is_active
--    AND (d.only_parties IS NOT NULL OR d.hide_parties IS NOT NULL) ORDER BY sort_order;
-- SELECT party_code, parameter, max_value FROM coa_customer_specs WHERE party_code IN ('WE-10','WE-15');
