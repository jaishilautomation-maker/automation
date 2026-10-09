-- =============================================================================
-- Migration 065: Add bag-weight info to packing material item names
--
-- Rules applied:
--   Old Bags              -> Old Bags 50 KG   (each old bag holds 50 kg)
--   All other bags where weight is not already in the name -> append 25 KG
--
-- Items left unchanged (weight already in name or not a bag):
--   JKI-108 50 KG, JUMBO BAGS 500 KG, RUBBER MAKER 50 KG,
--   Plain Bags EXPORT 25 kg for Export, THREAD CONE, WOODEN PALLETS
-- =============================================================================

-- Old Bags: 50 kg each
UPDATE public.stores_stock_items
SET    item_name  = 'Old Bags 50 KG',
       updated_at = now()
WHERE  item_name  = 'Old Bags'
  AND  category   = 'packaging_material';

-- APOLLO TYRE - 160108: 25 kg bags
UPDATE public.stores_stock_items
SET    item_name  = 'APOLLO TYRE - 160108 25 KG',
       updated_at = now()
WHERE  item_name  = 'APOLLO TYRE - 160108'
  AND  category   = 'packaging_material';

-- BRIDGESTONE WE-10: 25 kg bags
UPDATE public.stores_stock_items
SET    item_name  = 'BRIDGESTONE WE-10 25 KG',
       updated_at = now()
WHERE  item_name  = 'BRIDGESTONE WE-10'
  AND  category   = 'packaging_material';

-- CEAT 108/EXPORT: 25 kg bags
UPDATE public.stores_stock_items
SET    item_name  = 'CEAT 108/EXPORT 25 KG',
       updated_at = now()
WHERE  item_name  = 'CEAT 108/EXPORT'
  AND  category   = 'packaging_material';

-- CEAT R5299: 25 kg bags
UPDATE public.stores_stock_items
SET    item_name  = 'CEAT R5299 25 KG',
       updated_at = now()
WHERE  item_name  = 'CEAT R5299'
  AND  category   = 'packaging_material';

-- LANXESS: 25 kg bags
UPDATE public.stores_stock_items
SET    item_name  = 'LANXESS 25 KG',
       updated_at = now()
WHERE  item_name  = 'LANXESS'
  AND  category   = 'packaging_material';

-- MRF- M-2615: 25 kg bags
UPDATE public.stores_stock_items
SET    item_name  = 'MRF M-2615 25 KG',
       updated_at = now()
WHERE  item_name  = 'MRF- M-2615'
  AND  category   = 'packaging_material';
