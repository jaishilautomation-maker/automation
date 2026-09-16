-- =============================================================================
-- Migration 007: Fix infinite recursion in user_roles RLS policies
-- Problem: policies on user_roles used EXISTS (SELECT 1 FROM user_roles ...)
--          which recurses into itself (Postgres error 42P17).
--          This is the same class of bug fixed for batch_entries in 004.
-- Fix: replace every self-referencing check with fn_has_role(), which is
--      SECURITY DEFINER and bypasses RLS when it queries user_roles.
-- =============================================================================

-- Ensure fn_has_role exists (safe to re-run)
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

-- ---------------------------------------------------------------------------
-- Drop the recursive policies from 001_initial_schema.sql
-- ---------------------------------------------------------------------------

-- profiles
DROP POLICY IF EXISTS "profiles_select_admin"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"    ON public.profiles;

-- user_roles (the main offenders)
DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_insert"       ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update"       ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete"       ON public.user_roles;

-- factory_activities (used EXISTS (SELECT 1 FROM user_roles ...))
DROP POLICY IF EXISTS "factory_activities_insert" ON public.factory_activities;
DROP POLICY IF EXISTS "factory_activities_update" ON public.factory_activities;

-- factories
DROP POLICY IF EXISTS "factories_insert" ON public.factories;
DROP POLICY IF EXISTS "factories_update" ON public.factories;

-- materials / products / qc_test_definitions (FOR ALL policies)
DROP POLICY IF EXISTS "materials_write"            ON public.materials;
DROP POLICY IF EXISTS "products_write"             ON public.products;
DROP POLICY IF EXISTS "qc_test_definitions_write"  ON public.qc_test_definitions;

-- ---------------------------------------------------------------------------
-- Re-create all dropped policies using fn_has_role()
-- ---------------------------------------------------------------------------

-- profiles: admin read
CREATE POLICY "profiles_select_admin" ON public.profiles
    FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- profiles: own update (no recursion risk here but re-add for completeness)
CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid());

-- user_roles: admin read
CREATE POLICY "user_roles_select_admin" ON public.user_roles
    FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- user_roles: grant (only admins may insert new role rows)
CREATE POLICY "user_roles_insert" ON public.user_roles
    FOR INSERT TO authenticated
    WITH CHECK (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- user_roles: update (only admins)
CREATE POLICY "user_roles_update" ON public.user_roles
    FOR UPDATE TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- user_roles: revoke (only company_admin)
CREATE POLICY "user_roles_delete" ON public.user_roles
    FOR DELETE TO authenticated
    USING (fn_has_role(ARRAY['company_admin']::app_role[]));

-- factory_activities: write
CREATE POLICY "factory_activities_insert" ON public.factory_activities
    FOR INSERT TO authenticated
    WITH CHECK (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

CREATE POLICY "factory_activities_update" ON public.factory_activities
    FOR UPDATE TO authenticated
    USING (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- factories: write
CREATE POLICY "factories_insert" ON public.factories
    FOR INSERT TO authenticated
    WITH CHECK (fn_has_role(ARRAY['company_admin']::app_role[]));

CREATE POLICY "factories_update" ON public.factories
    FOR UPDATE TO authenticated
    USING (fn_has_role(ARRAY['company_admin']::app_role[]));

-- materials
CREATE POLICY "materials_write" ON public.materials
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- products
CREATE POLICY "products_write" ON public.products
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- qc_test_definitions
CREATE POLICY "qc_test_definitions_write" ON public.qc_test_definitions
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['company_admin','factory_admin']::app_role[]));

-- ---------------------------------------------------------------------------
-- Also fix the Lab QC table policies that have the same recursion risk.
-- In 001 they used EXISTS (SELECT 1 FROM user_roles WHERE ... role IN (...))
-- directly. Replace write-path checks with fn_has_role().
-- ---------------------------------------------------------------------------

-- batches INSERT check
DROP POLICY IF EXISTS "batches_insert" ON public.batches;
CREATE POLICY "batches_insert" ON public.batches
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','operator','production_incharge',
                              'factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "batches_update" ON public.batches;
CREATE POLICY "batches_update" ON public.batches
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- rm_receipts
DROP POLICY IF EXISTS "rm_receipts_insert" ON public.rm_receipts;
CREATE POLICY "rm_receipts_insert" ON public.rm_receipts
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','operator','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "rm_receipts_update" ON public.rm_receipts;
CREATE POLICY "rm_receipts_update" ON public.rm_receipts
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- rm_qc
DROP POLICY IF EXISTS "rm_qc_insert" ON public.rm_qc;
CREATE POLICY "rm_qc_insert" ON public.rm_qc
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "rm_qc_update" ON public.rm_qc;
CREATE POLICY "rm_qc_update" ON public.rm_qc
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- hourly_readings
DROP POLICY IF EXISTS "hourly_readings_insert" ON public.hourly_readings;
CREATE POLICY "hourly_readings_insert" ON public.hourly_readings
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['operator','production_incharge',
                              'factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "hourly_readings_update" ON public.hourly_readings;
CREATE POLICY "hourly_readings_update" ON public.hourly_readings
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- batch_analysis
DROP POLICY IF EXISTS "batch_analysis_insert" ON public.batch_analysis;
CREATE POLICY "batch_analysis_insert" ON public.batch_analysis
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "batch_analysis_update" ON public.batch_analysis;
CREATE POLICY "batch_analysis_update" ON public.batch_analysis
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- product_qc
DROP POLICY IF EXISTS "product_qc_insert" ON public.product_qc;
CREATE POLICY "product_qc_insert" ON public.product_qc
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "product_qc_update" ON public.product_qc;
CREATE POLICY "product_qc_update" ON public.product_qc
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- post_production_tests
DROP POLICY IF EXISTS "post_production_insert" ON public.post_production_tests;
CREATE POLICY "post_production_insert" ON public.post_production_tests
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "post_production_update" ON public.post_production_tests;
CREATE POLICY "post_production_update" ON public.post_production_tests
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- lab_trials
DROP POLICY IF EXISTS "lab_trials_insert" ON public.lab_trials;
CREATE POLICY "lab_trials_insert" ON public.lab_trials
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "lab_trials_update" ON public.lab_trials;
CREATE POLICY "lab_trials_update" ON public.lab_trials
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- attachments
DROP POLICY IF EXISTS "attachments_insert" ON public.attachments;
CREATE POLICY "attachments_insert" ON public.attachments
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','operator','production_incharge',
                              'lab_manager','factory_admin','company_admin']::app_role[])
    );

DROP POLICY IF EXISTS "attachments_update" ON public.attachments;
CREATE POLICY "attachments_update" ON public.attachments
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

-- audit_log SELECT (company_admin OR factory-scoped lab_manager/factory_admin)
DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
    FOR SELECT TO authenticated
    USING (
        fn_has_role(ARRAY['company_admin']::app_role[])
        OR (
            factory_id IN (SELECT fn_user_factory_ids())
            AND fn_has_role(ARRAY['lab_manager','factory_admin']::app_role[])
        )
    );

-- Grant table access to authenticated role (idempotent)
GRANT SELECT, INSERT, UPDATE ON public.user_roles TO authenticated;
