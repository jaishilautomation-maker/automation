-- =============================================================================
-- A-20 Migration 019: Grant table privileges to service_role
--
-- Problem: a20/001_init_a20.sql granted table privileges only to
--   `authenticated` and `anon`, never to `service_role`. The admin user flow
--   (app/api/admin/users/route.ts and scripts/seed_a20_users.mjs) uses the
--   service-role key, which goes through PostgREST / PostgREST as the Postgres
--   `service_role`. With no grants, every write failed:
--     - "permission denied for table user_roles"
--     - "permission denied for table profiles"
--     - "Database error creating new user"  (new-user trigger insert rolled back)
--
-- Fix: grant service_role full DML on the user-management tables (and the rest
--   of the public schema, to match the A-20/1 project's migration 062).
--   service_role bypasses RLS, so only table grants are needed.
--   Idempotent: safe to re-run.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles   TO service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
