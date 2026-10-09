-- =============================================================================
-- Migration 064: Change unit for all packaging_material items from 'bags' to 'nos'
--
-- Reason: Packing materials (bags, labels, pallets, etc.) are counted in
-- pieces (Nos.), not in bags. Raw materials remain in 'kg'.
-- =============================================================================

UPDATE public.stores_stock_items
SET    unit = 'nos',
       updated_at = now()
WHERE  category = 'packaging_material'
  AND  unit = 'bags';
