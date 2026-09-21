-- =============================================================================
-- Migration 038 (A-20/1 project): QC field reconciliation against paper forms
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 036.
--
-- Purpose: reconcile the Product QC (JSCI/QC/16) parameter set against the real
-- Final Inspection Record. Migration 036 seeded THREE separate heat-loss
-- field-sets (65°C, 70°C, 105°C = 9 fields). The paper form actually has a
-- SINGLE heat-loss value at whichever temperature applies (the form prints
-- "65°C /70°C/105°C" with two struck out).
--
-- This migration:
--   1. Deactivates the redundant per-temperature heat-loss fields from 036:
--        hl65_*, hl70_*, hl105_*   (inputs + calculated results)
--   2. Adds ONE heat-loss fieldset:
--        heat_loss_temp     — select 65/70/105  (which temperature was used)
--        heat_loss_m_before — Mass before M
--        heat_loss_m_after  — Mass after M1
--        heat_loss_result   — calculated: (M_before - M_after)/M_before * 100
--
-- We DEACTIVATE (is_active=false) rather than DELETE the old fields so any
-- already-saved product_qc.test_results JSONB keeps its historical keys intact
-- (the form simply stops rendering them). New records use the single fieldset.
--
-- Idempotent: safe to re-run (UPDATE deactivations + ON CONFLICT DO NOTHING
-- inserts + UPDATE to converge formula/options).
-- =============================================================================

DO $$
DECLARE
    pid_sp uuid;   -- SULPHUR_POWDER_FG product
    n      smallint;
BEGIN

SELECT id INTO pid_sp FROM public.products WHERE code = 'SULPHUR_POWDER_FG';

IF pid_sp IS NULL THEN
    RAISE NOTICE 'SULPHUR_POWDER_FG product not found — skipping migration 038. Run 036 first.';
    RETURN;
END IF;

-- ---------------------------------------------------------------------------
-- 1. Deactivate the redundant per-temperature heat-loss fields from 036.
-- ---------------------------------------------------------------------------
UPDATE public.qc_test_definitions
SET is_active = false
WHERE product_id = pid_sp
  AND test_key IN (
    'hl65_m_before',  'hl65_m_after',  'hl65_result',
    'hl70_m_before',  'hl70_m_after',  'hl70_result',
    'hl105_m_before', 'hl105_m_after', 'hl105_result'
  );

-- ---------------------------------------------------------------------------
-- 2. Add the single heat-loss fieldset.
--    sort_order 200+ so it lands in the heat-loss area of the form after the
--    deactivated rows (which no longer render). We reuse a compact block:
--      temperature select  → mass before → mass after → calculated result
-- ---------------------------------------------------------------------------
n := 200;

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, options, sort_order)
VALUES (pid_sp, 'none', 'heat_loss_temp', 'HEAT LOSS — Temperature used', '°C', 'select',
        '["65","70","105"]'::jsonb, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET options = '["65","70","105"]'::jsonb, input_type = 'select', is_active = true, label = 'HEAT LOSS — Temperature used', unit = '°C'
WHERE product_id = pid_sp AND test_key = 'heat_loss_temp';

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'heat_loss_m_before', 'HEAT LOSS — Mass before M', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET is_active = true, label = 'HEAT LOSS — Mass before M', unit = 'g', input_type = 'number'
WHERE product_id = pid_sp AND test_key = 'heat_loss_m_before';

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, sort_order)
VALUES (pid_sp, 'none', 'heat_loss_m_after', 'HEAT LOSS — Mass after M1', 'g', 'number', n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET is_active = true, label = 'HEAT LOSS — Mass after M1', unit = 'g', input_type = 'number'
WHERE product_id = pid_sp AND test_key = 'heat_loss_m_after';

n := n + 1;
INSERT INTO public.qc_test_definitions(product_id, phase, test_key, label, unit, input_type, formula, is_calculated, sort_order)
VALUES (pid_sp, 'none', 'heat_loss_result', 'HEAT LOSS — Heat Loss', '%', 'number',
        '(heat_loss_m_before - heat_loss_m_after) / heat_loss_m_before * 100', true, n)
ON CONFLICT (material_id, product_id, phase, test_key) DO NOTHING;
UPDATE public.qc_test_definitions
SET formula = '(heat_loss_m_before - heat_loss_m_after) / heat_loss_m_before * 100',
    is_calculated = true, is_active = true, label = 'HEAT LOSS — Heat Loss', unit = '%'
WHERE product_id = pid_sp AND test_key = 'heat_loss_result';

RAISE NOTICE 'Migration 038: heat-loss reconciled to single fieldset + temperature select for SULPHUR_POWDER_FG (product_id=%)', pid_sp;
END;
$$;
