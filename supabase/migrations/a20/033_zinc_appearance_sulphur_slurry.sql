-- =============================================================================
-- A-20 Migration 033: Zinc SC single Appearance + Sulphur SC Slurry Weight
--
-- Run on the Factory A-20 Supabase project, AFTER 032.
--
-- (1) Zinc SC shows TWO "Appearance" fields (a free-text `appearance` from the
--     003 seed AND the `appearance_dropdown` select from 027, both listed in
--     027's Appearance section). Keep only the dropdown: deactivate the legacy
--     `appearance` text field for Zinc SC Phase A and B (is_active=false, so
--     any historical values are preserved, the field just stops rendering).
--
-- (2) Sulphur SC "Slurry Wt" (phase_a_slurry_weight / phase_b_slurry_weight,
--     seeded in 003) is missing from the form because 027's Sulphur SC reorder
--     lists never included it, so it was parked at sort_order 5000+. Re-seat it
--     at the top of each phase (a "Batch Info" section) and re-run the full
--     Sulphur SC order so the layout is deterministic.
--
-- Also re-runs the Zinc SC order WITHOUT `appearance` so nothing re-parks it.
--
-- Idempotent: ON CONFLICT DO NOTHING on the (re)insert; reorder re-runnable.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ssc uuid;
  pid_zsc uuid;
BEGIN
  SELECT id INTO pid_ssc FROM public.products WHERE code = 'SULPHUR_SC';
  SELECT id INTO pid_zsc FROM public.products WHERE code = 'ZINC_SC';

  -- ── (1) Zinc SC: drop the duplicate free-text Appearance ──────────────────
  IF pid_zsc IS NOT NULL THEN
    UPDATE public.qc_test_definitions
       SET is_active = false
     WHERE product_id = pid_zsc AND phase IN ('A','B') AND test_key = 'appearance';
  END IF;

  -- ── (2) Sulphur SC: make sure the Slurry Weight inputs exist ──────────────
  IF pid_ssc IS NOT NULL THEN
    INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order,section_label) VALUES
      (pid_ssc,'A','phase_a_slurry_weight','Quantity of Phase A / Slurry Weight','kg','number', 5, 'Batch Info'),
      (pid_ssc,'B','phase_b_slurry_weight','Quantity / Slurry Weight',           'kg','number', 5, 'Batch Info')
    ON CONFLICT DO NOTHING;

    -- Ensure they are active and labelled even if they already existed.
    UPDATE public.qc_test_definitions
       SET is_active = true, input_type = 'number', unit = 'kg',
           label = 'Quantity of Phase A / Slurry Weight'
     WHERE product_id = pid_ssc AND phase = 'A' AND test_key = 'phase_a_slurry_weight';
    UPDATE public.qc_test_definitions
       SET is_active = true, input_type = 'number', unit = 'kg',
           label = 'Quantity / Slurry Weight'
     WHERE product_id = pid_ssc AND phase = 'B' AND test_key = 'phase_b_slurry_weight';
  END IF;
END;
$$;

-- ── Deterministic reorder (same helper pattern as 027) ──────────────────────
CREATE OR REPLACE FUNCTION pg_temp.reorder(p_code text, p_phase text, p_items text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_pid uuid; v_key text; v_sec text; i int;
BEGIN
  SELECT id INTO v_pid FROM public.products WHERE code = p_code;
  IF v_pid IS NULL THEN RETURN; END IF;

  UPDATE public.qc_test_definitions
     SET sort_order = 5000 + (sort_order % 1000)
   WHERE product_id = v_pid AND phase::text = p_phase
     AND test_key <> ALL (SELECT split_part(x, '|', 1) FROM unnest(p_items) x)
     AND test_key <> 'observations';

  FOR i IN 1 .. array_length(p_items, 1) LOOP
    v_key := split_part(p_items[i], '|', 1);
    v_sec := NULLIF(split_part(p_items[i], '|', 2), '');
    UPDATE public.qc_test_definitions
       SET sort_order = i * 10, section_label = COALESCE(v_sec, section_label)
     WHERE product_id = v_pid AND phase::text = p_phase AND test_key = v_key;
  END LOOP;

  UPDATE public.qc_test_definitions
     SET sort_order = 9000, section_label = 'Observation'
   WHERE product_id = v_pid AND phase::text = p_phase AND test_key = 'observations';
END $$;

-- Sulphur SC Phase A — Slurry Weight up top, then the 027 order.
SELECT pg_temp.reorder('SULPHUR_SC','A', ARRAY[
  'lot_batch_number|Batch Info','phase_a_slurry_weight|Batch Info',
  'desired_sulphur_content|Target',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'phase_a_sample_mass|Sulphur Content','phase_a_titration_vol|Sulphur Content','phase_a_iodine_normality|Sulphur Content',
  'phase_a_titration_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'wet_sieve200_sample|Wet Sieve (5 Micron)','wet_sieve200_residue|Wet Sieve (5 Micron)','wet_sieve200_result|Wet Sieve (5 Micron)',
  'wet_sieve325_sample|Wet Sieve (5 Micron)','wet_sieve325_residue|Wet Sieve (5 Micron)','wet_sieve325_result|Wet Sieve (5 Micron)',
  'product_photo|Photo','observations|Observation']);

-- Sulphur SC Phase B — Slurry Weight up top, then the 027 order.
SELECT pg_temp.reorder('SULPHUR_SC','B', ARRAY[
  'lot_batch_number|Batch Info','phase_b_slurry_weight|Batch Info',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'ph_direct|Physical Properties','density|Physical Properties','viscosity|Physical Properties',
  'phase_b_sample_mass|Sulphur Content','phase_b_titration_vol|Sulphur Content','phase_b_iodine_normality|Sulphur Content',
  'phase_b_titration_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'suspension_sample_m|Suspensibility','sediment_aliquot_v2|Suspensibility','suspension_sediment_m|Suspensibility','suspensibility|Suspensibility',
  'wet_sieve200_sample|Wet Sieve (5 Micron)','wet_sieve200_residue|Wet Sieve (5 Micron)','wet_sieve200_result|Wet Sieve (5 Micron)',
  'wet_sieve325_sample|Wet Sieve (5 Micron)','wet_sieve325_residue|Wet Sieve (5 Micron)','wet_sieve325_result|Wet Sieve (5 Micron)',
  'product_photo|Photo','observations|Observation']);

-- Zinc SC Phase A — NO legacy `appearance` (dropdown only); slurry weight up top.
SELECT pg_temp.reorder('ZINC_SC','A', ARRAY[
  'lot_batch_number|Batch Info','phase_a_slurry_weight|Batch Info',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'sample_weight_zn|Zinc Content','v1_with_cyanide|Zinc Content','v2_without_cyanide|Zinc Content',
  'normality_edta|Zinc Content','zinc_content_a|Zinc Content',
  'wet_sieve200_sample|Wet Sieve','wet_sieve200_residue|Wet Sieve','wet_sieve200_result|Wet Sieve',
  'wet_sieve325_sample|Wet Sieve','wet_sieve325_residue|Wet Sieve','wet_sieve325_result|Wet Sieve',
  'product_photo|Photo','observations|Observation']);

-- Zinc SC Phase B — NO legacy `appearance` (dropdown only); slurry weight up top.
SELECT pg_temp.reorder('ZINC_SC','B', ARRAY[
  'lot_batch_number|Batch Info','phase_b_slurry_weight|Batch Info',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'ph_direct|Physical Properties','density|Physical Properties','viscosity|Physical Properties',
  'zc_mass_sample|Zinc Content','zc_v1_with_cyanide|Zinc Content','zc_v2_without_cyanide|Zinc Content',
  'zc_normality_edta|Zinc Content','zinc_content|Zinc Content',
  'susp_mass|Suspensibility','susp_v1_sediment|Suspensibility','susp_v2_sediment|Suspensibility','suspension|Suspensibility',
  'wet_sieve200_sample|Wet Sieve','wet_sieve200_residue|Wet Sieve','wet_sieve200_result|Wet Sieve',
  'wet_sieve325_sample|Wet Sieve','wet_sieve325_residue|Wet Sieve','wet_sieve325_result|Wet Sieve',
  'product_photo|Photo','observations|Observation']);

COMMIT;

-- Verify:
-- SELECT p.code, d.phase, d.sort_order, d.test_key, d.section_label, d.is_active
-- FROM qc_test_definitions d JOIN products p ON p.id = d.product_id
-- WHERE p.code IN ('SULPHUR_SC','ZINC_SC') ORDER BY p.code, d.phase, d.sort_order;
