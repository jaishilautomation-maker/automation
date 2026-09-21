-- =============================================================================
-- A-20 Migration 013: Product QC — Sulphur Powder Full Parameter Panel (JSCI/QC/16)
--
-- This adds a SULPHUR_POWDER product + its qc_test_definitions to the A-20/1
-- project so the Product QC page can run final inspection on produced sulphur
-- powder before dispatch.
--
-- NOTE: The material SULPHUR_POWDER (code='SULPHUR_POWDER') is already in the
-- DB (seeded in 003). Here we add a matching PRODUCT with the same name so
-- product_qc can reference it (product_qc.product_id → products.id).
-- This is the correct A-20 architecture: RM receipt/QC uses materials,
-- Product QC uses products.
--
-- JSCI/QC/16 Final Inspection parameters for Sulphur Powder (all fields):
--
--   Purity / Solubility in CS2                (%) — raw: M1, M → purity
--   Insolubility in Toluene                   (%) — direct entry (no SOP formula given)
--   Acidity as H2SO4                          (%) — raw: V1, V2, N, M → formula
--   Ash Content                               (%) — raw: M1, M → formula (shared with purity)
--   Mesh Size:
--     150µ / 100 mesh   (%)
--     75µ / 200 mesh    (%)
--     45µ / 325 mesh    (%)
--     90µ / 500 mesh    (%) — direct readings (retained weight / sample weight pairs)
--   Oil Content                               (%) — raw: mass_loss, original → formula
--   Heat Loss:
--     At 65°C / 2hr     (%) — raw: M_before, M_after
--     At 70°C / 2hr     (%) — raw: M_before, M_after   (all three kept; chemist
--     At 105°C / 2hr    (%)   fills the one applicable to their test method;
--                              the grade-relevant one is noted in remarks)
--   Specific Gravity @ 25°C                       — raw: W1, W2, W3, W4, SL
--   Melting Point                             (°C) — direct entry
--   Alkalinity as NaOH                        (%) — direct entry (no SOP formula)
--   Total Sulphur Content                     (%) — direct entry (by digestion/ICP)
--   Softening Point                           (°C) — direct entry
--   Acetone Solubility                        (%) — direct entry
--   Appearance / Colour                           — text
--
-- Idempotent: ON CONFLICT DO NOTHING + UPDATEs for formula fields.
-- =============================================================================

DO $$
DECLARE
    pid_sp uuid;  -- SULPHUR_POWDER product
    n      smallint;
BEGIN

-- Upsert the SULPHUR_POWDER product (not trial-only; standard product)
INSERT INTO public.products (code, name, is_trial_only, is_active)
VALUES ('SULPHUR_POWDER_FG', 'Sulphur Powder (Final)', false, true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

SELECT id INTO pid_sp FROM public.products WHERE code = 'SULPHUR_POWDER_FG';

IF pid_sp IS NULL THEN
    RAISE EXCEPTION 'Could not create or find SULPHUR_POWDER_FG product';
END IF;

n := 0;

-- ── 1. Purity / Solubility in CS2 ─────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'purity_m1', 'PURITY (CS2) — Mass of residue M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'purity_m', 'PURITY (CS2) — Mass of sample M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'purity_result', 'PURITY — Purity in CS2', '%', 'number',
        '100 - (purity_m1 / purity_m) * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 - (purity_m1 / purity_m) * 100', is_calculated=true
WHERE product_id=pid_sp AND test_key='purity_result';

-- ── 2. Insolubility in Toluene (direct) ──────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'insolubility_toluene', 'Insolubility in Toluene', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── 3. Acidity as H2SO4 ───────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'acidity_v1', 'ACIDITY — Titre with material V1', 'mL', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'acidity_v2', 'ACIDITY — Titre with blank V2', 'mL', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'acidity_n', 'ACIDITY — Normality of NaOH N', NULL, 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'acidity_m', 'ACIDITY — Mass of sample M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'acidity_result', 'ACIDITY — Acidity (as H2SO4)', '%', 'number',
        '(acidity_v1 - acidity_v2) * acidity_n * 4.904 / acidity_m', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(acidity_v1 - acidity_v2) * acidity_n * 4.904 / acidity_m', is_calculated=true
WHERE product_id=pid_sp AND test_key='acidity_result';

-- ── 4. Ash Content ────────────────────────────────────────────────────────
-- Shares M1/M with purity (same crucible weighing from the SOP).
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'ash_result', 'ASH — Ash Content', '%', 'number',
        '100 * purity_m1 / purity_m', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * purity_m1 / purity_m', is_calculated=true
WHERE product_id=pid_sp AND test_key='ash_result';

-- ── 5. Mesh Size (4 sub-readings) ─────────────────────────────────────────
-- 150µ / 100 mesh
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh100_sample',   '100 MESH (150µ) — Sample M',   'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh100_retained', '100 MESH (150µ) — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'mesh100_result', '100 MESH (150µ) — Fineness', '%', 'number',
        '100 * (1 - mesh100_retained / mesh100_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - mesh100_retained / mesh100_sample)', is_calculated=true
WHERE product_id=pid_sp AND test_key='mesh100_result';

-- 75µ / 200 mesh
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh200_sample',   '200 MESH (75µ) — Sample M',   'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh200_retained', '200 MESH (75µ) — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'mesh200_result', '200 MESH (75µ) — Fineness', '%', 'number',
        '100 * (1 - mesh200_retained / mesh200_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - mesh200_retained / mesh200_sample)', is_calculated=true
WHERE product_id=pid_sp AND test_key='mesh200_result';

-- 45µ / 325 mesh
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh325_sample',   '325 MESH (45µ) — Sample M',   'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh325_retained', '325 MESH (45µ) — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'mesh325_result', '325 MESH (45µ) — Fineness', '%', 'number',
        '100 * (1 - mesh325_retained / mesh325_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - mesh325_retained / mesh325_sample)', is_calculated=true
WHERE product_id=pid_sp AND test_key='mesh325_result';

-- 90µ / 500 mesh
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh500_sample',   '500 MESH (90µ) — Sample M',   'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'mesh500_retained', '500 MESH (90µ) — Retained m', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'mesh500_result', '500 MESH (90µ) — Fineness', '%', 'number',
        '100 * (1 - mesh500_retained / mesh500_sample)', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='100 * (1 - mesh500_retained / mesh500_sample)', is_calculated=true
WHERE product_id=pid_sp AND test_key='mesh500_result';

-- ── 6. Oil Content ────────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'oil_mass_loss',    'OIL CONTENT — Mass loss',          'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'oil_original_mass', 'OIL CONTENT — Original sample mass', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'oil_result', 'OIL CONTENT — Oil Content', '%', 'number',
        'oil_mass_loss / oil_original_mass * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='oil_mass_loss / oil_original_mass * 100', is_calculated=true
WHERE product_id=pid_sp AND test_key='oil_result';

-- ── 7. Heat Loss — three temperature options ──────────────────────────────
-- All three are seeded; chemist fills the applicable one and notes it in
-- remarks. No assumption about which temperature the product uses.
-- Formula: (M_before - M_after) / M_before * 100
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'hl65_m_before',  'HEAT LOSS 65°C/2hr — Mass before M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'hl65_m_after',   'HEAT LOSS 65°C/2hr — Mass after M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'hl65_result', 'HEAT LOSS 65°C/2hr — Heat Loss', '%', 'number',
        '(hl65_m_before - hl65_m_after) / hl65_m_before * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(hl65_m_before - hl65_m_after) / hl65_m_before * 100', is_calculated=true
WHERE product_id=pid_sp AND test_key='hl65_result';

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'hl70_m_before',  'HEAT LOSS 70°C/2hr — Mass before M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'hl70_m_after',   'HEAT LOSS 70°C/2hr — Mass after M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'hl70_result', 'HEAT LOSS 70°C/2hr — Heat Loss', '%', 'number',
        '(hl70_m_before - hl70_m_after) / hl70_m_before * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(hl70_m_before - hl70_m_after) / hl70_m_before * 100', is_calculated=true
WHERE product_id=pid_sp AND test_key='hl70_result';

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'hl105_m_before', 'HEAT LOSS 105°C/2hr — Mass before M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'hl105_m_after',  'HEAT LOSS 105°C/2hr — Mass after M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'hl105_result', 'HEAT LOSS 105°C/2hr — Heat Loss', '%', 'number',
        '(hl105_m_before - hl105_m_after) / hl105_m_before * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(hl105_m_before - hl105_m_after) / hl105_m_before * 100', is_calculated=true
WHERE product_id=pid_sp AND test_key='hl105_result';

-- ── 8. Specific Gravity @ 25°C ────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'sg_w1', 'SPECIFIC GRAVITY — Empty pycnometer W1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'sg_w2', 'SPECIFIC GRAVITY — Pycnometer + sample W2', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'sg_w3', 'SPECIFIC GRAVITY — Pycnometer + sample + liquid W3', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'sg_w4', 'SPECIFIC GRAVITY — Pycnometer + liquid W4', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'sg_sl', 'SPECIFIC GRAVITY — Specific gravity of liquid SL', NULL, 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'sg_result', 'SPECIFIC GRAVITY @ 25°C', NULL, 'number',
        '(sg_w2 - sg_w1) * sg_sl / ((sg_w2 - sg_w1) - (sg_w3 - sg_w4))', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(sg_w2 - sg_w1) * sg_sl / ((sg_w2 - sg_w1) - (sg_w3 - sg_w4))', is_calculated=true
WHERE product_id=pid_sp AND test_key='sg_result';

-- ── 9. Melting Point ──────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'melting_point', 'Melting Point', '°C', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── 10. Alkalinity as NaOH ────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'alkalinity_naoh', 'Alkalinity (as NaOH)', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── 11. Total Sulphur Content ─────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'total_sulphur', 'Total Sulphur Content', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── 12. Softening Point ───────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'softening_point', 'Softening Point', '°C', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── 13. Acetone Solubility ────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'acetone_solubility', 'Acetone Solubility', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── 14. Appearance / Colour ───────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'colour_appearance', 'Appearance / Colour', NULL, 'text', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

RAISE NOTICE 'Migration 013: SULPHUR_POWDER_FG product + full JSCI/QC/16 parameter panel added (product_id=%)', pid_sp;
END;
$$;
