-- =============================================================================
-- Migration 057: Set minimum stock thresholds for Packing Material items
--
-- Sets min_threshold on stores_stock_items for the 13 PM items.
-- WOODEN PALLETS has no threshold (no status rule).
-- When closing_balance < min_threshold, Stock Ledger shows "Material Required".
--
-- Matches by item_name (case-insensitive ILIKE). No-op if item doesn't exist.
-- =============================================================================

UPDATE public.stores_stock_items
  SET min_threshold = 2000
  WHERE item_name ILIKE '%CEAT 108/EXPORT%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 4000
  WHERE (item_name ILIKE '%MRF%M-2615%' OR item_name ILIKE '%MRF-M-2615%')
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 2000
  WHERE item_name ILIKE '%LANXESS%'
    AND category = 'packaging_material';

-- WOODEN PALLETS: no threshold (min_threshold stays NULL)

UPDATE public.stores_stock_items
  SET min_threshold = 2000
  WHERE item_name ILIKE '%CEAT R5299%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE item_name ILIKE '%APOLLO TYRE%160108%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 2000
  WHERE item_name ILIKE '%Plain Bags EXPORT 25 kg%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE item_name ILIKE '%THREAD CONE%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE item_name ILIKE '%BRIDGESTONE WE-10%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE item_name ILIKE '%RUBBER MAKER 50 KG%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 2000
  WHERE item_name ILIKE '%JKI-108 50 KG%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE item_name ILIKE '%JUMBO BAGS 500 KG%'
    AND category = 'packaging_material';

UPDATE public.stores_stock_items
  SET min_threshold = 1000
  WHERE item_name ILIKE '%Old Bags%'
    AND category = 'packaging_material';

-- =============================================================================
-- END OF MIGRATION 057
-- Thresholds set (bags):
--   CEAT 108/EXPORT          2000
--   MRF-M-2615               4000
--   LANXESS                  2000
--   WOODEN PALLETS           NULL (no rule)
--   CEAT R5299               2000
--   APOLLO TYRE - 160108     1000
--   Plain Bags EXPORT 25 kg  2000
--   THREAD CONE              1000
--   BRIDGESTONE WE-10        1000
--   RUBBER MAKER 50 KG       1000
--   JKI-108 50 KG            2000
--   JUMBO BAGS 500 KG        1000
--   Old Bags                 1000
-- =============================================================================
