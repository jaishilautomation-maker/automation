-- =============================================================================
-- Migration 058: Reconcile stores_stock_items to the approved master list
--
-- Factory: DBV_20_1  (id = 00000000-0000-0000-0000-000000000001)
--
-- 1. Deactivates (is_active = false) every item NOT in the approved list,
--    per category. Items in other categories (e.g. custom seeds) are untouched.
--
-- 2. Reactivates any approved item that was previously deactivated.
--
-- 3. Inserts any approved item that does not yet exist (ON CONFLICT DO NOTHING
--    guard keeps it idempotent).
--
-- The approved lists come from the business spec dated Oct 2026.
-- =============================================================================

DO $$
DECLARE
    v_factory uuid := '00000000-0000-0000-0000-000000000001';
BEGIN

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 1: Deactivate items NOT in the approved list (per category)
-- ──────────────────────────────────────────────────────────────────────────────

-- Raw Materials: deactivate any RM item whose name is not in the approved list
UPDATE public.stores_stock_items SET is_active = false
WHERE factory_id = v_factory
  AND category   = 'raw_material'
  AND item_name NOT IN (
    'Crude Sulphur',
    'Elasto 541 Oil',
    'P.Silica',
    'Chem Grind Oil',
    'Poweroil Sapphire L3060',
    'Poweroil Citrine L4070',
    'Gear Oil 320/PARTHAN',
    'Magnesium Carbonate in kg',
    'Power oil Citrine M 4150'
  );

-- Packing Materials: deactivate PM items not in approved list
UPDATE public.stores_stock_items SET is_active = false
WHERE factory_id = v_factory
  AND category   = 'packaging_material'
  AND item_name NOT IN (
    'CEAT 108/EXPORT',
    'MRF- M-2615',
    'LANXESS',
    'WOODEN PALLETS',
    'CEAT R5299',
    'APOLLO TYRE - 160108',
    'Plain Bags EXPORT 25 kg for Export',
    'THREAD CONE',
    'BRIDGESTONE WE-10',
    'RUBBER MAKER 50 KG',
    'JKI-108 50 KG',
    'JUMBO BAGS 500 KG',
    'Old Bags'
  );

-- Finished Goods: deactivate FG items not in approved list
UPDATE public.stores_stock_items SET is_active = false
WHERE factory_id = v_factory
  AND category   = 'finished_good'
  AND item_name NOT IN (
    'CEAT-108/ EXPORT',
    'MRF LIMITED (M-2615)',
    'EXPORT Plain Bag 25 KG A2052',
    'LANXESS INDIA PVT LTD',
    'CEAT HALOL/NAGPUR-R5299(Halol/Nagpur)',
    'APOLLO TYRE/CLASSIC AUTO 160108',
    'CODE 2615 w/o Oil (MRF Grade)',
    'Lanxess 2% Oil',
    'MRF Ltd 2615 - Rejected',
    'Lanxess R.M. 25 KG - Rejected',
    'CEAT R5299 - Rejected',
    'Apollo 160108 - Rejected',
    'Jayam Chemical 0.5% Silica',
    'EOC POLYMERS',
    'BRIDGESTONE WE-10 FINISHED',
    'BRIDGESTONE/Lanxess(Semifinish) PLAIN',
    'RUBBER MAKER.50 KG',
    'OLD BAGS (SHAKTI & OTHERS)',
    'J.K. INDUSTRIES',
    'FOR PESTICIDE FORMULATION (SC)',
    'Sulphur Powder(Jumbo Bag-550 KG)',
    'BRIDGESTONE WE-10(500 KG JUMBO)',
    'RUBBER MAKER.50 KG - Rejected'
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 2: Reactivate any previously deactivated approved item
-- ──────────────────────────────────────────────────────────────────────────────

UPDATE public.stores_stock_items SET is_active = true
WHERE factory_id = v_factory AND is_active = false
  AND item_name IN (
    -- RM
    'Crude Sulphur', 'Elasto 541 Oil', 'P.Silica', 'Chem Grind Oil',
    'Poweroil Sapphire L3060', 'Poweroil Citrine L4070', 'Gear Oil 320/PARTHAN',
    'Magnesium Carbonate in kg', 'Power oil Citrine M 4150',
    -- PM
    'CEAT 108/EXPORT', 'MRF- M-2615', 'LANXESS', 'WOODEN PALLETS',
    'CEAT R5299', 'APOLLO TYRE - 160108', 'Plain Bags EXPORT 25 kg for Export',
    'THREAD CONE', 'BRIDGESTONE WE-10', 'RUBBER MAKER 50 KG',
    'JKI-108 50 KG', 'JUMBO BAGS 500 KG', 'Old Bags',
    -- FG
    'CEAT-108/ EXPORT', 'MRF LIMITED (M-2615)', 'EXPORT Plain Bag 25 KG A2052',
    'LANXESS INDIA PVT LTD', 'CEAT HALOL/NAGPUR-R5299(Halol/Nagpur)',
    'APOLLO TYRE/CLASSIC AUTO 160108', 'CODE 2615 w/o Oil (MRF Grade)',
    'Lanxess 2% Oil', 'MRF Ltd 2615 - Rejected', 'Lanxess R.M. 25 KG - Rejected',
    'CEAT R5299 - Rejected', 'Apollo 160108 - Rejected',
    'Jayam Chemical 0.5% Silica', 'EOC POLYMERS',
    'BRIDGESTONE WE-10 FINISHED', 'BRIDGESTONE/Lanxess(Semifinish) PLAIN',
    'RUBBER MAKER.50 KG', 'OLD BAGS (SHAKTI & OTHERS)', 'J.K. INDUSTRIES',
    'FOR PESTICIDE FORMULATION (SC)', 'Sulphur Powder(Jumbo Bag-550 KG)',
    'BRIDGESTONE WE-10(500 KG JUMBO)', 'RUBBER MAKER.50 KG - Rejected'
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 3: Insert missing approved items (with default 0 balance implied)
-- ──────────────────────────────────────────────────────────────────────────────

-- RAW MATERIALS
INSERT INTO public.stores_stock_items
    (factory_id, item_code, item_name, category, unit, is_active)
SELECT v_factory, upper(replace(item_name, ' ', '_')), item_name, 'raw_material', 'kg', true
FROM (VALUES
    ('Crude Sulphur'),
    ('Elasto 541 Oil'),
    ('P.Silica'),
    ('Chem Grind Oil'),
    ('Poweroil Sapphire L3060'),
    ('Poweroil Citrine L4070'),
    ('Gear Oil 320/PARTHAN'),
    ('Magnesium Carbonate in kg'),
    ('Power oil Citrine M 4150')
) AS t(item_name)
WHERE NOT EXISTS (
    SELECT 1 FROM public.stores_stock_items s
    WHERE s.factory_id = v_factory AND s.item_name = t.item_name
);

-- PACKING MATERIALS
INSERT INTO public.stores_stock_items
    (factory_id, item_code, item_name, category, unit, is_active)
SELECT v_factory, upper(replace(item_name, ' ', '_')), item_name, 'packaging_material', 'bags', true
FROM (VALUES
    ('CEAT 108/EXPORT'),
    ('MRF- M-2615'),
    ('LANXESS'),
    ('WOODEN PALLETS'),
    ('CEAT R5299'),
    ('APOLLO TYRE - 160108'),
    ('Plain Bags EXPORT 25 kg for Export'),
    ('THREAD CONE'),
    ('BRIDGESTONE WE-10'),
    ('RUBBER MAKER 50 KG'),
    ('JKI-108 50 KG'),
    ('JUMBO BAGS 500 KG'),
    ('Old Bags')
) AS t(item_name)
WHERE NOT EXISTS (
    SELECT 1 FROM public.stores_stock_items s
    WHERE s.factory_id = v_factory AND s.item_name = t.item_name
);

-- FINISHED GOODS
INSERT INTO public.stores_stock_items
    (factory_id, item_code, item_name, category, unit, is_active)
SELECT v_factory, upper(replace(item_name, ' ', '_')), item_name, 'finished_good', 'bags', true
FROM (VALUES
    ('CEAT-108/ EXPORT'),
    ('MRF LIMITED (M-2615)'),
    ('EXPORT Plain Bag 25 KG A2052'),
    ('LANXESS INDIA PVT LTD'),
    ('CEAT HALOL/NAGPUR-R5299(Halol/Nagpur)'),
    ('APOLLO TYRE/CLASSIC AUTO 160108'),
    ('CODE 2615 w/o Oil (MRF Grade)'),
    ('Lanxess 2% Oil'),
    ('MRF Ltd 2615 - Rejected'),
    ('Lanxess R.M. 25 KG - Rejected'),
    ('CEAT R5299 - Rejected'),
    ('Apollo 160108 - Rejected'),
    ('Jayam Chemical 0.5% Silica'),
    ('EOC POLYMERS'),
    ('BRIDGESTONE WE-10 FINISHED'),
    ('BRIDGESTONE/Lanxess(Semifinish) PLAIN'),
    ('RUBBER MAKER.50 KG'),
    ('OLD BAGS (SHAKTI & OTHERS)'),
    ('J.K. INDUSTRIES'),
    ('FOR PESTICIDE FORMULATION (SC)'),
    ('Sulphur Powder(Jumbo Bag-550 KG)'),
    ('BRIDGESTONE WE-10(500 KG JUMBO)'),
    ('RUBBER MAKER.50 KG - Rejected')
) AS t(item_name)
WHERE NOT EXISTS (
    SELECT 1 FROM public.stores_stock_items s
    WHERE s.factory_id = v_factory AND s.item_name = t.item_name
);

END $$;

-- =============================================================================
-- END OF MIGRATION 058
-- Effect: Stock Ledger shows exactly the approved RM (9) + PM (13) + FG (23)
--         items. All other items are deactivated (hidden from UI, data retained).
-- =============================================================================
