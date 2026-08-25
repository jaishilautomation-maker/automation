-- =============================================================================
-- A-20 Migration 005: Fix/update Production Job Card products
--
-- Corrects product names and adds two products per the confirmed spec.
-- product_formula_items NOT seeded here — formulas (JSC codes + quantities
-- per product) must be provided separately before seeding.
--
-- Products:
--   1. Sulphur SC UPL Grade          (single phase — no A/B)
--   2. Sulphur SC 55.13% (Gain/Instasul) (Phase A + B)
--   3. NUTRIZIN/ZINC OXIDE 39.5% SC  (Phase A + B)
--   4. INSTACAL 160                  (Phase A + B)
--   5. K GUM/KELZAN PLUS 1.4% SOLUTION (single phase)
--   6. INSTABORE 150                 (Phase A + B)
-- =============================================================================

-- Update existing product names to match spec exactly
UPDATE public.products SET name = 'Sulphur SC UPL Grade'
    WHERE code = 'SULPHUR_SC_UPL';

UPDATE public.products SET name = 'Sulphur SC 55.13% (Gain/Instasul)'
    WHERE code = 'SULPHUR_SC';

UPDATE public.products SET name = 'NUTRIZIN/ZINC OXIDE 39.5% SC'
    WHERE code = 'NUTRIZIN';

UPDATE public.products SET name = 'INSTACAL 160'
    WHERE code = 'INSTACAL';

UPDATE public.products SET name = 'K GUM/KELZAN PLUS 1.4% SOLUTION'
    WHERE code = 'K_GUM';

UPDATE public.products SET name = 'INSTABORE 150'
    WHERE code = 'INSTABORE';

-- Kelzan Plus was seeded separately in 002 — merge it into K_GUM if present,
-- or deactivate to avoid duplicates in the dropdown
UPDATE public.products SET is_active = false
    WHERE code = 'KELZAN_PLUS';

-- Verify final active production products:
-- SELECT code, name, is_active FROM products ORDER BY name;
-- Expected 6 active rows: SULPHUR_SC_UPL, SULPHUR_SC, NUTRIZIN, INSTACAL, K_GUM, INSTABORE
