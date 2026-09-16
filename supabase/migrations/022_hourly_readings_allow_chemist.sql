-- =============================================================================
-- Migration 022: Allow chemist / lab_manager to record Hourly Readings
--
-- Problem:
--   In Factory A-20/1, Hourly Reading is a Lab QC activity performed by the
--   chemist (it sits under Lab QC in the app). But the hourly_readings RLS
--   INSERT policy only permitted production roles
--   (operator, production_incharge, factory_admin, company_admin), so a chemist
--   saving an hourly reading hit:
--     "new row violates row-level security policy for table hourly_readings"
--
-- Fix:
--   Align hourly_readings with the other Lab QC tables (batch_analysis,
--   product_qc) by allowing chemist + lab_manager to INSERT, while KEEPING the
--   existing production roles so the activity works under either module.
--   UPDATE (corrections) allows lab_manager/chemist + admins, matching the
--   Lab QC correction pattern.
--
-- Idempotent: policies are dropped and recreated.
-- Run on the A-20/1 Supabase project (hourly_readings is A-20/1 only), and
-- harmless to run on A-20 if the table exists there.
-- =============================================================================

DROP POLICY IF EXISTS "hourly_readings_insert" ON public.hourly_readings;
CREATE POLICY "hourly_readings_insert" ON public.hourly_readings
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'chemist','lab_manager',
            'operator','production_incharge',
            'factory_admin','company_admin'
        ]::app_role[])
    );

DROP POLICY IF EXISTS "hourly_readings_update" ON public.hourly_readings;
CREATE POLICY "hourly_readings_update" ON public.hourly_readings
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY[
            'chemist','lab_manager',
            'factory_admin','company_admin'
        ]::app_role[])
    );
