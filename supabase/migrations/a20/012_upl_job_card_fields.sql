-- =============================================================================
-- A-20 Migration 012: UPL Grade Job Card — extended fields + formula seed
--
-- Adds UPL-specific columns to production_job_cards that the generic schema
-- does not have. All columns are nullable so existing rows (other products)
-- are unaffected.
--
-- Also seeds product_formula_items for SULPHUR_SC_UPL (12 rows, 677 kg ref).
-- Phase A: 8 rows. Phase B: 4 rows.
--
-- New columns on production_job_cards:
--   operator_name            text          — free-text name on the physical form
--   water_tds_phase_a        text          — TDS reading for Phase A water
--   water_tds_phase_b        text          — TDS reading for Phase B water
--   sulphur_bag_weights      jsonb         — array of {bag_no, weight_kg} for bags 1–20
--   sulphur_added_kg         numeric(12,3) — confirmed total sulphur added (kg)
--   total_sc_collected_kg    numeric(12,3) — final collected SC (kg)
--   total_sc_collected_l     numeric(12,3) — final collected SC (litres)
--   checkpoint_cooling_tower text          — observation for cooling tower pressure
--   checkpoint_mech_seal     text          — observation for mechanical seal
--   checkpoint_pipes         text          — observation for pipes/fittings/leakages
--   qc_sulphur_content       text          — sulphur content QC reading
--   qc_suspensibility        text          — suspensibility QC reading
--   qc_density               text          — density QC reading
--   qc_ph                    text          — pH QC reading (text; may be numeric or range)
--   qc_viscosity_sec         text          — viscosity in seconds
--   sign_operator            text          — operator sign name
--   sign_chemist             text          — chemist sign name
--   sign_manager             text          — manager sign name
--   jsc3_code_selection      text          — 'JSC57' | 'JSC07' — for UPL order 3 (Unitop/Soprophor)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add new columns (all nullable — safe for all existing rows)
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_job_cards
    ADD COLUMN IF NOT EXISTS operator_name         text,
    ADD COLUMN IF NOT EXISTS water_tds_phase_a     text,
    ADD COLUMN IF NOT EXISTS water_tds_phase_b     text,
    ADD COLUMN IF NOT EXISTS sulphur_bag_weights   jsonb,
    ADD COLUMN IF NOT EXISTS sulphur_added_kg      numeric(12,3),
    ADD COLUMN IF NOT EXISTS total_sc_collected_kg numeric(12,3),
    ADD COLUMN IF NOT EXISTS total_sc_collected_l  numeric(12,3),
    ADD COLUMN IF NOT EXISTS checkpoint_cooling_tower text,
    ADD COLUMN IF NOT EXISTS checkpoint_mech_seal     text,
    ADD COLUMN IF NOT EXISTS checkpoint_pipes          text,
    ADD COLUMN IF NOT EXISTS qc_sulphur_content    text,
    ADD COLUMN IF NOT EXISTS qc_suspensibility     text,
    ADD COLUMN IF NOT EXISTS qc_density            text,
    ADD COLUMN IF NOT EXISTS qc_ph                 text,
    ADD COLUMN IF NOT EXISTS qc_viscosity_sec      text,
    ADD COLUMN IF NOT EXISTS sign_operator         text,
    ADD COLUMN IF NOT EXISTS sign_chemist          text,
    ADD COLUMN IF NOT EXISTS sign_manager          text,
    ADD COLUMN IF NOT EXISTS jsc3_code_selection   text
        CONSTRAINT chk_jsc3_code CHECK (jsc3_code_selection IS NULL OR jsc3_code_selection IN ('JSC57','JSC07'));

-- ---------------------------------------------------------------------------
-- 2. Seed product_formula_items for SULPHUR_SC_UPL
--    Reference batch size: 677 kg.
--    Phase A: orders 1–8. Phase B: orders 9–12.
--    jsc_code is NULL for Water and Sulphur (non-JSC materials).
--    Order 3 (Unitop FL/SOPROPHORFLR) has jsc_code = 'JSC57/JSC07' as the
--    template placeholder; the actual selection is stored in jsc3_code_selection.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    pid uuid;
BEGIN
    SELECT id INTO pid FROM public.products WHERE code = 'SULPHUR_SC_UPL';
    IF pid IS NULL THEN
        RAISE EXCEPTION 'Product SULPHUR_SC_UPL not found — run earlier migrations first';
    END IF;

    -- Remove any existing formula items (idempotent re-run safety)
    DELETE FROM public.product_formula_items WHERE product_id = pid;

    -- ── Phase A ──────────────────────────────────────────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code, instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A', 1, 'Water',                      NULL,      144.500, 677),
        (pid, 'A', 2, 'ATLOX 4894',                 'JSC31',     4.640, 677),
        (pid, 'A', 3, 'Unitop FL / SOPROPHORFLR',   'JSC57/JSC07', 17.510, 677),
        (pid, 'A', 4, 'Morwet D425',                'JSC30',     4.640, 677),
        (pid, 'A', 5, 'Ethylene Glycol',            'JSC52',    32.000, 677),
        (pid, 'A', 6, 'SAG 1572',                   'JSC45',     1.500, 677),
        (pid, 'A', 7, 'JSC18',                      'JSC18',     3.000, 677),
        (pid, 'A', 8, 'Sulphur',                    NULL,      391.400, 677);
    -- Phase A total: 144.5 + 4.64 + 17.51 + 4.64 + 32 + 1.5 + 3 + 391.4 = 599.19 ✓

    -- ── Phase B ──────────────────────────────────────────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code, instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B',  9, 'Proxel GXL',            'JSC53',   2.000, 677),
        (pid, 'B', 10, 'Water',                  NULL,      7.500, 677),
        (pid, 'B', 11, 'Kelzan 1.4% Solution',   'JSC06',  66.970, 677),
        (pid, 'B', 12, 'SAG 1572',               'JSC45',   0.200, 677);
    -- Phase B total: 2 + 7.5 + 66.97 + 0.2 = 76.67 ✓

END $$;

-- ---------------------------------------------------------------------------
-- 3. Verify totals (informational — does not block migration)
-- ---------------------------------------------------------------------------
-- SELECT phase, SUM(instructed_qty_kg) AS total
-- FROM product_formula_items
-- WHERE product_id = (SELECT id FROM products WHERE code = 'SULPHUR_SC_UPL')
-- GROUP BY phase ORDER BY phase;
-- Expected: A → 599.190  |  B → 76.670
