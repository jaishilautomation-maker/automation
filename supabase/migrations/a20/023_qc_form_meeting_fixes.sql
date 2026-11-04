-- =============================================================================
-- A-20 Migration 023: QC Form Meeting Fixes (4 Nov 2026)
--
-- Implements items from the QC form meeting:
--
-- A1  Manufacturing Date: added as a first-class column on product_qc.
-- A2  Analysed-by: add analysed_by column to product_qc (login user stays
--     chemist_id for audit; analysed_by is the selected chemist name).
-- A3  Remove "Sample Taken By": deactivate sample_taken_by from Liquid Boron.
-- A4  Single Batch/Lot No: deactivate all per-product lot_batch_number,
--     lot_batch_quantity, and quantity test_key rows (A-20 page already
--     has one top-level batch field; these are duplicates).
--     NOTE: existing columns are NOT dropped — data is preserved.
-- A5  Section headers: add section_label column to qc_test_definitions.
--     Set section labels for each product/material group.
-- A6  Calcium content result sort_order fix: move calcium_content to
--     sort_order=7 (immediately after the 3 calcium inputs at 4,5,6).
-- A7  Burette labels: update naoh_v1/naoh_v2 labels for Liquid Boron;
--     update Ziddi content_iodine_vol/blank labels; update Zinc SC
--     v1_with_cyanide/v2_without_cyanide labels.
-- B   Sulphur SC Phase A: move desired_sulphur_content to sort_order=0.5
--     (before titration inputs); deactivate viscosity, density, clarity,
--     product_photo (per meeting; camera field removed).
-- B   Sulphur SC Phase B: add pH field; deactivate clarity.
-- B   Liquid Boron: move clarity ahead of observations (sort_order).
-- B   Liquid Calcium: move clarity ahead of observations; fix calcium_content
--     sort_order = 7 (after inputs at 4,5,6).
-- B   Ziddi: deactivate clarity.
-- B   Zinc SC Phase A: add zinc_content calc (interim, flagged needs_review);
--     add sample_weight_zn field; deactivate clarity.
-- B   Zinc SC Phase B: deactivate lot_batch_number (duplicate); deactivate
--     clarity; fix zinc_content sort_order to follow its inputs.
-- B   Appearance dropdowns (Sulphur SC, Zinc SC): add appearance_dropdown
--     select field with "Off-white liquid" options.
-- Pending formulas: Suspensibility (SSC B, Ziddi, ZSC B) and final
--     zinc_content formula are kept in place but tagged with a comment
--     in the label (DB) and isolated so each is a one-line swap.
-- 111% bug guard: handled in frontend formula evaluation (no DB change).
--
-- All INSERTs use ON CONFLICT DO NOTHING → idempotent.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A1: Add mfg_date column to product_qc
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_qc
  ADD COLUMN IF NOT EXISTS mfg_date date;

-- ---------------------------------------------------------------------------
-- A2: Add analysed_by column to product_qc
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_qc
  ADD COLUMN IF NOT EXISTS analysed_by text;

-- ---------------------------------------------------------------------------
-- A5: Add section_label column to qc_test_definitions
-- ---------------------------------------------------------------------------
ALTER TABLE public.qc_test_definitions
  ADD COLUMN IF NOT EXISTS section_label text;

-- ---------------------------------------------------------------------------
-- Helper: needs_review flag column (for interim zinc_content formula)
-- ---------------------------------------------------------------------------
ALTER TABLE public.qc_test_definitions
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

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
-- A3: Deactivate "Sample Taken By" (Liquid Boron)
-- ===========================================================================
IF pid_lb IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_lb AND test_key = 'sample_taken_by';
END IF;

-- ===========================================================================
-- A4: Deactivate duplicate per-product batch/lot/quantity fields
--     (the page header already captures the single batch number)
-- ===========================================================================
-- Sulphur SC Phase A & B
IF pid_ssc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_ssc AND test_key = 'lot_batch_number';
  -- Also deactivate phase_a_slurry_weight & phase_b_slurry_weight
  -- (these are the "quantity" fields in the per-product form).
  -- NOTE: preserved in DB — only hidden from the form.
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_ssc AND test_key IN ('phase_a_slurry_weight', 'phase_b_slurry_weight');
END IF;

-- Liquid Boron
IF pid_lb IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_lb AND test_key IN ('lot_batch_number', 'lot_batch_quantity');
END IF;

-- Ziddi
IF pid_ziddi IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_ziddi AND test_key = 'lot_batch_number';
END IF;

-- Liquid Calcium
IF pid_lc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_lc AND test_key IN ('lot_batch_number', 'quantity');
END IF;

-- Zinc SC Phase A & B
IF pid_zsc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_zsc AND test_key = 'lot_batch_number';
  -- Zinc SC Phase B: also deactivate phase_b_slurry_weight (quantity duplicate)
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'phase_b_slurry_weight';
END IF;

-- ===========================================================================
-- A6: Fix calcium_content sort_order → immediately after inputs (4,5,6 → 7)
-- ===========================================================================
IF pid_lc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET sort_order = 7
  WHERE product_id = pid_lc AND test_key = 'calcium_content';
  -- Shift remaining fields down to make room
  UPDATE public.qc_test_definitions
    SET sort_order = sort_order + 10
  WHERE product_id = pid_lc AND phase = 'none'
    AND test_key NOT IN ('calcium_w','calcium_normality','calcium_br','calcium_content','lot_batch_number','quantity')
    AND sort_order >= 6;
END IF;

-- ===========================================================================
-- A7: Burette label updates
-- ===========================================================================
-- Liquid Boron
IF pid_lb IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET label = 'NaOH starting burette reading (V1)'
  WHERE product_id = pid_lb AND test_key = 'naoh_v1';

  UPDATE public.qc_test_definitions
    SET label = 'NaOH ending burette reading (V2)'
  WHERE product_id = pid_lb AND test_key = 'naoh_v2';
END IF;

-- Ziddi: Iodine B2 (sample) and B1 (blank) labels
IF pid_ziddi IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET label = 'CONTENT — Volume of Iodine — Sample burette (B2)'
  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_vol';

  UPDATE public.qc_test_definitions
    SET label = 'CONTENT — Blank burette (B1)'
  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_blank';
END IF;

-- Zinc SC Phase A: V1/V2 labels
IF pid_zsc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET label = 'NaOH starting burette reading (V1) — with cyanide'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'v1_with_cyanide';

  UPDATE public.qc_test_definitions
    SET label = 'NaOH ending burette reading (V2) — without cyanide'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'v2_without_cyanide';

  -- Zinc SC Phase B: Zinc content V1/V2 labels
  UPDATE public.qc_test_definitions
    SET label = 'ZINC CONTENT — NaOH starting burette reading (V1) — with cyanide'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_v1_with_cyanide';

  UPDATE public.qc_test_definitions
    SET label = 'ZINC CONTENT — NaOH ending burette reading (V2) — without cyanide'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_v2_without_cyanide';
END IF;

-- ===========================================================================
-- A5: Section labels
-- Naming convention: text stored in section_label; frontend renders a
-- <h4> divider row whenever section_label changes between consecutive fields.
-- ===========================================================================

-- ── SULPHUR SC PHASE A ──────────────────────────────────────────────────────
IF pid_ssc IS NOT NULL THEN
  -- Desired sulphur content sits at the top (no section, or own label)
  UPDATE public.qc_test_definitions SET section_label = 'Target'
  WHERE product_id = pid_ssc AND phase = 'A' AND test_key = 'desired_sulphur_content';

  -- Titration inputs + result
  UPDATE public.qc_test_definitions SET section_label = 'Sulphur Content'
  WHERE product_id = pid_ssc AND phase = 'A'
    AND test_key IN ('phase_a_sample_mass','phase_a_titration_vol','phase_a_iodine_normality','phase_a_titration_blank','sulphur_content');

  -- Wet sieve
  UPDATE public.qc_test_definitions SET section_label = 'Wet Sieve (5 Micron)'
  WHERE product_id = pid_ssc AND phase = 'A'
    AND test_key IN ('wet_sieve200_sample','wet_sieve200_residue','wet_sieve200_result','wet_sieve325_sample','wet_sieve325_residue','wet_sieve325_result');

  -- Appearance
  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_ssc AND phase = 'A'
    AND test_key IN ('colour_physical_state','appearance_dropdown','any_sedimentation');

  -- Observations last
  UPDATE public.qc_test_definitions SET section_label = 'Observation'
  WHERE product_id = pid_ssc AND phase = 'A' AND test_key = 'observations';

  -- ── SULPHUR SC PHASE B ────────────────────────────────────────────────────
  UPDATE public.qc_test_definitions SET section_label = 'Sulphur Content'
  WHERE product_id = pid_ssc AND phase = 'B'
    AND test_key IN ('phase_b_sample_mass','phase_b_titration_vol','phase_b_iodine_normality','phase_b_titration_blank','sulphur_content');

  UPDATE public.qc_test_definitions SET section_label = 'Suspensibility'
  WHERE product_id = pid_ssc AND phase = 'B'
    AND test_key IN ('suspension_sample_m','sediment_aliquot_v2','suspension_sediment_m','suspensibility');

  UPDATE public.qc_test_definitions SET section_label = 'Physical Properties'
  WHERE product_id = pid_ssc AND phase = 'B'
    AND test_key IN ('viscosity','density','ph_direct');

  UPDATE public.qc_test_definitions SET section_label = 'Wet Sieve (5 Micron)'
  WHERE product_id = pid_ssc AND phase = 'B'
    AND test_key IN ('wet_sieve200_sample','wet_sieve200_residue','wet_sieve200_result','wet_sieve325_sample','wet_sieve325_residue','wet_sieve325_result');

  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_ssc AND phase = 'B'
    AND test_key IN ('colour_physical_state','appearance_dropdown','any_sedimentation');

  UPDATE public.qc_test_definitions SET section_label = 'Observation'
  WHERE product_id = pid_ssc AND phase = 'B' AND test_key = 'observations';
END IF;

-- ── LIQUID BORON ────────────────────────────────────────────────────────────
IF pid_lb IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET section_label = 'Boron Content'
  WHERE product_id = pid_lb
    AND test_key IN ('mass_taken_w','naoh_normality','naoh_v1','naoh_v2','boron_content');

  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_lb
    AND test_key IN ('colour_physical_state','clarity');

  UPDATE public.qc_test_definitions SET section_label = 'Physical Properties'
  WHERE product_id = pid_lb
    AND test_key IN ('density','ph_5pct','viscosity');

  UPDATE public.qc_test_definitions SET section_label = 'Observation'
  WHERE product_id = pid_lb AND test_key = 'observations';
END IF;

-- ── LIQUID CALCIUM ──────────────────────────────────────────────────────────
IF pid_lc IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET section_label = 'Calcium Content'
  WHERE product_id = pid_lc
    AND test_key IN ('calcium_w','calcium_normality','calcium_br','calcium_content');

  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_lc
    AND test_key IN ('colour_physical_state','clarity');

  UPDATE public.qc_test_definitions SET section_label = 'Physical Properties'
  WHERE product_id = pid_lc
    AND test_key IN ('density','ph_5pct');

  UPDATE public.qc_test_definitions SET section_label = 'Observation'
  WHERE product_id = pid_lc AND test_key = 'observations';
END IF;

-- ── ZIDDI ────────────────────────────────────────────────────────────────────
IF pid_ziddi IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET section_label = 'Sulphur Content'
  WHERE product_id = pid_ziddi
    AND test_key IN ('content_mass_w','content_iodine_vol','content_iodine_normality','content_iodine_blank','sulphur_content');

  UPDATE public.qc_test_definitions SET section_label = 'Suspensibility'
  WHERE product_id = pid_ziddi
    AND test_key IN ('susp_mass_w','susp_iodine_vol','susp_iodine_normality','susp_sediment_m','sulphur_suspensibility');

  UPDATE public.qc_test_definitions SET section_label = 'Tebuconazole (GC — Pending)'
  WHERE product_id = pid_ziddi
    AND test_key IN ('gc_tebu_content','gc_tebu_suspensibility');

  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_ziddi
    AND test_key IN ('colour_physical_state');

  UPDATE public.qc_test_definitions SET section_label = 'Observation'
  WHERE product_id = pid_ziddi AND test_key = 'observations';
END IF;

-- ── ZINC SC PHASE A ──────────────────────────────────────────────────────────
IF pid_zsc IS NOT NULL THEN
  UPDATE public.qc_test_definitions SET section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'A'
    AND test_key IN ('sample_weight_zn','normality_edta','v1_with_cyanide','v2_without_cyanide','zinc_content_a');

  UPDATE public.qc_test_definitions SET section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A'
    AND test_key IN ('wet_sieve200_sample','wet_sieve200_residue','wet_sieve200_result','wet_sieve325_sample','wet_sieve325_residue','wet_sieve325_result');

  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_zsc AND phase = 'A'
    AND test_key IN ('appearance','appearance_dropdown','any_sedimentation','colour_physical_state');

  -- ── ZINC SC PHASE B ──────────────────────────────────────────────────────
  UPDATE public.qc_test_definitions SET section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'B'
    AND test_key IN ('zc_normality_edta','zc_mass_sample','zc_v1_with_cyanide','zc_v2_without_cyanide','zinc_content');

  UPDATE public.qc_test_definitions SET section_label = 'Suspensibility'
  WHERE product_id = pid_zsc AND phase = 'B'
    AND test_key IN ('susp_mass','susp_v1_sediment','susp_v2_sediment','suspension');

  UPDATE public.qc_test_definitions SET section_label = 'Physical Properties'
  WHERE product_id = pid_zsc AND phase = 'B'
    AND test_key IN ('viscosity','ph_direct','density');

  UPDATE public.qc_test_definitions SET section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B'
    AND test_key IN ('wet_sieve200_sample','wet_sieve200_residue','wet_sieve200_result','wet_sieve325_sample','wet_sieve325_residue','wet_sieve325_result');

  UPDATE public.qc_test_definitions SET section_label = 'Appearance'
  WHERE product_id = pid_zsc AND phase = 'B'
    AND test_key IN ('appearance','appearance_dropdown','any_sedimentation','colour_physical_state');

  UPDATE public.qc_test_definitions SET section_label = 'Observation'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'observations';
END IF;

-- ===========================================================================
-- B: Sulphur SC Phase A — reorder desired_sulphur_content to the top,
--    deactivate viscosity, density, clarity, product_photo
-- ===========================================================================
IF pid_ssc IS NOT NULL THEN
  -- Move desired_sulphur_content to sort_order 0 (before all titration inputs at 1+)
  UPDATE public.qc_test_definitions
    SET sort_order = 0
  WHERE product_id = pid_ssc AND phase = 'A' AND test_key = 'desired_sulphur_content';

  -- Deactivate viscosity, density, clarity, product_photo for Phase A
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_ssc AND phase = 'A'
    AND test_key IN ('viscosity', 'density', 'clarity', 'product_photo');
END IF;

-- ===========================================================================
-- B: Sulphur SC Phase B — add pH field; deactivate clarity
-- ===========================================================================
IF pid_ssc IS NOT NULL THEN
  -- Add pH field for Phase B (insert if not exists)
  INSERT INTO public.qc_test_definitions
    (product_id, phase, test_key, label, unit, input_type, sort_order, section_label)
  VALUES
    (pid_ssc, 'B', 'ph_direct', 'pH (direct)', NULL, 'number', 19, 'Physical Properties')
  ON CONFLICT DO NOTHING;

  -- Deactivate clarity for Phase B
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_ssc AND phase = 'B' AND test_key = 'clarity';
END IF;

-- ===========================================================================
-- B: Liquid Boron — move clarity before colour_physical_state (A8 adjacency)
-- ===========================================================================
IF pid_lb IS NOT NULL THEN
  -- clarity: sort_order 8.5 (between boron_content=8 and colour_physical_state=9)
  UPDATE public.qc_test_definitions
    SET sort_order = 9
  WHERE product_id = pid_lb AND test_key = 'clarity';

  UPDATE public.qc_test_definitions
    SET sort_order = 10
  WHERE product_id = pid_lb AND test_key = 'colour_physical_state';

  UPDATE public.qc_test_definitions
    SET sort_order = 18
  WHERE product_id = pid_lb AND test_key = 'observations';

  UPDATE public.qc_test_definitions
    SET sort_order = 19
  WHERE product_id = pid_lb AND test_key = 'density';

  UPDATE public.qc_test_definitions
    SET sort_order = 20
  WHERE product_id = pid_lb AND test_key = 'ph_5pct';

  UPDATE public.qc_test_definitions
    SET sort_order = 21
  WHERE product_id = pid_lb AND test_key = 'viscosity';

  UPDATE public.qc_test_definitions
    SET sort_order = 22
  WHERE product_id = pid_lb AND test_key = 'product_photo';
END IF;

-- ===========================================================================
-- B: Liquid Calcium — move clarity before colour_physical_state; fix sort_orders
-- ===========================================================================
IF pid_lc IS NOT NULL THEN
  -- calcium_content result is already set to sort_order=7 above.
  -- colour_physical_state: 10, clarity: 11, observations: 20, density: 21, ph: 22
  UPDATE public.qc_test_definitions
    SET sort_order = 10
  WHERE product_id = pid_lc AND test_key = 'colour_physical_state';

  UPDATE public.qc_test_definitions
    SET sort_order = 11
  WHERE product_id = pid_lc AND test_key = 'clarity';

  UPDATE public.qc_test_definitions
    SET sort_order = 20
  WHERE product_id = pid_lc AND test_key = 'observations';

  UPDATE public.qc_test_definitions
    SET sort_order = 21
  WHERE product_id = pid_lc AND test_key = 'density';

  UPDATE public.qc_test_definitions
    SET sort_order = 22
  WHERE product_id = pid_lc AND test_key = 'ph_5pct';

  UPDATE public.qc_test_definitions
    SET sort_order = 30
  WHERE product_id = pid_lc AND test_key = 'product_photo';
END IF;

-- ===========================================================================
-- B: Ziddi — deactivate clarity; fix sort_orders for meeting layout
-- ===========================================================================
IF pid_ziddi IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_ziddi AND test_key = 'clarity';

  -- Reorder: sulphur inputs 1-4, blank 5, result 6 (from 022), then suspensibility
  -- susp inputs 10-13, result 14; tebu inputs 20-21; appearance 30; obs 40; photo 50
  UPDATE public.qc_test_definitions SET sort_order = 1  WHERE product_id = pid_ziddi AND test_key = 'content_mass_w';
  UPDATE public.qc_test_definitions SET sort_order = 2  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_vol';
  UPDATE public.qc_test_definitions SET sort_order = 3  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_normality';
  UPDATE public.qc_test_definitions SET sort_order = 4  WHERE product_id = pid_ziddi AND test_key = 'content_iodine_blank';
  UPDATE public.qc_test_definitions SET sort_order = 5  WHERE product_id = pid_ziddi AND test_key = 'sulphur_content';
  UPDATE public.qc_test_definitions SET sort_order = 10 WHERE product_id = pid_ziddi AND test_key = 'susp_mass_w';
  UPDATE public.qc_test_definitions SET sort_order = 11 WHERE product_id = pid_ziddi AND test_key = 'susp_iodine_vol';
  UPDATE public.qc_test_definitions SET sort_order = 12 WHERE product_id = pid_ziddi AND test_key = 'susp_iodine_normality';
  UPDATE public.qc_test_definitions SET sort_order = 13 WHERE product_id = pid_ziddi AND test_key = 'susp_sediment_m';
  UPDATE public.qc_test_definitions SET sort_order = 14 WHERE product_id = pid_ziddi AND test_key = 'sulphur_suspensibility';
  UPDATE public.qc_test_definitions SET sort_order = 20 WHERE product_id = pid_ziddi AND test_key = 'gc_tebu_content';
  UPDATE public.qc_test_definitions SET sort_order = 21 WHERE product_id = pid_ziddi AND test_key = 'gc_tebu_suspensibility';
  UPDATE public.qc_test_definitions SET sort_order = 30 WHERE product_id = pid_ziddi AND test_key = 'colour_physical_state';
  UPDATE public.qc_test_definitions SET sort_order = 40 WHERE product_id = pid_ziddi AND test_key = 'observations';
  UPDATE public.qc_test_definitions SET sort_order = 50 WHERE product_id = pid_ziddi AND test_key = 'product_photo';
END IF;

-- ===========================================================================
-- B: Zinc SC Phase A — add sample_weight_zn field and zinc_content_a calc
--    (INTERIM formula, flagged needs_review = true)
--    Formula: (v2_without_cyanide - v1_with_cyanide) * normality_edta * 0.0098012 * 65.38
--    Tagged "under review" — final formula pending from lab
-- ===========================================================================
IF pid_zsc IS NOT NULL THEN
  -- Add sample weight input for Phase A zinc content calc
  INSERT INTO public.qc_test_definitions
    (product_id, phase, test_key, label, unit, input_type, sort_order, section_label)
  VALUES
    (pid_zsc, 'A', 'sample_weight_zn', 'ZINC CONTENT — Sample Weight (W)', 'g', 'number', 3, 'Zinc Content')
  ON CONFLICT DO NOTHING;

  -- Move existing titration fields into the Zinc Content section
  UPDATE public.qc_test_definitions SET sort_order = 4, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'normality_edta';

  UPDATE public.qc_test_definitions SET sort_order = 5, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'v1_with_cyanide';

  UPDATE public.qc_test_definitions SET sort_order = 6, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'v2_without_cyanide';

  -- Zinc Content result — INTERIM formula (flagged needs_review)
  -- SOP ref: (V2-V1) * N * 0.0098012 * 65.38 — UNDER REVIEW, see migration 023
  INSERT INTO public.qc_test_definitions
    (product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order, section_label, needs_review)
  VALUES
    (pid_zsc, 'A', 'zinc_content_a',
     'Zinc Content (% — formula under review)',
     '%', 'number',
     '(v2_without_cyanide - v1_with_cyanide) * normality_edta * 0.0098012 * 65.38',
     true, 7, 'Zinc Content', true)
  ON CONFLICT DO NOTHING;

  -- Ensure formula + flags are current on re-run
  UPDATE public.qc_test_definitions
    SET formula        = '(v2_without_cyanide - v1_with_cyanide) * normality_edta * 0.0098012 * 65.38',
        is_calculated  = true,
        needs_review   = true
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'zinc_content_a';

  -- Deactivate clarity for Phase A
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'clarity';

  -- Deactivate old slurry_weight (already done above) and re-order Phase A
  UPDATE public.qc_test_definitions SET sort_order = 1  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'phase_a_slurry_weight';
  -- (already deactivated above — sort_order update harmless)

  -- Wet sieve: 20-25
  UPDATE public.qc_test_definitions SET sort_order = 20, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'wet_sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order = 21, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'wet_sieve200_residue';
  UPDATE public.qc_test_definitions SET sort_order = 22, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'wet_sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order = 23, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'wet_sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order = 24, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'wet_sieve325_residue';
  UPDATE public.qc_test_definitions SET sort_order = 25, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'wet_sieve325_result';

  -- Appearance
  UPDATE public.qc_test_definitions SET sort_order = 30, section_label = 'Appearance'
  WHERE product_id = pid_zsc AND phase = 'A' AND test_key = 'appearance';
END IF;

-- ===========================================================================
-- B: Zinc SC Phase B — deactivate clarity; fix zinc_content sort_order
-- ===========================================================================
IF pid_zsc IS NOT NULL THEN
  UPDATE public.qc_test_definitions
    SET is_active = false
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'clarity';

  -- zinc_content: should follow zc_v2_without_cyanide
  -- Zinc content inputs: zc_normality_edta(7), zc_mass_sample(8), zc_v1(9), zc_v2(10), result(11)
  UPDATE public.qc_test_definitions SET sort_order = 7, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_normality_edta';
  UPDATE public.qc_test_definitions SET sort_order = 8, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_mass_sample';
  UPDATE public.qc_test_definitions SET sort_order = 9, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_v1_with_cyanide';
  UPDATE public.qc_test_definitions SET sort_order = 10, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zc_v2_without_cyanide';
  UPDATE public.qc_test_definitions SET sort_order = 11, section_label = 'Zinc Content'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'zinc_content';

  -- Suspensibility group: 20-23
  -- NOTE: final formula pending — current formula is 1000*(M-m)/(9*M) pattern
  -- but inputs follow volume method per meeting. Tagged pending.
  UPDATE public.qc_test_definitions SET sort_order = 20, section_label = 'Suspensibility'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_mass';
  UPDATE public.qc_test_definitions SET sort_order = 21, section_label = 'Suspensibility'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_v1_sediment';
  UPDATE public.qc_test_definitions SET sort_order = 22, section_label = 'Suspensibility'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'susp_v2_sediment';
  UPDATE public.qc_test_definitions SET sort_order = 23, section_label = 'Suspensibility'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'suspension';

  -- Physical Properties: 30-32
  UPDATE public.qc_test_definitions SET sort_order = 30, section_label = 'Physical Properties'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'viscosity';
  UPDATE public.qc_test_definitions SET sort_order = 31, section_label = 'Physical Properties'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'ph_direct';
  UPDATE public.qc_test_definitions SET sort_order = 32, section_label = 'Physical Properties'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'density';

  -- Wet sieve: 40-45
  UPDATE public.qc_test_definitions SET sort_order = 40, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'wet_sieve200_sample';
  UPDATE public.qc_test_definitions SET sort_order = 41, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'wet_sieve200_residue';
  UPDATE public.qc_test_definitions SET sort_order = 42, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'wet_sieve200_result';
  UPDATE public.qc_test_definitions SET sort_order = 43, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'wet_sieve325_sample';
  UPDATE public.qc_test_definitions SET sort_order = 44, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'wet_sieve325_residue';
  UPDATE public.qc_test_definitions SET sort_order = 45, section_label = 'Wet Sieve'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'wet_sieve325_result';

  -- Appearance: 50
  UPDATE public.qc_test_definitions SET sort_order = 50, section_label = 'Appearance'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key IN ('colour_physical_state','appearance');

  -- Observations: 60
  UPDATE public.qc_test_definitions SET sort_order = 60, section_label = 'Observation'
  WHERE product_id = pid_zsc AND phase = 'B' AND test_key = 'observations';
END IF;

-- ===========================================================================
-- B: Appearance dropdowns for Sulphur SC and Zinc SC (all phases)
--    "appearance_dropdown" — select with "Off-white liquid" + "Other" free text
--    "any_sedimentation" — boolean (yes/no)
-- ===========================================================================
IF pid_ssc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions
    (product_id, phase, test_key, label, unit, input_type, options, sort_order, section_label)
  VALUES
    (pid_ssc, 'A', 'appearance_dropdown', 'Appearance', NULL, 'select',
     '["Off-white liquid","Yellowish liquid","White liquid","Other"]', 39, 'Appearance'),
    (pid_ssc, 'A', 'any_sedimentation',   'Any Sedimentation?', NULL, 'boolean', NULL, 40, 'Appearance'),
    (pid_ssc, 'B', 'appearance_dropdown', 'Appearance', NULL, 'select',
     '["Off-white liquid","Yellowish liquid","White liquid","Other"]', 49, 'Appearance'),
    (pid_ssc, 'B', 'any_sedimentation',   'Any Sedimentation?', NULL, 'boolean', NULL, 50, 'Appearance')
  ON CONFLICT DO NOTHING;
END IF;

IF pid_zsc IS NOT NULL THEN
  INSERT INTO public.qc_test_definitions
    (product_id, phase, test_key, label, unit, input_type, options, sort_order, section_label)
  VALUES
    (pid_zsc, 'A', 'appearance_dropdown', 'Appearance', NULL, 'select',
     '["Off-white liquid","Yellowish liquid","White liquid","Other"]', 31, 'Appearance'),
    (pid_zsc, 'A', 'any_sedimentation',   'Any Sedimentation?', NULL, 'boolean', NULL, 32, 'Appearance'),
    (pid_zsc, 'B', 'appearance_dropdown', 'Appearance', NULL, 'select',
     '["Off-white liquid","Yellowish liquid","White liquid","Other"]', 51, 'Appearance'),
    (pid_zsc, 'B', 'any_sedimentation',   'Any Sedimentation?', NULL, 'boolean', NULL, 52, 'Appearance')
  ON CONFLICT DO NOTHING;
END IF;

-- ===========================================================================
-- Grant service_role on updated table
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON public.product_qc TO service_role;
GRANT SELECT, UPDATE ON public.qc_test_definitions TO service_role;

RAISE NOTICE 'A-20 migration 023 complete';
END;
$$;

COMMIT;
