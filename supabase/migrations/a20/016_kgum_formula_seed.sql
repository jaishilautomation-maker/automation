-- =============================================================================
-- A-20 Migration 016: K GUM (Kelzan Plus 1.4% Solution) formula seed
--
-- Single-phase product — no Phase A / B, phase = NULL for all rows.
-- 4 ingredient rows from the K GUM sheet.
--
-- Ingredients (from K GUM sheet, column C rows 8–11):
--   1  WATER   —   277.826 kg  (has TDS field — stored in remark on save)
--   2  JSC52   —    14.987 kg  (MONOETHYLENE GLYCOL)
--   3  JSC53   —     1.200 kg  (PROXEL)
--   4  JSC51   —     4.200 kg  (KELZAN S PLUS)
--
-- SUM(C8:C11) = 277.826 + 14.987 + 1.200 + 4.200 = 298.213 kg ✓
--
-- No schema changes required — migration 012 already added all needed columns.
-- =============================================================================

DO $$
DECLARE
    pid uuid;
BEGIN
    SELECT id INTO pid FROM public.products WHERE code = 'K_GUM';
    IF pid IS NULL THEN
        RAISE EXCEPTION 'Product K_GUM not found — run earlier migrations first';
    END IF;

    DELETE FROM public.product_formula_items WHERE product_id = pid;

    INSERT INTO public.product_formula_items
        (product_id, phase, order_no, component_name, jsc_code,
         instructed_qty_kg, reference_batch_size_kg)
    VALUES
        (pid, NULL, 1, 'WATER', NULL,     277.826, 298.213),
        (pid, NULL, 2, 'JSC52', 'JSC52',   14.987, 298.213),
        (pid, NULL, 3, 'JSC53', 'JSC53',    1.200, 298.213),
        (pid, NULL, 4, 'JSC51', 'JSC51',    4.200, 298.213);
    -- Sum: 298.213 ✓

    -- Note: reference_batch_size_kg is set to the total (298.213) because
    -- the K GUM form does not specify a separate "batch size" — the formula
    -- quantities ARE the batch. The UI uses this for proportional scaling
    -- if the operator changes the batch size.

END $$;

-- Verify:
-- SELECT order_no, component_name, instructed_qty_kg
-- FROM product_formula_items
-- WHERE product_id = (SELECT id FROM products WHERE code = 'K_GUM')
-- ORDER BY order_no;
-- Expected total: 298.213
