-- =============================================================================
-- Migration 059: Crude Sulphur receipt tracking
--
-- Depends on: 058 (vendors table), 001 (rm_qc, batches), 015/017 (pulveriser_job_cards)
--
-- Changes:
--   1. rm_qc: add vendor_id (FK → vendors), receipt_date (date),
--             quantity_received_mt (numeric) — the JSCI/QC/03 header fields
--             that were never captured in code.
--
--   2. pulveriser_job_cards: add sulphur_source_rm_qc_id (FK → rm_qc.id) —
--             the authoritative link from a job card to the specific receipt
--             lot it draws crude sulphur from. sulphur_supplier, sulphur_lot_number,
--             and sulphur_empty_date are KEPT for backward compatibility and
--             Lab's independent lot labelling; sulphur_source_rm_qc_id is the
--             new preferred link.
--
--   3. v_sulphur_lot_remaining VIEW — Option A (decrement on job card creation
--             using planned_production_mt × sulphur_ratio). Shows remaining MT
--             per rm_qc receipt.
--
-- OPTION A FORMULA:
--   sulphur_draw_per_card = planned_production_mt × sulphur_ratio (from vfd_parameters)
--   quantity_remaining_mt = quantity_received_mt
--                           − SUM(sulphur_draw) for all job cards linked to this receipt
--                             regardless of status (any status except none means
--                             production has committed to drawing from that lot).
--
--   If sulphur_ratio IS NULL for a party_code, that card's draw is treated as 0
--   (the trigger fn_pulveriser_rm_deduction also skips NULL ratio cards). The view
--   will show a NULL draw_mt for those cards so the UI can warn "ratio not set".
--
--   quantity_received_mt IS NULL on old rm_qc rows (before this migration) — the
--   view shows those as NULL remaining (UI: "quantity not recorded").
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend rm_qc
-- ---------------------------------------------------------------------------
ALTER TABLE public.rm_qc
    ADD COLUMN IF NOT EXISTS vendor_id           uuid REFERENCES public.vendors(id),
    ADD COLUMN IF NOT EXISTS receipt_date        date,
    ADD COLUMN IF NOT EXISTS quantity_received_mt numeric(12,3);

COMMENT ON COLUMN public.rm_qc.vendor_id IS
    'FK → vendors.id. The crude sulphur supplier for this receipt.';
COMMENT ON COLUMN public.rm_qc.receipt_date IS
    'Date this batch of crude sulphur was physically received at the factory.';
COMMENT ON COLUMN public.rm_qc.quantity_received_mt IS
    'Quantity received in Metric Tonnes (MT). Needed to calculate remaining stock.';

-- Index for the vendor → available-receipts lookup in the production UI.
CREATE INDEX IF NOT EXISTS idx_rm_qc_vendor_date
    ON public.rm_qc (vendor_id, receipt_date DESC)
    WHERE vendor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Extend pulveriser_job_cards
-- ---------------------------------------------------------------------------
ALTER TABLE public.pulveriser_job_cards
    ADD COLUMN IF NOT EXISTS sulphur_source_rm_qc_id uuid REFERENCES public.rm_qc(id);

COMMENT ON COLUMN public.pulveriser_job_cards.sulphur_source_rm_qc_id IS
    'FK → rm_qc.id. Links this job card to the specific crude sulphur receipt '
    'lot it draws from. Set by Production when creating the card. Used to '
    'calculate remaining quantity in v_sulphur_lot_remaining.';

CREATE INDEX IF NOT EXISTS idx_pulv_jc_sulphur_source
    ON public.pulveriser_job_cards (sulphur_source_rm_qc_id)
    WHERE sulphur_source_rm_qc_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. v_sulphur_lot_remaining — Option A view
--
-- Returns one row per rm_qc receipt that has quantity_received_mt set,
-- showing how much crude sulphur remains available for production to draw.
--
-- Columns:
--   rm_qc_id              — pk of the rm_qc receipt row
--   vendor_id             — FK to vendors
--   vendor_name           — denormalised from vendors for UI display
--   receipt_date          — date received
--   quantity_received_mt  — original received quantity
--   total_planned_draw_mt — SUM of planned draws across all linked job cards
--                           (NULL sulphur_ratio cards contribute 0, not NULL)
--   quantity_remaining_mt — received − drawn  (can go negative if over-allocated)
--   linked_job_card_count — how many job cards are currently drawing from this lot
--   has_null_ratio_cards  — true if any linked card has no sulphur_ratio set
--                           (means draw estimate is incomplete)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_sulphur_lot_remaining;

CREATE VIEW public.v_sulphur_lot_remaining AS
SELECT
    r.id                                                      AS rm_qc_id,
    r.vendor_id,
    v.vendor_name,
    r.receipt_date,
    r.quantity_received_mt,
    -- Sum planned draws. For cards with a NULL sulphur_ratio we use 0 so the
    -- total stays numeric; has_null_ratio_cards flags the incomplete estimate.
    COALESCE(
        SUM(
            CASE
                WHEN vp.sulphur_ratio IS NOT NULL
                THEN jc.planned_production_mt * vp.sulphur_ratio
                ELSE 0
            END
        ),
        0
    )                                                         AS total_planned_draw_mt,
    r.quantity_received_mt - COALESCE(
        SUM(
            CASE
                WHEN vp.sulphur_ratio IS NOT NULL
                THEN jc.planned_production_mt * vp.sulphur_ratio
                ELSE 0
            END
        ),
        0
    )                                                         AS quantity_remaining_mt,
    COUNT(jc.id)                                              AS linked_job_card_count,
    BOOL_OR(
        jc.id IS NOT NULL AND vp.sulphur_ratio IS NULL
    )                                                         AS has_null_ratio_cards
FROM public.rm_qc r
LEFT JOIN public.vendors v
    ON v.id = r.vendor_id
LEFT JOIN public.pulveriser_job_cards jc
    ON jc.sulphur_source_rm_qc_id = r.id
   AND jc.planned_production_mt IS NOT NULL
LEFT JOIN public.vfd_parameters vp
    ON vp.party_code = jc.party_code
   AND vp.machine_type = 'mill'
WHERE r.quantity_received_mt IS NOT NULL
GROUP BY r.id, r.vendor_id, v.vendor_name, r.receipt_date, r.quantity_received_mt;

GRANT SELECT ON public.v_sulphur_lot_remaining TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS update: production_incharge may now UPDATE pulveriser_job_cards to
--    set sulphur_source_rm_qc_id (it's a production-owned column added after
--    the original INSERT policy was written). The existing INSERT policy
--    already allows any column on insert; we need the UPDATE policy to allow
--    writing this new column too.
--    The existing "pulv_jc_update_production" policy (migration 017) covers
--    status IN ('pending','pending_stores') — sulphur_source_rm_qc_id is set
--    at INSERT time so no policy change is needed for the normal flow. The
--    column rides along with the INSERT row, which is already permitted.
-- ---------------------------------------------------------------------------
-- No policy change needed: the new column is written during INSERT (allowed)
-- and the INSERT policy has no column-level restriction.

-- =============================================================================
-- END OF MIGRATION 059
--   rm_qc:                 +vendor_id, +receipt_date, +quantity_received_mt
--   pulveriser_job_cards:  +sulphur_source_rm_qc_id
--   new view:              v_sulphur_lot_remaining  (Option A — planned draw)
-- =============================================================================
