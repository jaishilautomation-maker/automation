-- =============================================================================
-- A-20 Migration 034: Sulphur SC suspensibility formula (titre method, both
-- phases) + Product QC section ordering for Sulphur SC, InstaBor, InstaCal.
--
-- Run on the Factory A-20 Supabase project, AFTER 033.
--
-- (A) Sulphur SC Suspensibility — new titre-based formula (worked example):
--       S-content % = 0.03206 x 100 x N x B.R / Wt           (already wired)
--       A = S-content x susp_sample_wt / 100
--       B = susp_sediment_titre x 0.03206 x N
--       Suspensibility % = (A - B) / (A x 9) x 1000
--     Worked check: N=0.0976, S-content=56.08, susp_sample_wt=0.6208,
--       sediment titre=18.4  ->  ~92.7 %.
--
--     Phase B already has suspension_sample_m (= susp sample wt) and
--     sediment_aliquot_v2 (= sediment titre); it uses phase_b_iodine_normality.
--     Phase A had NO suspensibility fields — they are added here so the same
--     calculation runs in Phase A using phase_a_iodine_normality.
--
--     The formula engine (lib/formula.ts) substitutes sibling test_key values,
--     so each phase references its OWN normality key and the phase's
--     sulphur_content result.
--
-- (B) Section order per request:
--     Sulphur SC : Sulphur Content -> Suspensibility -> pH -> Viscosity -> Density
--     InstaBor   : Content -> pH -> Viscosity -> Density
--     InstaCal   : Content -> pH -> Viscosity -> Density
--     (Appearance / Batch info stay above; Photo + Observation stay last.)
--
-- Idempotent.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ssc uuid;
BEGIN
  SELECT id INTO pid_ssc FROM public.products WHERE code = 'SULPHUR_SC';
  IF pid_ssc IS NULL THEN RAISE NOTICE '034: SULPHUR_SC not found'; RETURN; END IF;

  -- ── Phase A suspensibility inputs (new) ───────────────────────────────────
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order,section_label) VALUES
    (pid_ssc,'A','suspension_sample_m', 'Weight of suspension sample (g)',      'g', 'number', 300, 'Suspensibility'),
    (pid_ssc,'A','sediment_aliquot_v2', 'Titre with sediment aliquot (mL)',     'mL','number', 301, 'Suspensibility')
  ON CONFLICT DO NOTHING;

  -- Phase A suspensibility result (new, calculated)
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order,section_label) VALUES
    (pid_ssc,'A','suspensibility','Suspensibility','%','number',
     '((sulphur_content * suspension_sample_m / 100) - (sediment_aliquot_v2 * 0.03206 * phase_a_iodine_normality)) / ((sulphur_content * suspension_sample_m / 100) * 9) * 1000',
     true, 302, 'Suspensibility')
  ON CONFLICT DO NOTHING;

  -- Force the Phase A formula even if the row already existed.
  UPDATE public.qc_test_definitions
     SET formula = '((sulphur_content * suspension_sample_m / 100) - (sediment_aliquot_v2 * 0.03206 * phase_a_iodine_normality)) / ((sulphur_content * suspension_sample_m / 100) * 9) * 1000',
         is_calculated = true, input_type = 'number', unit = '%', label = 'Suspensibility'
   WHERE product_id = pid_ssc AND phase = 'A' AND test_key = 'suspensibility';

  -- ── Phase B suspensibility — switch to the titre-based formula ────────────
  UPDATE public.qc_test_definitions
     SET formula = '((sulphur_content * suspension_sample_m / 100) - (sediment_aliquot_v2 * 0.03206 * phase_b_iodine_normality)) / ((sulphur_content * suspension_sample_m / 100) * 9) * 1000',
         is_calculated = true, input_type = 'number', unit = '%', label = 'Suspensibility'
   WHERE product_id = pid_ssc AND phase = 'B' AND test_key = 'suspensibility';

  -- suspension_sediment_m (old mass input) is no longer used by the formula;
  -- keep it in the DB but drop it off the form.
  UPDATE public.qc_test_definitions
     SET is_active = false
   WHERE product_id = pid_ssc AND phase = 'B' AND test_key = 'suspension_sediment_m';
END;
$$;

-- ── Reorder helper (same pattern as 027) ────────────────────────────────────
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

-- Sulphur SC Phase A: Sulphur Content -> Suspensibility -> (no pH field in A)
-- -> Viscosity -> Density. Wet sieve kept after the physical props.
SELECT pg_temp.reorder('SULPHUR_SC','A', ARRAY[
  'lot_batch_number|Batch Info','phase_a_slurry_weight|Batch Info',
  'desired_sulphur_content|Target',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'phase_a_sample_mass|Sulphur Content','phase_a_titration_vol|Sulphur Content','phase_a_iodine_normality|Sulphur Content',
  'phase_a_titration_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'suspension_sample_m|Suspensibility','sediment_aliquot_v2|Suspensibility','suspensibility|Suspensibility',
  'viscosity|Viscosity',
  'density|Density',
  'wet_sieve200_sample|Wet Sieve (5 Micron)','wet_sieve200_residue|Wet Sieve (5 Micron)','wet_sieve200_result|Wet Sieve (5 Micron)',
  'wet_sieve325_sample|Wet Sieve (5 Micron)','wet_sieve325_residue|Wet Sieve (5 Micron)','wet_sieve325_result|Wet Sieve (5 Micron)',
  'product_photo|Photo','observations|Observation']);

-- Sulphur SC Phase B: Sulphur Content -> Suspensibility -> pH -> Viscosity -> Density.
SELECT pg_temp.reorder('SULPHUR_SC','B', ARRAY[
  'lot_batch_number|Batch Info','phase_b_slurry_weight|Batch Info',
  'colour_physical_state|Appearance','appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'phase_b_sample_mass|Sulphur Content','phase_b_titration_vol|Sulphur Content','phase_b_iodine_normality|Sulphur Content',
  'phase_b_titration_blank|Sulphur Content','sulphur_content|Sulphur Content',
  'suspension_sample_m|Suspensibility','sediment_aliquot_v2|Suspensibility','suspensibility|Suspensibility',
  'ph_direct|pH',
  'viscosity|Viscosity',
  'density|Density',
  'wet_sieve200_sample|Wet Sieve (5 Micron)','wet_sieve200_residue|Wet Sieve (5 Micron)','wet_sieve200_result|Wet Sieve (5 Micron)',
  'wet_sieve325_sample|Wet Sieve (5 Micron)','wet_sieve325_residue|Wet Sieve (5 Micron)','wet_sieve325_result|Wet Sieve (5 Micron)',
  'product_photo|Photo','observations|Observation']);

-- InstaBor (Liquid Boron): Content -> pH -> Viscosity -> Density.
SELECT pg_temp.reorder('LIQUID_BORON','none', ARRAY[
  'lot_batch_number|Batch Info','lot_batch_quantity|Batch Info',
  'colour_physical_state|Appearance','clarity|Appearance',
  'mass_taken_w|Boron Content','naoh_normality|Boron Content','naoh_v1|Boron Content','naoh_v2|Boron Content','boron_content|Boron Content',
  'ph_5pct|pH',
  'viscosity|Viscosity',
  'density|Density',
  'product_photo|Photo','observations|Observation']);

-- InstaCal 160 (Liquid Calcium): Content -> pH -> Viscosity -> Density.
-- (Liquid Calcium has no viscosity field seeded; the section is simply absent.)
SELECT pg_temp.reorder('LIQUID_CALCIUM','none', ARRAY[
  'lot_batch_number|Batch Info','quantity|Batch Info',
  'colour_physical_state|Appearance','clarity|Appearance',
  'calcium_w|Calcium Content','calcium_normality|Calcium Content','calcium_br|Calcium Content','calcium_content|Calcium Content',
  'ph_5pct|pH',
  'density|Density',
  'product_photo|Photo','observations|Observation']);

COMMIT;

-- Verify order + formulas:
-- SELECT p.code, d.phase, d.sort_order, d.test_key, d.section_label, d.formula
-- FROM qc_test_definitions d JOIN products p ON p.id = d.product_id
-- WHERE p.code IN ('SULPHUR_SC','LIQUID_BORON','LIQUID_CALCIUM') AND d.is_active
-- ORDER BY p.code, d.phase, d.sort_order;
