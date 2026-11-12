-- =============================================================================
-- A-20 Migration 040: Sulphur SC Phase B - Normality input in the Suspensibility block
--
-- Run on the Factory A-20 Supabase project, AFTER 039.
--
-- The titre-based suspensibility formula (migration 034) read its iodine
-- normality from phase_b_iodine_normality, which lives in the "Sulphur Content"
-- block. The Suspensibility block therefore showed only the sample weight (M) and
-- the sediment titre (v2), with no normality input.
--
-- This adds a dedicated input in the Suspensibility block, right after v2:
--     susp_iodine_normality   "Normality of iodine solution N"
-- and points the suspensibility formula at it (same worked example:
-- S = 56.08, M = 0.6208, v2 = 18.4, N = 0.0976  ->  92.71 %).
--
-- Phase B only. Sulphur Content keeps its own normality. Idempotent.
-- Records saved before this migration keep their stored suspensibility; if one
-- is re-opened, enter N in the new field to recalculate it.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ssc uuid;
  v2_order integer;
BEGIN
  SELECT id INTO pid_ssc FROM public.products WHERE code = 'SULPHUR_SC';
  IF pid_ssc IS NULL THEN RAISE NOTICE 'SULPHUR_SC not found - nothing to do'; RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.qc_test_definitions
                  WHERE product_id = pid_ssc AND phase::text = 'B' AND test_key = 'susp_iodine_normality') THEN

    SELECT sort_order INTO v2_order FROM public.qc_test_definitions
     WHERE product_id = pid_ssc AND phase::text = 'B' AND test_key = 'sediment_aliquot_v2';

    IF v2_order IS NULL THEN
      SELECT coalesce(max(sort_order), 0) INTO v2_order FROM public.qc_test_definitions
       WHERE product_id = pid_ssc AND phase::text = 'B' AND test_key IN ('suspension_sample_m');
    END IF;

    -- make room directly after v2
    UPDATE public.qc_test_definitions SET sort_order = sort_order + 1
     WHERE product_id = pid_ssc AND phase::text = 'B' AND sort_order > v2_order;

    INSERT INTO public.qc_test_definitions
      (product_id, phase, test_key, label, unit, input_type, sort_order, section_label)
    VALUES
      (pid_ssc, 'B', 'susp_iodine_normality', 'Normality of iodine solution N', NULL, 'number',
       v2_order + 1, 'Suspensibility');
  END IF;

  UPDATE public.qc_test_definitions
     SET formula = '((sulphur_content * suspension_sample_m / 100) - (sediment_aliquot_v2 * 0.03206 * susp_iodine_normality)) / ((sulphur_content * suspension_sample_m / 100) * 9) * 1000',
         is_calculated = true
   WHERE product_id = pid_ssc AND phase::text = 'B' AND test_key = 'suspensibility';
END $$;

COMMIT;

-- Verify (expect M, v2, N, Suspensibility in that order, all active):
-- SELECT d.test_key, d.label, d.sort_order, d.section_label, d.is_active
--   FROM qc_test_definitions d JOIN products p ON p.id = d.product_id
--  WHERE p.code = 'SULPHUR_SC' AND d.phase::text = 'B' AND d.section_label = 'Suspensibility'
--  ORDER BY d.sort_order;
