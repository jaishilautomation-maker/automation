-- =============================================================================
-- Migration 023: Phone + WhatsApp OTP login
--
-- 1. Add phone_number (E.164, unique) to profiles.
--    - This is the authoritative login identifier — populated by the seed script
--      and by the admin provisioning flow.  The existing `phone` column (nullable,
--      informal) is kept for backward compatibility but is no longer used for auth.
--    - UNIQUE constraint allows the auth-context lookup:
--        SELECT id FROM profiles WHERE phone_number = $1
--
-- 2. Create otp_notification_log — append-only proof-of-submission trail.
--    Written by the /api/auth/sms-hook endpoint each time Supabase fires
--    the Send SMS Hook.  No UPDATE or DELETE is permitted (mirroring audit_log).
--    Phone is stored masked (last 4 digits only) so the log is safe to share
--    without leaking full numbers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.phone_number
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS phone_number text;

-- Create the unique index only if it doesn't already exist.
-- Using IF NOT EXISTS on CREATE UNIQUE INDEX (Postgres 9.5+).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename  = 'profiles'
          AND indexname  = 'profiles_phone_number_key'
    ) THEN
        CREATE UNIQUE INDEX profiles_phone_number_key
            ON public.profiles (phone_number);
    END IF;
END $$;

-- Backfill: copy existing `phone` values into `phone_number` where it is not
-- already set.  Safe to run multiple times (NULLs are excluded from the unique
-- constraint, so duplicate NULLs are fine).
UPDATE public.profiles
SET    phone_number = phone
WHERE  phone IS NOT NULL
  AND  phone_number IS NULL;

-- ---------------------------------------------------------------------------
-- 2. otp_notification_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.otp_notification_log (
    id              bigserial   PRIMARY KEY,
    -- Phone last-4 only — safe to store in plain text
    phone_masked    text        NOT NULL,
    -- Full E.164 stored hashed (SHA-256 hex) so we can deduplicate without
    -- exposing the real number
    phone_hash      text        NOT NULL,
    success         boolean     NOT NULL,
    -- HTTP status returned by Interakt (NULL on network error)
    provider_status integer,
    -- Raw provider response body (trimmed to 512 chars)
    provider_msg    text,
    -- 'whatsapp_template' is the only provider right now; field future-proofs
    provider        text        NOT NULL DEFAULT 'whatsapp_interakt',
    factory_code    text,       -- NEXT_PUBLIC_FACTORY_CODE from env, for multi-app triage
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Block all writes except from the service-role (SECURITY DEFINER) path in
-- the API route, mirroring the audit_log pattern.
-- RLS is enabled but we only add a SELECT policy for admins; INSERT is done
-- via the service-role client which bypasses RLS entirely.
ALTER TABLE public.otp_notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "otp_log_select_admin" ON public.otp_notification_log;
CREATE POLICY "otp_log_select_admin" ON public.otp_notification_log
    FOR SELECT TO authenticated
    USING (fn_has_role(ARRAY['company_admin', 'factory_admin']::app_role[]));

-- No UPDATE / DELETE policies → hard-blocked for all authenticated roles.

-- Grant for the authenticated role (SELECT only; INSERT comes from service role)
GRANT SELECT ON public.otp_notification_log TO authenticated;

-- Index for time-range queries (admin triage, last N attempts)
CREATE INDEX IF NOT EXISTS otp_notification_log_created_at_idx
    ON public.otp_notification_log (created_at DESC);

-- Index for per-number lookup (admin checking delivery for a specific user)
CREATE INDEX IF NOT EXISTS otp_notification_log_phone_hash_idx
    ON public.otp_notification_log (phone_hash);
