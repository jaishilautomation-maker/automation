-- =============================================================================
-- Migration 054 (A-20/1 project): service_role GRANTs for the job-card report
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm), AFTER 053.
--
-- The job-card Excel report generator (generate-filled-report.ts, source
-- "job_card") reads the pulveriser job-card tables via the
-- SUPABASE_SERVICE_ROLE_KEY client. Same class of bug already fixed for the lab
-- tables in migration 041: PostgREST needs an explicit GRANT for service_role
-- even though it bypasses RLS. Without these the generator hits
--   "permission denied for table pulveriser_job_cards".
--
-- Read-only is sufficient (the report only reads). Idempotent.
-- =============================================================================

GRANT SELECT ON public.pulveriser_job_cards        TO service_role;
GRANT SELECT ON public.pulveriser_hourly_readings  TO service_role;
GRANT SELECT ON public.pulveriser_job_card_reviews TO service_role;

-- Migration 054 complete: service_role can read the job-card tables for reports.
