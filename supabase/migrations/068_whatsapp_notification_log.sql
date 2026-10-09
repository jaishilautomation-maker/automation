-- =============================================================================
-- Migration 068: WhatsApp job-card notification log + recipient-resolution RPC
-- (Renamed from 064 to avoid a number clash with the upstream
--  064_packaging_material_unit_nos.sql merged from origin/main. If you already
--  ran this on Supabase under the old number, no re-run is needed — the objects
--  are created with IF NOT EXISTS / CREATE OR REPLACE and are idempotent.)
--
-- Context: after each Pulveriser (A-20/1) job-card stage transition, a WhatsApp
-- message is sent (via Interakt) to the NEXT role in line. This is a pure
-- side-effect bolted onto the existing email path — no workflow/status/routing
-- logic changes. These objects support that feature:
--
--   1. whatsapp_notification_log — one row per (transition, recipient) send
--      attempt. Separate from notification_log (which is email-only, no
--      per-recipient granularity and no idempotency key). Never stores a full
--      phone number — only the last 4 digits.
--
--   2. UNIQUE (event_key, recipient_user_id) — idempotency. event_key is the id
--      of the specific transition (a review row id for Lab steps, or a
--      job_card_id + stage-timestamp composite for the others). A double-click /
--      retry of the SAME transition collides on this key and is skipped; a
--      legitimate new rework pass carries a different event_key and sends again.
--
--   3. fn_jobcard_notify_recipients(p_factory_id, p_role) — SECURITY DEFINER
--      resolver. Returns { user_id, full_name, phone_number } for all users
--      holding the given role at the given factory who have a non-null
--      phone_number. Modelled on fn_operator_names (063). The WhatsApp sender
--      runs server-side with the service-role key (RLS-bypassing) so it could
--      query directly, but this function keeps the "who gets notified" rule in
--      one place and is safe to expose if ever called with the anon key.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. whatsapp_notification_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_notification_log (
    id                  bigserial   PRIMARY KEY,
    job_card_id         uuid        REFERENCES public.pulveriser_job_cards(id) ON DELETE SET NULL,
    -- Stable identifier of the specific status transition this send belongs to.
    -- Lab steps: the pulveriser_job_card_reviews.id. Other steps: a composite
    -- "<job_card_id>:<target_status>:<stage_timestamp>". Differs per rework pass
    -- but is identical across a double-click of the same transition.
    event_key           text        NOT NULL,
    -- Which workflow event fired this (mirrors notify eventType), e.g.
    -- 'pulveriser_production', 'pulveriser_stores', 'pulveriser_operator',
    -- 'pulveriser_lab', 'pulveriser_production_triage'.
    event_type          text        NOT NULL,
    recipient_user_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    -- Last 4 digits only — never store or log the full number.
    phone_last4         text,
    template            text        NOT NULL,
    status              text        NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
    provider_message_id text,
    error               text,
    factory_id          uuid        REFERENCES public.factories(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: one send per (transition, recipient). A retry of the SAME
-- transition is blocked by this; a new rework pass has a different event_key.
-- Note: 'skipped' rows (kill switch / allowlist / no phone) also occupy the
-- key, which is intentional — re-running the same transition should not later
-- turn a skip into a send without a genuinely new transition.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_notify_event_recipient
    ON public.whatsapp_notification_log (event_key, recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_notify_job_card
    ON public.whatsapp_notification_log (job_card_id, created_at DESC);

-- Written exclusively server-side via SUPABASE_SERVICE_ROLE_KEY. Enable RLS
-- with NO policies: this denies all anon/authenticated access by default while
-- the service-role key (used by the sender) bypasses RLS entirely. This is
-- strictly safer than a grant-only table and satisfies the Supabase RLS lint.
-- (notification_log in migration 025 predates this convention and is grant-only;
--  mirroring it here but with RLS on, since there's no client read path.)
ALTER TABLE public.whatsapp_notification_log ENABLE ROW LEVEL SECURITY;

-- PostgREST still needs explicit grants even with RLS on (service_role is not
-- exempt from the GRANT layer, only from the RLS policy layer).
GRANT SELECT, INSERT ON public.whatsapp_notification_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_notification_log_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- 2. fn_jobcard_notify_recipients — resolve role + factory → phone numbers
-- ---------------------------------------------------------------------------
-- Returns active users holding p_role at factory p_factory_id who have a phone.
-- company_admin rows (factory_id IS NULL = all factories) are intentionally NOT
-- auto-included — the job-card roles (stores, operator, chemist, lab_manager,
-- production_incharge) are always factory-scoped. If an admin must be notified,
-- grant them the specific factory-scoped role.
CREATE OR REPLACE FUNCTION public.fn_jobcard_notify_recipients(
    p_factory_id uuid,
    p_role       public.app_role
)
RETURNS TABLE (user_id uuid, full_name text, phone_number text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT DISTINCT p.id, p.full_name, p.phone_number
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = p_role
      AND ur.factory_id = p_factory_id
      AND p.phone_number IS NOT NULL
      AND btrim(p.phone_number) <> '';
$$;

-- Callable by the service role (server-side sender). Also grant authenticated
-- in case it is ever called client-side; the body only exposes phone numbers of
-- co-workers at the same factory for the given role, consistent with 063.
GRANT EXECUTE ON FUNCTION public.fn_jobcard_notify_recipients(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_jobcard_notify_recipients(uuid, public.app_role) TO authenticated;
