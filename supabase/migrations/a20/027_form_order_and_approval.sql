-- =============================================================================
-- A-20 Migration 027: A8 form order + A11 Product Approved / Rejected
--
-- A8  Order on every product form:
--       header info (page) -> Colour / Physical State / Clarity (+ appearance
--       dropdown, sedimentation) together -> pH and density right after them
--       -> the tests (titrations, suspensibility, sieves) -> photo -> Observation LAST.
--     Exception kept on purpose: Sulphur SC Phase A "Desired sulphur content"
--     stays at the very top (explicit B-list instruction).
--     Fields not listed for a product are pushed after the listed ones (but
--     before Observation) instead of being dropped - no data is touched.
--     Idempotent (unlisted rows are parked at 5000 + (old order mod 1000)).
--
-- A11 product_qc.approval_decision ('approved' | 'rejected') + approval_reason.
--     Required in the form for Sulphur SC, Zinc SC, Liquid Boron, Liquid Calcium.
--
-- Also applies the B-list Zinc SC Phase A order: sample weight, burette WITH
-- cyanide, burette WITHOUT cyanide, normality, then the Zinc % result.
-- =============================================================================

BEGIN;

-- ─── A11 columns ────────────────────────────────────────────────────────────
ALTER TABLE public.product_qc
  ADD COLUMN IF NOT EXISTS approval_decision text,
  ADD COLUMN IF NOT EXISTS approval_reason   text;

ALTER TABLE public.product_qc DROP CONSTRAINT IF EXISTS product_qc_approval_decision_chk;
ALTER TABLE public.product_qc
  ADD CONSTRAINT product_qc_approval_decision_chk
  CHECK (approval_decision IS NULL OR approval_decision IN ('approved','rejected'));

-- ─── A8 helper: items are 'test_key|Section label', in display order ───────
CREATE OR REPLACE FUNCTION pg_temp.reorder(p_code text, p_phase text, p_items text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_pid uuid; v_key text; v_sec text; i int;
BEGIN
  SELECT id INTO v_pid FROM public.products WHERE code = p_code;
  IF v_pid IS NULL THEN RETURN; END IF;

  -- park everything not listed after the listed rows (and before Observation)
  UPDATE public.qc_test_definitions
     SET sort_order = 5000 + (sort_order % 1000)
   WHERE product_id = v_pid AND phase::text = p_phase
     AND test_key <> ALL (SELECT split_part(x, '|', 1) FROM unnest(p_items) x);

  FOR i IN 1 .. array_length(p_items, 1) LOOP
    v_key := split_part(p_items[i], '|', 1);
    v_sec := NULLIF(split_part(p_items[i], '|', 2), '');
    UPDATE public.qc_test_definitions
       SET sort_order = i * 10, section_label = COALESCE(v_sec, section_label)
     WHERE product_id = v_pid AND phase::text = p_phase AND test_key = v_key;
  END LOOP;

  -- Observation always last
  UPDATE public.qc_test_definitions
     SET sort_order = 9000, section_label = 'Observation'
   WHERE product_id = v_pid AND phase::text = p_phase AND test_key = 'observations';
END $$;

-- ─── Liquid Boron ───────────────────────────────────────────────────────────
SELECT pg_temp.reorder('LIQUID_BORON','none', ARRAY[
  'colour_physical_state|Appearance','clarity|Appearance',
  'ph_5pct|Physical Properties','density|Physical Properties','viscosity|Physical Properties',
  'mass_taken_w|Boron Content','naoh_normality|Boron Content','naoh_v1|Boron Content','naoh_v2|Boron Content','boron_content|Boron Content',
  'product_photo|Photo','observations|Observation']);

-- ─── Liquid Calcium ─────────────────────────────────────────────────────────
SELECT pg_temp.reorder('LIQUID_CALCIUM','none', ARRAY[
  'colour_physical_state|Appearance','clarity|Appearance',
  'ph_5pct|Physical Properties','density|Physical Properties',
  'calcium_w|Calcium Content','calcium_normality|Calcium Content','calcium_br|Calcium Content','calcium_content|Calcium Content',
  'product_photo|Photo','observations|Observation']);

-- ─── Sulphur SC Phase A (desired sulphur content stays on top) ──────────────
SELECT pg_temp.reorder('SULPHUR_SC','A', ARRAY[
  'desired_sulphur_content|Target',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'phase_a_sample_mass|Sulphur Content','phase_a_titration_vol|Sulphur Content','phase_a_iodine_normality|Sulphur Content',
  'phase_a_titration_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'wet_sieve200_sample|Wet Sieve (5 Micron)','wet_sieve200_residue|Wet Sieve (5 Micron)','wet_sieve200_result|Wet Sieve (5 Micron)',
  'wet_sieve325_sample|Wet Sieve (5 Micron)','wet_sieve325_residue|Wet Sieve (5 Micron)','wet_sieve325_result|Wet Sieve (5 Micron)',
  'product_photo|Photo','observations|Observation']);

-- ─── Sulphur SC Phase B ─────────────────────────────────────────────────────
SELECT pg_temp.reorder('SULPHUR_SC','B', ARRAY[
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'ph_direct|Physical Properties','density|Physical Properties','viscosity|Physical Properties',
  'phase_b_sample_mass|Sulphur Content','phase_b_titration_vol|Sulphur Content','phase_b_iodine_normality|Sulphur Content',
  'phase_b_titration_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'suspension_sample_m|Suspensibility','sediment_aliquot_v2|Suspensibility','suspension_sediment_m|Suspensibility','suspensibility|Suspensibility',
  'wet_sieve200_sample|Wet Sieve (5 Micron)','wet_sieve200_residue|Wet Sieve (5 Micron)','wet_sieve200_result|Wet Sieve (5 Micron)',
  'wet_sieve325_sample|Wet Sieve (5 Micron)','wet_sieve325_residue|Wet Sieve (5 Micron)','wet_sieve325_result|Wet Sieve (5 Micron)',
  'product_photo|Photo','observations|Observation']);

-- ─── Ziddi ──────────────────────────────────────────────────────────────────
SELECT pg_temp.reorder('ZIDDI','none', ARRAY[
  'colour_physical_state|Appearance',
  'content_mass_w|Sulphur Content','content_iodine_vol|Sulphur Content','content_iodine_normality|Sulphur Content',
  'content_iodine_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'susp_mass_w|Suspensibility','susp_iodine_vol|Suspensibility','susp_iodine_normality|Suspensibility',
  'susp_sediment_m|Suspensibility','sulphur_suspensibility|Suspensibility',
  'gc_tebu_content|Tebuconazole (GC - Pending)','gc_tebu_suspensibility|Tebuconazole (GC - Pending)',
  'product_photo|Photo','observations|Observation']);

-- ─── Zinc SC Phase A (B-list: weight, WITH cyanide, WITHOUT cyanide, normality) ─
SELECT pg_temp.reorder('ZINC_SC','A', ARRAY[
  'colour_physical_state|Appearance','appearance|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'sample_weight_zn|Zinc Content','v1_with_cyanide|Zinc Content','v2_without_cyanide|Zinc Content',
  'normality_edta|Zinc Content','zinc_content_a|Zinc Content',
  'wet_sieve200_sample|Wet Sieve','wet_sieve200_residue|Wet Sieve','wet_sieve200_result|Wet Sieve',
  'wet_sieve325_sample|Wet Sieve','wet_sieve325_residue|Wet Sieve','wet_sieve325_result|Wet Sieve',
  'product_photo|Photo','observations|Observation']);

-- ─── Zinc SC Phase B ────────────────────────────────────────────────────────
SELECT pg_temp.reorder('ZINC_SC','B', ARRAY[
  'colour_physical_state|Appearance','appearance|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'ph_direct|Physical Properties','density|Physical Properties','viscosity|Physical Properties',
  'zc_mass_sample|Zinc Content','zc_v1_with_cyanide|Zinc Content','zc_v2_without_cyanide|Zinc Content',
  'zc_normality_edta|Zinc Content','zinc_content|Zinc Content',
  'susp_mass|Suspensibility','susp_v1_sediment|Suspensibility','susp_v2_sediment|Suspensibility','suspension|Suspensibility',
  'wet_sieve200_sample|Wet Sieve','wet_sieve200_residue|Wet Sieve','wet_sieve200_result|Wet Sieve',
  'wet_sieve325_sample|Wet Sieve','wet_sieve325_residue|Wet Sieve','wet_sieve325_result|Wet Sieve',
  'product_photo|Photo','observations|Observation']);

COMMIT;

-- Check (expect Observation as the highest sort_order per product/phase):
-- SELECT p.code, d.phase, d.test_key, d.sort_order FROM qc_test_definitions d
-- JOIN products p ON p.id = d.product_id WHERE d.is_active ORDER BY p.code, d.phase, d.sort_order;
