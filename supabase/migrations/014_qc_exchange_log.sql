-- =============================================================================
-- Migration 014: QC Exchange Log (A-20/1 side)
--
-- When a QC record in A-20/1 is finalized, a row is inserted here.
-- The send API route reads SYNC_PENDING rows and POSTs them to A-20's
-- receive endpoint. Failures are retried by the cron route with backoff.
--
-- This table is on the A-20/1 Supabase project only.
-- A-20 has a separate `qc_imports` table (see migrations/a20/001_init_a20.sql).
--
-- Design principles:
--   - Finalization NEVER blocks on send failure (send is async, fire-and-forget
--     for the UI, retried by cron in the background).
--   - Every send attempt is logged (attempt_count, last_attempted_at, last_error).
--   - Successful sends flip status to SYNC_SENT and record sent_at.
--   - Max 5 attempts; after that status = SYNC_FAILED (requires manual review).
-- =============================================================================

CREATE TABLE public.qc_exchange_log (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which QC table and record triggered this exchange
    source_table        text        NOT NULL,
    -- 'product_qc' | 'rm_qc' | 'batch_analysis'
    source_record_id    uuid        NOT NULL,

    factory_id          uuid        NOT NULL REFERENCES public.factories(id),

    -- Full QC record snapshot at the time of finalization.
    -- Stored so the send route has everything it needs without joining back.
    payload             jsonb       NOT NULL,

    -- Sync state machine
    status              text        NOT NULL DEFAULT 'SYNC_PENDING',
    -- SYNC_PENDING → SYNC_SENT (success)
    -- SYNC_PENDING → SYNC_FAILED (after max retries)

    attempt_count       integer     NOT NULL DEFAULT 0,
    last_attempted_at   timestamptz,
    last_error          text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    sent_at             timestamptz,

    -- Idempotency: one exchange log row per source record
    UNIQUE (source_table, source_record_id)
);

-- Index for the retry cron job (queries SYNC_PENDING + SYNC_FAILED in order)
CREATE INDEX idx_qc_exchange_pending
    ON public.qc_exchange_log (status, created_at)
    WHERE status IN ('SYNC_PENDING', 'SYNC_FAILED');

-- ---------------------------------------------------------------------------
-- RLS
-- RLS is enabled but the send/retry API routes run with the service-role
-- key server-side and bypass RLS. The policies below prevent client-side
-- reads/writes from leaking exchange state or payload data.
-- ---------------------------------------------------------------------------
ALTER TABLE public.qc_exchange_log ENABLE ROW LEVEL SECURITY;

-- Only factory_admin and company_admin can read the exchange log (audit)
CREATE POLICY "qc_exchange_log_select" ON public.qc_exchange_log
    FOR SELECT TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['factory_admin','company_admin']::app_role[])
    );

-- INSERT/UPDATE via service role only (API routes) — no authenticated policy

-- ---------------------------------------------------------------------------
-- GRANT (service role bypasses RLS, but authenticated needs SELECT for audit UI)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.qc_exchange_log TO authenticated;
