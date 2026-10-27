-- =============================================================================
-- A-20 Migration 017: InstaBor 150 extra columns + formula seed
--
-- Adds two new columns to production_job_cards for Phase A heating times
-- and one column for Specific Gravity (not covered by existing columns).
-- Also seeds product_formula_items for INSTABORE (7 rows: 5 Phase A + 2 Phase B).
--
-- New columns:
--   heating_start      time   — Phase A Heating Start Time
--   heating_stop       time   — Phase A Heating Stop Time
--   qc_specific_gravity text  — Specific Gravity QC reading
--
-- Column reuse from migration 012 (no change needed):
--   premix_start / premix_end        → Phase A Mixing Start / End
--   bead_mill_start / bead_mill_end  → Phase B Mixing Start / End
--   sulphur_bag_weights (jsonb)      → Boric Acid bags 1–20
--   sulphur_added_kg                 → Boric Acid Added (kg)
--   total_sc_collected_kg            → Total Lot Weight
--   qc_sulphur_content               → Boron Content
--   qc_density                       → Appearance (Clear / Not Clear)
--   qc_ph                            → pH
--   water_tds_phase_a (text→JSON)    → Remarks + Phase A obs + Phase B obs
--   sign_operator / sign_chemist / sign_manager
--
-- Phase A ingredients (ref 555 kg):
--   1  Water          65.83666666666667  kg
--   2  JSC72           0.58333333333333  kg
--   3  JSC73         128.99666666666667  kg
--   4  Water (rinse)   4.66666666666667  kg
--   5  BORIC ACID    349.91666666666663  kg
--   Sum ≈ 550.00 kg
--
-- Phase B ingredients (ref 555 kg):
--   1  JSC67           0.00147408  kg
--   2  JSC71           5.58333333  kg
--   Sum ≈ 5.584807 kg
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_job_cards
    ADD COLUMN IF NOT EXISTS heating_start       time,
    ADD COLUMN IF NOT EXISTS heating_stop        time,
    ADD COLUMN IF NOT EXISTS qc_specific_gravity text;

-- ---------------------------------------------------------------------------
-- 2. Formula seed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    pid uuid;
BEGIN
    SELECT id INTO pid FROM public.products WHERE code = 'INSTABORE';
    IF pid IS NULL THEN
        RAISE EXCEPTION 'Product INSTABORE not found — run earlier migrations first';
    END IF;

    DELETE FROM public.product_formula_items WHERE product_id = pid;

    -- ── Phase A (reference 555 kg) ────────────────────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A', 1, 'Water',         NULL,      65.83666666666667, 555),
        (pid, 'A', 2, 'JSC72',         'JSC72',    0.58333333333333, 555),
        (pid, 'A', 3, 'JSC73',         'JSC73',  128.99666666666667, 555),
        (pid, 'A', 4, 'Water (rinse)', NULL,       4.66666666666667, 555),
        (pid, 'A', 5, 'BORIC ACID',    NULL,     349.91666666666663, 555);
    -- Sum ≈ 550.00 ✓ (the template shows Total Phase A = 550.00)

    -- ── Phase B (reference 555 kg) ────────────────────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B', 1, 'JSC67', 'JSC67', 0.00147408, 555),
        (pid, 'B', 2, 'JSC71', 'JSC71', 5.58333333, 555);
    -- Sum ≈ 5.584807 ✓

END $$;

-- Verify:
-- SELECT phase, ROUND(SUM(instructed_qty_kg),2) AS total
-- FROM product_formula_items
-- WHERE product_id = (SELECT id FROM products WHERE code = 'INSTABORE')
-- GROUP BY phase ORDER BY phase;
-- Expected: A → 550.00  B → 5.58
