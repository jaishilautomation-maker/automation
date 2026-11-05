-- =============================================================================
-- A-20 Migration 031: Ziddi — Tebuconazole Suspensibility by GC
--
-- Run on the Factory A-20 Supabase project, AFTER 030.
--
-- Turns the single manual "Tebuconazole Suspensibility (by GC)" % field into
-- the full GC-based suspension calculation from the worked method guide
-- ("TEBUCONAZOLE 10% WG — Actual GC Assay and Suspension Calculation").
--
-- The suspension reuses the SAME working-standard ratio, standard weight and
-- standard purity entered for the assay (migration 030): tebu_std_ratio,
-- tebu_std_wt, tebu_std_purity. It adds its own GC areas, a prep weight, the
-- initial test-portion weight, and the dried-residue weight + fraction.
--
--   1. Suspension GC ratio   = Area Tebu (susp) / Area DOP (susp)
--   2. Suspension GC assay %  = (susp ratio / std ratio)
--                             x (std wt / susp prep wt)
--                             x std purity
--   3. C (a.i. in test portion, g) = initial sample wt x (assay % / 100)
--        -> uses the ASSAY result gc_tebu_content (section 3.1 of the guide)
--   4. Q (a.i. in bottom residue, g) = residue wt x residue fraction
--   5. Suspensibility %      = 111 x (C - Q) / C
--
-- Worked-example check (guide section 6, Q from 0.4440 x 0.09081):
--   std ratio 0.8423, susp ratio 0.8172, susp assay ~9.81%,
--   C = 1.5000 x 9.78/100 = 0.1467, Q = 0.4440 x 0.09081 = 0.04032,
--   Suspensibility = 111 x (0.1467 - 0.04032)/0.1467 ~= 80.5%.
--
-- ============================================================================
-- DECISIONS THE GUIDE ASKS YOU TO CONFIRM (it is a calculation guide, NOT an
-- approved SOP). Implemented the chemically-consistent reading; change here if
-- your controlled method differs:
--   * 111 factor = 100 x (250/225) volume/percentage correction — left as a
--     plain constant in the formula (not an input).
--   * C uses the product ASSAY (gc_tebu_content), per guide 3.1.
--   * Q = residue weight x residue assay FRACTION (decimal, e.g. 0.09081 for
--     9.081%). The guide flags that 0.09081 vs 0.09797 changes the result
--     (80.5% vs 78.08%); the chemist enters whichever the controlled method
--     specifies as the dried-residue assay fraction.
-- ============================================================================
--
-- Idempotent: ON CONFLICT DO NOTHING + explicit UPDATEs; reorder re-runnable.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ziddi uuid;
BEGIN

SELECT id INTO pid_ziddi FROM public.products WHERE code = 'ZIDDI';
IF pid_ziddi IS NULL THEN
  RAISE NOTICE 'ZIDDI product not found — skipping migration 031';
  RETURN;
END IF;

-- ── Raw suspension inputs (sort_order set authoritatively in the reorder) ───
INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES
  (pid_ziddi,'none','tebu_susp_area_tebu',        'TEBU SUSPENSIBILITY (GC) — Area of Tebuconazole',            NULL,'number', 200),
  (pid_ziddi,'none','tebu_susp_area_dop',         'TEBU SUSPENSIBILITY (GC) — Area of DOP',                     NULL,'number', 201),
  (pid_ziddi,'none','tebu_susp_prep_wt',          'TEBU SUSPENSIBILITY (GC) — Weight of GC prep material (g)',  'g', 'number', 203),
  (pid_ziddi,'none','tebu_susp_init_wt',          'TEBU SUSPENSIBILITY — Initial test sample weight (g)',       'g', 'number', 205),
  (pid_ziddi,'none','tebu_susp_residue_wt',       'TEBU SUSPENSIBILITY — Dried bottom residue weight (g)',      'g', 'number', 207),
  (pid_ziddi,'none','tebu_susp_residue_fraction', 'TEBU SUSPENSIBILITY — Residue assay fraction (decimal)',     NULL,'number', 208)
ON CONFLICT DO NOTHING;

-- ── Calculated chain ────────────────────────────────────────────────────────
INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order) VALUES
  (pid_ziddi,'none','tebu_susp_ratio', 'TEBU SUSPENSIBILITY (GC) — Response ratio (Tebu / DOP)', NULL,'number',
     'tebu_susp_area_tebu / tebu_susp_area_dop', true, 202),
  (pid_ziddi,'none','tebu_susp_assay', 'TEBU SUSPENSIBILITY (GC) — Assay of prep (% w/w)', '%','number',
     '(tebu_susp_ratio / tebu_std_ratio) * (tebu_std_wt / tebu_susp_prep_wt) * tebu_std_purity', true, 204),
  (pid_ziddi,'none','tebu_susp_c', 'TEBU SUSPENSIBILITY — C: a.i. in test portion (g)', 'g','number',
     'tebu_susp_init_wt * gc_tebu_content / 100', true, 206),
  (pid_ziddi,'none','tebu_susp_q', 'TEBU SUSPENSIBILITY — Q: a.i. in bottom residue (g)', 'g','number',
     'tebu_susp_residue_wt * tebu_susp_residue_fraction', true, 209)
ON CONFLICT DO NOTHING;

-- Force the formulas even if rows pre-existed.
UPDATE public.qc_test_definitions
  SET formula = 'tebu_susp_area_tebu / tebu_susp_area_dop', is_calculated = true, input_type = 'number', unit = NULL
  WHERE product_id = pid_ziddi AND test_key = 'tebu_susp_ratio';
UPDATE public.qc_test_definitions
  SET formula = '(tebu_susp_ratio / tebu_std_ratio) * (tebu_std_wt / tebu_susp_prep_wt) * tebu_std_purity',
      is_calculated = true, input_type = 'number', unit = '%'
  WHERE product_id = pid_ziddi AND test_key = 'tebu_susp_assay';
UPDATE public.qc_test_definitions
  SET formula = 'tebu_susp_init_wt * gc_tebu_content / 100', is_calculated = true, input_type = 'number', unit = 'g'
  WHERE product_id = pid_ziddi AND test_key = 'tebu_susp_c';
UPDATE public.qc_test_definitions
  SET formula = 'tebu_susp_residue_wt * tebu_susp_residue_fraction', is_calculated = true, input_type = 'number', unit = 'g'
  WHERE product_id = pid_ziddi AND test_key = 'tebu_susp_q';

-- ── Final suspensibility (replaces the old manual gc_tebu_suspensibility) ───
UPDATE public.qc_test_definitions
  SET formula = '111 * (tebu_susp_c - tebu_susp_q) / tebu_susp_c',
      is_calculated = true, input_type = 'number', unit = '%',
      label = 'Tebuconazole Suspensibility (by GC)'
  WHERE product_id = pid_ziddi AND test_key = 'gc_tebu_suspensibility';

-- ── Reorder: slot the suspension block under "Tebuconazole Suspensibility" ──
DECLARE
  v_items text[] := ARRAY[
    'colour_physical_state|Appearance',
    -- 1. Sulphur Content
    'content_mass_w|Sulphur Content','content_iodine_vol|Sulphur Content',
    'content_iodine_normality|Sulphur Content','content_iodine_blank|Sulphur Content',
    'sulphur_content|Sulphur Content',
    -- 2. Sulphur Suspensibility
    'susp_mass_w|Sulphur Suspensibility','susp_iodine_vol|Sulphur Suspensibility',
    'susp_iodine_normality|Sulphur Suspensibility','susp_sediment_m|Sulphur Suspensibility',
    'sulphur_suspensibility|Sulphur Suspensibility',
    -- 3. Tebuconazole Content (GC)
    'tebu_std_area_tebu|Tebuconazole Content','tebu_std_area_dop|Tebuconazole Content',
    'tebu_std_ratio|Tebuconazole Content','tebu_sample_area_tebu|Tebuconazole Content',
    'tebu_sample_area_dop|Tebuconazole Content','tebu_sample_ratio|Tebuconazole Content',
    'tebu_std_wt|Tebuconazole Content','tebu_sample_wt|Tebuconazole Content',
    'tebu_std_purity|Tebuconazole Content','gc_tebu_content|Tebuconazole Content',
    -- 4. Tebuconazole Suspensibility (GC)
    'tebu_susp_area_tebu|Tebuconazole Suspensibility','tebu_susp_area_dop|Tebuconazole Suspensibility',
    'tebu_susp_ratio|Tebuconazole Suspensibility','tebu_susp_prep_wt|Tebuconazole Suspensibility',
    'tebu_susp_assay|Tebuconazole Suspensibility','tebu_susp_init_wt|Tebuconazole Suspensibility',
    'tebu_susp_c|Tebuconazole Suspensibility','tebu_susp_residue_wt|Tebuconazole Suspensibility',
    'tebu_susp_residue_fraction|Tebuconazole Suspensibility','tebu_susp_q|Tebuconazole Suspensibility',
    'gc_tebu_suspensibility|Tebuconazole Suspensibility',
    'product_photo|Photo'
  ];
  v_key text; v_sec text; i int;
BEGIN
  UPDATE public.qc_test_definitions
     SET sort_order = 5000 + (sort_order % 1000)
   WHERE product_id = pid_ziddi AND phase = 'none'
     AND test_key <> ALL (SELECT split_part(x, '|', 1) FROM unnest(v_items) x)
     AND test_key <> 'observations';

  FOR i IN 1 .. array_length(v_items, 1) LOOP
    v_key := split_part(v_items[i], '|', 1);
    v_sec := NULLIF(split_part(v_items[i], '|', 2), '');
    UPDATE public.qc_test_definitions
       SET sort_order = i * 10, section_label = COALESCE(v_sec, section_label)
     WHERE product_id = pid_ziddi AND phase = 'none' AND test_key = v_key;
  END LOOP;

  UPDATE public.qc_test_definitions
     SET sort_order = 9000, section_label = 'Observation'
   WHERE product_id = pid_ziddi AND phase = 'none' AND test_key = 'observations';
END;

RAISE NOTICE 'A-20 migration 031 — Ziddi Tebuconazole Suspensibility GC wired';
END;
$$;

COMMIT;
