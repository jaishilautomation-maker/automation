-- =============================================================================
-- A-20 Migration 012: Batch Analysis — Raw Input Fields + Auto-Calculated Results
--
-- Context: batch_analysis uses qc_test_definitions WHERE material_id = SULPHUR_POWDER
--          AND phase = 'B'.  The existing seed (003) contains only derived or
--          observational fields.  This migration adds the raw laboratory measurement
--          inputs and wires the SOP auto-calculation formulas.
--
-- NEW RAW INPUTS (per SOP JSCI/QC/01-05):
--   Purity / Ash:
--     ba_m1   — Mass of residue after ignition (g)
--     ba_m    — Mass of sample taken (g)
--   Acidity:
--     ba_v1   — Titre with material V1 (mL)
--     ba_v2   — Titre with blank V2 (mL)
--     ba_n    — Normality of NaOH solution N
--   Mesh (dry sieve — three meshes: 200 / 170 / 325):
--     ba_mesh200_sample   — Sample taken for 200-mesh sieve (g)
--     ba_mesh200_retained — Material retained on 200-mesh sieve (g)
--     ba_mesh170_sample   — Sample taken for 170-mesh sieve (g)
--     ba_mesh170_retained — Material retained on 170-mesh sieve (g)
--     ba_mesh325_sample   — Sample taken for 325-mesh sieve (g)
--     ba_mesh325_retained — Material retained on 325-mesh sieve (g)
--
-- AUTO-CALCULATED RESULTS (read-only computed fields):
--   ba_purity_result   = 100 - (ba_m1 / ba_m) * 100
--   ba_ash_result      = 100 * (ba_m1 / ba_m)
--   ba_acidity_result  = (ba_v1 - ba_v2) * ba_n * 4.904 / ba_m
--   ba_mesh200_result  = 100 * (1 - ba_mesh200_retained / ba_mesh200_sample)
--   ba_mesh170_result  = 100 * (1 - ba_mesh170_retained / ba_mesh170_sample)
--   ba_mesh325_result  = 100 * (1 - ba_mesh325_retained / ba_mesh325_sample)
--
-- Mesh formula derivation:
--   The blank form notation "100 × (1 - m/M)" (m=retained, M=sample) is the
--   same fineness formula already used for Sulphur Powder RM QC (007).
--   Confirmed as the correct interpretation — "% passing" the sieve.
--
-- Fields are inserted at sort_order 200+ so they appear after all existing
-- batch-analysis fields without renumbering.
--
-- Idempotent: ON CONFLICT DO NOTHING + explicit UPDATEs to converge.
-- =============================================================================

DO $$
DECLARE
    mid_sp uuid;
    n      smallint;
BEGIN

SELECT id INTO mid_sp FROM public.materials WHERE code = 'SULPHUR_POWDER';

IF mid_sp IS NULL THEN
    RAISE NOTICE 'SULPHUR_POWDER material not found — skipping migration 012.';
    RETURN;
END IF;

n := 200;

-- ── Purity / Ash raw inputs ───────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_m1', 'PURITY/ASH — Mass of residue M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_m', 'PURITY/ASH — Mass of sample M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Acidity raw inputs ────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_v1', 'ACIDITY — Titre with material V1', 'mL', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_v2', 'ACIDITY — Titre with blank V2', 'mL', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_n', 'ACIDITY — Normality of NaOH N', NULL, 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Mesh sieve raw inputs (200, 170, 325) ─────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh200_sample', '200 MESH — Sample M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh200_retained', '200 MESH — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh170_sample', '170 MESH — Sample M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh170_retained', '170 MESH — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh325_sample', '325 MESH — Sample M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh325_retained', '325 MESH — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Calculated result fields ───────────────────────────────────────────────
-- Purity % = 100 - (M1/M)*100
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'ba_purity_result', 'PURITY — Purity %', '%', 'number',
        '100 - (ba_m1 / ba_m) * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 - (ba_m1 / ba_m) * 100', is_calculated=true
WHERE material_id=mid_sp AND phase='B' AND test_key='ba_purity_result';

-- Ash % = (M1/M)*100
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'ba_ash_result', 'ASH — Ash %', '%', 'number',
        '100 * ba_m1 / ba_m', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * ba_m1 / ba_m', is_calculated=true
WHERE material_id=mid_sp AND phase='B' AND test_key='ba_ash_result';

-- Acidity % = (V1-V2)*N*4.904/M
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'ba_acidity_result', 'ACIDITY — Acidity (H2SO4) %', '%', 'number',
        '(ba_v1 - ba_v2) * ba_n * 4.904 / ba_m', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(ba_v1 - ba_v2) * ba_n * 4.904 / ba_m', is_calculated=true
WHERE material_id=mid_sp AND phase='B' AND test_key='ba_acidity_result';

-- Mesh fineness = 100*(1 - retained/sample)
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh200_result', '200 MESH — Fineness %', '%', 'number',
        '100 * (1 - ba_mesh200_retained / ba_mesh200_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - ba_mesh200_retained / ba_mesh200_sample)', is_calculated=true
WHERE material_id=mid_sp AND phase='B' AND test_key='ba_mesh200_result';

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh170_result', '170 MESH — Fineness %', '%', 'number',
        '100 * (1 - ba_mesh170_retained / ba_mesh170_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - ba_mesh170_retained / ba_mesh170_sample)', is_calculated=true
WHERE material_id=mid_sp AND phase='B' AND test_key='ba_mesh170_result';

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'ba_mesh325_result', '325 MESH — Fineness %', '%', 'number',
        '100 * (1 - ba_mesh325_retained / ba_mesh325_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - ba_mesh325_retained / ba_mesh325_sample)', is_calculated=true
WHERE material_id=mid_sp AND phase='B' AND test_key='ba_mesh325_result';

RAISE NOTICE 'Migration 012: batch_analysis raw inputs + calculated fields added for SULPHUR_POWDER phase=B';
END;
$$;
