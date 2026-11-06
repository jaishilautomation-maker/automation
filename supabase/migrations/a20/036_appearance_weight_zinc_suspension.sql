-- =============================================================================
-- A-20 Migration 036: Appearance section, "mass" -> "weight", Zinc SC Phase B
--                     suspension clean-up
--
-- Run on the Factory A-20 Supabase project, AFTER 035.
-- Needs the matching app change in app/(app)/lab-qc/product-qc/page.tsx (the
-- saved product_qc.appearance now comes from the Appearance dropdown).
--
-- (1) APPEARANCE SECTION - every product (Sulphur SC, Zinc SC, Liquid Boron,
--     Liquid Calcium, Ziddi), every phase:
--       * the free-text "Color & Physical State" field is removed (switched off)
--       * kept: "Appearance" dropdown (Off-white liquid / Yellowish liquid /
--         White liquid / Other + free text) and "Any Sedimentation?" (Yes / No)
--       * Liquid Boron + Liquid Calcium ALSO keep their existing Clarity field
--         unchanged (so they show Appearance, Any Sedimentation, Clarity)
--       * Clarity is switched off on Sulphur SC, Zinc SC and Ziddi so those
--         show only the two fields requested
--     Boron, Calcium and Ziddi did not have the dropdown / sedimentation fields
--     yet (only Sulphur SC + Zinc SC did), so they are created here in the exact
--     slot "Color & Physical State" used to occupy.
--
-- (2) The word "mass" -> "weight" in every product QC field label.
--
-- (3) ZINC SC PHASE B - Suspensibility section:
--       * "Normality EDTA" was sinking to the bottom of the form; it now sits
--         inside the Suspensibility section.
--       * "Titre with cyanide" / "Titre without cyanide" at the bottom were
--         leftover duplicates of the V1 / V2 titre inputs the suspension
--         formula actually reads; they are switched off.
--       * Section order: weight, V1 (with cyanide), V2 (without cyanide),
--         Normality EDTA, then the Suspension % result.
--     The suspension FORMULA is unchanged (SOP: A = Zinc% x 0.25/100,
--     B = (V2s - V1s) x 0.0098012 x 65.38 / 1000, Susp % = (A-B)/A x 111). It
--     reads the Zinc Content V1/V2 as well as the suspension V1/V2, which is why
--     it stayed blank when only the suspension fields (or the old bottom fields)
--     were filled; the form now says what a blank result is waiting for.
--     Normality EDTA is recorded only: the SOP factor 0.0098012 already embeds
--     the 0.01 N EDTA strength (same as Phase A / Zinc Content).
--
-- Rows are switched off (is_active = false), never deleted. Idempotent.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ssc uuid; pid_zsc uuid; pid_lb uuid; pid_lc uuid; pid_zd uuid;
  v_opts  jsonb := '["Off-white liquid","Yellowish liquid","White liquid","Other"]'::jsonb;
  v_yesno jsonb := '["Yes","No"]'::jsonb;
BEGIN
  SELECT id INTO pid_ssc FROM public.products WHERE code = 'SULPHUR_SC';
  SELECT id INTO pid_zsc FROM public.products WHERE code = 'ZINC_SC';
  SELECT id INTO pid_lb  FROM public.products WHERE code = 'LIQUID_BORON';
  SELECT id INTO pid_lc  FROM public.products WHERE code = 'LIQUID_CALCIUM';
  SELECT id INTO pid_zd  FROM public.products WHERE code = 'ZIDDI';

  -- ── (1a) Create the two fields where they are missing (single-phase products) ──
  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,options,sort_order,section_label)
  SELECT p, 'none', 'appearance_dropdown', 'Appearance', NULL, 'select', v_opts, 25, 'Appearance'
    FROM unnest(ARRAY[pid_lb, pid_lc, pid_zd]) AS p WHERE p IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,options,sort_order,section_label)
  SELECT p, 'none', 'any_sedimentation', 'Any Sedimentation?', NULL, 'select', v_yesno, 26, 'Appearance'
    FROM unnest(ARRAY[pid_lb, pid_lc, pid_zd]) AS p WHERE p IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Put them where "Color & Physical State" sat (dropdown there, sedimentation
  -- just after it; Boron / Calcium Clarity keeps its own slot right below).
  UPDATE public.qc_test_definitions a
     SET sort_order = c.sort_order
    FROM public.qc_test_definitions c
   WHERE a.product_id = c.product_id AND a.phase = c.phase
     AND c.test_key = 'colour_physical_state'
     AND a.test_key = 'appearance_dropdown'
     AND a.product_id IN (pid_lb, pid_lc, pid_zd);

  UPDATE public.qc_test_definitions a
     SET sort_order = c.sort_order + 5
    FROM public.qc_test_definitions c
   WHERE a.product_id = c.product_id AND a.phase = c.phase
     AND c.test_key = 'colour_physical_state'
     AND a.test_key = 'any_sedimentation'
     AND a.product_id IN (pid_lb, pid_lc, pid_zd);

  -- ── (1b) Same definition on all five products ─────────────────────────────
  UPDATE public.qc_test_definitions
     SET label = 'Appearance', input_type = 'select', options = v_opts,
         section_label = 'Appearance', is_active = true
   WHERE test_key = 'appearance_dropdown'
     AND product_id IN (pid_ssc, pid_zsc, pid_lb, pid_lc, pid_zd);

  UPDATE public.qc_test_definitions
     SET label = 'Any Sedimentation?', input_type = 'select', options = v_yesno,
         section_label = 'Appearance', is_active = true
   WHERE test_key = 'any_sedimentation'
     AND product_id IN (pid_ssc, pid_zsc, pid_lb, pid_lc, pid_zd);

  -- ── (1c) Remove "Color & Physical State" everywhere ───────────────────────
  UPDATE public.qc_test_definitions
     SET is_active = false
   WHERE test_key = 'colour_physical_state' AND product_id IS NOT NULL;

  -- ── (1d) Clarity: stays on Boron + Calcium, removed from the rest ─────────
  UPDATE public.qc_test_definitions
     SET is_active = false
   WHERE test_key = 'clarity' AND product_id IN (pid_ssc, pid_zsc, pid_zd);

  -- ── (2) "mass" -> "weight" in every product field label / section label ───
  UPDATE public.qc_test_definitions
     SET label = replace(replace(replace(label, 'Mass', 'Weight'), 'mass', 'weight'), 'MASS', 'WEIGHT')
   WHERE product_id IS NOT NULL AND label ILIKE '%mass%';

  UPDATE public.qc_test_definitions
     SET section_label = replace(replace(replace(section_label, 'Mass', 'Weight'), 'mass', 'weight'), 'MASS', 'WEIGHT')
   WHERE product_id IS NOT NULL AND section_label ILIKE '%mass%';

  -- ── (3) Zinc SC Phase B: suspension section ───────────────────────────────
  IF pid_zsc IS NOT NULL THEN
    -- the duplicate titre inputs left at the bottom of the form
    UPDATE public.qc_test_definitions
       SET is_active = false
     WHERE product_id = pid_zsc AND phase = 'B'
       AND test_key IN ('titre_with_cyanide', 'titre_without_cyanide');

    -- Normality EDTA belongs to the suspension block
    UPDATE public.qc_test_definitions
       SET label = 'SUSPENSION — Normality EDTA', section_label = 'Suspensibility', is_active = true
     WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'normality_edta';

    UPDATE public.qc_test_definitions
       SET label = 'SUSPENSION — Weight of suspension sample'
     WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_mass';
  END IF;
END;
$$;

-- ── Zinc SC Phase B: explicit order (same helper pattern as 027 / 033) ───────
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

SELECT pg_temp.reorder('ZINC_SC','B', ARRAY[
  'lot_batch_number|Batch Info','phase_b_slurry_weight|Batch Info',
  'appearance_dropdown|Appearance','any_sedimentation|Appearance',
  'ph_direct|Physical Properties','density|Physical Properties','viscosity|Physical Properties',
  'zc_mass_sample|Zinc Content','zc_v1_with_cyanide|Zinc Content','zc_v2_without_cyanide|Zinc Content',
  'zc_normality_edta|Zinc Content','zinc_content|Zinc Content',
  'susp_mass|Suspensibility','susp_v1_sediment|Suspensibility','susp_v2_sediment|Suspensibility',
  'normality_edta|Suspensibility','suspension|Suspensibility',
  'wet_sieve200_sample|Wet Sieve','wet_sieve200_residue|Wet Sieve','wet_sieve200_result|Wet Sieve',
  'wet_sieve325_sample|Wet Sieve','wet_sieve325_residue|Wet Sieve','wet_sieve325_result|Wet Sieve',
  'product_photo|Photo','observations|Observation']);

COMMIT;

-- Verify:
-- SELECT p.code, d.phase, d.sort_order, d.test_key, d.label, d.section_label
--   FROM qc_test_definitions d JOIN products p ON p.id = d.product_id
--  WHERE d.is_active AND d.section_label = 'Appearance' ORDER BY p.code, d.phase, d.sort_order;
-- SELECT label FROM qc_test_definitions WHERE product_id IS NOT NULL AND label ILIKE '%mass%';  -- expect 0 rows
-- SELECT sort_order, test_key, label FROM qc_test_definitions d JOIN products p ON p.id=d.product_id
--  WHERE p.code='ZINC_SC' AND d.phase='B' AND d.is_active ORDER BY sort_order;
