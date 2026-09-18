-- =============================================================================
-- Migration 032: Fix stores_stock_ledger RLS for manual inserts
--
-- PROBLEM:
--   Migration 027 restricted manual INSERT on stores_stock_ledger to only the
--   'stores' role. This blocked:
--     - factory_admin and company_admin from entering RM / Received / Supplied /
--       Daily Production records via the Stores UI
--     - Any authenticated user who is not strictly the 'stores' role but needs
--       to enter stock data (e.g. production_incharge entering RM data)
--
-- FIX:
--   Broaden the INSERT policy so all authenticated users within the correct
--   factory can insert manual rows. The factory_id check already scopes the
--   data correctly — no user can insert rows for a factory they don't belong to.
--
--   The append-only nature (no UPDATE/DELETE policies) is preserved — this
--   migration only relaxes the INSERT role gate.
--
-- Depends on: 027 (stores_stock_ledger, RLS setup).
-- =============================================================================

DROP POLICY IF EXISTS "ssl_insert" ON public.stores_stock_ledger;

CREATE POLICY "ssl_insert" ON public.stores_stock_ledger
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND transaction_source = 'manual'
    );

-- Also grant INSERT to authenticated (was already granted in 027 but
-- re-stated here for clarity / idempotency).
GRANT SELECT, INSERT ON public.stores_stock_ledger TO authenticated;

-- =============================================================================
-- END OF MIGRATION 032
-- Changed : ssl_insert policy -- removed role restriction, kept factory scope
-- Effect  : All authenticated users at their factory can insert manual ledger rows
-- =============================================================================
