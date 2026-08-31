-- =============================================================================
-- Migration 019: Fix pulveriser_job_cards INSERT policy for the new flow
--
-- Migration 015 created pulv_jc_insert with `WITH CHECK (... status = 'pending')`.
-- The VFD/Stores addendum (017) made Production create cards as 'pending_stores'
-- (Production → Stores → Operator), but the INSERT policy was never updated —
-- so every new card fails RLS with:
--   "new row violates row-level security policy for table pulveriser_job_cards"
--
-- This migration repoints the INSERT check to 'pending_stores'. Idempotent.
--
-- (For a fresh DB this is already baked into 017; this standalone file exists so
--  an already-migrated database can apply just the fix.)
--
-- Depends on: 015 (policy), 016b (pending_stores enum value).
-- =============================================================================

DROP POLICY IF EXISTS "pulv_jc_insert" ON public.pulveriser_job_cards;
CREATE POLICY "pulv_jc_insert" ON public.pulveriser_job_cards
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND status = 'pending_stores'
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    );

-- =============================================================================
-- END OF MIGRATION 019
-- =============================================================================
