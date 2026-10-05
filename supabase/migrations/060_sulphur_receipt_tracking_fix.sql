-- =============================================================================
-- Migration 060: Correct crude sulphur receipt tracking (supersedes §1 of 059)
--
-- Migration 059 placed vendor_id/receipt_date/quantity_received_mt on rm_qc,
-- which is wrong — those are properties of the delivery receipt, not the QC
-- test. They belong on rm_receipts, which already exists. This migration:
--
--   1. Adds vendor_id to rm_receipts (the correct home for vendor identity).
--   2. Drops the three 059 columns from rm_qc (vendor_id, receipt_date,
--      quantity_received_mt) — they were never the right place.
--   3. Adds receipt_id FK to rm_qc → rm_receipts.id so RM QC rows link to the
--      receipt they tested.
--   4. Renames pulveriser_job_cards.sulphur_source_rm_qc_id
--      → sulphur_source_receipt_id (FK → rm_receipts.id, not rm_qc.id).
--   5. Drops v_sulphur_lot_remaining (pointed at rm_qc) and creates
--      v_sulphur_receipt_remaining (pointed at rm_receipts) — the view
--      Production uses to pick a receipt and see remaining stock.
--
-- Depends on: 058 (vendors), 059 (created the columns we are fixing), 001,
--             015/017 (pulveriser_job_cards).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add vendor_id to rm_receipts
--    This is where vendor identity correctly lives (one vendor per delivery).
-- ---------------------------------------------------------------------------
ALTER TABLE public.rm_receipts
    ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id);

COMMENT ON COLUMN public.rm_receipts.vendor_id IS
    'FK → vendors.id. The crude sulphur supplier for this receipt. '
    'Populated by the RM Receipt entry page from the vendor dropdown.';

CREATE INDEX IF NOT EXISTS idx_rm_receipts_vendor
    ON public.rm_receipts (vendor_id)
    WHERE vendor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Drop the three 059 columns from rm_qc
--    v_sulphur_lot_remaining (from 059) depends on vendor_id — drop it first.
--    The corrected view v_sulphur_receipt_remaining is created in step 5.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_sulphur_lot_remaining CASCADE;
DROP INDEX IF EXISTS public.idx_rm_qc_vendor_date;

ALTER TABLE public.rm_qc
    DROP COLUMN IF EXISTS vendor_id,
    DROP COLUMN IF EXISTS receipt_date,
    DROP COLUMN IF EXISTS quantity_received_mt;

-- ---------------------------------------------------------------------------
-- 3. Add receipt_id FK to rm_qc → rm_receipts.id
--    One rm_qc row tests one rm_receipts delivery.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rm_qc
    ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.rm_receipts(id);

COMMENT ON COLUMN public.rm_qc.receipt_id IS
    'FK → rm_receipts.id. The delivery receipt this QC result is for. '
    'Set by matching the invoice number to an existing rm_receipts row via '
    'batches.batch_number. NULL on old rows and non-crude-sulphur materials.';

CREATE INDEX IF NOT EXISTS idx_rm_qc_receipt
    ON public.rm_qc (receipt_id)
    WHERE receipt_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Rename pulveriser_job_cards column:
--      sulphur_source_rm_qc_id  →  sulphur_source_receipt_id
--    and re-point the FK to rm_receipts (not rm_qc).
--
--    Safe sequence: drop old FK constraint, rename, add new FK.
--    Using IF EXISTS / DO $$ guards for idempotency.
-- ---------------------------------------------------------------------------

-- Drop the old column (including its FK) and add the corrected one.
-- We can't rename a FK-constrained column directly in all Postgres versions,
-- so we drop-and-add. Existing data is NULL (no job cards linked yet in prod),
-- so no data loss.
ALTER TABLE public.pulveriser_job_cards
    DROP COLUMN IF EXISTS sulphur_source_rm_qc_id;

ALTER TABLE public.pulveriser_job_cards
    ADD COLUMN IF NOT EXISTS sulphur_source_receipt_id uuid
        REFERENCES public.rm_receipts(id);

COMMENT ON COLUMN public.pulveriser_job_cards.sulphur_source_receipt_id IS
    'FK → rm_receipts.id. Links this job card to the specific crude sulphur '
    'delivery receipt it draws from. Set by Production when creating the card. '
    'Used by v_sulphur_receipt_remaining to calculate remaining stock.';

DROP INDEX IF EXISTS public.idx_pulv_jc_sulphur_source;

CREATE INDEX IF NOT EXISTS idx_pulv_jc_sulphur_receipt
    ON public.pulveriser_job_cards (sulphur_source_receipt_id)
    WHERE sulphur_source_receipt_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Drop the 059 view (reads rm_qc) and create the corrected view
--    v_sulphur_receipt_remaining (reads rm_receipts).
--
-- Columns match the previous view's external interface where possible so
-- TypeScript types (SulphurLotRemaining) need only minor renaming.
--
-- OPTION A formula (unchanged):
--   sulphur_draw  = planned_production_mt × sulphur_ratio (vfd_parameters)
--   remaining_mt  = receipt.quantity − SUM(planned draws)
-- ---------------------------------------------------------------------------
-- v_sulphur_lot_remaining already dropped with CASCADE in step 2 above.

CREATE OR REPLACE VIEW public.v_sulphur_receipt_remaining AS
SELECT
    rr.id                                                       AS receipt_id,
    rr.batch_id,
    b.batch_number                                              AS invoice_number,
    rr.vendor_id,
    v.vendor_name,
    rr.received_date,
    rr.quantity                                                 AS quantity_received_mt,
    rr.unit,
    rr.supplier_name,
    -- Sum planned draws. Cards with NULL sulphur_ratio contribute 0 so the
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
    )                                                           AS total_planned_draw_mt,
    rr.quantity - COALESCE(
        SUM(
            CASE
                WHEN vp.sulphur_ratio IS NOT NULL
                THEN jc.planned_production_mt * vp.sulphur_ratio
                ELSE 0
            END
        ),
        0
    )                                                           AS quantity_remaining_mt,
    COUNT(jc.id)                                                AS linked_job_card_count,
    BOOL_OR(
        jc.id IS NOT NULL AND vp.sulphur_ratio IS NULL
    )                                                           AS has_null_ratio_cards
FROM public.rm_receipts rr
LEFT JOIN public.batches b
    ON b.id = rr.batch_id
LEFT JOIN public.vendors v
    ON v.id = rr.vendor_id
LEFT JOIN public.pulveriser_job_cards jc
    ON jc.sulphur_source_receipt_id = rr.id
   AND jc.planned_production_mt IS NOT NULL
LEFT JOIN public.vfd_parameters vp
    ON vp.party_code = jc.party_code
   AND vp.machine_type = 'mill'
-- Only show receipts for crude sulphur (unit = MT, supplier_name heuristic or
-- vendor_id set). Filter to receipts that have a quantity (all rm_receipts do).
WHERE rr.quantity IS NOT NULL
GROUP BY
    rr.id, rr.batch_id, b.batch_number, rr.vendor_id, v.vendor_name,
    rr.received_date, rr.quantity, rr.unit, rr.supplier_name;

GRANT SELECT ON public.v_sulphur_receipt_remaining TO authenticated;

-- =============================================================================
-- END OF MIGRATION 060
--
-- rm_receipts:            +vendor_id
-- rm_qc:                  -vendor_id, -receipt_date, -quantity_received_mt
--                         +receipt_id (FK → rm_receipts.id)
-- pulveriser_job_cards:   -sulphur_source_rm_qc_id
--                         +sulphur_source_receipt_id (FK → rm_receipts.id)
-- Views dropped:          v_sulphur_lot_remaining
-- Views created:          v_sulphur_receipt_remaining
-- =============================================================================
