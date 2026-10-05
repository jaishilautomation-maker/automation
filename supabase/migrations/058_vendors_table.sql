-- =============================================================================
-- Migration 058: vendors table
--
-- Tracks supplier/vendor master data. Scoped by vendor_type so it can grow
-- to cover oil, packaging etc. in future without schema changes.
-- Only crude_sulphur vendors are seeded now.
--
-- Referenced by:
--   rm_qc.vendor_id            (migration 059) — who supplied the receipt
--   pulveriser_job_cards.sulphur_source_rm_qc_id → rm_qc.vendor_id (indirect)
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_type') THEN
        CREATE TYPE public.vendor_type AS ENUM (
            'crude_sulphur',
            'oil',
            'other'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vendors (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_name text        NOT NULL,
    vendor_type public.vendor_type NOT NULL DEFAULT 'crude_sulphur',
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_vendor_name_type UNIQUE (vendor_name, vendor_type)
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read; only admins can write.
DROP POLICY IF EXISTS "vendors_select" ON public.vendors;
CREATE POLICY "vendors_select" ON public.vendors
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "vendors_write" ON public.vendors;
CREATE POLICY "vendors_write" ON public.vendors
    FOR ALL TO authenticated
    USING     (fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]))
    WITH CHECK(fn_has_role(ARRAY['factory_admin','company_admin']::app_role[]));

GRANT SELECT, INSERT, UPDATE ON public.vendors TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed: 9 crude sulphur vendors (exact names from the spec)
-- ---------------------------------------------------------------------------
INSERT INTO public.vendors (vendor_name, vendor_type) VALUES
    ('Bharat Petroleum Corporation Ltd.',          'crude_sulphur'),
    ('Devansh Chemicals',                          'crude_sulphur'),
    ('Dossa Chemicals Pvt. Ltd',                   'crude_sulphur'),
    ('Gulf Fertilizers and Chemicals FZE',         'crude_sulphur'),
    ('Hindustan Petroleum Corporation Ltd.',       'crude_sulphur'),
    ('Jaishil Sulphur & Chemical Inds.-A/20/1',    'crude_sulphur'),
    ('M/S SETCO TRADING FZE',                      'crude_sulphur'),
    ('SUPERFORM CHEMISTRIES LIMITED (CR.)',         'crude_sulphur'),
    ('Zolfo Impex',                                'crude_sulphur')
ON CONFLICT (vendor_name, vendor_type) DO NOTHING;

-- =============================================================================
-- END OF MIGRATION 058
-- =============================================================================
