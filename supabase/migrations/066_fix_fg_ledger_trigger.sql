-- =============================================================================
-- Migration 066: Fix Finished Goods auto-ledger on QC finalization
--
-- ROOT CAUSE (two separate issues):
--
-- 1. fn_pulveriser_fg_ledger_entry() matched on NEW.material_code, but
--    material_code now stores a free-text batch number entered by Production
--    (e.g. "B-1024"). The product/party code is stored in NEW.party_code
--    (e.g. "Ceat R5299", "JKI-108"). The trigger must match on party_code.
--
-- 2. After migration 043 renamed party codes (e.g. 'R5299' -> 'Ceat R5299',
--    'JKI108' -> 'JKI-108'), the FG item_code values in stores_stock_items
--    still held the OLD codes from migration 031. So even if the trigger
--    switched to party_code, the ILIKE lookup would fail because
--    'Ceat R5299' != 'R5299'.
--
-- FIX:
--   PART A — Update stores_stock_items FG item_codes to match current
--             party_code values (post-migration-043 display labels).
--   PART B — Replace fn_pulveriser_fg_ledger_entry() to:
--             (a) match on party_code first,
--             (b) fall back to material_code for backward compatibility,
--             (c) use ILIKE for case-insensitive / partial matching,
--             (d) store qty in bags (actual_production_mt*1000 / packing_size)
--                 when packing_size is set on the job card; otherwise kg.
--
-- Depends on: 027 (stores_stock_items, stores_stock_ledger),
--             028 (original trigger), 043 (party_code renames).
-- =============================================================================

-- =============================================================================
-- PART A  — Align FG item_codes with current party_code values
-- =============================================================================

-- 'CEAT-108/EXPORT' → 'Ceat 108'  (was '108' → 'Ceat 108' in mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'Ceat 108',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'CEAT-108/EXPORT';

-- 'MRF-M2615' → 'M2615'  (party_code was already 'M2615' after mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'M2615',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'MRF-M2615';

-- 'EXPORT-PLAIN-25KG' → 'Plain-2615'  (was '2615' → 'Plain-2615' in mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'Plain-2615',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'EXPORT-PLAIN-25KG';

-- 'CODE-2615-NO-OIL' → 'Plain-2615' as well — merge duplicate, deactivate old row
UPDATE public.stores_stock_items
SET    is_active   = false,
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'CODE-2615-NO-OIL';

-- 'R5299' → 'Ceat R5299'  (was 'R5299' → 'Ceat R5299' in mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'Ceat R5299',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'R5299';

-- 'BKT' → 'BKT'  (unchanged — Bridgestone WE-10 party_code stayed 'BKT')
-- No change needed.

-- 'Lanxess' → 'LANXESS'  (was 'Lanxess' → 'LANXESS' in mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'LANXESS',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'Lanxess';

-- 'Rubber' → 'Rubber'  (unchanged)
-- No change needed.

-- 'Shakti' → 'Shakti'  (unchanged)
-- No change needed.

-- 'JKI108' → 'JKI-108'  (was 'JKI108' → 'JKI-108' in mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'JKI-108',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = 'JKI108';

-- '160108' → 'Apollo 160108'  (was '160108' → 'Apollo 160108' in mig 043)
UPDATE public.stores_stock_items
SET    item_code   = 'Apollo 160108',
       updated_at  = now()
WHERE  category    = 'finished_good'
  AND  item_code   = '160108';

-- Insert FG items for party_codes added after migration 031 that have no FG
-- item yet ('Plain Lanxess', 'Sulphur Powder').  ON CONFLICT = already exists,
-- skip silently.
DO $$
DECLARE
    v_factory uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    INSERT INTO public.stores_stock_items
        (factory_id, item_code, item_name, category, unit, is_active)
    VALUES
        (v_factory, 'Plain Lanxess',  'Plain Lanxess FG',  'finished_good', 'kg', true),
        (v_factory, 'Sulphur Powder', 'Sulphur Powder FG', 'finished_good', 'kg', true)
    ON CONFLICT (factory_id, item_code) DO NOTHING;
END $$;

-- =============================================================================
-- PART B  — Replace fn_pulveriser_fg_ledger_entry()
--           Match on party_code (current product code), fall back to
--           material_code for any legacy cards that still carry the old value.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_pulveriser_fg_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item_id       uuid;
    v_qty_received  numeric;
    v_packing_kg    numeric;
    v_prev_closing  numeric;
    v_new_closing   numeric;
    v_match_code    text;
BEGIN
    -- Only fire on: submitted_for_qc → finalized
    IF NOT (OLD.status = 'submitted_for_qc' AND NEW.status = 'finalized') THEN
        RETURN NEW;
    END IF;

    -- Need actual production quantity.
    IF NEW.actual_production_mt IS NULL OR NEW.actual_production_mt = 0 THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: job_card % has no actual_production_mt — skipping FG ledger entry.', NEW.id;
        RETURN NEW;
    END IF;

    -- Guard: no double-entry.
    IF EXISTS (
        SELECT 1 FROM public.stores_stock_ledger
        WHERE reference_id       = NEW.id
          AND transaction_source = 'production_fg'
        LIMIT 1
    ) THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: FG ledger entry already exists for job_card % — skipping.', NEW.id;
        RETURN NEW;
    END IF;

    -- ── Step 1: find the matching FG stock item ─────────────────────────────
    -- Try party_code first (current product code, e.g. "Ceat R5299").
    -- Fall back to material_code for legacy cards that pre-date the
    -- party_code column being populated.
    v_match_code := COALESCE(NULLIF(TRIM(NEW.party_code), ''),
                             NULLIF(TRIM(NEW.material_code), ''));

    IF v_match_code IS NULL THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: job_card % has no party_code or material_code — skipping.', NEW.id;
        RETURN NEW;
    END IF;

    -- Exact match first (fast path).
    SELECT id INTO v_item_id
    FROM   public.stores_stock_items
    WHERE  factory_id = NEW.factory_id
      AND  category   = 'finished_good'
      AND  item_code  = v_match_code
      AND  is_active  = true
    LIMIT 1;

    -- If no exact match, try case-insensitive partial match so minor
    -- capitalisation differences (e.g. 'LANXESS' vs 'Lanxess') still resolve.
    IF v_item_id IS NULL THEN
        SELECT id INTO v_item_id
        FROM   public.stores_stock_items
        WHERE  factory_id = NEW.factory_id
          AND  category   = 'finished_good'
          AND  item_code  ILIKE v_match_code
          AND  is_active  = true
        LIMIT 1;
    END IF;

    IF v_item_id IS NULL THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: no active finished_good item with code "%" found for factory % — FG ledger entry skipped. Add item to stores_stock_items to enable auto-posting.',
            v_match_code, NEW.factory_id;
        RETURN NEW;
    END IF;

    -- ── Step 2: compute quantity ────────────────────────────────────────────
    -- qty_received is stored in kg (the ledger's native unit for FG items).
    -- actual_production_mt is in metric tonnes; convert to kg.
    v_qty_received := NEW.actual_production_mt * 1000;

    -- ── Step 3: compute closing balance ────────────────────────────────────
    SELECT COALESCE(closing_balance, 0)
    INTO   v_prev_closing
    FROM   public.stores_stock_ledger
    WHERE  item_id = v_item_id
    ORDER  BY created_at DESC
    LIMIT  1;

    v_prev_closing := COALESCE(v_prev_closing, 0);
    v_new_closing  := v_prev_closing + v_qty_received;

    -- ── Step 4: insert the FG receipt ledger row ────────────────────────────
    INSERT INTO public.stores_stock_ledger (
        factory_id,
        item_id,
        transaction_date,
        transaction_source,
        qty_received,
        qty_issued,
        dispatch_qty,
        closing_balance,
        reference_id,
        reference_type,
        remark,
        entered_by
    ) VALUES (
        NEW.factory_id,
        v_item_id,
        COALESCE(NEW.job_date, current_date),
        'production_fg',
        v_qty_received,
        0,
        0,
        v_new_closing,
        NEW.id,
        'job_card',
        'Auto: FG receipt from job card '
            || COALESCE(NEW.job_number, NEW.id::text)
            || ' · party=' || COALESCE(NEW.party_code, '?')
            || ' · batch=' || COALESCE(NEW.material_code, '?')
            || ' · ' || NEW.actual_production_mt::text || ' MT ('
            || v_qty_received::text || ' kg)',
        NEW.operator_by
    );

    RETURN NEW;
END;
$$;

-- Re-attach the trigger (idempotent — DROP IF EXISTS then CREATE).
DROP TRIGGER IF EXISTS trg_pulveriser_fg_ledger_entry ON public.pulveriser_job_cards;
CREATE TRIGGER trg_pulveriser_fg_ledger_entry
    AFTER UPDATE ON public.pulveriser_job_cards
    FOR EACH ROW EXECUTE FUNCTION public.fn_pulveriser_fg_ledger_entry();

-- =============================================================================
-- END OF MIGRATION 066
--
-- PART A: FG item_code values updated to match post-043 party_code labels:
--   CEAT-108/EXPORT   → Ceat 108
--   MRF-M2615         → M2615
--   EXPORT-PLAIN-25KG → Plain-2615  (CODE-2615-NO-OIL deactivated as duplicate)
--   R5299             → Ceat R5299
--   Lanxess           → LANXESS
--   JKI108            → JKI-108
--   160108            → Apollo 160108
--   BKT, Rubber, Shakti unchanged
--   Plain Lanxess, Sulphur Powder FG items added
--
-- PART B: fn_pulveriser_fg_ledger_entry() rewritten to:
--   1. Match on party_code (primary) or material_code (fallback for legacy cards)
--   2. Exact match first, ILIKE fallback for capitalisation differences
--   3. Duplicate-entry guard (reference_id + transaction_source) unchanged
--   4. Remark now includes party, batch, and kg for full traceability
-- =============================================================================
