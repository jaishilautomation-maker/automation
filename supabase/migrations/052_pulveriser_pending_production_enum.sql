-- =============================================================================
-- Migration 052: Add 'pending_production' status to pulveriser_status enum.
--
-- New rejection flow (per 29-09-26 follow-up):
--   Lab NOT OK  →  card goes to Production for TRIAGE (pending_production).
--   Production decides whether it's a Stores issue or an Operator issue and
--   routes the card to 'pending_stores' (re-issue oil) or 'pending' (operator
--   re-run) accordingly. It then flows back to Lab for final approval.
--
-- Postgres requires a freshly-added enum value to be committed before it can be
-- USED (in a trigger body / DEFAULT / comparison). So this ALTER TYPE lives in
-- its OWN migration file; migration 053 defines the trigger + RLS that use it.
-- =============================================================================

ALTER TYPE public.pulveriser_status ADD VALUE IF NOT EXISTS 'pending_production' AFTER 'pending_stores';

-- =============================================================================
-- END OF MIGRATION 052
-- =============================================================================
