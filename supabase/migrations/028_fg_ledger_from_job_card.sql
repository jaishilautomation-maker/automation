-- =============================================================================
-- Migration 028: FG ledger auto-populate from finalized job card
--
-- Sept 16 meeting item 1: "FG ledger auto-populates from finalized job cards".
--
-- WHAT THIS DOES:
--   When fn_pulveriser_apply_review() transitions a job card to 'finalized'
--   (i.e. Lab marks OK), the DB must automatically insert a qty_received row
--   into stores_stock_ledger for the matching Finished Good item at this factory.
--
--   The qty_received = actual_production_mt * 1000   (convert MT → kg)
--
-- MATCHING LOGIC:
--   We join stores_stock_items on factory_id + category='finished_good' + an
--   item_code that matches the job card's material_code. This is the natural
--   key: material_code is the batch/material code filled by Production, and
--   the FG item in stock_items should use the same code.
--
--   If no matching FG item exists yet in stores_stock_items (item not seeded),
--   the trigger logs a NOTICE and does NOT fail — it would be wrong to block
--   finalization because the stores catalogue hasn't been set up yet. The job
--   card still becomes finalized; the ledger entry just won't appear until the
--   item is added and re-triggered manually.
--
-- CLOSING BALANCE:
--   We compute prev_closing = the most recent closing_balance for this item
--   (by created_at DESC). If there is no prior row the opening balance is 0.
--   new_closing = prev_closing + qty_received.
--
-- GUARD — no double-entry:
--   We check for an existing ledger row with reference_id = job_card.id AND
--   transaction_source = 'production_fg'. If one already exists (e.g. trigger
--   fired twice from a race), we skip silently. This should not happen in
--   normal flow but is cheap insurance.
--
-- SECURITY DEFINER:
--   Required because the Lab role (which triggers the review insert that starts
--   this chain) has no direct INSERT grant on stores_stock_ledger for
--   non-manual rows. The trigger runs as the function owner (postgres/service
--   role) so it bypasses RLS. The existing fn_pulveriser_apply_review() is
--   already SECURITY DEFINER for the same reason.
--
-- Depends on: 015 (pulveriser_job_card_reviews, fn_pulveriser_apply_review),
--             027 (stores_stock_ledger, stores_stock_items).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.  fn_pulveriser_fg_ledger_entry()
--     Fires AFTER the job card row has been updated to 'finalized'. We hook
--     onto the SAME review-insert trigger chain by extending
--     fn_pulveriser_apply_review() to call a helper — OR we add a second
--     AFTER-UPDATE trigger on pulveriser_job_cards itself that fires when
--     status changes TO 'finalized'.
--
--     We choose the latter (trigger on pulveriser_job_cards AFTER UPDATE) so
--     the FG + RM triggers are self-contained and don't require modifying the
--     already-tested fn_pulveriser_apply_review(). A trigger on status
--     transition FROM submitted_for_qc TO finalized fires exactly once per
--     finalization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pulveriser_fg_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item_id       uuid;
    v_qty_received  numeric;
    v_prev_closing  numeric;
    v_new_closing   numeric;
BEGIN
    -- Only act when status transitions TO 'finalized' from 'submitted_for_qc'.
    IF NOT (OLD.status = 'submitted_for_qc' AND NEW.status = 'finalized') THEN
        RETURN NEW;
    END IF;

    -- Need actual_production_mt to compute received quantity.
    IF NEW.actual_production_mt IS NULL OR NEW.actual_production_mt = 0 THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: job_card % has no actual_production_mt — skipping FG ledger entry.', NEW.id;
        RETURN NEW;
    END IF;

    -- Qty in kg (ledger unit).
    v_qty_received := NEW.actual_production_mt * 1000;

    -- Guard: skip if an FG ledger entry already exists for this job card.
    IF EXISTS (
        SELECT 1 FROM public.stores_stock_ledger
        WHERE reference_id = NEW.id
          AND transaction_source = 'production_fg'
        LIMIT 1
    ) THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: FG ledger entry already exists for job_card % — skipping.', NEW.id;
        RETURN NEW;
    END IF;

    -- Look up the Finished Good item for this factory + material_code.
    -- material_code is the batch/product code that Production filled in;
    -- the FG item in stores_stock_items must use the same item_code.
    SELECT id INTO v_item_id
    FROM public.stores_stock_items
    WHERE factory_id = NEW.factory_id
      AND category    = 'finished_good'
      AND item_code   = NEW.material_code
      AND is_active   = true
    LIMIT 1;

    IF v_item_id IS NULL THEN
        RAISE NOTICE 'fn_pulveriser_fg_ledger_entry: no active finished_good item with code "%" found for factory % — FG ledger entry skipped. Seed stores_stock_items to enable auto-posting.',
            NEW.material_code, NEW.factory_id;
        RETURN NEW;
    END IF;

    -- Compute closing balance from most recent ledger row for this item.
    SELECT COALESCE(closing_balance, 0)
    INTO   v_prev_closing
    FROM   public.stores_stock_ledger
    WHERE  item_id = v_item_id
    ORDER BY created_at DESC
    LIMIT 1;

    v_prev_closing := COALESCE(v_prev_closing, 0);
    v_new_closing  := v_prev_closing + v_qty_received;

    -- Insert the FG receipt row.
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
        NEW.id,             -- reference_id = job_card id
        'job_card',
        'Auto: FG receipt from job card ' || COALESCE(NEW.job_number, NEW.id::text)
            || ' · ' || COALESCE(NEW.actual_production_mt::text, '?') || ' MT',
        NEW.operator_by     -- credit to operator who ran the batch
    );

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2.  Attach the trigger to pulveriser_job_cards AFTER UPDATE
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_pulveriser_fg_ledger_entry ON public.pulveriser_job_cards;
CREATE TRIGGER trg_pulveriser_fg_ledger_entry
    AFTER UPDATE ON public.pulveriser_job_cards
    FOR EACH ROW EXECUTE FUNCTION public.fn_pulveriser_fg_ledger_entry();

-- =============================================================================
-- END OF MIGRATION 028
-- New trigger : trg_pulveriser_fg_ledger_entry (AFTER UPDATE on pulveriser_job_cards)
-- New function: fn_pulveriser_fg_ledger_entry  (SECURITY DEFINER)
-- Effect      : On job card finalization, auto-inserts a qty_received ledger
--               row for the matching FG item. Skips gracefully if item not
--               seeded yet (no hard error, no blocked finalization).
-- =============================================================================
