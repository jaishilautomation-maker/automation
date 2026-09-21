-- =============================================================================
-- Migration 041 (A-20/1 project): service_role GRANTs for report generators
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 040.
--
-- Root cause: PostgREST requires an explicit SQL GRANT for a role even when
-- that role is `service_role` (which bypasses RLS, but NOT table grants).
-- Migration 008 granted rm_qc / batch_analysis / product_qc / batches / etc.
-- only to `authenticated`. The new report-generator API routes
-- (generate-rm-qc-report, generate-batch-analysis-report, generate-coa) all
-- use the SUPABASE_SERVICE_ROLE_KEY client, which hit:
--   "permission denied for table rm_qc"
-- exactly the same class of bug already documented and fixed once for
-- qc_exchange_log (016) and notification_log (025).
--
-- This migration grants service_role explicit access to every table read or
-- written by the 3 report-generator routes:
--   rm_qc, rm_receipts, batches, batch_analysis, product_qc, products,
--   materials, profiles, factories, coa_customer_specs, coa_documents.
--
-- service_role is trusted server-side code (never exposed to the browser), so
-- granting broad SELECT/INSERT/UPDATE here does not weaken RLS for the
-- `authenticated` role — those policies are untouched.
--
-- Idempotent: GRANT is safe to re-run.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON public.rm_qc               TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.rm_receipts         TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.batches             TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.batch_analysis      TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.product_qc          TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.products            TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.materials           TO service_role;
GRANT SELECT                 ON public.profiles            TO service_role;
GRANT SELECT                 ON public.factories           TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.qc_test_definitions TO service_role;

-- COA tables (037) — grant explicitly in case they were only granted to
-- `authenticated` when created.
GRANT SELECT, INSERT, UPDATE ON public.coa_customer_specs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.coa_documents      TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.coa_report_seq TO service_role;

-- hourly_readings — read by other Lab QC service-role routes (create-batch);
-- included here for completeness so future report generators don't hit the
-- same class of bug.
GRANT SELECT, INSERT ON public.hourly_readings TO service_role;
