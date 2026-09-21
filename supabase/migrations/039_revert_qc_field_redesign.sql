-- =============================================================================
-- Migration 039 (A-20/1 project): Revert the QC field/form redesign from 034-038
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 038.
--
-- Context: 034-038 redesigned the RM QC / Batch Analysis / Product QC pages
-- into raw-input + auto-calc data-entry forms driven directly by the paper
-- documents. That direction has been reversed — the original data-entry pages
-- (pre-migration-034) are correct as-is. The 4 paper documents are instead
-- reference layouts for REPORT GENERATORS that read already-saved QC data and
-- render a PDF (the same pattern as the COA generator in 037).
--
-- This migration deactivates every qc_test_definitions row that 034/035/036/038
-- added, so the reverted pages (which render ALL active defs for their
-- material/product) don't show fields that no longer have a matching UI:
--
--   034 -> SULPHUR_CRUDE 'none': s1_*, s2_*, avg_*, incoming_grade
--   035 -> SULPHUR_POWDER 'B'  : ba_* (raw inputs + calculated results)
--   036 -> SULPHUR_POWDER_FG   : the ENTIRE product (it did not exist before
--                                 this task; product-qc's product list must
--                                 return to its original 5 A-20/1 products)
--   038 -> SULPHUR_POWDER_FG   : heat_loss_temp/m_before/m_after/result
--                                 (covered by deactivating the whole product,
--                                 listed explicitly for clarity/idempotency)
--
-- Deactivate (is_active=false), never delete: preserves any test_results
-- JSONB already saved under these keys, and keeps the migration reversible.
--
-- Idempotent: safe to re-run.
-- =============================================================================

DO $$
DECLARE
    mid_sc uuid;   -- SULPHUR_CRUDE
    mid_sp uuid;   -- SULPHUR_POWDER
    pid_sp uuid;   -- SULPHUR_POWDER_FG
BEGIN

SELECT id INTO mid_sc FROM public.materials WHERE code = 'SULPHUR_CRUDE';
SELECT id INTO mid_sp FROM public.materials WHERE code = 'SULPHUR_POWDER';
SELECT id INTO pid_sp FROM public.products  WHERE code = 'SULPHUR_POWDER_FG';

-- ---------------------------------------------------------------------------
-- 034: deactivate Crude Sulphur incoming-inspection fields
-- ---------------------------------------------------------------------------
IF mid_sc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
  SET is_active = false
  WHERE material_id = mid_sc
    AND phase = 'none'
    AND test_key IN (
      's1_purity_cs2', 's1_acidity_h2so4', 's1_ash_content', 's1_heat_loss_70c_2hr', 's1_appearance',
      's2_purity_cs2', 's2_acidity_h2so4', 's2_ash_content', 's2_heat_loss_70c_2hr', 's2_appearance',
      'avg_purity_cs2', 'avg_acidity_h2so4', 'avg_ash_content', 'avg_heat_loss_70c_2hr',
      'incoming_grade'
    );
  RAISE NOTICE 'Migration 039: deactivated 034 incoming-inspection fields on SULPHUR_CRUDE (material_id=%)', mid_sc;
ELSE
  RAISE NOTICE 'Migration 039: SULPHUR_CRUDE not found — nothing to deactivate for 034.';
END IF;

-- ---------------------------------------------------------------------------
-- 035: deactivate Batch Analysis raw-input + calculated fields
-- ---------------------------------------------------------------------------
IF mid_sp IS NOT NULL THEN
  UPDATE public.qc_test_definitions
  SET is_active = false
  WHERE material_id = mid_sp
    AND phase = 'B'
    AND test_key IN (
      'ba_m1', 'ba_m',
      'ba_v1', 'ba_v2', 'ba_n',
      'ba_mesh200_sample', 'ba_mesh200_retained',
      'ba_mesh170_sample', 'ba_mesh170_retained',
      'ba_mesh325_sample', 'ba_mesh325_retained',
      'ba_purity_result', 'ba_ash_result', 'ba_acidity_result',
      'ba_mesh200_result', 'ba_mesh170_result', 'ba_mesh325_result'
    );
  RAISE NOTICE 'Migration 039: deactivated 035 raw-input fields on SULPHUR_POWDER phase=B (material_id=%)', mid_sp;
ELSE
  RAISE NOTICE 'Migration 039: SULPHUR_POWDER not found — nothing to deactivate for 035.';
END IF;

-- ---------------------------------------------------------------------------
-- 036 + 038: deactivate the entire SULPHUR_POWDER_FG product and product,
-- so it no longer appears in the Product QC product dropdown, and all its
-- qc_test_definitions (036's raw inputs + 038's heat-loss fieldset) stop
-- rendering.
-- ---------------------------------------------------------------------------
IF pid_sp IS NOT NULL THEN
  UPDATE public.qc_test_definitions
  SET is_active = false
  WHERE product_id = pid_sp;

  UPDATE public.products
  SET is_active = false
  WHERE id = pid_sp;

  RAISE NOTICE 'Migration 039: deactivated SULPHUR_POWDER_FG product and all its test definitions (product_id=%)', pid_sp;
ELSE
  RAISE NOTICE 'Migration 039: SULPHUR_POWDER_FG not found — nothing to deactivate for 036/038.';
END IF;

RAISE NOTICE 'Migration 039 complete: RM QC / Batch Analysis / Product QC forms restored to their pre-034 field set.';
END;
$$;
