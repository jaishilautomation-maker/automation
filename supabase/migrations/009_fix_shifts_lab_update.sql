-- =============================================================================
-- Migration 009: Allow chemist and lab_manager to UPDATE shifts
--
-- Problem: shifts_update policy in 003 only includes production_incharge,
--          factory_admin, company_admin. chemist and lab_manager are missing.
--          When a lab user submits /lab, the UPDATE to set lab_submitted=true
--          and lab_user_id silently writes 0 rows (RLS blocks it without error).
--          The shift stays pending and never appears as submitted.
-- =============================================================================

DROP POLICY IF EXISTS "shifts_update" ON public.shifts;

CREATE POLICY "shifts_update" ON public.shifts
    FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY[
            'company_admin',
            'factory_admin',
            'production_incharge',
            'lab_manager',
            'chemist'
        ]::app_role[])
    );
