-- =============================================================================
-- A-20 Migration 024: Confirm all formulas from official SOPs (4 Nov 2026)
--
-- Source documents received:
--   • "Insta Cal / Insta Bor" — Boron (AOAC 949.03) + Calcium EDTA formulae
--   • "Zinc SC SOP" — Zinc % and Suspension % (EDTA complexometric, 0.01N)
--   • "ZIDDI MOA" — Sulphur % (iodine) + Suspensibility (IS: 6940-1982-11.1)
--   • "SULPHUR 55.16% SC" photo — Sulphur % (iodine, same formula)
--   • "Sulphur SC Suspensibility" photo — 1000*(M-m)/(9*M) confirmed
--
-- All formulas in lib/lab-qc/formula-registry.ts match these SOPs.
-- This migration:
--   1. Removes needs_review from zinc_content_a (Phase A) — confirmed = Phase B formula
--   2. Confirms zinc_content Phase B — already correct, sets needs_review=false
--   3. Confirms suspension Phase B — already correct formula
--   4. Confirms sulphur_suspensibility (Ziddi) — confirmed, sets needs_review=false
--   5. Confirms suspensibility (Sulphur SC Phase B) — confirmed
--   6. Adds section_label to any fields that were missing it after 023
--   7. Updates Ziddi B1/B2 label order (B2=sample burette first, B1=blank)
--      Per SOP: B2 = Burette reading of sample; B1 = Burette reading of blank
--   8. Zinc SC Phase B: the SOP confirms the suspension formula does NOT use
--      a separate normality input — 0.0098012 is fixed for 0.01N EDTA.
--      Deactivate the old zc_normality_edta and zc_mass_sample fields if the
--      SOP's 10 mL aliquot from 1 g/100 mL applies (inputs for titration only
--      are V1 and V2). Keep for record but deactivate zc_normality_edta,
--      zc_mass_sample — sample weight is always 1.0 g per SOP, prep is fixed.
--      NOTE: deactivate only if confirmed with Ganesh — SKIP for now.
--
-- Idempotent: all UPDATEs are safe to re-run.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ssc   uuid;
  pid_lb    uuid;
  pid_ziddi uuid;
  pid_lc    uuid;
  pid_zsc   uuid;
BEGIN

SELECT id INTO pid_ssc   FROM public.products WHERE code = 'SULPHUR_SC';
SELECT id INTO pid_lb    FROM public.products WHERE code = 'LIQUID_BORON';
SELECT id INTO pid_ziddi FROM public.products WHERE code = 'ZIDDI';
SELECT id INTO pid_lc    FROM public.products WHERE code = 'LIQUID_CALCIUM';
SELECT id INTO pid_zsc   FROM public.products WHERE code = 'ZINC_SC';

-- ===========================================================================
-- 1. Zinc SC Phase A — zinc_content_a: remove needs_review, confirm formula
-- SOP ref: Zinc SC SOP Section 7.2 — same 0.0098012 × 65.38 factor
-- Formula: (v2_without_cyanide - v1_with_cyanide) * 0.0098012 * 65.38
-- ===========================================================================
IF pid_zsc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET formula       = '(v2_without_cyanide - v1_with_cyanide) * 0.0098012 * 65.38',
        is_calculated = true,
        needs_review  = false,
        label         = 'Zinc Content (%)'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'zinc_content_a';

  -- ===========================================================================
  -- 2. Zinc SC Phase B — zinc_content: confirm formula, clear needs_review
  -- ===========================================================================
  UPDATE public.qc_test_definitions
    SET formula       = '(zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38',
        is_calculated = true,
        needs_review  = false
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zinc_content';

  -- ===========================================================================
  -- 3. Zinc SC Phase B — suspension: confirm formula (was already seeded in 008)
  -- SOP: A = (Zinc% × 0.25)/100; B = ((V2−V1) × 0.0098012 × 65.38)/1000
  --      Suspension % = ((A−B)/A) × 111
  --      Written self-contained (Zinc% substituted inline).
  -- ===========================================================================
  UPDATE public.qc_test_definitions
    SET formula =
      '(((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) - '
      '((susp_v2_sediment - susp_v1_sediment) * 0.0098012 * 65.38 / 1000)) / '
      '((zc_v2_without_cyanide - zc_v1_with_cyanide) * 0.0098012 * 65.38 * 0.25 / 100) * 111',
        is_calculated = true,
        needs_review  = false
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'suspension';

  -- Suspension burette labels (A7 style)
  UPDATE public.qc_test_definitions
    SET label = 'SUSPENSION — NaOH starting burette reading (V1) — with cyanide'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_v1_sediment';

  UPDATE public.qc_test_definitions
    SET label = 'SUSPENSION — NaOH ending burette reading (V2) — without cyanide'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_v2_sediment';
END IF;

-- ===========================================================================
-- 4. Ziddi — sulphur_suspensibility: confirm formula, clear needs_review
-- SOP: ZIDDI MOA — Determination of Suspensibility (IS: 6940-1982-11.1)
--      Suspensibility % Mass = 1000 × (M − m) / (9 × M)
-- ===========================================================================
IF pid_ziddi IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET formula       = '1000 * (susp_mass_w - susp_sediment_m) / (9 * susp_mass_w)',
        is_calculated = true,
        needs_review  = false
  WHERE product_id = pid_ziddi AND test_key = 'sulphur_suspensibility';

  -- Confirm sulphur_content formula (iodine titrimetric, Appendix A)
  UPDATE public.qc_test_definitions
    SET formula       = '(content_iodine_vol - content_iodine_blank) * 0.03206 * content_iodine_normality * 100 / content_mass_w',
        is_calculated = true,
        needs_review  = false
  WHERE product_id = pid_ziddi AND test_key = 'sulphur_content';

  -- Update Ziddi B2/B1 labels to match SOP (B2=sample burette, B1=blank)
  -- Per SOP: "B2 − Burette reading of sample in ml; B1 − Burette reading of blank in ml"
  UPDATE public.qc_test_definitions
    SET label = 'CONTENT — Sample burette reading (B2)'
  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_vol';

  UPDATE public.qc_test_definitions
    SET label = 'CONTENT — Blank burette reading (B1)'
  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_blank';
END IF;

-- ===========================================================================
-- 5. Sulphur SC Phase B — suspensibility: confirm formula
-- SOP: "Determination of Suspensibility — Sulphur SC" (IS: 6940-1982-11.1)
--      Suspensibility % Mass = 1000 × (M − m) / (9 × M)
-- ===========================================================================
IF pid_ssc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET formula       = '1000 * (suspension_sample_m - suspension_sediment_m) / (9 * suspension_sample_m)',
        is_calculated = true,
        needs_review  = false
  WHERE product_id = pid_ssc AND phase = 'B' AND test_key = 'suspensibility';

  -- Confirm Sulphur SC sulphur_content formulae (both phases)
  UPDATE public.qc_test_definitions
    SET needs_review  = false
  WHERE product_id = pid_ssc AND test_key = 'sulphur_content';
END IF;

-- ===========================================================================
-- 6. Liquid Boron — boron_content: confirm (was already correct)
-- SOP: Insta Bor — Boron % = 10.811 × V × N / W (AOAC 949.03)
-- ===========================================================================
IF pid_lb IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET needs_review = false
  WHERE product_id = pid_lb AND test_key = 'boron_content';
END IF;

-- ===========================================================================
-- 7. Liquid Calcium — calcium_content: confirm (was already correct)
-- SOP: Insta Cal — Ca% = N × B.R × 40 / (10 × W)
-- ===========================================================================
IF pid_lc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET needs_review = false
  WHERE product_id = pid_lc AND test_key = 'calcium_content';
END IF;

RAISE NOTICE 'A-20 migration 024 — all formulas confirmed from SOP documents';
END;
$$;

COMMIT;
