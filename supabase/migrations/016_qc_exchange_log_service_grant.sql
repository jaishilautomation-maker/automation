-- =============================================================================
-- Migration 016: Explicit table privileges for qc_exchange_log
--
-- Context:
--   The QC exchange send/retry API routes write to qc_exchange_log using the
--   Supabase service-role key. Normally service_role bypasses RLS, but a
--   "permission denied for table qc_exchange_log" error appears when the
--   configured key is not truly service_role, or when the role lacks a
--   SQL-level GRANT. Migration 014 only granted SELECT to `authenticated`.
--
--   This migration makes the write privileges explicit for service_role (and
--   keeps authenticated read-only for the audit UI). It is idempotent and safe
--   to run on the A-20/1 Supabase project.
--
--   NOTE: this does NOT fix a wrong key in SUPABASE_SERVICE_ROLE_KEY — if the
--   env var holds the anon key, set it to the real service_role secret in the
--   A-20/1 Vercel project. This migration only ensures the role, once correct,
--   has the necessary table privileges.
-- =============================================================================

-- service_role: full write access for the exchange API routes.
GRANT SELECT, INSERT, UPDATE ON public.qc_exchange_log TO service_role;

-- authenticated: read-only (audit UI). Re-assert from migration 014.
GRANT SELECT ON public.qc_exchange_log TO authenticated;
