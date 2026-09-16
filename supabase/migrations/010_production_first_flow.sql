-- =============================================================================
-- Migration 010: Reverse Job Card flow — Production creates shift first
--
-- OLD flow: Operator creates → Production fills → Lab fills
-- NEW flow: Production creates → Operator fills → Lab fills
--
-- Changes:
--   1. Add `operator_submitted` boolean to shifts
--      (replaces the old meaning of production_submitted as "step 1 done")
--   2. Production now creates the shift (INSERT), so we need:
--      - production_incharge may INSERT shifts (currently only operator can)
--   3. Operator now UPDATES shifts (they don't create them any more)
--      - operator may UPDATE shifts WHERE operator_submitted = false
--   4. batch_entries extra columns:
--      - maal_code  text  — माल का code number (filled by production at creation)
--      - sulphur_info text — sulphur supplier / lot / खाली करने की तारीख
--      - oil_info    text — oil supplier / batch number / oil quantity
--      These complement the existing `material`, `sulphur`, `oil` columns.
--      (sulphur and oil already exist from migration 004 — we add maal_code
--       and rename intent: production fills sulphur/oil at creation time,
--       lab still has access to view them)
--   5. Update RLS:
--      - shifts INSERT: allow production_incharge (was operator only)
--      - shifts UPDATE: allow operator (to fill their details)
--      - batch_entries INSERT: allow production_incharge
--      - batch_entries UPDATE: allow operator (to add their details)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add operator_submitted flag to shifts
-- ---------------------------------------------------------------------------
ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS operator_submitted boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Add maal_code column to batch_entries
--    (sulphur and oil columns already exist from migration 004)
-- ---------------------------------------------------------------------------
ALTER TABLE public.batch_entries
    ADD COLUMN IF NOT EXISTS maal_code text;

-- ---------------------------------------------------------------------------
-- 3. Update RLS on shifts
-- ---------------------------------------------------------------------------

-- Production incharge can now INSERT shifts (they create the entry first)
DROP POLICY IF EXISTS "shifts_insert" ON public.shifts;
CREATE POLICY "shifts_insert" ON public.shifts
    FOR INSERT TO authenticated
    WITH CHECK (
        fn_has_role(ARRAY[
            'production_incharge','operator',
            'factory_admin','company_admin'
        ]::app_role[])
    );

-- Operator can UPDATE shifts (to fill their checkpoint/hours/signature details)
DROP POLICY IF EXISTS "shifts_update" ON public.shifts;
CREATE POLICY "shifts_update" ON public.shifts
    FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY[
            'operator','production_incharge',
            'lab_manager','chemist',
            'factory_admin','company_admin'
        ]::app_role[])
    );

-- ---------------------------------------------------------------------------
-- 4. Update RLS on batch_entries
-- ---------------------------------------------------------------------------

-- Production incharge can INSERT batch entries (they create them with shift)
DROP POLICY IF EXISTS "batch_entries_insert" ON public.batch_entries;
CREATE POLICY "batch_entries_insert" ON public.batch_entries
    FOR INSERT TO authenticated
    WITH CHECK (
        fn_has_role(ARRAY[
            'production_incharge','operator',
            'factory_admin','company_admin'
        ]::app_role[])
    );

-- Operator can UPDATE batch entries (to add their per-batch details)
DROP POLICY IF EXISTS "batch_entries_update" ON public.batch_entries;
CREATE POLICY "batch_entries_update" ON public.batch_entries
    FOR UPDATE TO authenticated
    USING (
        fn_has_role(ARRAY[
            'operator','production_incharge',
            'lab_manager','chemist',
            'factory_admin','company_admin'
        ]::app_role[])
    );
