-- =============================================================================
-- Migration 044 — `parties` master table (single source of party/customer codes)
--
-- Per the MoM + 13 customer spec sheets: the "Party Code" used in
-- vfd_parameters (Ceat R5299, M2615, Apollo 160108, LANXESS, JKI-108, ...) is
-- the SAME code system used for:
--   - the Production Job Card party dropdown (pulveriser_job_cards.party_code)
--   - the new Batch Analysis party selector
--   - the COA customer spec sheets (coa_customer_specs.party_code)
--
-- This table consolidates them into ONE master list. It is deliberately the
-- single place party codes live; vfd_parameters.party_code and
-- coa_customer_specs.party_code both reference party_code here.
--
-- We do NOT add a hard FK from vfd_parameters (it predates this table and has
-- its own (party_code, machine_type) uniqueness with 2 rows per code); instead
-- parties is seeded FROM the distinct codes already in vfd_parameters so the
-- two stay consistent, and new selectors read from parties.
--
-- Factory-agnostic master data (no factory_id) — same treatment as
-- vfd_parameters / materials / products: no fn_audit_log trigger.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.parties (
    id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    party_code    text    NOT NULL UNIQUE,
    customer_name text,                 -- human-friendly name; may match party_code initially
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed from the distinct party codes already present in vfd_parameters.
-- customer_name defaults to the code itself; update with real customer names
-- as they are confirmed from the spec sheets (migration for seeding specs will
-- also upsert customer_name where the sheet gives a clearer name).
-- ---------------------------------------------------------------------------
INSERT INTO public.parties (party_code, customer_name)
SELECT DISTINCT party_code, party_code
FROM public.vfd_parameters
ON CONFLICT (party_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS: readable by all authenticated; writable by admins only (master data).
-- ---------------------------------------------------------------------------
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parties_select" ON public.parties;
DROP POLICY IF EXISTS "parties_write"  ON public.parties;

CREATE POLICY "parties_select" ON public.parties
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "parties_write" ON public.parties
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]));

GRANT SELECT, INSERT, UPDATE ON public.parties TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.parties TO service_role;

-- =============================================================================
-- END 044
-- =============================================================================
