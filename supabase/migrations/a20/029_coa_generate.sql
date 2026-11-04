-- =============================================================================
-- A-20 Migration 029: Generate COA tab
--
-- Run on the Factory A-20 Supabase project, AFTER 028.
--
-- Adds what the Lab "Generate COA" tab needs:
--   1. coa_report_seq + fn_coa_claim_report_no / fn_coa_peek_next_report_no
--      (atomic Test Report No., optional typed number)
--   2. coa_documents  - one row per issued COA, with an immutable JSONB snapshot
--      (the PDF is always re-rendered from the snapshot)
--   3. notification_log - email attempt log (written by sendEmail via service
--      role). Created only if this project does not have it yet.
--
-- Purely additive. Does not touch product_qc, batches or any job-card table.
-- =============================================================================

BEGIN;

-- ─── 1. Report number sequence ──────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.coa_report_seq START WITH 1 INCREMENT BY 1;

-- Next number that will be handed out (without consuming it).
CREATE OR REPLACE FUNCTION public.fn_coa_peek_next_report_no()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END
    FROM public.coa_report_seq;
$$;

-- Claim a number. NULL = next from the sequence. A typed number is honoured and
-- the sequence is advanced past it so later automatic numbers never collide.
-- UNIQUE(test_report_no) on coa_documents remains the final guard.
CREATE OR REPLACE FUNCTION public.fn_coa_claim_report_no(p_requested bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next bigint;
BEGIN
    IF p_requested IS NULL THEN
        RETURN nextval('public.coa_report_seq');
    END IF;
    IF p_requested <= 0 THEN
        RAISE EXCEPTION 'Test Report No. must be positive';
    END IF;
    SELECT public.fn_coa_peek_next_report_no() INTO v_next;
    IF p_requested >= v_next THEN
        PERFORM setval('public.coa_report_seq', p_requested, true);
    END IF;
    RETURN p_requested;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_coa_peek_next_report_no()        TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_coa_claim_report_no(bigint)      TO service_role;

-- ─── 2. coa_documents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coa_documents (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    test_report_no  bigint       NOT NULL UNIQUE,
    factory_id      uuid         NOT NULL REFERENCES public.factories(id),
    product_code    text         NOT NULL,
    product_name    text         NOT NULL,
    batch_no        text         NOT NULL,
    invoice_no      text,
    invoice_date    text,
    lorry_no        text,
    qty             text,
    mfg_date        date,
    snapshot        jsonb        NOT NULL,
    generated_by    uuid         REFERENCES auth.users(id),
    created_by      uuid         REFERENCES auth.users(id),
    generated_at    timestamptz  NOT NULL DEFAULT now(),
    email_status    text,                      -- 'sent' | 'failed' | NULL (pending)
    email_error     text,
    email_sent_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_coa_docs_factory_no
    ON public.coa_documents (factory_id, test_report_no DESC);
CREATE INDEX IF NOT EXISTS idx_coa_docs_batch
    ON public.coa_documents (factory_id, batch_no);

ALTER TABLE public.coa_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa_docs_select" ON public.coa_documents;
CREATE POLICY "coa_docs_select" ON public.coa_documents
    FOR SELECT TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[])
    );

-- Writes happen only through the server API (service role bypasses RLS).
GRANT SELECT ON public.coa_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.coa_documents TO service_role;

-- Immutability: after insert only the email_* columns may change. Corrections
-- are a brand-new COA with a new number.
CREATE OR REPLACE FUNCTION public.fn_coa_documents_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF  NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.test_report_no IS DISTINCT FROM OLD.test_report_no
     OR NEW.factory_id     IS DISTINCT FROM OLD.factory_id
     OR NEW.product_code   IS DISTINCT FROM OLD.product_code
     OR NEW.product_name   IS DISTINCT FROM OLD.product_name
     OR NEW.batch_no       IS DISTINCT FROM OLD.batch_no
     OR NEW.invoice_no     IS DISTINCT FROM OLD.invoice_no
     OR NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date
     OR NEW.lorry_no       IS DISTINCT FROM OLD.lorry_no
     OR NEW.qty            IS DISTINCT FROM OLD.qty
     OR NEW.mfg_date       IS DISTINCT FROM OLD.mfg_date
     OR NEW.snapshot       IS DISTINCT FROM OLD.snapshot
     OR NEW.generated_by   IS DISTINCT FROM OLD.generated_by
     OR NEW.created_by     IS DISTINCT FROM OLD.created_by
     OR NEW.generated_at   IS DISTINCT FROM OLD.generated_at
    THEN
        RAISE EXCEPTION
            'coa_documents is immutable: only email_status / email_error / email_sent_at may change (test_report_no %).',
            OLD.test_report_no
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coa_documents_immutable ON public.coa_documents;
CREATE TRIGGER trg_coa_documents_immutable
    BEFORE UPDATE ON public.coa_documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_coa_documents_immutable();

-- ─── 3. notification_log (email attempts) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_log (
    id           bigserial    PRIMARY KEY,
    event_type   text         NOT NULL,
    subject      text         NOT NULL,
    recipients   text[]       NOT NULL,
    success      boolean      NOT NULL,
    error_msg    text,
    factory_id   uuid         REFERENCES public.factories(id),
    reference_id text,
    created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_factory_event
    ON public.notification_log (factory_id, event_type, created_at DESC);
GRANT SELECT, INSERT ON public.notification_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.notification_log_id_seq TO service_role;

-- Service role must be able to read the QC tables the COA is built from.
GRANT SELECT ON public.product_qc, public.product_qc_specs, public.batches,
                public.products, public.factories TO service_role;

-- >>> TO CONTINUE A PAPER REGISTER: set the last paper Test Report No., e.g.
-- >>>   SELECT setval('public.coa_report_seq', 12, true);   -- next COA = 13

COMMIT;
