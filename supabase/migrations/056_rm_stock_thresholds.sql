-- =============================================================================
-- Migration 056: Set minimum stock thresholds for Raw Material items
--
-- Sets min_threshold on stores_stock_items for the 4 RM items that have
-- defined reorder points. When closing_balance < min_threshold the Stock
-- Ledger shows a "Material Required" warning.
--
-- Matches by item_name (case-insensitive ILIKE) so it works regardless of
-- how the item was seeded. No-op if the item doesn't exist yet.
-- =============================================================================

UPDATE public.stores_stock_items
  SET min_threshold = 200
  WHERE item_name ILIKE '%Chem Grind Oil%'
    AND category = 'raw_material';

UPDATE public.stores_stock_items
  SET min_threshold = 200
  WHERE item_name ILIKE '%Gear Oil 320%'
    AND category = 'raw_material';

UPDATE public.stores_stock_items
  SET min_threshold = 50
  WHERE item_name ILIKE '%Magnesium Carbonate%'
    AND category = 'raw_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE (item_name ILIKE '%Power oil Citrine M 4150%'
      OR item_name ILIKE '%Power Oil Citrine M 4150%'
      OR item_name ILIKE '%POWER OIL CITRINE M 4150%')
    AND category = 'raw_material';

-- =============================================================================
-- END OF MIGRATION 056
-- Effect: Stock Ledger section now shows "Material Required" warning when
--         Chem Grind Oil     < 200
--         Gear Oil 320       < 200
--         Magnesium Carbonate < 50
--         Power oil Citrine  < 1000
-- =============================================================================
