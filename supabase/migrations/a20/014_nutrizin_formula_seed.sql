-- =============================================================================
-- A-20 Migration 014: NUTRIZIN (Zinc Oxide 39.5% SC) formula seed
--
-- The NUTRIZIN workbook has two distinct batch variants on the same sheet.
-- They are NOT proportionally scaled versions of each other — they have
-- different ingredient quantities and must be stored separately.
--
-- Four phase keys (stored in product_formula_items.phase — TEXT column):
--   'A_843'  Phase A of the 843 kg batch  (Instruction Group 1 in workbook)
--   'B_843'  Phase B of the 843 kg batch  (Instruction Group 2)
--   'A_808'  Phase A of the 808 kg batch  (Instruction Group 3)
--   'B_808'  Phase B of the 808 kg batch  (Instruction Group 4)
--
-- Ingredient names from the NUTRIZIN sheet:
--   Phase A: Water, JSC52, JSC68, JSC45, JSC53, JSC18, ZNO
--   Phase B: Water, JSC06, JSC45
--
-- ⚠ Known discrepancies (values stored exactly as displayed):
--   843 kg Phase A: sum of ingredients = 608.48 kg, template total = 592.25
--   808 kg Phase B: sum of ingredients = 225.32 kg, template total = 225.31
--   The UI flags these discrepancies. Nothing is silently changed.
--
-- 843 kg Phase B total: 114.22 + 121.00 + 0.11 = 235.33 ✓
-- 808 kg Phase A total: 99.50 + 34.95 + 31.07 + 0.26 + 0.78 + 0.47 + 400.00 = 567.03 ✓
--
-- No schema changes needed — migration 012 already has all required columns.
-- The product_formula_items.phase column is TEXT, so custom phase keys work.
-- =============================================================================

DO $$
DECLARE
    pid uuid;
BEGIN
    SELECT id INTO pid FROM public.products WHERE code = 'NUTRIZIN';
    IF pid IS NULL THEN
        RAISE EXCEPTION 'Product NUTRIZIN not found — run earlier migrations first';
    END IF;

    DELETE FROM public.product_formula_items WHERE product_id = pid;

    -- ── 843 kg — Phase A (Instruction Group 1) ───────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A_843', 1, 'Water',  NULL,      120.15, 843),
        (pid, 'A_843', 2, 'JSC52',  'JSC52',    36.51, 843),
        (pid, 'A_843', 3, 'JSC68',  'JSC68',    32.45, 843),
        (pid, 'A_843', 4, 'JSC45',  'JSC45',     0.27, 843),
        (pid, 'A_843', 5, 'JSC53',  'JSC53',     0.82, 843),
        (pid, 'A_843', 6, 'JSC18',  'JSC18',     0.49, 843),
        (pid, 'A_843', 7, 'ZNO',    NULL,      417.79, 843);
    -- ⚠ Sum = 608.48; template-stated total = 592.25 (discrepancy: +16.23)

    -- ── 843 kg — Phase B (Instruction Group 2) ───────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B_843', 1, 'Water',               NULL,      114.22, 843),
        (pid, 'B_843', 2, 'Kelzan 1.4% Solution', 'JSC06',  121.00, 843),
        (pid, 'B_843', 3, 'SAG 1572',             'JSC45',    0.11, 843);
    -- Sum = 235.33 ✓

    -- ── 808 kg — Phase A (Instruction Group 3) ───────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'A_808', 1, 'Water',  NULL,       99.50, 808),
        (pid, 'A_808', 2, 'JSC52',  'JSC52',    34.95, 808),
        (pid, 'A_808', 3, 'JSC68',  'JSC68',    31.07, 808),
        (pid, 'A_808', 4, 'JSC45',  'JSC45',     0.26, 808),
        (pid, 'A_808', 5, 'JSC53',  'JSC53',     0.78, 808),
        (pid, 'A_808', 6, 'JSC18',  'JSC18',     0.47, 808),
        (pid, 'A_808', 7, 'ZNO',    NULL,      400.00, 808);
    -- Sum = 567.03 ✓

    -- ── 808 kg — Phase B (Instruction Group 4) ───────────────────────────
    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, 'B_808', 1, 'Water',               NULL,      109.36, 808),
        (pid, 'B_808', 2, 'Kelzan 1.4% Solution', 'JSC06',  115.85, 808),
        (pid, 'B_808', 3, 'SAG 1572',             'JSC45',    0.11, 808);
    -- ⚠ Sum = 225.32; template-stated total = 225.31 (discrepancy: +0.01)

END $$;

-- Verification query:
-- SELECT phase,
--        ROUND(SUM(instructed_qty_kg), 2)       AS sum_stored,
--        CASE phase
--          WHEN 'A_843' THEN 592.25
--          WHEN 'B_843' THEN 235.33
--          WHEN 'A_808' THEN 567.03
--          WHEN 'B_808' THEN 225.31
--        END                                     AS template_total
-- FROM product_formula_items
-- WHERE product_id = (SELECT id FROM products WHERE code = 'NUTRIZIN')
-- GROUP BY phase ORDER BY phase;
