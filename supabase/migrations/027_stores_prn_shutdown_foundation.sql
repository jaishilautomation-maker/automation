-- =============================================================================
-- Migration 027: Stores Inventory + PRN + Shutdown Log — foundation tables
--
-- Sept 16 meeting scope. Creates all new tables needed before the automation
-- triggers (028, 029, 030) can be added.
--
-- NEW TABLES:
--   stores_stock_items      — master item catalogue (RM / FG / PM categories)
--   stores_stock_ledger     — running stock ledger (one row per transaction)
--   purchase_requisitions   — PRN table (extended with threshold + received_qty)
--   pulveriser_shutdown_logs— per-shift shutdown periods logged by Operator
--
-- NEW COLUMNS on existing tables:
--   vfd_parameters.sulphur_ratio    — sulphur purity fraction (independent of oil_feed_std)
--   stores_stock_items.min_threshold— reorder threshold; triggers auto PRN when
--                                     closing_balance falls below this
--   purchase_requisitions.received_qty — incremental delivery tracking
--
-- IMPORTANT — sulphur_ratio vs oil_feed_std:
--   These are INDEPENDENT. oil_feed_std is the oil dosing ratio (kg oil per kg
--   product). sulphur_ratio is the purity of the sulphur raw material (e.g.
--   0.99 = 99% pure). For R5299: oil_feed_std=0.01 and sulphur purity might be
--   0.99, but that is NOT universal. Lanxess has oil_feed_std=0.02, and its
--   sulphur purity is a separate product spec, not 1-0.02=0.98. All sulphur_ratio
--   values are seeded NULL and MUST be filled by admin before RM auto-deduction
--   will fire for sulphur. The trigger (029) guards on sulphur_ratio IS NOT NULL
--   so the system is safe until the admin populates real values.
--
-- IMPORTANT — stores_stock_items seeding:
--   DO NOT blindly seed from the raw RM sheet. Items like "P Silica" with all-zero
--   activity are flagged by the business as unused/dummy. Confirm the active
--   materials list with the Stores team before seeding. This migration creates the
--   schema only. Seed data belongs in a separate controlled migration once
--   confirmed.
--
-- Depends on: 001 (fn_set_updated_at, fn_audit_log, fn_user_factory_ids),
--             003/004/007 (fn_has_role, app_role enum),
--             017 (vfd_parameters).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.  sulphur_ratio on vfd_parameters (mill rows only, but column is on all)
-- ---------------------------------------------------------------------------
ALTER TABLE public.vfd_parameters
    ADD COLUMN IF NOT EXISTS sulphur_ratio numeric;   -- e.g. 0.99 for 99% pure sulphur

-- No seed values set here intentionally. See header note above.
-- Admin sets these via the VFD parameters admin UI or a future seeding migration
-- once the Stores team confirms actual purity per party_code.

COMMENT ON COLUMN public.vfd_parameters.sulphur_ratio IS
    'Sulphur purity fraction for this party_code (e.g. 0.99 = 99% pure). '
    'Independent of oil_feed_std. NULL = not yet confirmed; RM auto-deduction '
    'for sulphur will not fire until this is set. Set by admin.';

-- ---------------------------------------------------------------------------
-- 2.  Item category enum
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_item_category') THEN
        CREATE TYPE public.stock_item_category AS ENUM (
            'raw_material',     -- RM: Sulphur, Oil, etc.
            'finished_good',    -- FG: packed sulphur product
            'packaging_material'-- PM: bags, liners, etc.
        );
    END IF;
END $$;

-- PRN status enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prn_status') THEN
        CREATE TYPE public.prn_status AS ENUM (
            'draft',            -- being filled by Stores
            'submitted',        -- sent to purchase team
            'approved',         -- purchase team approved
            'ordered',          -- PO raised
            'partial',          -- some qty received, more expected
            'fulfilled',        -- fully received
            'cancelled',        -- cancelled / not needed
            'auto_flagged'      -- auto-created by threshold trigger; needs review
        );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3.  stores_stock_items  — master item catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores_stock_items (
    id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id      uuid                NOT NULL REFERENCES public.factories(id),
    item_code       text                NOT NULL,
    item_name       text                NOT NULL,
    category        public.stock_item_category NOT NULL,
    unit            text                NOT NULL DEFAULT 'kg',   -- kg / bag / pcs etc.
    -- Reorder threshold: when closing_balance < min_threshold, a PRN is
    -- auto-created with status='auto_flagged'. NULL = no auto-PRN for this item.
    min_threshold   numeric,
    hsn_code        text,
    remarks         text,
    is_active       boolean             NOT NULL DEFAULT true,
    created_at      timestamptz         NOT NULL DEFAULT now(),
    updated_at      timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT uq_stores_item_code_factory UNIQUE (factory_id, item_code)
);

DROP TRIGGER IF EXISTS trg_stores_stock_items_updated_at ON public.stores_stock_items;
CREATE TRIGGER trg_stores_stock_items_updated_at
    BEFORE UPDATE ON public.stores_stock_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_stores_stock_items ON public.stores_stock_items;
CREATE TRIGGER trg_audit_stores_stock_items
    AFTER INSERT OR UPDATE OR DELETE ON public.stores_stock_items
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

COMMENT ON COLUMN public.stores_stock_items.min_threshold IS
    'Auto-PRN threshold. When a ledger transaction leaves closing_balance below '
    'this value, a purchase_requisitions row (status=auto_flagged) is created '
    'automatically if no open PRN already exists for this item. NULL = disabled.';

-- ---------------------------------------------------------------------------
-- 4.  stores_stock_ledger  — running ledger (one row per transaction)
--
-- Each row represents ONE transaction:
--   qty_received  > 0: goods received (from supplier delivery or FG production)
--   qty_issued    > 0: goods issued (manual issue slip or auto-deduction from production)
--   dispatch_qty  > 0: finished goods dispatched (Nivas Patil's dispatch entry on FG rows)
--
-- closing_balance is COMPUTED from the prior row's closing_balance:
--   closing_balance = prev_closing + qty_received - qty_issued - dispatch_qty
-- For the first row of an item it equals opening_balance + qty_received - qty_issued - dispatch_qty.
-- The DB does NOT store this as a formula column; the application (or trigger) must
-- compute it correctly on every INSERT. The trigger fn_stores_ledger_auto_balance()
-- in migration 028/029 handles production-sourced rows; manual slip rows are
-- computed by the Stores UI before inserting.
--
-- transaction_source identifies who/what created the row:
--   'manual'            — Stores entered a Material Issue Slip or manual receipt
--   'production_fg'     — auto from job card finalization (FG qty_received)
--   'production_rm_oil' — auto deduction of oil on job card finalization
--   'production_rm_sul' — auto deduction of sulphur on job card finalization
--   'dispatch'          — Nivas Patil's FG dispatch entry
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_transaction_source') THEN
        CREATE TYPE public.ledger_transaction_source AS ENUM (
            'manual',
            'production_fg',
            'production_rm_oil',
            'production_rm_sul',
            'dispatch'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stores_stock_ledger (
    id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id          uuid                        NOT NULL REFERENCES public.factories(id),
    item_id             uuid                        NOT NULL REFERENCES public.stores_stock_items(id),
    transaction_date    date                        NOT NULL DEFAULT current_date,
    transaction_source  public.ledger_transaction_source NOT NULL DEFAULT 'manual',

    -- Exactly one of these should be non-zero per row (enforced by CHECK below).
    -- qty_received and qty_issued cover RM/PM; dispatch_qty is FG only.
    qty_received        numeric                     NOT NULL DEFAULT 0,
    qty_issued          numeric                     NOT NULL DEFAULT 0,
    dispatch_qty        numeric                     NOT NULL DEFAULT 0,

    closing_balance     numeric                     NOT NULL,   -- computed on insert; see above
    reference_id        uuid,           -- optional: job_card_id, PRN id, etc.
    reference_type      text,           -- 'job_card' | 'prn' | 'slip' etc.
    remark              text,
    entered_by          uuid            REFERENCES auth.users(id),
    created_at          timestamptz     NOT NULL DEFAULT now(),

    -- At most one movement column can be non-zero per row (a transaction is
    -- either a receipt, an issue, or a dispatch — not multiple at once).
    CONSTRAINT chk_ledger_single_movement CHECK (
        (CASE WHEN qty_received > 0 THEN 1 ELSE 0 END
       + CASE WHEN qty_issued   > 0 THEN 1 ELSE 0 END
       + CASE WHEN dispatch_qty > 0 THEN 1 ELSE 0 END) <= 1
    ),
    CONSTRAINT chk_ledger_non_negative CHECK (
        qty_received >= 0 AND qty_issued >= 0 AND dispatch_qty >= 0
    )
);

-- No UPDATE / DELETE — ledger rows are append-only (corrections are new rows).
-- Audit trigger still records the inserts.
DROP TRIGGER IF EXISTS trg_audit_stores_stock_ledger ON public.stores_stock_ledger;
CREATE TRIGGER trg_audit_stores_stock_ledger
    AFTER INSERT OR UPDATE OR DELETE ON public.stores_stock_ledger
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE INDEX IF NOT EXISTS idx_stores_ledger_item_date
    ON public.stores_stock_ledger (item_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stores_ledger_factory
    ON public.stores_stock_ledger (factory_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_stores_ledger_reference
    ON public.stores_stock_ledger (reference_id) WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5.  purchase_requisitions  — PRN table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_requisitions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id          uuid            NOT NULL REFERENCES public.factories(id),
    item_id             uuid            NOT NULL REFERENCES public.stores_stock_items(id),
    prn_number          text,           -- human-readable reference, e.g. "PRN-2026-001"
    status              public.prn_status NOT NULL DEFAULT 'draft',

    -- Quantity fields
    po_qty              numeric,        -- quantity requested / ordered
    received_qty        numeric         NOT NULL DEFAULT 0,
    -- pending_qty = po_qty - received_qty  (computed by app, not stored)

    -- Supplier / timing
    preferred_supplier  text,
    required_by_date    date,
    unit_price          numeric,        -- optional estimate

    -- Narrative
    reason              text,           -- why this PRN was raised
    notes               text,

    -- Who did what
    raised_by           uuid            REFERENCES auth.users(id),
    raised_at           timestamptz     NOT NULL DEFAULT now(),
    approved_by         uuid            REFERENCES auth.users(id),
    approved_at         timestamptz,

    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    -- Threshold-breach context (populated when status='auto_flagged')
    auto_flagged_balance numeric,       -- closing_balance that triggered the PRN
    auto_flagged_at      timestamptz
);

DROP TRIGGER IF EXISTS trg_purchase_requisitions_updated_at ON public.purchase_requisitions;
CREATE TRIGGER trg_purchase_requisitions_updated_at
    BEFORE UPDATE ON public.purchase_requisitions
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_purchase_requisitions ON public.purchase_requisitions;
CREATE TRIGGER trg_audit_purchase_requisitions
    AFTER INSERT OR UPDATE OR DELETE ON public.purchase_requisitions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE INDEX IF NOT EXISTS idx_prn_item_status
    ON public.purchase_requisitions (item_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prn_factory_status
    ON public.purchase_requisitions (factory_id, status, created_at DESC);

COMMENT ON COLUMN public.purchase_requisitions.received_qty IS
    'Cumulative qty received against this PRN. Updated incrementally as '
    'deliveries arrive (e.g. 4000 of 10000 received → received_qty=4000, '
    'pending = po_qty - received_qty = 6000). When received_qty >= po_qty '
    'the status should be set to fulfilled.';

COMMENT ON COLUMN public.purchase_requisitions.auto_flagged_balance IS
    'Closing balance at the time this auto_flagged PRN was created. '
    'Provides context to the purchase team about how low stock was.';

-- ---------------------------------------------------------------------------
-- 6.  pulveriser_shutdown_logs  — per-shift shutdown periods
--
-- Operator logs shutdown periods alongside hourly readings. Multiple periods
-- per job card are allowed (e.g. 10:00-12:00 breakdown + 13:00-14:00 power cut).
-- The shift reconciliation check (migration 028) uses these to verify that
-- (shift_duration_hours - sum(shutdown_hours)) ≈ sum(hourly_readings.total_hours).
--
-- start_time / end_time are stored as text matching the CODED hour-meter reading
-- system (same as pulveriser_hourly_readings.start_time/stop_time, migration 020):
--   coded reading 1000 = 10h 00m on the meter
--   duration (coded) = end_reading - start_reading; hours = diff / 100
--
-- reason is free text (e.g. "Mesh clogging", "Power cut" — operator's own words,
-- not a fixed list, because shutdown cause is more varied than low-prod reasons).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pulveriser_shutdown_logs (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_card_id     uuid        NOT NULL REFERENCES public.pulveriser_job_cards(id) ON DELETE CASCADE,
    factory_id      uuid        NOT NULL REFERENCES public.factories(id),
    -- Coded hour-meter readings (same scale as pulveriser_hourly_readings)
    start_time      text        NOT NULL,   -- e.g. "1000" (meter reading at shutdown start)
    end_time        text        NOT NULL,   -- e.g. "1200" (meter reading when restarted)
    -- shutdown_hours = (end_time - start_time) / 100  — computed by app, not stored
    reason          text,                   -- free text; optional
    logged_by       uuid        NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_audit_pulveriser_shutdown_logs ON public.pulveriser_shutdown_logs;
CREATE TRIGGER trg_audit_pulveriser_shutdown_logs
    AFTER INSERT OR UPDATE OR DELETE ON public.pulveriser_shutdown_logs
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE INDEX IF NOT EXISTS idx_shutdown_logs_job_card
    ON public.pulveriser_shutdown_logs (job_card_id, created_at);

-- ---------------------------------------------------------------------------
-- 7.  RLS
-- ---------------------------------------------------------------------------

-- ── stores_stock_items ──────────────────────────────────────────────────────
ALTER TABLE public.stores_stock_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ssi_select" ON public.stores_stock_items;
CREATE POLICY "ssi_select" ON public.stores_stock_items
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- Only admins and stores role can insert/update items.
DROP POLICY IF EXISTS "ssi_insert" ON public.stores_stock_items;
CREATE POLICY "ssi_insert" ON public.stores_stock_items
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['stores','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "ssi_update" ON public.stores_stock_items;
CREATE POLICY "ssi_update" ON public.stores_stock_items
    FOR UPDATE TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids())
           AND fn_has_role(ARRAY['stores','factory_admin','company_admin']::app_role[]))
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()));

-- ── stores_stock_ledger ─────────────────────────────────────────────────────
ALTER TABLE public.stores_stock_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ssl_select" ON public.stores_stock_ledger;
CREATE POLICY "ssl_select" ON public.stores_stock_ledger
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- INSERT only: ledger is append-only. No UPDATE/DELETE policies → those ops
-- are blocked for all authenticated users. Production triggers run SECURITY
-- DEFINER (migration 029) and bypass RLS for auto-deduction rows.
DROP POLICY IF EXISTS "ssl_insert" ON public.stores_stock_ledger;
CREATE POLICY "ssl_insert" ON public.stores_stock_ledger
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['stores','factory_admin','company_admin']::app_role[])
        -- Manual inserts only. Production-sourced rows come through SECURITY
        -- DEFINER triggers and skip this policy.
        AND transaction_source = 'manual'
    );

-- ── purchase_requisitions ───────────────────────────────────────────────────
ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prn_select" ON public.purchase_requisitions;
CREATE POLICY "prn_select" ON public.purchase_requisitions
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

DROP POLICY IF EXISTS "prn_insert" ON public.purchase_requisitions;
CREATE POLICY "prn_insert" ON public.purchase_requisitions
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['stores','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "prn_update" ON public.purchase_requisitions;
CREATE POLICY "prn_update" ON public.purchase_requisitions
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['stores','factory_admin','company_admin']::app_role[])
        -- Cannot edit a fulfilled or cancelled PRN
        AND status NOT IN ('fulfilled','cancelled')
    )
    WITH CHECK (factory_id IN (SELECT fn_user_factory_ids()));

-- ── pulveriser_shutdown_logs ─────────────────────────────────────────────────
ALTER TABLE public.pulveriser_shutdown_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psl_select" ON public.pulveriser_shutdown_logs;
CREATE POLICY "psl_select" ON public.pulveriser_shutdown_logs
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

-- INSERT: operator (and admins) may log shutdowns while the parent card is 'pending'.
DROP POLICY IF EXISTS "psl_insert" ON public.pulveriser_shutdown_logs;
CREATE POLICY "psl_insert" ON public.pulveriser_shutdown_logs
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[])
        AND EXISTS (
            SELECT 1 FROM public.pulveriser_job_cards jc
            WHERE jc.id = pulveriser_shutdown_logs.job_card_id
              AND jc.status = 'pending'
        )
    );

-- DELETE: operator may remove a shutdown log row while the card is still 'pending'
--         (same pattern as hourly readings delete).
DROP POLICY IF EXISTS "psl_delete" ON public.pulveriser_shutdown_logs;
CREATE POLICY "psl_delete" ON public.pulveriser_shutdown_logs
    FOR DELETE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator','factory_admin','company_admin']::app_role[])
        AND EXISTS (
            SELECT 1 FROM public.pulveriser_job_cards jc
            WHERE jc.id = pulveriser_shutdown_logs.job_card_id
              AND jc.status = 'pending'
        )
    );

-- ---------------------------------------------------------------------------
-- 8.  Grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE        ON public.stores_stock_items     TO authenticated;
GRANT SELECT, INSERT                ON public.stores_stock_ledger     TO authenticated;
GRANT SELECT, INSERT, UPDATE        ON public.purchase_requisitions   TO authenticated;
GRANT SELECT, INSERT, DELETE        ON public.pulveriser_shutdown_logs TO authenticated;

-- =============================================================================
-- END OF MIGRATION 027
-- New tables  : stores_stock_items, stores_stock_ledger, purchase_requisitions,
--               pulveriser_shutdown_logs
-- New enums   : stock_item_category, prn_status, ledger_transaction_source
-- New columns : vfd_parameters.sulphur_ratio
-- =============================================================================
