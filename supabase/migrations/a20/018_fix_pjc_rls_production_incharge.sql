-- =============================================================================
-- A-20 Migration 018: Fix production_job_cards RLS — add production_incharge
-- =============================================================================
--
-- Problem:
--   The pjc_insert and pjc_update policies created in migration 002 only
--   include ['operator','factory_admin','company_admin'].
--   The production_incharge role (the primary user of this module) was
--   omitted, causing "new row violates row-level security policy" on INSERT.
--
-- Fix:
--   Drop both policies and recreate them with production_incharge included.
-- =============================================================================

-- INSERT policy
DROP POLICY IF EXISTS "pjc_insert" ON public.production_job_cards;
CREATE POLICY "pjc_insert" ON public.production_job_cards
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['production_incharge','operator','factory_admin','company_admin']::app_role[])
    );

-- UPDATE policy
DROP POLICY IF EXISTS "pjc_update" ON public.production_job_cards;
CREATE POLICY "pjc_update" ON public.production_job_cards
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['production_incharge','operator','factory_admin','company_admin']::app_role[])
    );

-- Also fix production_job_card_items (same omission)
DROP POLICY IF EXISTS "pjci_insert" ON public.production_job_card_items;
CREATE POLICY "pjci_insert" ON public.production_job_card_items
    FOR INSERT TO authenticated
    WITH CHECK (
        fn_has_role(ARRAY['production_incharge','operator','factory_admin','company_admin']::app_role[])
        AND job_card_id IN (
            SELECT id FROM public.production_job_cards
            WHERE factory_id IN (SELECT fn_user_factory_ids())
        )
    );

DROP POLICY IF EXISTS "pjci_update" ON public.production_job_card_items;
CREATE POLICY "pjci_update" ON public.production_job_card_items
    FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY['production_incharge','operator','factory_admin','company_admin']::app_role[])
        AND job_card_id IN (
            SELECT id FROM public.production_job_cards
            WHERE factory_id IN (SELECT fn_user_factory_ids())
        )
    );
