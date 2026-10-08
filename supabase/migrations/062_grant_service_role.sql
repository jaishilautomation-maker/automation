-- =============================================================================
-- Migration 062: Restore table privileges for the service_role
--
-- Problem: the admin API (app/api/admin/users/route.ts) uses the service-role
--   key to create users and assign roles. Those calls go through PostgREST as
--   the Postgres `service_role`. On this project that role is missing table
--   privileges on user_roles (SELECT/INSERT/UPDATE/DELETE all denied) and on
--   profiles (INSERT/UPDATE denied), so:
--     - "permission denied for table user_roles"
--     - "permission denied for table profiles"
--   Every earlier GRANT (migrations 001/007/008) targeted only `authenticated`,
--   never `service_role`, so when the default service_role grants were lost the
--   admin flow broke silently (role assignment never persisted).
--
-- Fix: grant service_role full DML on the user-management tables it writes.
--   service_role bypasses RLS, so no policies are needed — only table grants.
--   Idempotent: safe to re-run.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles   TO service_role;

-- Keep the service_role whole for future tables/sequences too.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
