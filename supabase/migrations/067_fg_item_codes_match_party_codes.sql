-- =============================================================================
-- Migration 067: Set FG item_codes to exactly match party_code values.
-- Idempotent: each UPDATE skips rows that already have the correct item_code.
-- =============================================================================

-- Helper macro pattern: only update when the row DOES NOT already have the
-- target code (prevents the unique-constraint collision on re-runs or when
-- a prior migration already set the code on a different row).

UPDATE public.stores_stock_items
SET    item_code = 'Ceat 108', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'CEAT-108/ EXPORT'
  AND  item_code != 'Ceat 108';

UPDATE public.stores_stock_items
SET    item_code = 'M2615', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'MRF LIMITED (M-2615)'
  AND  item_code != 'M2615';

UPDATE public.stores_stock_items
SET    item_code = 'Plain-2615', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'CODE 2615 w/o Oil (MRF Grade)'
  AND  item_code != 'Plain-2615';

UPDATE public.stores_stock_items
SET    item_code = 'Apollo 160108', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'APOLLO TYRE/CLASSIC AUTO 160108'
  AND  item_code != 'Apollo 160108';

UPDATE public.stores_stock_items
SET    item_code = 'LANXESS', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'LANXESS INDIA PVT LTD'
  AND  item_code != 'LANXESS';

UPDATE public.stores_stock_items
SET    item_code = 'Ceat R5299', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name ILIKE '%HALOL%NAGPUR%R5299%'
  AND  item_code != 'Ceat R5299';

UPDATE public.stores_stock_items
SET    item_code = 'Plain Lanxess', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'BRIDGESTONE/Lanxess(Semifinish) PLAIN'
  AND  item_code != 'Plain Lanxess';

UPDATE public.stores_stock_items
SET    item_code = 'JKI-108', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'J.K. INDUSTRIES'
  AND  item_code != 'JKI-108';

UPDATE public.stores_stock_items
SET    item_code = 'Shakti', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'OLD BAGS (SHAKTI & OTHERS)'
  AND  item_code != 'Shakti';

UPDATE public.stores_stock_items
SET    item_code = 'Rubber', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'RUBBER MAKER.50 KG'
  AND  item_code != 'Rubber';

UPDATE public.stores_stock_items
SET    item_code = 'Sulphur Powder', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name ILIKE '%Sulphur Powder%Jumbo%'
  AND  item_code != 'Sulphur Powder';

UPDATE public.stores_stock_items
SET    item_code = 'BKT', updated_at = now()
WHERE  category  = 'finished_good'
  AND  item_name = 'BRIDGESTONE WE-10 FINISHED'
  AND  item_code != 'BKT';

-- =============================================================================
-- END OF MIGRATION 067
-- =============================================================================
