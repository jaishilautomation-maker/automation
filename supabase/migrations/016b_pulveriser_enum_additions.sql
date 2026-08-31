-- =============================================================================
-- Migration 016b: Enum additions for the Pulveriser VFD / Stores addendum
--
-- Kept SEPARATE from 017 on purpose. Postgres does not allow a value added by
-- `ALTER TYPE ... ADD VALUE` to be USED in the same transaction that added it.
-- Because the Supabase migration runner wraps each file in a single
-- transaction, the new labels must be committed by this file BEFORE 017
-- references them (in seed data comparisons, CHECKs, and RLS policies).
--
-- Both additions are guarded against re-runs via a pg_enum catalog check.
--
-- Depends on: 001 (app_role), 015 (pulveriser_status).
-- =============================================================================

-- New role: stores  (fourth A-20/1 pulveriser role — issues oil to the batch).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'app_role' AND e.enumlabel = 'stores'
    ) THEN
        ALTER TYPE public.app_role ADD VALUE 'stores';
    END IF;
END $$;

-- New job card status: pending_stores
-- (Production has filled the card; awaiting Stores to issue oil before the
--  Operator can run the batch.) Placed after 'pending' — order is cosmetic.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'pulveriser_status' AND e.enumlabel = 'pending_stores'
    ) THEN
        ALTER TYPE public.pulveriser_status ADD VALUE 'pending_stores' AFTER 'pending';
    END IF;
END $$;

-- =============================================================================
-- END OF MIGRATION 016b
-- =============================================================================
