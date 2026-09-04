-- =============================================================================
-- Migration 025: notification_log
--
-- General-purpose email notification log. Every attempt to send an email
-- (success or failure) is appended here. Never truncated — use for audit,
-- replay, and debugging. No RLS needed (server-only writes via service role).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.notification_log (
    id           bigserial    PRIMARY KEY,
    event_type   text         NOT NULL,   -- e.g. 'pulveriser_production', 'lab_qc_rm_receipt'
    subject      text         NOT NULL,
    recipients   text[]       NOT NULL,
    success      boolean      NOT NULL,
    error_msg    text,                    -- null on success
    factory_id   uuid         REFERENCES public.factories(id),
    reference_id text,                   -- free-form: job card id, breakdown id, etc.
    created_at   timestamptz  NOT NULL DEFAULT now()
);

-- Index for lookups by factory + event type
CREATE INDEX IF NOT EXISTS idx_notification_log_factory_event
    ON public.notification_log (factory_id, event_type, created_at DESC);

-- No RLS — this table is written exclusively via the SUPABASE_SERVICE_ROLE_KEY
-- from server-side API routes. The anon key cannot read or write it.
