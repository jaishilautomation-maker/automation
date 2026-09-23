-- =============================================================================
-- Migration 045 — coa_customer_specs + batch_analysis extensions (MoM)
--
-- Part A: coa_customer_specs
--   + party_code       text  (references parties.party_code — the code system
--                             from §0; customer_name kept for back-compat)
--   + target_value     numeric(12,4)  (nullable — some specs give a target,
--                                       e.g. Melting point target 117)
--   + needs_verification boolean DEFAULT false  (flag rows whose source value
--                             was handwritten/OCR-ambiguous; surfaced in UI for
--                             a human to confirm before any COA relies on them)
--
-- Part B: batch_analysis
--   + party_code       text  (the customer/party this batch is being analysed
--                             against — drives the live pass/fail check)
--   + rework_action    enum batch_rework_action (downgrade_grade_b |
--                             reroute_repackaging) — set when a batch fails
-- =============================================================================

-- ─── Part A: coa_customer_specs ───────────────────────────────────────────
ALTER TABLE public.coa_customer_specs
    ADD COLUMN IF NOT EXISTS party_code         text,
    ADD COLUMN IF NOT EXISTS target_value       numeric(12, 4),
    ADD COLUMN IF NOT EXISTS needs_verification  boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_coa_customer_specs_party
    ON public.coa_customer_specs (party_code);

COMMENT ON COLUMN public.coa_customer_specs.party_code IS
    'References parties.party_code — the single party/customer code system. '
    'Preferred over customer_name for new rows.';
COMMENT ON COLUMN public.coa_customer_specs.needs_verification IS
    'TRUE when the seeded value came from a handwritten / OCR-ambiguous source '
    'and must be confirmed against the physical spec sheet before a COA uses it.';

-- ─── Part B: batch_analysis rework enum + columns ─────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_rework_action') THEN
        CREATE TYPE public.batch_rework_action AS ENUM (
            'downgrade_grade_b',    -- reclassify the failed batch as Grade B
            'reroute_repackaging'   -- send back for repackaging / reprocessing
        );
    END IF;
END $$;

ALTER TABLE public.batch_analysis
    ADD COLUMN IF NOT EXISTS party_code    text,
    ADD COLUMN IF NOT EXISTS rework_action public.batch_rework_action;

COMMENT ON COLUMN public.batch_analysis.party_code IS
    'References parties.party_code — the customer/party this batch is analysed '
    'against; drives the live pass/fail comparison vs coa_customer_specs.';
COMMENT ON COLUMN public.batch_analysis.rework_action IS
    'Set only when the batch fails spec: downgrade_grade_b or reroute_repackaging.';

-- =============================================================================
-- END 045
-- =============================================================================
