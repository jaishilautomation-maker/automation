-- =============================================================================
-- Migration 047: Allow UPDATE on stores_stock_ledger for manually entered rows
--
-- PROBLEM:
--   stores_stock_ledger was designed append-only (migration 027). No UPDATE
--   policy exists, so any .update() call from the Stores UI returns
--   "permission denied for table stores_stock_ledger".
--
--   The Stores Daily Production Edit feature (and future edit flows for
--   Received, Supplied, etc.) needs to update the remark JSON and
--   transaction_date on rows the user originally entered.
--
-- FIX:
--   Add an UPDATE RLS policy that allows authenticated users to update rows:
--     - In a factory they belong to (factory_id IN fn_user_factory_ids())
--     - That were inserted as 'manual' entries (transaction_source = 'manual')
--     - That they themselves entered (entered_by = auth.uid())
--
--   Auto-deduction rows (transaction_source = 'production_rm_oil',
--   'production_rm_sul', 'production_fg') are inserted by SECURITY DEFINER
--   triggers and remain non-updatable by app users.
--
-- Depends on: 027 (stores_stock_ledger, RLS), 032 (relaxed insert policy).
-- =============================================================================

-- Allow authenticated users to update their own manual ledger entries
DROP POLICY IF EXISTS "ssl_update" ON public.stores_stock_ledger;

CREATE POLICY "ssl_update" ON public.stores_stock_ledger
    FOR UPDATE TO authenticated
    USING (
        factory_id       IN (SELECT fn_user_factory_ids())
        AND transaction_source = 'manual'
        AND entered_by        = auth.uid()
    )
    WITH CHECK (
        factory_id       IN (SELECT fn_user_factory_ids())
        AND transaction_source = 'manual'
        AND entered_by        = auth.uid()
    );

-- Grant the UPDATE privilege to authenticated (was not granted in 027/032)
GRANT UPDATE ON public.stores_stock_ledger TO authenticated;

-- =============================================================================
-- END OF MIGRATION 047
-- New policy : ssl_update — authenticated users can update their own manual rows
-- Effect     : Stores edit flow (Daily Production, Received, etc.) can now
--              call .update() on rows they entered. Trigger-inserted rows
--              (production auto-deductions) remain immutable from the app layer.
-- =============================================================================
