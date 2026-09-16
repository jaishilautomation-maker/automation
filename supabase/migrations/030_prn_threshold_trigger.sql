-- =============================================================================
-- Migration 030: PRN auto-create on closing_balance < min_threshold
--
-- Sept 16 meeting item 3: "PRN threshold + pending tracking".
--
-- WHAT THIS DOES:
--   After any row is inserted into stores_stock_ledger, check if the new
--   closing_balance is below the item's min_threshold. If so, and if there
--   is no already-open PRN for that item (status in draft/submitted/approved/
--   ordered/partial/auto_flagged), create a new purchase_requisitions row
--   with status='auto_flagged'.
--
-- "NO DUPLICATE OPEN PRNs" RULE:
--   We count open PRNs as those in any non-terminal status. Terminal statuses
--   are 'fulfilled' and 'cancelled'. So an auto-flagged PRN will NOT be
--   created if any of {draft, submitted, approved, ordered, partial, auto_flagged}
--   already exists for that item at that factory. This prevents re-triggering
--   on every further stock movement once a threshold breach has been noted.
--
-- AUTO-FLAGGED CONTENT:
--   po_qty is left NULL (purchase team fills in the order quantity).
--   auto_flagged_balance captures the closing_balance that triggered it.
--   reason is a short descriptive string.
--   raised_by is NULL (system-generated).
--   A prn_number is assigned as 'AUTO-{YYYY}-{NNNN}' using a sequence to avoid
--   collisions.
--
-- SECURITY DEFINER:
--   The ledger INSERT can come from production triggers (028, 029) which are
--   themselves SECURITY DEFINER. An AFTER INSERT trigger on stores_stock_ledger
--   then needs to INSERT into purchase_requisitions. Using SECURITY DEFINER
--   here ensures the insert works regardless of which role originally caused
--   the ledger row to land. The RLS on purchase_requisitions allows
--   stores/admin to insert manually; this trigger bypasses RLS for
--   system-generated auto rows.
--
-- Depends on: 027 (stores_stock_items.min_threshold, purchase_requisitions,
--             stores_stock_ledger, prn_status enum).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.  Sequence for auto PRN numbers
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.prn_auto_seq
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;

-- ---------------------------------------------------------------------------
-- 2.  fn_stores_prn_threshold_check()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_prn_threshold_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_threshold     numeric;
    v_open_count    integer;
    v_seq           bigint;
    v_prn_number    text;
    v_item_name     text;
BEGIN
    -- Load the item's min_threshold (and name for the PRN reason text).
    SELECT min_threshold, item_name
    INTO   v_threshold, v_item_name
    FROM   public.stores_stock_items
    WHERE  id = NEW.item_id;

    -- No threshold set → nothing to check.
    IF v_threshold IS NULL THEN
        RETURN NEW;
    END IF;

    -- Closing balance is still above threshold → no action.
    IF NEW.closing_balance >= v_threshold THEN
        RETURN NEW;
    END IF;

    -- Count open PRNs for this item at this factory.
    -- "Open" = any non-terminal status (not fulfilled/cancelled).
    SELECT COUNT(*) INTO v_open_count
    FROM   public.purchase_requisitions
    WHERE  item_id    = NEW.item_id
      AND  factory_id = NEW.factory_id
      AND  status NOT IN ('fulfilled', 'cancelled');

    IF v_open_count > 0 THEN
        -- There is already an open PRN — don't create a duplicate.
        RETURN NEW;
    END IF;

    -- Assign the next auto PRN number.
    v_seq        := nextval('public.prn_auto_seq');
    v_prn_number := 'AUTO-' || to_char(current_date, 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

    -- Create the auto-flagged PRN.
    INSERT INTO public.purchase_requisitions (
        factory_id,
        item_id,
        prn_number,
        status,
        po_qty,
        received_qty,
        reason,
        raised_at,
        auto_flagged_balance,
        auto_flagged_at
    ) VALUES (
        NEW.factory_id,
        NEW.item_id,
        v_prn_number,
        'auto_flagged',
        NULL,           -- purchase team fills order qty
        0,
        'Auto-flagged: closing balance ' || NEW.closing_balance::text
            || ' fell below min_threshold ' || v_threshold::text
            || ' for item "' || COALESCE(v_item_name, NEW.item_id::text) || '".',
        now(),
        NEW.closing_balance,
        now()
    );

    RAISE NOTICE 'fn_stores_prn_threshold_check: PRN % auto-created for item % (balance=%, threshold=%).',
        v_prn_number, NEW.item_id, NEW.closing_balance, v_threshold;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3.  Attach trigger to stores_stock_ledger AFTER INSERT
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_stores_prn_threshold_check ON public.stores_stock_ledger;
CREATE TRIGGER trg_stores_prn_threshold_check
    AFTER INSERT ON public.stores_stock_ledger
    FOR EACH ROW EXECUTE FUNCTION public.fn_stores_prn_threshold_check();

-- =============================================================================
-- END OF MIGRATION 030
-- New sequence: prn_auto_seq
-- New trigger : trg_stores_prn_threshold_check (AFTER INSERT on stores_stock_ledger)
-- New function: fn_stores_prn_threshold_check  (SECURITY DEFINER)
-- Effect      : On every ledger insert, if closing_balance < min_threshold AND
--               no open PRN exists for the item, auto-creates a PRN with
--               status='auto_flagged'. No duplicate open PRNs per item.
-- =============================================================================
