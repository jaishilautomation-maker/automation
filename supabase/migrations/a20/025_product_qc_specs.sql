-- =============================================================================
-- A-20 Migration 025: Product QC Specs — pass/fail indicators
--
-- Creates product_qc_specs table and seeds specifications from the COA PDFs
-- supplied by the company (JSCI batch analysis certificates, Aug–Sep 2026).
--
-- Sources (mark all as needs_verification = false — taken directly from COAs):
--   Zinc SC           → Zinc oxide 39.15% SC COA (batch JS-04020, 28-08-2026)
--   Sulphur SC        → Sulphur 55.16%SC COA (batch JS-01028, 2 Sep 2026)
--   Liquid Boron      → Boron Ethanolamine COA (batch JS-05013, 15-09-2026)
--   Liquid Calcium    → Concentrated liquid calcium 11% COA (batch JS-06020, 22-08-2026)
--   Ziddi             → Tebuconazole 10% + Sulphur 65% WDG COA (batch JS-03024, 27-08-2026)
--
-- Note: Ganesh's official spec sheet (A-20) has not been received yet.
--       These specs are INTERIM (needs_verification = true for any parameter
--       where the COA spec and the SOP/product sheet may differ).
--       Parameters copied directly from the COA specification column are
--       marked needs_verification = false.
--
-- pH fields: stored and compared to 2 d.p. (the pH meter shows 2 d.p.).
--
-- Table schema mirrors coa_customer_specs (batch-analysis) but is product-scoped:
--   product_code + phase + test_key is the natural key.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create product_qc_specs table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_qc_specs (
    id                uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code      text       NOT NULL,
    phase             text       NOT NULL DEFAULT 'none',  -- 'A' | 'B' | 'none'
    test_key          text       NOT NULL,                 -- matches qc_test_definitions.test_key
    parameter_label   text       NOT NULL,
    unit              text,
    min_value         numeric(12, 4),   -- NULL = no lower limit
    max_value         numeric(12, 4),   -- NULL = no upper limit
    -- needs_verification: true = interim from COA; false = confirmed
    needs_verification boolean   NOT NULL DEFAULT true,
    is_active         boolean    NOT NULL DEFAULT true,
    coa_source        text,             -- batch number / document reference
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_code, phase, test_key)
);

CREATE INDEX IF NOT EXISTS idx_pqc_specs_product
    ON public.product_qc_specs (product_code, phase);

-- RLS
ALTER TABLE public.product_qc_specs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pqc_specs_select" ON public.product_qc_specs;
CREATE POLICY "pqc_specs_select" ON public.product_qc_specs
    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.product_qc_specs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_qc_specs TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Seed specs from COA documents
-- ---------------------------------------------------------------------------

-- ============================================================
-- ZINC SC (Phase A — pre-grinding / Phase B — final product)
-- Source: Zinc oxide 39.15% SC COA, batch JS-04020, 28-08-2026
--         and Zinc oxide 39.5% SC COA (second reference)
-- Specs apply to Phase B (final product). Phase A has no COA spec.
-- ============================================================

-- Phase B (final product specs from COA)
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('ZINC_SC','B','zinc_content',      'Zinc content',                     '%',      39.50, NULL,  false, 'JS-04020 / Zinc oxide 39.15% SC COA'),
    ('ZINC_SC','B','suspension',        'Suspensibility',                   '%',      85.00, NULL,  false, 'JS-04020 / Zinc oxide 39.15% SC COA'),
    ('ZINC_SC','B','ph_direct',         'pH',                               NULL,      8.00, 10.00, false, 'JS-04020 / Zinc oxide 39.15% SC COA'),
    ('ZINC_SC','B','wet_sieve200_result','Wet sieve test (74 micron/200mesh)','%',    99.00, NULL,  false, 'JS-04020 / Zinc oxide 39.15% SC COA'),
    ('ZINC_SC','B','density',           'Specific gravity (at 15°C)',       'g/cm³',   1.71,  1.75, false, 'JS-04020 / Zinc oxide 39.15% SC COA'),
    ('ZINC_SC','B','viscosity',         'Persistent foam (after 1 min)',    'ml',     NULL,  60.00, false, 'JS-04020 / Zinc oxide 39.15% SC COA')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        needs_verification = EXCLUDED.needs_verification,
        coa_source = EXCLUDED.coa_source;

-- Phase A — Zinc content (same spec applies during production check)
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('ZINC_SC','A','zinc_content_a','Zinc content (Phase A check)', '%', 39.50, NULL, true, 'JS-04020 — interim, apply Phase B spec')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value;

-- ============================================================
-- SULPHUR SC
-- Source: Sulphur 55.16%SC COA, batch JS-01028, 2 Sep 2026
-- Phase A = during grinding; Phase B = final product.
-- Sulphur content spec applies to both phases.
-- ============================================================

-- Phase A
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('SULPHUR_SC','A','sulphur_content',      'Sulphur content',               '%',    55.16, NULL,  false, 'JS-01028 / Sulphur 55.16%SC COA'),
    ('SULPHUR_SC','A','wet_sieve200_result',  'Wet sieve test (74 micron)',     '%',    99.00, NULL,  false, 'JS-01028 / Sulphur 55.16%SC COA'),
    ('SULPHUR_SC','A','wet_sieve325_result',  'Wet sieve test (5 micron)',      '%',    99.00, NULL,  true,  'JS-01028 — 5 micron sieve, interim')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
        needs_verification = EXCLUDED.needs_verification, coa_source = EXCLUDED.coa_source;

-- Phase B (final product)
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('SULPHUR_SC','B','sulphur_content',      'Sulphur content',               '%',    55.16, NULL,  false, 'JS-01028 / Sulphur 55.16%SC COA'),
    ('SULPHUR_SC','B','suspensibility',       'Suspensibility',                '%',    85.00, NULL,  false, 'JS-01028 / Sulphur 55.16%SC COA'),
    ('SULPHUR_SC','B','ph_direct',            'pH',                            NULL,    5.00,  8.00, false, 'JS-01028 / Sulphur 55.16%SC COA'),
    ('SULPHUR_SC','B','wet_sieve200_result',  'Wet sieve test (74 micron)',     '%',    99.00, NULL,  false, 'JS-01028 / Sulphur 55.16%SC COA'),
    ('SULPHUR_SC','B','density',              'Density',                       'g/cm³', 1.40,  1.60, false, 'JS-01028 / Sulphur 55.16%SC COA')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
        needs_verification = EXCLUDED.needs_verification, coa_source = EXCLUDED.coa_source;

-- ============================================================
-- LIQUID BORON
-- Source: Boron Ethanolamine COA, batch JS-05013, 15-09-2026
-- ============================================================
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('LIQUID_BORON','none','boron_content', 'Boron (as B)',          '%',   10.00, NULL,  false, 'JS-05013 / Boron Ethanolamine COA'),
    ('LIQUID_BORON','none','ph_5pct',       'pH',                    NULL,   7.50,  9.50, false, 'JS-05013 / Boron Ethanolamine COA'),
    ('LIQUID_BORON','none','density',       'Specific gravity',      'Kg/1', 1.30,  1.40, false, 'JS-05013 / Boron Ethanolamine COA')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
        needs_verification = EXCLUDED.needs_verification, coa_source = EXCLUDED.coa_source;

-- ============================================================
-- LIQUID CALCIUM
-- Source: Concentrated liquid calcium 11% COA, batch JS-06020, 22-08-2026
-- ============================================================
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('LIQUID_CALCIUM','none','calcium_content', 'Calcium (as Ca)', '%',   11.00, NULL,  false, 'JS-06020 / Concentrated liquid calcium 11% COA'),
    ('LIQUID_CALCIUM','none','ph_5pct',          'pH',              NULL,   8.50, 10.50, false, 'JS-06020 / Concentrated liquid calcium 11% COA'),
    ('LIQUID_CALCIUM','none','density',          'Specific gravity','Kg/1', 1.30,  1.40, false, 'JS-06020 / Concentrated liquid calcium 11% COA')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
        needs_verification = EXCLUDED.needs_verification, coa_source = EXCLUDED.coa_source;

-- ============================================================
-- ZIDDI (Sulphur 65% WG + Tebuconazole 10%)
-- Source: Tebuconazole 10% + Sulphur 65% WDG COA, batch JS-03024, 27-08-2026
-- ============================================================
INSERT INTO public.product_qc_specs
    (product_code, phase, test_key, parameter_label, unit, min_value, max_value, needs_verification, coa_source)
VALUES
    ('ZIDDI','none','sulphur_content',        'Sulphur content',         '%w/w', 65.00, NULL,  false, 'JS-03024 / Tebuconazole 10%+Sulphur 65% WDG COA'),
    ('ZIDDI','none','gc_tebu_content',        'Tebuconazole content',    '%w/w', 10.00, NULL,  false, 'JS-03024 / Tebuconazole 10%+Sulphur 65% WDG COA'),
    ('ZIDDI','none','sulphur_suspensibility', 'Suspensibility (sulphur)','%w/w', 80.00, NULL,  false, 'JS-03024 / Tebuconazole 10%+Sulphur 65% WDG COA'),
    ('ZIDDI','none','wet_sieve200_result',    'Wet sieve (200 mesh dry)','%w/w', 99.50, NULL,  false, 'JS-03024 / Tebuconazole 10%+Sulphur 65% WDG COA')
ON CONFLICT (product_code, phase, test_key) DO UPDATE
    SET min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
        needs_verification = EXCLUDED.needs_verification, coa_source = EXCLUDED.coa_source;

COMMIT;
