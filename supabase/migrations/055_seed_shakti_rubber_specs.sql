-- =============================================================================
-- Migration 055 — Seed coa_customer_specs for Shakti and Rubber parties.
--
-- Source: JSCI/QC/17 test reports (SPEC- OF RUBBER AND SHAKTI- NASHIK.docx)
--
--   1. Shakti Synergetics Pvt. Ltd (party_code = 'Shakti')
--      Test Report No. 422, Lot B, Date 25-09-2026, Qty 18.000 MT
--
--   2. Rubber Industries (party_code = 'Rubber')
--      Test Report No. 362, Lot A, Batch No. 336, Date 01-09-2026, Qty 2.000 MT
--
-- MESH CONVENTION NOTE: the spec sheets express mesh limits as "% PASSING min X"
-- (IS-7086). The system stores mesh*_pct as "% RETAINED". Conversion:
--   passing min Y  →  retained max (100 - Y).
-- All converted mesh rows are flagged needs_verification = true so a human can
-- confirm the intent against the physical sheet.
--
-- Parameters with no stated party specification (blank MIN and MAX columns in
-- the report) are NOT seeded — there is nothing to pass/fail against.
--
-- Idempotent: clears any prior seed for these two codes then re-inserts.
-- =============================================================================

-- Ensure customer names are set on the parties rows (seeded from vfd_parameters,
-- which don't carry a customer_name).
UPDATE public.parties
SET customer_name = 'Shakti Synergetics Pvt. Ltd'
WHERE party_code = 'Shakti'
  AND (customer_name IS NULL OR customer_name = 'Shakti');

UPDATE public.parties
SET customer_name = 'Rubber Industries'
WHERE party_code = 'Rubber'
  AND (customer_name IS NULL OR customer_name = 'Rubber');

-- Converge on re-run.
DELETE FROM public.coa_customer_specs
WHERE party_code IN ('Shakti', 'Rubber');

INSERT INTO public.coa_customer_specs
    (party_code, customer_name, parameter, parameter_label, unit,
     min_value, max_value, target_value, needs_verification)
VALUES

    -- ── Shakti Synergetics (JSCI/QC/17, Report 422) ──────────────────────
    --
    -- Only parameters where the sheet shows a Party Specification are seeded.
    --
    -- Purity / solubility in CS2:  min 99.00, no max.
    ('Shakti', 'Shakti Synergetics Pvt. Ltd',
     'purity_percent', 'Purity / solubility in CS2', '%',
     99.00, NULL, NULL, false),

    -- Mesh 200 (75µ): the sheet states "% passing min 70.00".
    -- Converted to retained: max (100 - 70) = max 30.00.  ⚠ needs_verification.
    ('Shakti', 'Shakti Synergetics Pvt. Ltd',
     'mesh200_pct', 'Sieve 200 mesh (75µ) — % retained', '%',
     NULL, 30.00, NULL, true),

    -- ── Rubber Industries (JSCI/QC/17, Report 362) ───────────────────────
    --
    -- Purity / solubility in CS2:  min 99.0, no max.
    ('Rubber', 'Rubber Industries',
     'purity_percent', 'Purity / solubility in CS2', '%',
     99.0, NULL, NULL, false),

    -- Acidity as H2SO4:  no min, max 0.01.
    ('Rubber', 'Rubber Industries',
     'acidity_percent', 'Acidity (as H2SO4)', '%',
     NULL, 0.01, NULL, false),

    -- Ash content:  no min, max 0.15.
    ('Rubber', 'Rubber Industries',
     'ash_percent', 'Ash content', '%',
     NULL, 0.15, NULL, false),

    -- Mesh 100 (150µ):  sheet "% passing min 99.0"  →  retained max 1.0.  ⚠
    ('Rubber', 'Rubber Industries',
     'mesh100_pct', 'Sieve 100 mesh (150µ) — % retained', '%',
     NULL, 1.0, NULL, true),

    -- Mesh 200 (75µ):  sheet "% passing min 94.0"  →  retained max 6.0.  ⚠
    ('Rubber', 'Rubber Industries',
     'mesh200_pct', 'Sieve 200 mesh (75µ) — % retained', '%',
     NULL, 6.0, NULL, true),

    -- Melting point:  min 113°C, max 119°C.
    ('Rubber', 'Rubber Industries',
     'melting_point', 'Melting point', 'C',
     113, 119, NULL, false),

    -- Heat loss at 70°C / 2 hrs:  no min, max 0.15.
    ('Rubber', 'Rubber Industries',
     'heat_loss_percent', 'Heat loss (70°C / 2 hrs)', '%',
     NULL, 0.15, NULL, false);

-- =============================================================================
-- END OF MIGRATION 055
--
-- Shakti specs: 2 rows  (purity, mesh200 ⚠)
-- Rubber specs: 6 rows  (purity, acidity, ash, mesh100 ⚠, mesh200 ⚠, melting,
--                         heat_loss)
--
-- Rows marked needs_verification=true (mesh converted from "% passing" to
-- "% retained"): Shakti mesh200, Rubber mesh100, Rubber mesh200.
-- Confirm these three against the physical sheet before relying on pass/fail.
-- =============================================================================
