-- =============================================================================
-- Migration 053: Route Lab "NOT OK" to Production triage, not straight to Stores.
--
-- Depends on migration 052 (adds the 'pending_production' enum value).
--
-- Changes:
--   1. Redefine fn_pulveriser_apply_review so a NOT-OK review sends the card to
--      'pending_production' (Production triage) instead of 'pending_stores'.
--      OK path (→ 'finalized') is unchanged.
--   2. Add a Production RLS UPDATE policy allowing production_incharge (+admins)
--      to act on a 'pending_production' card and route it to EITHER
--      'pending_stores' (stores issue → re-issue oil) or 'pending' (operator
--      issue → operator re-runs). The existing 7a policy is left intact for the
--      normal draft/create flow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Review status-transition trigger: NOT OK → pending_production
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pulveriser_apply_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.result = 'ok' THEN
        UPDATE public.pulveriser_job_cards
        SET    status = 'finalized'
        WHERE  id = NEW.job_card_id
          AND  status = 'submitted_for_qc';
    ELSE  -- 'not_ok' → Production triage first
        UPDATE public.pulveriser_job_cards
        SET    status = 'pending_production'
        WHERE  id = NEW.job_card_id
          AND  status = 'submitted_for_qc';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Production triage RLS — act on a rejected card and route it onward.
--    USING gates the rows Production may touch; WITH CHECK constrains the
--    status they may leave the row in:
--      pending_production → pending_stores  (stores issue)
--      pending_production → pending         (operator issue; oil already issued)
--      pending_production → pending_production (save without deciding yet)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pulv_jc_triage_production" ON public.pulveriser_job_cards;
CREATE POLICY "pulv_jc_triage_production" ON public.pulveriser_job_cards
    FOR UPDATE TO authenticated
    USING (
        status = 'pending_production'
        AND factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'production_incharge', 'factory_admin', 'company_admin'
        ]::app_role[])
    )
    WITH CHECK (
        status IN ('pending_production', 'pending_stores', 'pending')
        AND factory_id IN (SELECT fn_user_factory_ids())
    );

-- =============================================================================
-- END OF MIGRATION 053
--   Trigger fn_pulveriser_apply_review: NOT OK now → pending_production.
--   New policy pulv_jc_triage_production lets Production route rejected cards.
-- =============================================================================
