-- =============================================================================
-- Migration 069: Widen the Production edit window for pulveriser job cards
--
-- CONTEXT:
--   Migration 015 defined "pulv_jc_update_production", which let a
--   production_incharge (+ admins) edit a pulveriser_job_cards row ONLY while
--   its status was 'pending'. In practice the Production In-charge needs to be
--   able to correct a card they started a little later in the flow too —
--   before it has been handed to Lab.
--
-- WHAT THIS DOES:
--   Recreates "pulv_jc_update_production" so the editable statuses are:
--     • 'pending_stores'     — just created, waiting for Stores to issue oil
--     • 'pending'            — back with Production/Operator (pre-QC)
--     • 'pending_production' — Lab rejected; sitting in Production's triage
--   These are exactly the pre-QC / Production-owned stages.
--
--   Still EXCLUDED (unchanged, intentionally):
--     • 'submitted_for_qc'   — with Lab; Production must not alter what Lab is
--                              reviewing.
--     • 'finalized'          — locked for everyone (no policy targets it).
--
-- GUARDRAILS (preserved):
--   • factory scope: factory_id must be in the user's factories.
--   • role: production_incharge, factory_admin, company_admin.
--   • NO status escalation: the WITH CHECK constrains the RESULTING status to
--     the SAME editable set, so a Production edit cannot advance a card to
--     'submitted_for_qc' or 'finalized', nor resurrect a finalized card.
--     Advancing to 'submitted_for_qc' remains exclusively the Operator policy's
--     job; 'finalized' remains exclusively the Lab review trigger's job.
--
-- The Operator policy (pulv_jc_update_operator) and all other policies from
-- migration 015 are left untouched.
--
-- Depends on: 015_pulveriser_job_cards.sql.
-- =============================================================================

DROP POLICY IF EXISTS "pulv_jc_update_production" ON public.pulveriser_job_cards;
CREATE POLICY "pulv_jc_update_production" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status IN ('pending_stores', 'pending', 'pending_production')
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    )
    WITH CHECK (
        -- Result must stay within the Production-editable set → no escalation
        -- to submitted_for_qc / finalized through this policy.
        status IN ('pending_stores', 'pending', 'pending_production')
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- =============================================================================
-- END OF MIGRATION 069
-- Effect: production_incharge (+ admins) may now edit a pulveriser job card in
--         any pre-QC stage (pending_stores / pending / pending_production),
--         not just 'pending'. submitted_for_qc and finalized remain read-only
--         to Production, and the policy cannot change a card's status.
-- =============================================================================
