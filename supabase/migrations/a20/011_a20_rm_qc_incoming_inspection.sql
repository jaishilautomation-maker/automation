-- =============================================================================
-- A-20 Migration 011: RM QC — Crude Sulphur Incoming Inspection (JSCI/QC/03)
--
-- Adds dual-sample inspection parameters for Crude Sulphur (A-20/1 RM QC):
--   purity_cs2  (% purity by CS2 extraction)
--   acidity_h2so4 (% acidity as H2SO4)
--   ash_content (%)
--   heat_loss_70c_2hr (% heat loss at 70°C for 2 hours)
--   appearance (text observation)
--   grade (computed A/B/reject from purity_cs2 average)
--
-- Each parameter is captured for two independent samples (sample_1, sample_2).
-- The grade field is calculated client-side from the average purity; this
-- migration seeds the qc_test_definitions rows so the dynamic form renders them.
--
-- Grade thresholds (JSCI/QC/03 source):
--   A: purity >= 98.00 AND purity <= 100.00
--      acidity <= 0.010, ash <= 0.10, heat_loss <= 0.30
--   B: purity >= 90.00 AND purity < 98.00  (above A's max = below 98.00)
--      acidity / ash / heat_loss above A-grade maxima (no hard B upper bound
--      specified — recorded as free text in remarks per company direction)
--   Reject: purity < 90.00
--
-- NOTE: These test_definitions are on the SULPHUR_CRUDE material (A-20/1) NOT
-- SULPHUR_POWDER, because incoming inspection happens at A-20/1.
--
-- The `grade` test_key uses input_type='select' with options displayed for
-- reference; the computed value is set client-side from purity averages, but
-- the chemist can override if needed.
--
-- Idempotent: ON CONFLICT DO NOTHING + UPDATE to converge on re-run.
-- =============================================================================

DO $$
DECLARE
    mid_sc uuid;  -- SULPHUR_CRUDE (A-20/1)
    n smallint;
BEGIN

SELECT id INTO mid_sc FROM public.materials WHERE code = 'SULPHUR_CRUDE';

IF mid_sc IS NULL THEN
    RAISE NOTICE 'SULPHUR_CRUDE material not found — skipping 011 migration. Run on the A-20/1 project.';
    RETURN;
END IF;

-- -------------------------------------------------------------------------
-- Reserve sort_order range 100+ for new incoming inspection fields so they
-- append cleanly after any existing test definitions.
-- -------------------------------------------------------------------------

n := 100;

-- ── Sample 1 ─────────────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's1_purity_cs2',       'Sample 1 — Purity (CS2)',        '%',  'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's1_acidity_h2so4',    'Sample 1 — Acidity (as H2SO4)',  '%',  'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's1_ash_content',       'Sample 1 — Ash Content',         '%',  'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's1_heat_loss_70c_2hr', 'Sample 1 — Heat Loss (70°C, 2 hr)', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's1_appearance',        'Sample 1 — Appearance',           NULL, 'text',   n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Sample 2 ─────────────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's2_purity_cs2',        'Sample 2 — Purity (CS2)',         '%',  'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's2_acidity_h2so4',     'Sample 2 — Acidity (as H2SO4)',   '%',  'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's2_ash_content',        'Sample 2 — Ash Content',          '%',  'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's2_heat_loss_70c_2hr',  'Sample 2 — Heat Loss (70°C, 2 hr)', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sc, 'none', 's2_appearance',         'Sample 2 — Appearance',            NULL, 'text',   n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Averages (calculated) ─────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sc, 'none', 'avg_purity_cs2',
        'Average Purity (CS2)',        '%', 'number',
        '(s1_purity_cs2 + s2_purity_cs2) / 2', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(s1_purity_cs2 + s2_purity_cs2) / 2', is_calculated=true
WHERE material_id=mid_sc AND test_key='avg_purity_cs2';

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sc, 'none', 'avg_acidity_h2so4',
        'Average Acidity (H2SO4)',     '%', 'number',
        '(s1_acidity_h2so4 + s2_acidity_h2so4) / 2', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(s1_acidity_h2so4 + s2_acidity_h2so4) / 2', is_calculated=true
WHERE material_id=mid_sc AND test_key='avg_acidity_h2so4';

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sc, 'none', 'avg_ash_content',
        'Average Ash Content',         '%', 'number',
        '(s1_ash_content + s2_ash_content) / 2', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(s1_ash_content + s2_ash_content) / 2', is_calculated=true
WHERE material_id=mid_sc AND test_key='avg_ash_content';

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sc, 'none', 'avg_heat_loss_70c_2hr',
        'Average Heat Loss (70°C, 2 hr)', '%', 'number',
        '(s1_heat_loss_70c_2hr + s2_heat_loss_70c_2hr) / 2', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula='(s1_heat_loss_70c_2hr + s2_heat_loss_70c_2hr) / 2', is_calculated=true
WHERE material_id=mid_sc AND test_key='avg_heat_loss_70c_2hr';

-- ── Grade (select — value set client-side from averages, editable) ─────────
-- Grade thresholds seeded as options JSON on the field for UI reference.
-- The frontend computes the initial value; the chemist can override.
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, options, sort_order)
VALUES (mid_sc, 'none', 'incoming_grade',
        'Grade (Auto-determined)',
        NULL, 'select',
        '["A","B","Reject"]'::jsonb,
        n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET options='["A","B","Reject"]'::jsonb
WHERE material_id=mid_sc AND test_key='incoming_grade';

RAISE NOTICE 'Migration 011: Crude Sulphur incoming inspection fields added for material id=%', mid_sc;
END;
$$;
