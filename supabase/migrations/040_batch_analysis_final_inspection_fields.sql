-- =============================================================================
-- Migration 040 (A-20/1 project): Add missing Final Inspection Record fields
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 039.
--
-- Context: Doc JSCI/QC/16 (Final Inspection Record — Sulphur Powder) shares the
-- same lab step as batch_analysis (SULPHUR_POWDER, phase='B'), but the original
-- schema (001_initial_schema.sql) does not capture every parameter on that
-- paper form. Already present (added back in migration 001, unchanged):
--   purity_percent, acidity_percent, mesh100/200/325_pct, melting_point,
--   moisture_percent, ash_percent, oil_percent, sg_value, bd_value
--
-- Missing from the paper form, added here as genuinely NEW input fields
-- (no duplicate of anything already captured):
--   insolubility_toluene   — direct % entry (no formula given on the SOP)
--   heat_loss_temp         — select 65/70/105 (which temperature was used)
--   heat_loss_m_before     — mass before heating (g)
--   heat_loss_m_after      — mass after heating (g)
--   heat_loss_percent      — calculated: (before-after)/before * 100
--   alkalinity_naoh        — direct % entry
--   total_sulphur_percent  — direct % entry
--   softening_point        — direct °C entry
--   acetone_solubility     — direct % entry
--
-- These are added to material_id = SULPHUR_POWDER, phase = 'B' (the same
-- table/phase batch_analysis already uses) — NOT a new table, NOT a new
-- product. sort_order continues after the existing 39 rows from 001.
--
-- Idempotent: ON CONFLICT DO NOTHING + UPDATE to converge on re-run.
-- =============================================================================

DO $$
DECLARE
    mid_sp uuid;
    n      smallint;
BEGIN

SELECT id INTO mid_sp FROM public.materials WHERE code = 'SULPHUR_POWDER';

IF mid_sp IS NULL THEN
    RAISE NOTICE 'SULPHUR_POWDER material not found — skipping migration 040.';
    RETURN;
END IF;

-- Start after the original 39 sort_order slots from 001_initial_schema.sql.
n := 100;

-- ── Insolubility in Toluene ────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'insolubility_toluene', 'Insolubility in Toluene', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Heat Loss (temperature select + before/after + calculated result) ─────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, options, sort_order)
VALUES (mid_sp, 'B', 'heat_loss_temp', 'Heat Loss — Temperature used', '°C', 'select',
        '["65","70","105"]'::jsonb, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET options = '["65","70","105"]'::jsonb, input_type = 'select'
WHERE material_id = mid_sp AND phase = 'B' AND test_key = 'heat_loss_temp';

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'heat_loss_m_before', 'Heat Loss — Mass before M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'heat_loss_m_after', 'Heat Loss — Mass after M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (mid_sp, 'B', 'heat_loss_percent', 'Heat Loss', '%', 'number',
        '((heat_loss_m_before - heat_loss_m_after) / heat_loss_m_before) * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula = '((heat_loss_m_before - heat_loss_m_after) / heat_loss_m_before) * 100', is_calculated = true
WHERE material_id = mid_sp AND phase = 'B' AND test_key = 'heat_loss_percent';

-- ── Alkalinity (as NaOH) ────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'alkalinity_naoh', 'Alkalinity (as NaOH)', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Total Sulphur Content ───────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'total_sulphur_percent', 'Total Sulphur Content', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Softening Point ─────────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'softening_point', 'Softening Point', '°C', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

-- ── Acetone Solubility ──────────────────────────────────────────────────────
n := n + 1;
INSERT INTO public.qc_test_definitions(material_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (mid_sp, 'B', 'acetone_solubility', 'Acetone Solubility', '%', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;

RAISE NOTICE 'Migration 040: Final Inspection Record fields added to SULPHUR_POWDER phase=B (material_id=%)', mid_sp;
END;
$$;
