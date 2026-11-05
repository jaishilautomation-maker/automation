-- =============================================================================
-- A-20 Migration 030: Ziddi — Tebuconazole Content by GC + form reorder
--
-- Run on the Factory A-20 Supabase project, AFTER 029.
--
-- Part 1 — Tebuconazole Content by GC (internal standard)
--   Replaces the single manual "Tebuconazole Content (by GC)" % input with the
--   full GC internal-standard calculation from the SOP
--   ("Determination of Tebuconazole 10% WG by G.C method"):
--
--     Reagents: Acetone, Dioctyl phthalate (DOP / DOCP = internal std)
--     Prep: std stock 2 g DOP -> 100 mL; working std 0.2 g tebu + 10 mL -> 100 mL;
--           sample 2 g product + 10 mL stock -> 100 mL.
--     Retention: Tebuconazole 2.5 min, DOP 4 min.
--
--     STD ratio    = Area of Tebuconazole (std)    / Area of DOP (std)
--     Sample ratio = Area of Tebuconazole (sample) / Area of DOP (sample)
--     Content %    = (Sample ratio / STD ratio)
--                  x (Wt of standard / Wt of sample)   -- DOP cancels (same stock)
--                  x Purity of standard
--
--   The chemist types the four GC areas, the two weights (SOP 0.2 g / 2 g), and
--   the standard purity. The two ratios and the final content calculate live
--   (lib/formula.ts) and are stored in test_results.
--
--   NOTE ON WEIGHTS: the SOP's final line reads "Wt of sample / Wt of DOP", but
--   the prep makes DOP the internal standard present in BOTH injections, so it
--   cancels in the ratio. The chemically-correct weight term is therefore
--   (weight of tebuconazole reference standard) / (weight of product sample).
--   Both weights are editable inputs (pre-filled 0.2 and 2) so the value on
--   screen always matches what the chemist actually weighed.
--
-- Part 2 — Rename + reorder the whole Ziddi form into four blocks:
--     1. Sulphur Content
--     2. Sulphur Suspensibility   (section + field label renamed from
--        plain "Suspensibility")
--     3. Tebuconazole Content     (GC block above)
--     4. Tebuconazole Suspensibility
--   Appearance stays at the top; Photo + Observation stay last.
--
-- Idempotent: inserts use ON CONFLICT DO NOTHING; formulas/labels/order are
-- then set explicitly, so re-running converges.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  pid_ziddi uuid;
BEGIN

SELECT id INTO pid_ziddi FROM public.products WHERE code = 'ZIDDI';
IF pid_ziddi IS NULL THEN
  RAISE NOTICE 'ZIDDI product not found — skipping migration 030';
  RETURN;
END IF;

-- ── Part 1a: Raw GC inputs (sort_order set authoritatively in Part 2) ───────
INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,sort_order) VALUES
  (pid_ziddi,'none','tebu_std_area_tebu',    'TEBUCONAZOLE (GC) — STD: Area of Tebuconazole',    NULL,'number', 100),
  (pid_ziddi,'none','tebu_std_area_dop',     'TEBUCONAZOLE (GC) — STD: Area of DOP',             NULL,'number', 101),
  (pid_ziddi,'none','tebu_sample_area_tebu', 'TEBUCONAZOLE (GC) — Sample: Area of Tebuconazole', NULL,'number', 103),
  (pid_ziddi,'none','tebu_sample_area_dop',  'TEBUCONAZOLE (GC) — Sample: Area of DOP',          NULL,'number', 104),
  (pid_ziddi,'none','tebu_std_wt',           'TEBUCONAZOLE (GC) — Weight of standard (g)',       'g', 'number', 106),
  (pid_ziddi,'none','tebu_sample_wt',        'TEBUCONAZOLE (GC) — Weight of sample (g)',         'g', 'number', 107),
  (pid_ziddi,'none','tebu_std_purity',       'TEBUCONAZOLE (GC) — Purity of standard (%)',       '%', 'number', 108)
ON CONFLICT DO NOTHING;

-- ── Part 1b: Calculated ratios ──────────────────────────────────────────────
INSERT INTO public.qc_test_definitions(product_id,phase,test_key,label,unit,input_type,formula,is_calculated,sort_order) VALUES
  (pid_ziddi,'none','tebu_std_ratio',    'TEBUCONAZOLE (GC) — STD ratio (Tebu / DOP)',    NULL,'number',
     'tebu_std_area_tebu / tebu_std_area_dop',       true, 102),
  (pid_ziddi,'none','tebu_sample_ratio', 'TEBUCONAZOLE (GC) — Sample ratio (Tebu / DOP)', NULL,'number',
     'tebu_sample_area_tebu / tebu_sample_area_dop', true, 105)
ON CONFLICT DO NOTHING;

-- Force formulas even if the ratio rows already existed.
UPDATE public.qc_test_definitions
  SET formula = 'tebu_std_area_tebu / tebu_std_area_dop', is_calculated = true, input_type = 'number', unit = NULL
  WHERE product_id = pid_ziddi AND test_key = 'tebu_std_ratio';
UPDATE public.qc_test_definitions
  SET formula = 'tebu_sample_area_tebu / tebu_sample_area_dop', is_calculated = true, input_type = 'number', unit = NULL
  WHERE product_id = pid_ziddi AND test_key = 'tebu_sample_ratio';

-- ── Part 1c: Final content (replaces the old manual gc_tebu_content input) ──
UPDATE public.qc_test_definitions
  SET formula = '(tebu_sample_ratio / tebu_std_ratio) * (tebu_std_wt / tebu_sample_wt) * tebu_std_purity',
      is_calculated = true, input_type = 'number', unit = '%',
      label = 'Tebuconazole Content (by GC)'
  WHERE product_id = pid_ziddi AND test_key = 'gc_tebu_content';

-- ── Part 2a: Rename the sulphur suspensibility field label ──────────────────
UPDATE public.qc_test_definitions
  SET label = 'Sulphur Suspensibility'
  WHERE product_id = pid_ziddi AND test_key = 'sulphur_suspensibility';

-- ── Part 2b: Reorder the whole form (section labels set here) ───────────────
-- Helper: items are 'test_key|Section label', applied in display order.
-- Mirrors pg_temp.reorder from migration 027 so unlisted rows are parked after
-- the listed ones and no data is dropped.
DECLARE
  v_items text[] := ARRAY[
    'colour_physical_state|Appearance',
    -- 1. Sulphur Content
    'content_mass_w|Sulphur Content','content_iodine_vol|Sulphur Content',
    'content_iodine_normality|Sulphur Content','content_iodine_blank|Sulphur Content',
    'sulphur_content|Sulphur Content',
    -- 2. Sulphur Suspensibility (renamed from "Suspensibility")
    'susp_mass_w|Sulphur Suspensibility','susp_iodine_vol|Sulphur Suspensibility',
    'susp_iodine_normality|Sulphur Suspensibility','susp_sediment_m|Sulphur Suspensibility',
    'sulphur_suspensibility|Sulphur Suspensibility',
    -- 3. Tebuconazole Content (GC)
    'tebu_std_area_tebu|Tebuconazole Content','tebu_std_area_dop|Tebuconazole Content',
    'tebu_std_ratio|Tebuconazole Content','tebu_sample_area_tebu|Tebuconazole Content',
    'tebu_sample_area_dop|Tebuconazole Content','tebu_sample_ratio|Tebuconazole Content',
    'tebu_std_wt|Tebuconazole Content','tebu_sample_wt|Tebuconazole Content',
    'tebu_std_purity|Tebuconazole Content','gc_tebu_content|Tebuconazole Content',
    -- 4. Tebuconazole Suspensibility
    'gc_tebu_suspensibility|Tebuconazole Suspensibility',
    'product_photo|Photo'
  ];
  v_key text; v_sec text; i int;
BEGIN
  -- Park everything not listed after the listed rows (keep below 9000 so
  -- Observation stays last).
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

  -- Observation always last.
  UPDATE public.qc_test_definitions
     SET sort_order = 9000, section_label = 'Observation'
   WHERE product_id = pid_ziddi AND phase = 'none' AND test_key = 'observations';
END;

RAISE NOTICE 'A-20 migration 030 — Ziddi Tebuconazole GC + form reorder applied';
END;
$$;

COMMIT;
