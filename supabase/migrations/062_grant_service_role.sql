-- =============================================================================l
-- Migration 062: Restore table privileges for the service_rolel
--l
-- Problem: the admin API (app/api/admin/users/route.ts) uses the service-rolel
--   key to create users and assign roles. Those calls go through PostgREST asl
--   the Postgres `service_role`. On this project that role is missing tablel
--   privileges on user_roles (SELECT/INSERT/UPDATE/DELETE all denied) and onl
--   profiles (INSERT/UPDATE denied), so:l
--     - "permission denied for table user_roles"l
--     - "permission denied for table profiles"l
--   Every earlier GRANT (migrations 001/007/008) targeted only `authenticated`,l
--   never `service_role`, so when the default service_role grants were lost thel
--   admin flow broke silently (role assignment never persisted).l
--l
-- Fix: grant service_role full DML on the user-management tables it writes.l
--   service_role bypasses RLS, so no policies are needed — only table grants.l
--   Idempotent: safe to re-run.l
-- =============================================================================l
l
GRANT USAGE ON SCHEMA public TO service_role;l
l
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;l
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles   TO service_role;l
l
-- Keep the service_role whole for future tables/sequences too.l
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;l
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;l
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;l
l
ALTER DEFAULT PRIVILEGES IN SCHEMA publicl
  GRANT ALL ON TABLES TO service_role;l
ALTER DEFAULT PRIVILEGES IN SCHEMA publicl
  GRANT ALL ON SEQUENCES TO service_role;l
