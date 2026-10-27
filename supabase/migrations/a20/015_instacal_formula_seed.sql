-- =============================================================================
-- A-20 Migration 015: InstaCal 160 formula seed
--
-- Four batch-size variants, each with Phase A (6 rows) and Phase B (1–2 rows).
-- Phase keys stored in product_formula_items.phase (TEXT column):
--   'A_600', 'B_600'  — 600 kg variant
--   'A_573', 'B_573'  — 573 kg variant
--   'A_450', 'B_450'  — 450 kg variant
--   'A_335', 'B_335'  — 335 kg variant
--
-- IMPORTANT — precision notes:
--   600 kg variant:  clean round values (JSC63 in row 5)
--   573/450/335 kg:  full-precision decimal values from the Excel formulae
--                    (JSC64 in row 5; RETURN INSTACAL in B_573 only)
--   Stored at full Excel precision so the UI can round/format as needed.
--   JSC63 (600 kg) and JSC64 (573/450/335 kg) are DIFFERENT materials.
--
-- Approximate template totals per variant:
--   600 kg: Phase A ≈ 583.96 kg,  Phase B ≈ 12.00 kg,  Lot ≈ 595.96 kg
--   573 kg: Phase A ≈ 561.42 kg,  Phase B ≈ 23.08 kg,  Lot ≈ 584.50 kg
--   450 kg: Phase A ≈ 342.93 kg,  Phase B ≈  9.06 kg,  Lot ≈ 351.99 kg
--   335 kg: Phase A ≈ 328.23 kg,  Phase B ≈  6.74 kg,  Lot ≈ 334.98 kg
--
-- No schema changes needed — migration 012 added all required columns.
-- =============================================================================

DO $$
DECLARE
    pid uuid;
BEGIN
    SELECT id INTO pid FROM public.products WHERE code = 'INSTACAL';
    IF pid IS NULL THEN
        RAISE EXCEPTION 'Product INSTACAL not found — run earlier migrations first';
    END IF;

    DELETE FROM public.product_formula_items WHERE product_id = pid;

    -- =========================================================================
    -- 600 kg variant
    -- =========================================================================

    -- Phase A (6 rows, JSC63)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A_600', 1, 'Water',            NULL,       323.000000, 600),
        (pid, 'A_600', 2, 'JSC69',            'JSC69',      0.450000, 600),
        (pid, 'A_600', 3, 'Calcium Chloride', NULL,        260.000000, 600),
        (pid, 'A_600', 4, 'JSC70',            'JSC70',      0.005100, 600),
        (pid, 'A_600', 5, 'JSC63',            'JSC63',      0.001440, 600),
        (pid, 'A_600', 6, 'JSC45',            'JSC45',      0.500000, 600);
    -- Sum: 583.956540 ≈ 583.96 ✓

    -- Phase B (1 row)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B_600', 7, 'JSC 71', 'JSC71', 12.000000, 600);
    -- Sum: 12.00;  Lot: 583.956540 + 12 = 595.956540 ≈ 595.96 ✓

    -- =========================================================================
    -- 573 kg variant
    -- =========================================================================

    -- Phase A (6 rows, JSC64)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A_573', 1, 'Water',            NULL,       310.535249899288, 573),
        (pid, 'A_573', 2, 'JSC69',            'JSC69',      0.432634228187919, 573),
        (pid, 'A_573', 3, 'Calcium Chloride', NULL,        249.966442953020, 573),
        (pid, 'A_573', 4, 'JSC70',            'JSC70',      0.004903187919463, 573),
        (pid, 'A_573', 5, 'JSC64',            'JSC64',      0.001384429530201, 573),
        (pid, 'A_573', 6, 'JSC45',            'JSC45',      0.480704697986577, 573);
    -- Sum ≈ 561.42 ✓

    -- Phase B (2 rows — JSC71 + RETURN INSTACAL)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B_573', 7, 'JSC 71',          'JSC71', 11.536912751677852, 573),
        (pid, 'B_573', 8, 'RETURN INSTACAL', NULL,    11.540000000000000, 573);
    -- Sum: 11.536912... + 11.54 ≈ 23.08;  Lot ≈ 584.50 ✓

    -- =========================================================================
    -- 450 kg variant
    -- =========================================================================

    -- Phase A (6 rows, JSC64)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A_450', 1, 'Water',            NULL,       189.682080536912, 450),
        (pid, 'A_450', 2, 'JSC69',            'JSC69',      0.264261744966443, 450),
        (pid, 'A_450', 3, 'Calcium Chloride', NULL,        152.684563758389, 450),
        (pid, 'A_450', 4, 'JSC70',            'JSC70',      0.002994966442953, 450),
        (pid, 'A_450', 5, 'JSC64',            'JSC64',      0.000845637583893, 450),
        (pid, 'A_450', 6, 'JSC45',            'JSC45',      0.293624161073826, 450);
    -- Sum ≈ 342.93 ✓

    -- Phase B (1 row)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B_450', 7, 'JSC 71', 'JSC71', 9.060402684563758, 450);
    -- Sum ≈ 9.06;  Lot ≈ 351.99 ✓

    -- =========================================================================
    -- 335 kg variant
    -- =========================================================================

    -- Phase A (6 rows, JSC64)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A_335', 1, 'Water',            NULL,       181.552013422819, 335),
        (pid, 'A_335', 2, 'JSC69',            'JSC69',      0.252936241610738, 335),
        (pid, 'A_335', 3, 'Calcium Chloride', NULL,        146.140939597315, 335),
        (pid, 'A_335', 4, 'JSC70',            'JSC70',      0.002866610738255, 335),
        (pid, 'A_335', 5, 'JSC64',            'JSC64',      0.000809395973154, 335),
        (pid, 'A_335', 6, 'JSC45',            'JSC45',      0.281040268456376, 335);
    -- Sum ≈ 328.23 ✓

    -- Phase B (1 row)
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B_335', 7, 'JSC 71', 'JSC71', 6.744966442953020, 335);
    -- Sum ≈ 6.74;  Lot ≈ 334.98 ✓

END $$;

-- Verification:
-- SELECT phase, COUNT(*) AS rows, ROUND(SUM(instructed_qty_kg),2) AS total
-- FROM product_formula_items
-- WHERE product_id = (SELECT id FROM products WHERE code = 'INSTACAL')
-- GROUP BY phase ORDER BY phase;
-- Expected totals: A_600≈583.96  B_600=12.00
--                  A_573≈561.42  B_573≈23.08
--                  A_450≈342.93  B_450≈9.06
--                  A_335≈328.23  B_335≈6.74
