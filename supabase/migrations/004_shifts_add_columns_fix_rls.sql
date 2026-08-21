-- Migration 004: add missing columns to shifts, fix batch_entries RLS recursion
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. New columns on shifts
--    factory_id          : ties the shift to a factory (arch §3)
--    production_user_id  : who filled in the production step
--    lab_user_id         : who filled in the lab/QC step
--    planned / actual / bags / batch_no / reason : production-step fields
--    sig_production / sig_qc : remaining signature columns
--    production_user_id and lab_user_id are nullable — they're filled in later

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS factory_id          uuid REFERENCES public.factories(id),
    ADD COLUMN IF NOT EXISTS production_user_id  uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS lab_user_id         uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS planned             numeric(10,2),
    ADD COLUMN IF NOT EXISTS actual              numeric(10,2),
    ADD COLUMN IF NOT EXISTS bags                numeric(10,2),
    ADD COLUMN IF NOT EXISTS batch_no            text,
    ADD COLUMN IF NOT EXISTS reason              text,
    ADD COLUMN IF NOT EXISTS sig_production      text,
    ADD COLUMN IF NOT EXISTS sig_qc              text;

-- 2. Extra columns batch_entries needs for the lab page
ALTER TABLE public.batch_entries
    ADD COLUMN IF NOT EXISTS sulphur   text,
    ADD COLUMN IF NOT EXISTS oil       text,
    ADD COLUMN IF NOT EXISTS bag       text,
    ADD COLUMN IF NOT EXISTS packing   text,
    ADD COLUMN IF NOT EXISTS qc        text,
    ADD COLUMN IF NOT EXISTS stores    text;

-- 3. fn_has_role — already created in 003 but repeated here with
--    CREATE OR REPLACE so this migration is safe to run on a fresh DB too.
CREATE OR REPLACE FUNCTION fn_has_role(required_roles app_role[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
          AND role = ANY(required_roles)
    );
$$;

-- 4. Fix batch_entries RLS — the original policies used an EXISTS subquery
--    on shifts which itself hits user_roles and causes infinite recursion.
--    Replace with fn_has_role for admin paths.

DROP POLICY IF EXISTS "batch_entries_select" ON public.batch_entries;
DROP POLICY IF EXISTS "batch_entries_insert" ON public.batch_entries;

-- Operators see their own shift's batch entries
CREATE POLICY "batch_entries_select_own" ON public.batch_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shifts
            WHERE shifts.id = batch_entries.shift_id
              AND shifts.user_id = auth.uid()
        )
    );

-- Admins / production / lab see all batch entries
CREATE POLICY "batch_entries_select_admin" ON public.batch_entries
    FOR SELECT TO authenticated
    USING (
        fn_has_role(ARRAY['company_admin','factory_admin',
                          'production_incharge','lab_manager','chemist']::app_role[])
    );

-- Only the operator who owns the shift may insert batch entries
CREATE POLICY "batch_entries_insert" ON public.batch_entries
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shifts
            WHERE shifts.id = batch_entries.shift_id
              AND shifts.user_id = auth.uid()
        )
    );

-- Lab / production / admin may update batch entries (lab QC fill-in step)
CREATE POLICY "batch_entries_update" ON public.batch_entries
    FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY['company_admin','factory_admin',
                          'production_incharge','lab_manager','chemist']::app_role[])
    );

-- 5. Also grant UPDATE on shifts to authenticated so production/lab pages
--    can write back their fields.
GRANT SELECT, INSERT, UPDATE ON public.shifts        TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.batch_entries TO authenticated;
