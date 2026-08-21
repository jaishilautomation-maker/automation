-- =============================================================================
-- Migration 008: Grant missing table permissions to the authenticated role
--
-- Problem 1: "permission denied for table factories"
--   Migration 001 created tables but never ran GRANT SELECT on them for the
--   `authenticated` role. Supabase's anon/authenticated roles need explicit
--   GRANT even when RLS policies exist.
--
-- Problem 2: "No module access" on select-module page
--   The user_roles query in ModuleContext uses a join:
--     .from("user_roles").select("..., factories(...)")
--   This is a Supabase PostgREST embedded resource join. PostgREST requires
--   SELECT permission on the joined table (factories) even when the FK exists.
--   Without it, the join silently returns null for the factories column,
--   so accessList ends up empty and the user sees "No module access yet".
--
-- Fix: GRANT SELECT, INSERT, UPDATE on every Lab QC table + factories,
--      and GRANT USAGE on the public schema (required for PostgREST joins).
-- =============================================================================

-- Schema usage (PostgREST requires this)
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Core / auth tables
GRANT SELECT                    ON public.factories           TO authenticated;
GRANT SELECT                    ON public.factory_activities  TO authenticated;
GRANT SELECT, UPDATE            ON public.profiles            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles     TO authenticated;

-- Master data (read by all, write by admins via RLS)
GRANT SELECT                    ON public.materials           TO authenticated;
GRANT SELECT                    ON public.products            TO authenticated;
GRANT SELECT                    ON public.qc_test_definitions TO authenticated;

-- Batch / traceability
GRANT SELECT, INSERT, UPDATE    ON public.batches             TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON public.rm_receipts         TO authenticated;

-- QC result tables
GRANT SELECT, INSERT, UPDATE    ON public.rm_qc               TO authenticated;
GRANT SELECT, INSERT            ON public.hourly_readings     TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON public.batch_analysis      TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON public.product_qc          TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON public.post_production_tests TO authenticated;
GRANT SELECT, INSERT, UPDATE    ON public.lab_trials          TO authenticated;

-- Supporting tables
GRANT SELECT, INSERT, UPDATE    ON public.attachments         TO authenticated;
GRANT SELECT                    ON public.audit_log           TO authenticated;

-- Views (PostgREST needs SELECT on views too)
GRANT SELECT ON public.v_batch_chain          TO authenticated;
GRANT SELECT ON public.v_unified_search       TO authenticated;
GRANT SELECT ON public.v_rm_qc_with_source    TO authenticated;
GRANT SELECT ON public.v_factory_qc_summary   TO authenticated;

-- Sequences (needed for bigserial on audit_log)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
