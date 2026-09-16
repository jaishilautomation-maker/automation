-- =============================================================================
-- Migration 029: RM auto-deduction (oil + sulphur) on job card finalization
--
-- Sept 16 meeting item 2: "RM auto-consumption — oil math exists, sulphur does not".
--
-- WHAT THIS DOES:
--   On job card finalization (same AFTER UPDATE trigger point as migration 028),
--   automatically deducts two raw materials from stores_stock_ledger:
--
--   OIL:
--     qty_issued += actual_oil_consumption_kg   (already computed by trigger 017/018)
--     Item matched by: factory_id + category='raw_material' + item_code='OIL'
--     (or whatever item_code the admin seeds for oil — see MATCHING note below)
--
--   SULPHUR:
--     qty_issued += actual_production_mt * 1000 * sulphur_ratio
--     where sulphur_ratio comes from vfd_parameters (mill row for party_code)
--     Item matched by: factory_id + category='raw_material' + item_code='SULPHUR'
--
-- MATCHING:
--   Oil and sulphur items in stores_stock_items must use item_code = 'OIL' and
--   item_code = 'SULPHUR' (case-sensitive). If the Stores team uses different
--   codes, update these constants here. This is a known coupling point; if a
--   more flexible mapping is needed in future, a vfd_parameters column
--   (oil_item_code, sulphur_item_code) can be added.
--   Currently hard-coded to the two canonical RM names because:
--     - There is only one oil type and one sulphur type per factory
--     - The meeting does not describe a multi-RM mapping system
--     - Premature generality adds complexity without a current need
--
-- SULPHUR GUARD:
--   sulphur_ratio is NULL by default (migration 027). If sulphur_ratio IS NULL
--   for the job card's party_code, the sulphur deduction is SKIPPED and a
--   NOTICE is raised. This is intentional — see migration 027 header. The
--   admin must set sulphur_ratio in vfd_parameters before auto-deduction fires.
--
-- OIL GUARD:
--   If actual_oil_consumption_kg IS NULL (zero-oil codes or no Stores issue),
--   the oil deduction is skipped silently.
--
-- SEPARATE ROWS PER MATERIAL:
--   Oil and sulphur are inserted as separate ledger rows (one for each material),
--   each with their own item_id. This keeps the ledger granular and traceable.
--
-- CLOSING BALANCE:
--   Same pattern as migration 028: prev_closing from latest row for that item,
--   then new_closing = prev_closing - qty_issued.
--
-- NO DOUBLE-ENTRY GUARD:
--   We check for existing rows with reference_id = job_card.id + matching
--   transaction_source. Safe to skip if already present.
--
-- DOES NOT REPLACE MANUAL ISSUE SLIPS:
--   This auto-deduction is SEPARATE from and ADDITIVE TO any manual Material
--   Issue Slip that Stores may have entered prior to the batch. The meeting
--   specifies: "this deduction is automatic, ratio-driven, triggered by
--   production, not by a Stores-entered slip." The manual slip (if any) and
--   this auto-deduction are independent ledger rows.
--
-- Depends on: 015 (pulveriser_job_cards), 017/018 (oil math columns),
--             027 (stores_stock_ledger, vfd_parameters.sulphur_ratio).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_pulveriser_rm_deduction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sulphur_ratio     numeric;
    v_oil_item_id       uuid;
    v_sul_item_id       uuid;
    v_oil_deduct        numeric;
    v_sul_deduct        numeric;
    v_prev_closing      numeric;
    v_new_closing       numeric;
BEGIN
    -- Only act on status transition TO 'finalized' from 'submitted_for_qc'.
    IF NOT (OLD.status = 'submitted_for_qc' AND NEW.status = 'finalized') THEN
        RETURN NEW;
    END IF;

    -- ── OIL DEDUCTION ───────────────────────────────────────────────────────
    v_oil_deduct := NEW.actual_oil_consumption_kg;

    IF v_oil_deduct IS NOT NULL AND v_oil_deduct > 0 THEN
        -- Guard: skip if already deducted.
        IF NOT EXISTS (
            SELECT 1 FROM public.stores_stock_ledger
            WHERE reference_id       = NEW.id
              AND transaction_source  = 'production_rm_oil'
            LIMIT 1
        ) THEN
            -- Find the oil RM item for this factory.
            SELECT id INTO v_oil_item_id
            FROM public.stores_stock_items
            WHERE factory_id  = NEW.factory_id
              AND category     = 'raw_material'
              AND item_code    = 'OIL'
              AND is_active    = true
            LIMIT 1;

            IF v_oil_item_id IS NULL THEN
                RAISE NOTICE 'fn_pulveriser_rm_deduction: no active raw_material item with code "OIL" found for factory % — oil deduction skipped. Create item in stores_stock_items.', NEW.factory_id;
            ELSE
                -- Compute closing balance.
                SELECT COALESCE(closing_balance, 0) INTO v_prev_closing
                FROM   public.stores_stock_ledger
                WHERE  item_id = v_oil_item_id
                ORDER BY created_at DESC LIMIT 1;

                v_prev_closing := COALESCE(v_prev_closing, 0);
                v_new_closing  := v_prev_closing - v_oil_deduct;

                INSERT INTO public.stores_stock_ledger (
                    factory_id, item_id, transaction_date, transaction_source,
                    qty_received, qty_issued, dispatch_qty, closing_balance,
                    reference_id, reference_type, remark, entered_by
                ) VALUES (
                    NEW.factory_id,
                    v_oil_item_id,
                    COALESCE(NEW.job_date, current_date),
                    'production_rm_oil',
                    0,
                    v_oil_deduct,
                    0,
                    v_new_closing,
                    NEW.id,
                    'job_card',
                    'Auto: oil deduction from job card ' || COALESCE(NEW.job_number, NEW.id::text)
                        || ' · actual_oil_consumption_kg=' || v_oil_deduct::text,
                    NEW.operator_by
                );
            END IF;
        END IF;
    END IF;

    -- ── SULPHUR DEDUCTION ───────────────────────────────────────────────────

    -- Look up sulphur_ratio from vfd_parameters for this job card's party_code.
    SELECT sulphur_ratio INTO v_sulphur_ratio
    FROM public.vfd_parameters
    WHERE party_code   = NEW.party_code
      AND machine_type = 'mill'
    LIMIT 1;

    IF v_sulphur_ratio IS NULL THEN
        RAISE NOTICE 'fn_pulveriser_rm_deduction: sulphur_ratio not set in vfd_parameters for party_code "%" — sulphur deduction skipped. Set sulphur_ratio in vfd_parameters to enable.',
            COALESCE(NEW.party_code, '(null)');
    ELSIF NEW.actual_production_mt IS NULL OR NEW.actual_production_mt = 0 THEN
        RAISE NOTICE 'fn_pulveriser_rm_deduction: job_card % has no actual_production_mt — sulphur deduction skipped.', NEW.id;
    ELSE
        v_sul_deduct := NEW.actual_production_mt * 1000 * v_sulphur_ratio;

        IF v_sul_deduct > 0 THEN
            -- Guard: skip if already deducted.
            IF NOT EXISTS (
                SELECT 1 FROM public.stores_stock_ledger
                WHERE reference_id       = NEW.id
                  AND transaction_source  = 'production_rm_sul'
                LIMIT 1
            ) THEN
                -- Find the sulphur RM item for this factory.
                SELECT id INTO v_sul_item_id
                FROM public.stores_stock_items
                WHERE factory_id  = NEW.factory_id
                  AND category     = 'raw_material'
                  AND item_code    = 'SULPHUR'
                  AND is_active    = true
                LIMIT 1;

                IF v_sul_item_id IS NULL THEN
                    RAISE NOTICE 'fn_pulveriser_rm_deduction: no active raw_material item with code "SULPHUR" found for factory % — sulphur deduction skipped. Create item in stores_stock_items.', NEW.factory_id;
                ELSE
                    -- Compute closing balance.
                    SELECT COALESCE(closing_balance, 0) INTO v_prev_closing
                    FROM   public.stores_stock_ledger
                    WHERE  item_id = v_sul_item_id
                    ORDER BY created_at DESC LIMIT 1;

                    v_prev_closing := COALESCE(v_prev_closing, 0);
                    v_new_closing  := v_prev_closing - v_sul_deduct;

                    INSERT INTO public.stores_stock_ledger (
                        factory_id, item_id, transaction_date, transaction_source,
                        qty_received, qty_issued, dispatch_qty, closing_balance,
                        reference_id, reference_type, remark, entered_by
                    ) VALUES (
                        NEW.factory_id,
                        v_sul_item_id,
                        COALESCE(NEW.job_date, current_date),
                        'production_rm_sul',
                        0,
                        v_sul_deduct,
                        0,
                        v_new_closing,
                        NEW.id,
                        'job_card',
                        'Auto: sulphur deduction from job card ' || COALESCE(NEW.job_number, NEW.id::text)
                            || ' · ' || NEW.actual_production_mt::text || ' MT × 1000 × sulphur_ratio '
                            || v_sulphur_ratio::text || ' = ' || v_sul_deduct::text || ' kg',
                        NEW.operator_by
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attach trigger — fires on the same AFTER UPDATE event as migration 028.
-- Both triggers fire for the same status transition; order is alphabetical
-- by trigger name so trg_pulveriser_fg_ledger_entry (028) fires before
-- trg_pulveriser_rm_deduction (this one). Both are independent.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_pulveriser_rm_deduction ON public.pulveriser_job_cards;
CREATE TRIGGER trg_pulveriser_rm_deduction
    AFTER UPDATE ON public.pulveriser_job_cards
    FOR EACH ROW EXECUTE FUNCTION public.fn_pulveriser_rm_deduction();

-- =============================================================================
-- END OF MIGRATION 029
-- New trigger : trg_pulveriser_rm_deduction (AFTER UPDATE on pulveriser_job_cards)
-- New function: fn_pulveriser_rm_deduction  (SECURITY DEFINER)
-- Effect      : On job card finalization, auto-deducts oil (actual_oil_consumption_kg)
--               and sulphur (actual_production_mt * 1000 * sulphur_ratio) from
--               stores_stock_ledger. Both are skipped gracefully if item not seeded
--               or if sulphur_ratio not yet set in vfd_parameters.
-- =============================================================================
