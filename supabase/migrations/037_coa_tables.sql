-- =============================================================================
-- Migration 037 (A-20/1 project): COA (Certificate of Analysis) Tables
--
-- Run on the Factory A-20/1 Supabase project (dezwaxrtxpszxsmrxpkm) — the same
-- project as root migrations 001–033. Must run AFTER 036 (needs the
-- SULPHUR_POWDER_FG product it creates).
--
-- Two new tables:
--
-- 1. coa_customer_specs
--    Stores per-customer specification limits for each test parameter.
--    When a COA is generated, actual results are pulled from product_qc and
--    compared against the customer's spec range from this table.
--
-- 2. coa_documents
--    One row per generated COA. Links to the source product_qc record, stores
--    dispatch metadata (invoice, vehicle, etc.) and the generated PDF URL.
--    test_report_no is auto-sequenced via a SEQUENCE.
--
-- RLS:
--   SELECT   — all authenticated users (factory-scoped via factory_id)
--   INSERT   — chemist / lab_manager / factory_admin / company_admin
--   UPDATE   — lab_manager / factory_admin / company_admin
--
-- A sequence (coa_report_seq) provides incrementing test_report_no values.
-- The API route uses nextval() to claim a number before inserting.
-- =============================================================================

-- ─── Sequence for auto-incrementing test report number ────────────────────
CREATE SEQUENCE IF NOT EXISTS public.coa_report_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO CYCLE;

GRANT USAGE ON SEQUENCE public.coa_report_seq TO authenticated;

-- ─── 1. coa_customer_specs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coa_customer_specs (
    id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name  text    NOT NULL,
    -- The parameter key must match a test_key in qc_test_definitions so the
    -- COA generator can map actual results to customer spec limits.
    parameter      text    NOT NULL,
    -- Human-readable label for the COA table (may differ from qc_test_definitions.label)
    parameter_label text   NOT NULL,
    unit           text,
    min_value      numeric(12, 4),   -- NULL = no minimum limit
    max_value      numeric(12, 4),   -- NULL = no maximum limit
    -- Optional: restrict spec to a specific product code (NULL = applies to all)
    product_code   text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid REFERENCES auth.users(id),
    UNIQUE (customer_name, parameter, product_code)
);

CREATE INDEX IF NOT EXISTS idx_coa_customer_specs_customer
    ON public.coa_customer_specs (customer_name);

ALTER TABLE public.coa_customer_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa_specs_select" ON public.coa_customer_specs;
DROP POLICY IF EXISTS "coa_specs_write"  ON public.coa_customer_specs;

CREATE POLICY "coa_specs_select" ON public.coa_customer_specs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "coa_specs_write" ON public.coa_customer_specs
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[]));

GRANT SELECT, INSERT, UPDATE ON public.coa_customer_specs TO authenticated;

-- ─── 2. coa_documents ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coa_documents (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source QC record
    product_qc_id   uuid        NOT NULL REFERENCES public.product_qc(id) ON DELETE RESTRICT,
    factory_id      uuid        NOT NULL REFERENCES public.factories(id),

    -- Customer / dispatch info
    customer_name   text        NOT NULL,
    customer_address text,
    test_report_no  integer     NOT NULL DEFAULT nextval('public.coa_report_seq'),

    -- Dispatch details (collected at time of COA generation)
    lot_no          text,
    batch_no        text,
    qty             text,          -- e.g. "25 MT", "500 bags" — free text
    invoice_no      text,
    vehicle_no      text,
    mfg_date        date,

    -- PDF artifact
    pdf_url         text,          -- Supabase Storage signed URL or path
    pdf_storage_path text,         -- raw path in the storage bucket

    -- Metadata
    generated_at    timestamptz NOT NULL DEFAULT now(),
    generated_by    uuid        NOT NULL REFERENCES auth.users(id),

    -- Track if the email was sent
    email_sent_at   timestamptz,
    sheet_synced_at timestamptz,

    UNIQUE (test_report_no)   -- one canonical report number per row
);

CREATE INDEX IF NOT EXISTS idx_coa_docs_product_qc
    ON public.coa_documents (product_qc_id);
CREATE INDEX IF NOT EXISTS idx_coa_docs_factory
    ON public.coa_documents (factory_id);
CREATE INDEX IF NOT EXISTS idx_coa_docs_customer
    ON public.coa_documents (customer_name);

ALTER TABLE public.coa_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa_docs_select" ON public.coa_documents;
DROP POLICY IF EXISTS "coa_docs_insert" ON public.coa_documents;
DROP POLICY IF EXISTS "coa_docs_update" ON public.coa_documents;

CREATE POLICY "coa_docs_select" ON public.coa_documents
    FOR SELECT TO authenticated
    USING (factory_id IN (SELECT fn_user_factory_ids()));

CREATE POLICY "coa_docs_insert" ON public.coa_documents
    FOR INSERT TO authenticated
    WITH CHECK (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['chemist','lab_manager','factory_admin','company_admin']::app_role[])
    );

CREATE POLICY "coa_docs_update" ON public.coa_documents
    FOR UPDATE TO authenticated
    USING (
        factory_id IN (SELECT fn_user_factory_ids())
        AND fn_has_role(ARRAY['lab_manager','factory_admin','company_admin']::app_role[])
    );

GRANT SELECT, INSERT, UPDATE ON public.coa_documents TO authenticated;

-- ─── Audit trigger ────────────────────────────────────────────────────────
-- IMPORTANT: fn_audit_log() reads NEW.factory_id / OLD.factory_id, so the audit
-- trigger can ONLY be attached to tables that have a factory_id column.
--
--   coa_documents      → HAS factory_id  → audited (below).
--   coa_customer_specs → NO  factory_id  → NOT audited. It is a global
--                        reference table (like materials / products /
--                        qc_test_definitions, which are also un-audited for
--                        the same reason). Attaching the trigger here would
--                        raise: 42703 record "new" has no field "factory_id".
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_audit_coa_documents'
    ) THEN
        CREATE TRIGGER trg_audit_coa_documents
        AFTER INSERT OR UPDATE OR DELETE ON public.coa_documents
        FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
    END IF;
END;
$$;

-- Safety net: if a previous partial run already created the invalid trigger on
-- coa_customer_specs, remove it so re-running this migration succeeds.
DROP TRIGGER IF EXISTS trg_audit_coa_customer_specs ON public.coa_customer_specs;

-- ─── Seed: common customer specs for Sulphur Powder ──────────────────────
-- These are example entries matching the MRF / Dalmia style specs visible on
-- the paper COA form. Update with actual customer-provided values.
INSERT INTO public.coa_customer_specs
    (customer_name, parameter, parameter_label, unit, min_value, max_value, product_code)
VALUES
    -- MRF example specs
    ('MRF Tyres',       'purity_result',        'Purity in CS2',          '%',   98.0,  NULL,  'SULPHUR_POWDER_FG'),
    ('MRF Tyres',       'acidity_result',        'Acidity as H2SO4',       '%',   NULL,  0.010, 'SULPHUR_POWDER_FG'),
    ('MRF Tyres',       'ash_result',            'Ash Content',            '%',   NULL,  0.10,  'SULPHUR_POWDER_FG'),
    ('MRF Tyres',       'hl70_result',           'Heat Loss (70°C/2hr)',   '%',   NULL,  0.30,  'SULPHUR_POWDER_FG'),
    ('MRF Tyres',       'mesh200_result',        'Mesh Size (200 mesh)',   '%',   98.0,  NULL,  'SULPHUR_POWDER_FG'),
    ('MRF Tyres',       'colour_appearance',     'Appearance',             NULL,  NULL,  NULL,  'SULPHUR_POWDER_FG'),
    -- Dalmia example specs
    ('Dalmia',          'purity_result',         'Purity in CS2',          '%',   98.0,  NULL,  'SULPHUR_POWDER_FG'),
    ('Dalmia',          'acidity_result',        'Acidity as H2SO4',       '%',   NULL,  0.010, 'SULPHUR_POWDER_FG'),
    ('Dalmia',          'ash_result',            'Ash Content',            '%',   NULL,  0.10,  'SULPHUR_POWDER_FG'),
    ('Dalmia',          'hl70_result',           'Heat Loss (70°C/2hr)',   '%',   NULL,  0.30,  'SULPHUR_POWDER_FG'),
    ('Dalmia',          'mesh200_result',        'Mesh Size (200 mesh)',   '%',   98.0,  NULL,  'SULPHUR_POWDER_FG'),
    ('Dalmia',          'colour_appearance',     'Appearance',             NULL,  NULL,  NULL,  'SULPHUR_POWDER_FG')
ON CONFLICT (customer_name, parameter, product_code) DO NOTHING;

-- Migration 037 complete: coa_customer_specs and coa_documents tables created.
