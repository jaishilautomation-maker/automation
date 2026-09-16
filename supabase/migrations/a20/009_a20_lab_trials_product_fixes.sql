-- =============================================================================
-- A-20 Migration 009: Lab Trials product dropdown fixes
--
--   1. Correct spelling: "INSTABORE 150" -> "INSTABOR 150"
--   2. Remove K Gum from the Lab Trials (and all other) product dropdowns by
--      deactivating it. Deactivation (is_active = false) is used instead of a
--      hard delete so any existing trial / QC / batch rows that reference the
--      product remain intact; the dropdowns filter on is_active = true.
--
-- Idempotent: both statements are safe to re-run.
-- =============================================================================

-- 1. Fix INSTABORE spelling on the product record (dropdowns read products.name)
UPDATE public.products
SET name = 'INSTABOR 150'
WHERE code = 'INSTABORE';

-- 2. Hide K Gum from product dropdowns
UPDATE public.products
SET is_active = false
WHERE code = 'K_GUM';
